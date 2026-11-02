// Orquestador de la ingesta diaria multi-fuente:
// 1) consultar cada boletín activo (cada uno con sus respaldos)
// 2) enriquecer ámbito (solo BOE)  3) guardar en SQLite
// 4) cruzar con alertas  5) notificar a Discord  6) registrar todo en el log

import { obtenerFila, todas, ejecutar, nuevoId, fechaPublicacionIso, hoyIsoUtc, bd } from "./bd.mjs";
import { consultarFuentes, normalizarFuentesActivas } from "./fuentes/index.mjs";
import { obtenerAmbitoBOE, boeDirectoOk } from "./fuentes/boe.mjs";
import { clasificarTipo, mapearAmbito } from "./normalizar.mjs";
import { itemCoincide, boletinesDe } from "./matching.mjs";
import { construirPayload, enviarBot, enviarWebhook, payloadPrueba } from "./discord.mjs";
import { itemsDemo, ambitoDemo } from "./demo.mjs";

const PAUSA_ENRIQUECER_MS = 350; // ritmo respetuoso con boe.es
const MAX_ENRIQUECER = 120;
const MAX_EMBEDS = 10;
// Presupuesto total del enriquecimiento: si boe.es no responde (cortafuegos,
// caída) no se queda 80 minutos intentándolo: tras este tiempo sigue el resto
// de la ingesta y los anuncios se guardan sin ámbito (se enriquecerán en una
// ingesta futura si se repite la fecha).
const PRESUPUESTO_ENRIQUECER_MS = 90_000;

// Bloqueo en proceso para no solapar ingestas
const g = globalThis;

function intentaTomarLock() {
  if (g.__opoalertaIngestando) return false;
  g.__opoalertaIngestando = true;
  return true;
}

function liberaLock() {
  g.__opoalertaIngestando = false;
}

/** ¿Hay una ingesta ejecutándose ahora mismo? (lo consulta el panel para
 * mostrar «ingesta en marcha» en lugar de un 409 críptico). */
export function ingestaEnCurso() {
  return g.__opoalertaIngestando === true;
}

/** Fecha de «hoy» en la zona horaria configurada (por defecto, España). */
export function fechaHoyMadrid() {
  const zona = process.env.ZONA_HORARIA || "Europe/Madrid";
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date()).replace(/-/g, "");
}

export function obtenerAjustes() {
  let ajustes = obtenerFila(`SELECT * FROM Ajustes WHERE id = 1`);
  if (!ajustes) {
    ejecutar(`INSERT INTO Ajustes (id, updatedAt) VALUES (1, ?)`, hoyIsoUtc());
    ajustes = obtenerFila(`SELECT * FROM Ajustes WHERE id = 1`);
  }
  return ajustes;
}

function destinoDe(alerta, ajustes) {
  if (alerta.webhook && alerta.webhook.trim()) return { tipo: "webhook", webhook: alerta.webhook.trim() };
  const token = ajustes.discordBotToken || process.env.DISCORD_BOT_TOKEN || "";
  const canal = alerta.canalId || ajustes.canalPorDefecto || process.env.DISCORD_CANAL_ID || "";
  if (token && canal) return { tipo: "bot", token, canal };
  return { tipo: "ninguno" };
}

async function enviarLotes(destino, alertaNombre, items) {
  let ultimo = { ok: true, detalle: "sin mensajes" };
  for (let i = 0; i < items.length; i += MAX_EMBEDS) {
    const payload = construirPayload(alertaNombre, items.slice(i, i + MAX_EMBEDS));
    ultimo = destino.tipo === "webhook" ? await enviarWebhook(destino.webhook, payload) : await enviarBot(destino.token, destino.canal, payload);
    if (!ultimo.ok) return ultimo;
  }
  return ultimo;
}

/** Clasifica y guarda los items nuevos de una fuente. Los que ya estaban
 * (mismo identificador) se saltan sin fallar. */
function guardarNuevos(fuente, fecha, items, ambitoPorId) {
  const guardados = [];
  for (const it of items) {
    const identificador = fuente === "boe" ? it.identificador : `${fuente}:${it.identificador}`;
    const existe = obtenerFila(`SELECT 1 FROM Convocatoria WHERE identificador = ?`, identificador);
    if (existe) continue;
    const tipo = clasificarTipo(it.titulo);
    const tipoAmbito = it.tipoAmbitoOverride ?? (ambitoPorId.get(it.identificador) ?? null);
    try {
      const id = nuevoId();
      ejecutar(
        `INSERT INTO Convocatoria (id, identificador, titulo, departamento, epigrafe, fechaBOE, fechaPublicacion, urlPdf, urlHtml, tipo, ambito, enriquecido, fuente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        identificador,
        it.titulo,
        it.organismo,
        it.epigrafe ?? null,
        fecha,
        fechaPublicacionIso(fecha),
        it.urlPdf ?? null,
        it.urlHtml ?? null,
        tipo,
        tipoAmbito,
        tipoAmbito ? 1 : 0,
        fuente
      );
      guardados.push({ ...it, tipo, tipoAmbito, fechaBOE: fecha, departamento: it.organismo, dbId: id, fuente });
    } catch (e) {
      // carrera con otra ingesta que acabó de guardarlo: no interrumpe el día
      if (String(e?.code ?? e?.message ?? "").includes("SQLITE_CONSTRAINT_UNIQUE")) continue;
      throw e;
    }
  }
  return guardados;
}

/** Sumario demo con la misma forma que una fuente real. */
function sumarioDemo(fecha) {
  const items = itemsDemo(fecha).map((o) => ({
    identificador: o.identificador,
    titulo: o.titulo,
    organismo: o.departamento,
    epigrafe: "B. OPOSICIONES Y CONCURSOS",
    urlPdf: `https://www.boe.es${o.url_pdf}`,
    urlHtml: `https://www.boe.es${o.url_html}`,
  }));
  return { id: "demo", nombre: "Modo demo (datos de ejemplo)", estado: items.length === 0 ? "sin_datos" : "ok", items };
}

/** Ejecuta la ingesta completa de una fecha (por defecto, hoy en España). */
export async function ejecutarIngesta(opts = {}) {
  const inicio = Date.now();
  const fecha = (opts.fecha || fechaHoyMadrid()).replace(/\D/g, "");
  const origen = opts.origen || "programado";
  const resumen = { estado: "error", fechaBOE: fecha, fuente: "—", itemsSeccion: 0, itemsNuevos: 0, notificados: 0, alertasDisparadas: 0, duracionMs: 0, porFuente: [] };

  const terminar = () => {
    resumen.duracionMs = Date.now() - inicio;
    try {
      for (const f of resumen.porFuente) {
        ejecutar(
          `INSERT INTO IngestaLog (id, fechaBOE, fuente, estado, itemsSeccion, itemsNuevos, notificados, mensaje, duracionMs, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          nuevoId(),
          resumen.fechaBOE,
          f.id,
          f.estado,
          f.items,
          f.nuevos,
          f.notificados,
          f.detalle ?? resumen.mensaje ?? null,
          resumen.duracionMs,
          origen
        );
      }
    } catch {
      /* no bloquear por fallo de log */
    }
    liberaLock();
    return resumen;
  };

  if (!/^\d{8}$/.test(fecha)) {
    resumen.mensaje = "Fecha no válida (formato esperado: AAAAMMDD)";
    return terminar();
  }
  if (!intentaTomarLock()) {
    return { ...resumen, estado: "omitida", mensaje: "Ya hay una ingesta en marcha", duracionMs: Date.now() - inicio };
  }

  let ajustes;
  try {
    ajustes = obtenerAjustes();
  } catch (e) {
    liberaLock();
    return { ...resumen, mensaje: `No se pudo leer la BD: ${e instanceof Error ? e.message : e}` };
  }

  try {
    const modo = ajustes.fuente === "demo" ? "demo" : "real";

    // 1) Consulta de los boletines activos (cada uno con su respaldo interno)
    let resultados;
    if (modo === "demo") {
      resultados = [sumarioDemo(fecha)];
    } else {
      const activas = normalizarFuentesActivas(ajustes.fuentesActivas);
      resultados = await consultarFuentes(fecha, activas);
    }
    resumen.fuente = modo === "demo" ? "demo" : resultados.length > 1 ? "multi" : resultados[0]?.id ?? "ninguno";
    resumen.itemsSeccion = resultados.reduce((n, r) => n + r.items.length, 0);

    if (resultados.every((r) => r.estado === "error")) {
      resumen.estado = "error";
      resumen.mensaje = `Todos los boletines fallaron → ${resultados.map((r) => `${r.id}: ${r.detalle}`).join(" | ")}`.slice(0, 900);
      resumen.porFuente = resultados.map((r) => ({ id: r.id, nombre: r.nombre, estado: r.estado, items: 0, nuevos: 0, notificados: 0, detalle: r.detalle }));
      return terminar();
    }

    // 2) Enriquecimiento del ámbito (opcional, secuencial y pausado; en demo
    //    se simula con la tabla de ámbitos de ejemplo). Se salta de plano si
    //    boe.es no fue alcanzable directamente en la 1.ª pasada (las fichas
    //    individuales usan el mismo portal: sería quemar el presupuesto por
    //    nada); con red a medias se aborta pronto: 3 fallos seguidos o
    //    presupuesto agotado.
    const ambitoPorId = new Map();
    if (ajustes.enriquecer) {
      const boe = resultados.find((r) => r.id === "boe" || r.id === "demo");
      if (boe && (modo === "demo" || boeDirectoOk())) {
        const aEnriquecer = boe.items.slice(0, MAX_ENRIQUECER);
        const finPresupuesto = Date.now() + PRESUPUESTO_ENRIQUECER_MS;
        let fallosSeguidos = 0;
        for (const it of aEnriquecer) {
          if (Date.now() > finPresupuesto) {
            resumen.mensaje = "Enriquecimiento del ámbito abortado (boe.es no responde); anuncios guardados sin ámbito";
            break;
          }
          const ambito = modo === "demo" ? ambitoDemo(it.identificador) : await obtenerAmbitoBOE(it.identificador);
          if (modo === "real" && !ambito) {
            fallosSeguidos++;
            if (fallosSeguidos >= 3) {
              resumen.mensaje = "Enriquecimiento del ámbito abortado (boe.es no responde); anuncios guardados sin ámbito";
              break;
            }
          } else {
            fallosSeguidos = 0;
          }
          ambitoPorId.set(it.identificador, ambito ? mapearAmbito(ambito) : null);
          if (modo === "real") await new Promise((r) => setTimeout(r, PAUSA_ENRIQUECER_MS));
        }
      }
    }

    // 3) Guardar (solo los realmente nuevos) por fuente
    const nuevos = [];
    const nuevosPorFuente = {};
    for (const r of resultados) {
      if (r.estado !== "ok") continue;
      const guardados = guardarNuevos(r.id, fecha, r.items, ambitoPorId);
      nuevos.push(...guardados);
      nuevosPorFuente[r.id] = guardados.length;
    }
    resumen.itemsNuevos = nuevos.length;

    // 4) Cruzar con alertas activas y notificar a Discord
    //    boletinesDe convierte el JSON de la columna a array UNA vez por alerta
    //    (itemCoincide lo usa tal cual: array → ruta rápida sin re-parsear).
    const alertas = todas(`SELECT * FROM Alerta WHERE activa = 1`).map((a) => ({
      ...a,
      soloConvocatorias: a.soloConvocatorias !== 0,
      boletines: boletinesDe(a),
    }));
    let notificados = 0;
    let disparadas = 0;
    const notificadosPorFuente = {};
    for (const a of alertas) {
      const coincidentes = nuevos.filter((an) => itemCoincide(a, an));
      if (coincidentes.length === 0) continue;
      disparadas++;
      const destino = destinoDe(a, ajustes);
      const res = destino.tipo === "ninguno" ? { ok: false, detalle: "Sin destino Discord configurado (webhook de la alerta o bot global + canal)" } : await enviarLotes(destino, a.nombre, coincidentes);
      if (res.ok) notificados += coincidentes.length;
      for (const c of coincidentes) {
        if (res.ok) notificadosPorFuente[c.fuente] = (notificadosPorFuente[c.fuente] ?? 0) + 1;
        try {
          ejecutar(
            `INSERT OR IGNORE INTO Notificacion (id, alertaId, convocatoriaId, estado, detalle) VALUES (?, ?, ?, ?, ?)`,
            nuevoId(),
            a.id,
            c.dbId,
            res.ok ? "ok" : "error",
            res.detalle
          );
        } catch {
          /* deduplicación por alerta+convocatoria */
        }
      }
    }
    resumen.notificados = notificados;
    resumen.alertasDisparadas = disparadas;

    // 5) Aviso «sin novedades» si está activado y no se disparó nada
    if (ajustes.notificarSinNovedades !== 0 && ajustes.notificarSinNovedades !== false && disparadas === 0) {
      for (const a of alertas) {
        const destino = destinoDe(a, ajustes);
        if (destino.tipo === "ninguno") continue;
        const payload = { username: "OpoAlerta", allowed_mentions: { parse: [] }, content: `🔕 **${a.nombre}**: sin coincidencias en los boletines de hoy.` };
        if (destino.tipo === "webhook") await enviarWebhook(destino.webhook, payload);
        else await enviarBot(destino.token, destino.canal, payload);
      }
    }

    // 6) Purga opcional de anuncios antiguos y de registros de ingesta viejos
    //    (mantienen la base compacta: el visor solo enseña las últimas 20 filas)
    const purgaDias = Number(ajustes.purgaDias ?? 180);
    let purgados = 0;
    if (purgaDias > 0) {
      const limite = new Date(Date.now() - purgaDias * 86400000).toISOString();
      purgados = ejecutar(`DELETE FROM Convocatoria WHERE fechaPublicacion < ?`, limite).changes;
    }
    const logsPurgados = ejecutar(`DELETE FROM IngestaLog WHERE createdAt < ?`, new Date(Date.now() - 180 * 86400000).toISOString()).changes;
    if (purgados > 0 || logsPurgados > 0) {
      try {
        // Compacta el WAL para que el fichero -wal no crezca indefinidamente
        bd.pragma("wal_checkpoint(TRUNCATE)");
        // VACUUM solo si la purga ha sido grande (reescribe la BD entera: no es gratis)
        if (purgados > 500) bd.pragma("vacuum");
      } catch {
        /* compactación best-effort */
      }
    }

    resumen.estado = resultados.some((r) => r.estado === "ok") ? "ok" : "sin_datos";
    resumen.porFuente = resultados.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      estado: r.estado,
      items: r.items.length,
      nuevos: nuevosPorFuente[r.id] ?? 0,
      notificados: notificadosPorFuente[r.id] ?? 0,
      ...(r.detalle ? { detalle: r.detalle } : {}),
    }));
    if (nuevos.length === 0) resumen.mensaje = "Sin anuncios nuevos (ya estaban guardados o ningún boletín publicó empleo ese día)";
    return terminar();
  } catch (e) {
    resumen.mensaje = e instanceof Error ? e.message : String(e);
    return terminar();
  }
}

/** Ventana del relleno de días perdidos: BACKFILL_DIAS (7 por defecto).
 * Tope 30 desde la v2.3.17 (antes 14): pide hasta 20 días de margen. Cada día
 * ya cubierto se descarta con una consulta índexada, así que una ventana
 * amplia no cuesta nada si no hay huecos. */
export function diasBackfill() {
  const n = parseInt(process.env.BACKFILL_DIAS ?? "", 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 7, 0), 30); // 0 = desactivado (¡no puede caer al 7 por defecto!)
}

/** Al arrancar: ingesta de los días que no tengan log correcto (p. ej. si el
 * servidor estuvo apagado a la hora de la ingesta diaria). Se va de MÁS ANTIGUO
 * a más reciente: así el último registro de cada fuente es siempre el día más
 * nuevo y el panel de estado muestra la realidad de hoy. */
export async function backfillArranque() {
  const zona = process.env.ZONA_HORARIA || "Europe/Madrid";
  const dias = diasBackfill();
  for (let i = dias - 1; i >= 0; i--) {
    const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date(Date.now() - i * 86400000)).replace(/-/g, "");
    const yaOk = obtenerFila(`SELECT id FROM IngestaLog WHERE fechaBOE = ? AND estado = 'ok' LIMIT 1`, fecha);
    if (yaOk) continue;
    try {
      await ejecutarIngesta({ fecha, origen: i === 0 ? "arranque" : "reintento" });
    } catch {
      /* el log ya registra el error */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** v2.3.17: relleno de huecos SIN hoy (hoy acaba de intentarse en la ingesta
 * programada). Lo llama el planificador tras el ÚLTIMO horario del día: así,
 * si un día falló la ingesta y el contenedor siguió en pie durante semanas,
 * ese día se recupera al día siguiente sin necesidad de reiniciar. Mismas
 * reglas que el de arranque: solo días sin log «ok», de más antiguo a más
 * reciente, e idempotente (los anuncios ya guardados se saltan, así que no
 * hay notificaciones repetidas a Discord). */
export async function backfillDiario() {
  const zona = process.env.ZONA_HORARIA || "Europe/Madrid";
  const dias = diasBackfill();
  for (let i = dias - 1; i >= 1; i--) {
    const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date(Date.now() - i * 86400000)).replace(/-/g, "");
    const yaOk = obtenerFila(`SELECT id FROM IngestaLog WHERE fechaBOE = ? AND estado = 'ok' LIMIT 1`, fecha);
    if (yaOk) continue;
    try {
      await ejecutarIngesta({ fecha, origen: "reintento" });
    } catch {
      /* el log ya registra el error */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Prueba de destino Discord desde la web. */
export async function probarDestino(alerta, nombre) {
  const ajustes = obtenerAjustes();
  const destino = destinoDe(alerta, ajustes);
  if (destino.tipo === "ninguno") return { ok: false, detalle: "Sin destino: añade un webhook a esta alerta o configura el bot global + canal en Ajustes" };
  const payload = payloadPrueba(destino.tipo === "webhook" ? "webhook de la alerta" : "bot de Discord");
  return destino.tipo === "webhook" ? enviarWebhook(destino.webhook, payload) : await enviarBot(destino.token, destino.canal, payload);
}

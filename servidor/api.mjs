// Servidor HTTP (node:http, sin frameworks) + enrutador de la API + estáticos.
// Seguridad:
// · Cabeceras duras + CSP estricta (script/style/img/connect solo 'self').
// · ADMIN_TOKEN (si está definido) exige cabecera x-admin-token (o ?token=)
//   para toda escritura y para leer /api/consola. Comparación en tiempo
//   constante (node:crypto.timingSafeEqual).
// · Cuerpo JSON con tope de tamaño; rutas/methods cerrados por defecto.
// · Límite simple de peticiones de escritura por IP.
// · PERMITIR_EMBEBER=1 relaja X-Frame-Options/frame-ancestors para poder
//   mostrar el panel embebido (paneles de vista previa tipo iframe); por
//   defecto (0) la app NO puede enmarcarse, como manda el endurecimiento.

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

import { asegurarEsquema, obtenerFila, todas, ejecutar, nuevoId, hoyIsoUtc, normalizarBooleanos } from "./bd.mjs";
import { ejecutarIngesta, fechaHoyMadrid, obtenerAjustes, probarDestino, ingestaEnCurso } from "./ingesta.mjs";
import { estadoScheduler } from "./scheduler.mjs";
import { leerConsola, limpiarConsola } from "./consola.mjs";
import { validarWebhook } from "./discord.mjs";
import { FUENTES, IDS_FUENTES, verificarFuentes } from "./fuentes/index.mjs";
import { itemCoincide } from "./matching.mjs";
import { permitirEntrada, cortafuegosActivo, cortafuegosEntradaActivo } from "./cortafuegos.mjs";
import { fechaBonita } from "./normalizar.mjs";

const VERSION = "2.3.6";
const RAIZ_PUBLICO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "publico");
const TAM_PAGINA = 20;
const MAX_CUERPO = 256 * 1024;
const AMBITOS = ["todos", "estatal", "autonomica", "provincial", "local"];

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

// ─── Seguridad ───────────────────────────────────────────────────────────────

function igualConstante(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // compara contra sí mismo para gastar el mismo tiempo y devolver false
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function autorizado(req, url) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true;
  const recibido = req.headers["x-admin-token"] || url.searchParams.get("token") || "";
  return recibido && igualConstante(recibido, token);
}

function cabecerasSeguridad() {
  // PERMITIR_EMBEBER=1 (solo para demostraciones): quita X-Frame-Options y permite
  // frame-ancestors * para que un iframe externo (vista previa) lo muestre.
  const embebible = process.env.PERMITIR_EMBEBER === "1";
  return {
    "X-Content-Type-Options": "nosniff",
    ...(embebible ? {} : { "X-Frame-Options": "DENY" }),
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors ${embebible ? "*" : "'none'"}; base-uri 'none'; form-action 'self'`,
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

// Límite de escrituras: 40 por minuto por IP (los flujos normales usan 3-4).
const marcasPorIp = new Map();
function limiteEscrituras(ip) {
  const ahora = Date.now();
  const lista = (marcasPorIp.get(ip) ?? []).filter((t) => ahora - t < 60000);
  lista.push(ahora);
  marcasPorIp.set(ip, lista);
  if (marcasPorIp.size > 5000) marcasPorIp.clear();
  return lista.length <= 40;
}

// ─── Utilidades de respuesta ─────────────────────────────────────────────────

function json(res, codigo, cuerpo) {
  const datos = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...cabecerasSeguridad(),
  });
  res.end(datos);
}

function error500(res, e) {
  console.error("[opoalerta] error interno:", e instanceof Error ? e.message : e);
  json(res, 500, { error: "Error interno del servidor" });
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let tamano = 0;
    const trozos = [];
    req.on("data", (t) => {
      tamano += t.length;
      if (tamano > MAX_CUERPO) {
        rechazar(new Error("cuerpo demasiado grande"));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on("end", () => resolver(Buffer.concat(trozos).toString("utf-8")));
    req.on("error", rechazar);
  });
}

// ─── Estáticos ───────────────────────────────────────────────────────────────

// Caché LRU minúscula de estáticos (los archivos son pocos y pequeños):
// evita leer del disco en cada petición sin gastar memoria apreciable.
const cacheEstaticos = new Map();
const CACHE_ESTATICOS_MAX = 15;

function servirEstatico(res, ruta) {
  const limpia = normalize(ruta).replace(/^(\.\.[/\\])+/, "");
  // BUG v2.0.0 corregido: las páginas piden /static/estilo.css, /static/app.js…,
  // pero el código no quitaba el prefijo /static y buscaba en publico/static/
  // (que no existe): TODOS los estáticos daban 404 y la GUI se veía sin estilos
  // ni JavaScript. Ahora /static/X se sirve desde publico/X.
  const relativa = limpia.startsWith("/static/") ? limpia.slice("/static".length) : limpia;
  const archivo = relativa === "/" || relativa === "" ? join(RAIZ_PUBLICO, "index.html") : join(RAIZ_PUBLICO, relativa);
  if (!archivo.startsWith(RAIZ_PUBLICO) || !existsSync(archivo) || !statSync(archivo).isFile()) return false;
  const tipo = TIPOS[extname(archivo)] ?? "application/octet-stream";
  const cacheo = extname(archivo) === ".html" ? "no-store" : "public, max-age=3600";
  const clave = `${archivo}:${statSync(archivo).mtimeMs}`;
  let cuerpo = cacheEstaticos.get(archivo)?.clave === clave ? cacheEstaticos.get(archivo).cuerpo : null;
  if (!cuerpo) {
    cuerpo = readFileSync(archivo);
    if (cacheEstaticos.size >= CACHE_ESTATICOS_MAX) cacheEstaticos.delete(cacheEstaticos.keys().next().value);
    cacheEstaticos.set(archivo, { clave, cuerpo });
  }
  res.writeHead(200, { "Content-Type": tipo, "Cache-Control": cacheo, ...cabecerasSeguridad() });
  res.end(cuerpo);
  return true;
}

// ─── Manejadores de la API ───────────────────────────────────────────────────

async function apiHealth(res) {
  json(res, 200, { ok: true, servicio: "opoalerta-docker", version: VERSION, ts: new Date().toISOString() });
}

async function apiEstado(res) {
  const hoy = fechaHoyMadrid();
  const totalConvocatorias = obtenerFila(`SELECT COUNT(*) AS n FROM Convocatoria`).n;
  const hoyN = obtenerFila(`SELECT COUNT(*) AS n FROM Convocatoria WHERE fechaBOE = ?`, hoy).n;
  const alertasActivas = obtenerFila(`SELECT COUNT(*) AS n FROM Alerta WHERE activa = 1`).n;
  const alertasTotal = obtenerFila(`SELECT COUNT(*) AS n FROM Alerta`).n;
  const notificacionesOk = obtenerFila(`SELECT COUNT(*) AS n FROM Notificacion WHERE estado = 'ok'`).n;
  const ultimaConvocatoria = obtenerFila(`SELECT fechaBOE FROM Convocatoria ORDER BY fechaBOE DESC LIMIT 1`);
  const logs = todas(`SELECT * FROM IngestaLog ORDER BY createdAt DESC LIMIT 20`).map(normalizarBooleanos);
  const ajustes = obtenerAjustes();
  const mem = process.memoryUsage();

  // Estado de la última ingesta por fuente (para la página de estado).
  // IMPORTANTE: por fuente se toma la fila del BOLETÍN MÁS RECIENTE que tenga
  // registro (y dentro de esa fecha, la ejecución más nueva). Antes se ordenaba
  // solo por createdAt: como el backfill inserta primero hoy y después los días
  // anteriores, la página mostraba el estado del día MÁS VIEJO (p. ej. el error
  // de un BOE hace 7 días) dando la impresión de que el boletín estaba caído.
  const filasEstado = todas(
    `SELECT fuente, estado, fechaBOE, mensaje FROM (
       SELECT id, fuente, estado, fechaBOE, mensaje,
              ROW_NUMBER() OVER (PARTITION BY fuente ORDER BY fechaBOE DESC, createdAt DESC) AS rn
       FROM IngestaLog
     ) WHERE rn = 1`
  );
  const resumenPorFuente = todas(
    `SELECT fuente, SUM(itemsNuevos) AS itemsNuevos, COUNT(*) AS ingestas, MAX(createdAt) AS ultima, MAX(fechaBOE) AS ultimaFecha
     FROM IngestaLog GROUP BY fuente`
  );
  const fuentesEstado = FUENTES.map((f) => {
    const g = resumenPorFuente.find((x) => x.fuente === f.id);
    const estadoFila = filasEstado.find((x) => x.fuente === f.id);
    return {
      clave: f.id,
      nombre: f.nombre,
      convocatorias: g?.itemsNuevos ?? 0,
      ingestas: g?.ingestas ?? 0,
      ultimaEjecucion: g?.ultima ?? null,
      estado: estadoFila?.estado ?? "sin_ejecutar",
      fechaBOE: estadoFila?.fechaBOE ?? null,
      mensaje: estadoFila?.mensaje ?? null,
    };
  });

  json(res, 200, {
    stats: { totalConvocatorias, hoy: hoyN, alertasActivas, alertasTotal, notificacionesOk, hoyFecha: hoy },
    ultimaFechaBOE: ultimaConvocatoria?.fechaBOE ?? null,
    ingestaEnCurso: ingestaEnCurso(),
    logs,
    scheduler: estadoScheduler(),
    ajustes: {
      ...normalizarBooleanos(ajustes),
      discordBotToken: ajustes.discordBotToken ? `••••${ajustes.discordBotToken.slice(-4)}` : null,
      tieneToken: !!ajustes.discordBotToken,
      fuentesActivas: normalizarFuentesActivas(ajustes.fuentesActivas),
    },
    fuentes: FUENTES.map((f) => ({ id: f.id, nombre: f.nombre, ambito: f.ambito, licencia: f.licencia })),
    fuentesEstado,
    ram: { rssMB: Math.round((mem.rss / 1048576) * 10) / 10, heapMB: Math.round((mem.heapUsed / 1048576) * 10) / 10 },
    cortafuegos: { salida: cortafuegosActivo() ? "lista" : "off", entrada: cortafuegosEntradaActivo() ? "lan" : "off" },
    version: VERSION,
  });
}

function normalizarFuentesActivas(valor) {
  if (!valor) return null;
  try {
    const lista = JSON.parse(valor);
    if (!Array.isArray(lista)) return null;
    const validos = lista.filter((x) => typeof x === "string" && IDS_FUENTES.includes(x));
    return validos.length > 0 ? validos : null;
  } catch {
    return null;
  }
}

async function apiIngesta(req, res, url) {
  if (req.method === "GET") {
    json(res, 200, { hoy: fechaHoyMadrid(), enCurso: ingestaEnCurso() });
    return;
  }
  let fecha;
  let origen = "manual";
  try {
    const c = JSON.parse((await leerCuerpo(req)) || "{}");
    fecha = c.fecha?.replace(/\D/g, "");
    if (c.origen === "prueba") origen = "prueba";
  } catch {
    /* sin cuerpo: hoy */
  }
  const resumen = await ejecutarIngesta({ fecha, origen });
  // 409 = ya había una ingesta en marcha. Se añade «error» para que cualquier
  // cliente (no solo este panel) muestre un mensaje claro y no un «HTTP 409».
  json(res, resumen.estado === "omitida" ? 409 : 200, {
    ...resumen,
    ...(resumen.estado === "omitida" ? { error: resumen.mensaje ?? "Ya hay una ingesta en marcha" } : {}),
  });
}

async function apiConvocatorias(res, url) {
  const p = url.searchParams;
  const q = (p.get("q") || "").trim();
  const tipo = p.get("tipo") || "";
  const ambito = p.get("ambito") || "";
  const fuente = p.get("fuente") || "";
  const desde = (p.get("desde") || "").replace(/\D/g, "");
  const hasta = (p.get("hasta") || "").replace(/\D/g, "");
  const pagina = Math.max(parseInt(p.get("pagina") || "1", 10) || 1, 1);

  const condiciones = [];
  const params = [];
  if (tipo) {
    condiciones.push("tipo = ?");
    params.push(tipo);
  }
  if (ambito) {
    condiciones.push("ambito = ?");
    params.push(ambito);
  }
  if (fuente) {
    condiciones.push("fuente = ?");
    params.push(fuente);
  }
  if (desde) {
    condiciones.push("fechaBOE >= ?");
    params.push(desde);
  }
  if (hasta) {
    condiciones.push("fechaBOE <= ?");
    params.push(hasta);
  }
  if (q) {
    condiciones.push("(titulo LIKE ? ESCAPE '\\' OR departamento LIKE ? ESCAPE '\\')");
    const escapado = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    params.push(`%${escapado}%`, `%${escapado}%`);
  }
  const donde = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
  const total = obtenerFila(`SELECT COUNT(*) AS n FROM Convocatoria ${donde}`, ...params).n;
  const items = todas(
    `SELECT id, identificador, titulo, departamento, fechaBOE, tipo, ambito, urlPdf, urlHtml, enriquecido, fuente FROM Convocatoria ${donde} ORDER BY fechaBOE DESC, titulo ASC LIMIT ? OFFSET ?`,
    ...params,
    TAM_PAGINA,
    (pagina - 1) * TAM_PAGINA
  ).map(normalizarBooleanos);
  json(res, 200, { total, pagina, paginas: Math.max(Math.ceil(total / TAM_PAGINA), 1), items });
}

function validarCuerpoAlerta(c) {
  const errores = [];
  const nombre = String(c.nombre ?? "").trim();
  if (!nombre) errores.push("El nombre es obligatorio");
  const modoKeywords = c.modoKeywords === "cualquiera" ? "cualquiera" : "todas";
  const ambito = AMBITOS.includes(String(c.ambito)) ? String(c.ambito) : "todos";
  const soloConvocatorias = c.soloConvocatorias !== false;
  const activa = c.activa !== false;
  const keywords = String(c.keywords ?? "").trim();
  const organismo = c.organismo ? String(c.organismo).trim() : null;
  const webhook = c.webhook ? String(c.webhook).trim() : null;
  const canalId = c.canalId ? String(c.canalId).replace(/\D/g, "") : null;
  if (webhook && !validarWebhook(webhook)) errores.push("El webhook debe tener el formato https://discord.com/api/webhooks/…");
  if (canalId && !/^\d{5,25}$/.test(canalId)) errores.push("El ID de canal no parece válido");
  return { nombre, keywords, modoKeywords, organismo, ambito, soloConvocatorias, activa, webhook, canalId, errores };
}

async function apiAlertas(req, res) {
  if (req.method === "GET") {
    const hace7dias = new Date(Date.now() - 7 * 86400000).toISOString();
    const alertas = todas(`SELECT * FROM Alerta ORDER BY createdAt DESC`).map((a) => {
      const normalizada = normalizarBooleanos(a);
      return {
        ...normalizada,
        stats: {
          totalNotificaciones: obtenerFila(`SELECT COUNT(*) AS n FROM Notificacion WHERE alertaId = ?`, a.id).n,
          ok7dias: obtenerFila(`SELECT COUNT(*) AS n FROM Notificacion WHERE alertaId = ? AND estado = 'ok' AND enviadoAt >= ?`, a.id, hace7dias).n,
        },
        ultimaNotificacion: obtenerFila(`SELECT enviadoAt FROM Notificacion WHERE alertaId = ? ORDER BY enviadoAt DESC LIMIT 1`, a.id)?.enviadoAt ?? null,
      };
    });
    json(res, 200, { alertas });
    return;
  }
  // POST
  let c;
  try {
    c = JSON.parse((await leerCuerpo(req)) || "{}");
  } catch {
    json(res, 400, { error: "Cuerpo JSON no válido" });
    return;
  }
  const datos = validarCuerpoAlerta(c);
  if (datos.errores.length > 0) {
    json(res, 400, { error: datos.errores.join(" · ") });
    return;
  }
  const id = nuevoId();
  ejecutar(
    `INSERT INTO Alerta (id, nombre, keywords, modoKeywords, organismo, ambito, soloConvocatorias, activa, webhook, canalId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    datos.nombre,
    datos.keywords,
    datos.modoKeywords,
    datos.organismo,
    datos.ambito,
    datos.soloConvocatorias ? 1 : 0,
    datos.activa ? 1 : 0,
    datos.webhook,
    datos.canalId
  );
  json(res, 201, { alerta: normalizarBooleanos(obtenerFila(`SELECT * FROM Alerta WHERE id = ?`, id)) });
}

async function apiAlertaId(req, res, url, id) {
  const actual = obtenerFila(`SELECT * FROM Alerta WHERE id = ?`, id);
  if (!actual) {
    json(res, 404, { error: "Alerta no encontrada" });
    return;
  }
  if (req.method === "DELETE") {
    ejecutar(`DELETE FROM Notificacion WHERE alertaId = ?`, id);
    ejecutar(`DELETE FROM Alerta WHERE id = ?`, id);
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "PATCH") {
    let c;
    try {
      c = JSON.parse((await leerCuerpo(req)) || "{}");
    } catch {
      json(res, 400, { error: "Cuerpo JSON no válido" });
      return;
    }
    const datos = {};
    if (c.nombre !== undefined) {
      const nombre = String(c.nombre).trim();
      if (!nombre) {
        json(res, 400, { error: "El nombre no puede estar vacío" });
        return;
      }
      datos.nombre = nombre;
    }
    if (c.keywords !== undefined) datos.keywords = String(c.keywords).trim();
    if (c.modoKeywords !== undefined) datos.modoKeywords = c.modoKeywords === "cualquiera" ? "cualquiera" : "todas";
    if (c.organismo !== undefined) datos.organismo = c.organismo ? String(c.organismo).trim() : null;
    if (c.ambito !== undefined) datos.ambito = AMBITOS.includes(String(c.ambito)) ? String(c.ambito) : "todos";
    if (c.soloConvocatorias !== undefined) datos.soloConvocatorias = c.soloConvocatorias !== false ? 1 : 0;
    if (c.activa !== undefined) datos.activa = c.activa !== false ? 1 : 0;
    if (c.webhook !== undefined) {
      const webhook = c.webhook ? String(c.webhook).trim() : null;
      if (webhook && !validarWebhook(webhook)) {
        json(res, 400, { error: "El webhook debe tener el formato https://discord.com/api/webhooks/…" });
        return;
      }
      datos.webhook = webhook;
    }
    if (c.canalId !== undefined) {
      const canalId = c.canalId ? String(c.canalId).replace(/\D/g, "") : null;
      if (canalId && !/^\d{5,25}$/.test(canalId)) {
        json(res, 400, { error: "El ID de canal no parece válido" });
        return;
      }
      datos.canalId = canalId;
    }
    const asignaciones = Object.keys(datos).map((k) => `${k} = ?`);
    if (asignaciones.length > 0) {
      ejecutar(`UPDATE Alerta SET ${asignaciones.join(", ")} WHERE id = ?`, ...Object.values(datos), id);
    }
    json(res, 200, { alerta: normalizarBooleanos(obtenerFila(`SELECT * FROM Alerta WHERE id = ?`, id)) });
    return;
  }
  json(res, 405, { error: "Método no permitido" });
}

async function apiAlertaProbar(req, res, id) {
  const alerta = obtenerFila(`SELECT * FROM Alerta WHERE id = ?`, id);
  if (!alerta) {
    json(res, 404, { error: "Alerta no encontrada" });
    return;
  }
  const envio = await probarDestino(alerta, alerta.nombre);
  const desde = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date(Date.now() - 7 * 86400000)).replace(/-/g, "");
  const guardadas = todas(
    `SELECT identificador, titulo, departamento, fechaBOE, tipo, ambito, fuente FROM Convocatoria WHERE fechaBOE >= ? ORDER BY fechaBOE DESC LIMIT 500`,
    desde
  );
  const coincidentes = guardadas.filter((g) =>
    itemCoincide({ ...alerta, soloConvocatorias: alerta.soloConvocatorias !== 0 }, { titulo: g.titulo, departamento: g.departamento, tipo: g.tipo, tipoAmbito: g.ambito ?? undefined })
  );
  json(res, 200, {
    envio,
    coincidencias7dias: { total: coincidentes.length, ejemplo: coincidentes.slice(0, 5).map((c) => ({ titulo: c.titulo, fechaBOE: c.fechaBOE, tipo: c.tipo, fuente: c.fuente })) },
  });
}

function conFuentesActivas(a) {
  return { ...normalizarBooleanos(a), discordBotToken: a.discordBotToken ? `••••${a.discordBotToken.slice(-4)}` : null, tieneToken: !!a.discordBotToken, fuentesActivas: normalizarFuentesActivas(a.fuentesActivas) };
}

async function apiAjustes(req, res) {
  if (req.method === "GET") {
    json(res, 200, { ajustes: conFuentesActivas(obtenerAjustes()) });
    return;
  }
  // PUT
  obtenerAjustes();
  let c;
  try {
    c = JSON.parse((await leerCuerpo(req)) || "{}");
  } catch {
    json(res, 400, { error: "Cuerpo JSON no válido" });
    return;
  }
  const datos = {};
  if (c.fuente !== undefined) datos.fuente = c.fuente === "demo" ? "demo" : "real";
  if (c.fuentesActivas !== undefined) {
    if (Array.isArray(c.fuentesActivas)) {
      const validas = c.fuentesActivas.filter((x) => typeof x === "string" && IDS_FUENTES.includes(x));
      datos.fuentesActivas = validas.length > 0 ? JSON.stringify(validas) : null; // lista vacía = todas
    } else {
      datos.fuentesActivas = null;
    }
  }
  if (c.enriquecer !== undefined) datos.enriquecer = c.enriquecer !== false ? 1 : 0;
  if (c.notificarSinNovedades !== undefined) datos.notificarSinNovedades = c.notificarSinNovedades !== false ? 1 : 0;
  if (c.purgaDias !== undefined) {
    const dias = parseInt(String(c.purgaDias), 10);
    datos.purgaDias = Number.isFinite(dias) ? Math.min(Math.max(dias, 0), 3650) : 180;
  }
  if (c.canalPorDefecto !== undefined) {
    const canal = c.canalPorDefecto ? String(c.canalPorDefecto).replace(/\D/g, "") : null;
    if (canal && !/^\d{5,25}$/.test(canal)) {
      json(res, 400, { error: "El ID de canal no parece válido" });
      return;
    }
    datos.canalPorDefecto = canal;
  }
  if (c.discordBotToken !== undefined) {
    const token = String(c.discordBotToken).trim();
    if (token.includes("••")) {
      /* enmascarado sin cambios */
    } else if (!token) {
      datos.discordBotToken = null;
    } else if (token.length < 20) {
      json(res, 400, { error: "El token del bot parece demasiado corto" });
      return;
    } else {
      datos.discordBotToken = token;
    }
  }
  const asignaciones = Object.keys(datos).map((k) => `${k} = ?`);
  if (asignaciones.length > 0) {
    ejecutar(`UPDATE Ajustes SET ${asignaciones.join(", ")}, updatedAt = ? WHERE id = 1`, ...Object.values(datos), hoyIsoUtc());
  }
  json(res, 200, { ajustes: conFuentesActivas(obtenerAjustes()) });
}

async function apiConsola(req, res, url) {
  if (req.method === "DELETE") {
    limpiarConsola();
    json(res, 200, { ok: true });
    return;
  }
  const p = url.searchParams;
  const n = parseInt(p.get("n") || "200", 10) || 200;
  const nivel = p.get("nivel") || "todos";
  const lineas = leerConsola(n, nivel);
  json(res, 200, { lineas, total: lineas.length });
}

// ─── Enrutador ───────────────────────────────────────────────────────────────

async function gestionar(req, res) {
  // Cortafuegos de entrada (primera comprobación, antes de procesar nada):
  // el panel solo se sirve a IPs privadas — tu LAN, redes Docker y loopback.
  // Una IP pública de internet recibe un 403 inmediato. (Se registra en la
  // consola del servidor para que se vea quién intentó entrar.)
  const ipOrigen = req.socket.remoteAddress ?? "";
  if (!permitirEntrada(ipOrigen)) {
    console.log(`[cortafuegos-entrada] petición desde IP pública ${ipOrigen} → 403 (solo se sirve a la red local)`);
    json(res, 403, { error: "Acceso solo permitido desde la red local" });
    return;
  }
  let url;
  try {
    url = new URL(req.url ?? "/", `http://${req.headers.host ?? "local"}`);
  } catch {
    json(res, 400, { error: "URL no válida" });
    return;
  }
  const ruta = url.pathname;
  const metodo = (req.method ?? "GET").toUpperCase();

  try {
    // Estáticos y páginas
    if (metodo === "GET" || metodo === "HEAD") {
      if (ruta === "/" || (!ruta.startsWith("/api/") && !ruta.includes(".") && ruta === "/estado-servicio")) {
        if (servirEstatico(res, ruta === "/" ? "/" : "/estado.html")) return;
      }
      if (ruta === "/favicon.ico" && servirEstatico(res, "/favicon.svg")) return;
      if (ruta.startsWith("/static/") && servirEstatico(res, ruta)) return;
      if (ruta === "/robots.txt") {
        res.writeHead(200, { "Content-Type": "text/plain", ...cabecerasSeguridad() });
        res.end("User-agent: *\nDisallow: /\n");
        return;
      }
    }

    // API
    if (ruta.startsWith("/api/")) {
      const escritura = metodo !== "GET" && metodo !== "HEAD";
      const requiereToken = escritura || ruta === "/api/consola";
      if (requiereToken && !autorizado(req, url)) {
        json(res, 401, { error: "Falta el token de administración (cabecera x-admin-token)" });
        return;
      }
      if (escritura && !limiteEscrituras(req.socket.remoteAddress ?? "?")) {
        json(res, 429, { error: "Demasiadas peticiones, espera un minuto" });
        return;
      }
      // El esquema está garantizado antes de tocar la BD (ver indice.mjs);
      // comprobación barata por si algo llegó antes:
      asegurarEsquema();

      if (ruta === "/api/health") return apiHealth(res);
      if (ruta === "/api/estado") return apiEstado(res);
      if (ruta === "/api/ingesta") return apiIngesta(req, res, url);
      if (ruta === "/api/convocatorias") return apiConvocatorias(res, url);
      if (ruta === "/api/alertas") return apiAlertas(req, res);
      if (ruta === "/api/ajustes") return apiAjustes(req, res);
      if (ruta === "/api/consola") return apiConsola(req, res, url);
      if (ruta === "/api/fuentes/verificar") {
        json(res, 200, { fuentes: await verificarFuentes() });
        return;
      }
      const mAlerta = /^\/api\/alertas\/([^/]+)$/.exec(ruta);
      if (mAlerta) return apiAlertaId(req, res, url, decodeURIComponent(mAlerta[1]));
      const mProbar = /^\/api\/alertas\/([^/]+)\/probar$/.exec(ruta);
      if (mProbar) return apiAlertaProbar(req, res, decodeURIComponent(mProbar[1]));
      json(res, 404, { error: "Ruta no encontrada" });
      return;
    }

    // Páginas bonitas para rutas desconocidas
    if (metodo === "GET" && !ruta.includes(".")) {
      if (servirEstatico(res, "/index.html")) return;
    }
    json(res, 404, { error: "No encontrado" });
  } catch (e) {
    if (!res.headersSent) error500(res, e);
    else res.destroy();
  }
}

/** Arranca el servidor HTTP. */
export function arrancarServidor() {
  const puerto = parseInt(process.env.PORT || "3000", 10);
  // OJO: HOSTNAME (Docker) es el ID del contenedor, no una IP de escucha
  // usable: usarlo hacía que el servidor se atara a una interfaz errónea y el
  // panel no fuera accesible desde fuera. La dirección correcta es HOST.
  const maquina = process.env.HOST || "0.0.0.0";
  const servidor = createServer((req, res) => {
    void gestionar(req, res);
  });
  servidor.listen(puerto, maquina, () => {
    console.log(`[opoalerta] servidor web escuchando en http://${maquina}:${puerto} (v${VERSION})`);
  });
  return servidor;
}

export { fechaBonita };

// Panel de empleo público v2.3.12 · lógica del panel (JavaScript vanilla, sin framework).
// Todas las llamadas van a la API local con credenciales «same-origin».
// Sin estilos en línea: la CSP los bloquea, todo el aspecto vive en estilo.css.

"use strict";

const $ = (id) => document.getElementById(id);

function escapar(texto) {
  const div = document.createElement("div");
  div.textContent = String(texto ?? "");
  return div.innerHTML;
}

function fechaBonita(f) {
  if (!f || f.length !== 8) return f ?? "";
  return `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(0, 4)}`;
}

const ETIQUETAS_TIPO = { convocatoria: "Convocatoria", lista: "Listas / Aprobados", resolucion: "Resolución", correccion: "Corrección", otro: "Otro" };
const ETIQUETAS_AMBITO = { estatal: "Estatal", autonomica: "Autonómico", provincial: "Provincial", local: "Local" };

/** Clase de chip para un id de fuente según su ámbito (estado.fuentes). */
function claseChipFuente(idFuente) {
  const f = (estado?.fuentes ?? []).find((x) => x.id === idFuente);
  if (idFuente === "epso") return "ue";
  if (idFuente === "demo") return "otro";
  const ambito = f?.ambito ?? "otro";
  return ["estatal", "autonomica", "provincial", "local", "mixta"].includes(ambito) ? ambito : "otro";
}

function aviso(titulo, detalle = "", esError = false) {
  const caja = document.createElement("div");
  caja.className = `aviso-flotante${esError ? " error" : ""}`;
  caja.innerHTML = `<div class="titulo">${escapar(titulo)}</div>${detalle ? `<div class="detalle">${escapar(detalle)}</div>` : ""}`;
  $("avisos").appendChild(caja);
  setTimeout(() => caja.remove(), 6500);
}

async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, { cache: "no-store", ...opciones });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(datos.error ?? `HTTP ${res.status}`), { estado: res.status, datos });
  return datos;
}

// ─── Pestañas ────────────────────────────────────────────────────────────────

const pestanas = ["panel", "convocatorias", "alertas", "sistema"];
function irAPestana(nombre) {
  for (const p of pestanas) {
    $("tab-" + p).setAttribute("aria-selected", String(p === nombre));
    $(p).classList.toggle("oculto", p !== nombre);
  }
  if (nombre === "convocatorias") cargarConvocatorias();
  if (nombre === "alertas") cargarAlertas();
  if (nombre === "sistema") { cargarConsola(); cargarFuentes(); }
}
for (const p of pestanas) $("tab-" + p).addEventListener("click", () => irAPestana(p));

// ─── Estado general ──────────────────────────────────────────────────────────

let estado = null;
let ingestaManualEnMarcha = false; // clic local en «Ingestar» (aparte del estado del servidor)

function insigniaModo() {
  const demo = estado?.ajustes?.fuente === "demo";
  $("insignia-modo").innerHTML = demo
    ? `<span class="punto-ambar" aria-hidden="true"></span> Modo demo`
    : `<span class="punto-verde" aria-hidden="true"></span> Boletines reales`;
  $("insignia-modo").title = demo ? "Modo demo con datos de ejemplo" : "Ingesta de boletines oficiales activada";
}

/** Franja de tarjetas con el estado de los 16 boletines. */
function pintarFranjaFuentes() {
  const fuentes = estado?.fuentesEstado ?? [];
  const caja = $("franja-fuentes");
  if (!caja) return;
  if (fuentes.length === 0) {
    caja.innerHTML = `<p class="vacio">Ejecuta la primera ingesta para ver aquí el estado de los 16 boletines.</p>`;
    $("franja-detalle").textContent = "";
    return;
  }
  const conDatos = fuentes.filter((f) => f.estado === "ok").length;
  const conError = fuentes.filter((f) => f.estado === "error").length;
  const sinEjecutar = fuentes.filter((f) => f.estado === "sin_ejecutar").length;
  caja.innerHTML = fuentes
    .map((f) => {
      const clase = `tarjeta-fuente estado-${escapar(f.estado)}`;
      const sub =
        f.estado === "ok" && f.fechaBOE
          ? `boletín ${fechaBonita(f.fechaBOE)}`
          : f.estado === "sin_datos" && f.fechaBOE
            ? `sin empleo el ${fechaBonita(f.fechaBOE)}`
            : f.estado === "error"
              ? "error (ver Sistema)"
              : "sin ejecutar";
      return `<div class="${clase}">
        <div class="fuente-cabecera">
          <span class="fuente-id" title="${escapar(f.nombre)}">${escapar((f.clave ?? "").toUpperCase())}</span>
          <span class="fuente-estado" aria-hidden="true"></span>
        </div>
        <div class="fuente-dato">${f.convocatorias}</div>
        <div class="fuente-sub">${escapar(sub)}</div>
      </div>`;
    })
    .join("");
  const partes = [`${conDatos}/16 boletines con datos en la última ingesta`];
  if (conError > 0) partes.push(`${conError} con error`);
  if (sinEjecutar > 0) partes.push(`${sinEjecutar} sin ejecutar todavía`);
  $("franja-detalle").textContent = `${partes.join(" · ")}. Los boletines que no publican ciertos días (fines de semana y festivos) cuentan como «sin datos», que no es un fallo.`;
}

function pintarEstado() {
  if (!estado) return;
  const s = estado.stats;
  $("stat-total").textContent = s.totalConvocatorias;
  $("stat-hoy").textContent = s.hoy;
  $("stat-alertas").textContent = s.alertasActivas;
  $("stat-alertas-detalle").textContent = `de ${s.alertasTotal} totales`;
  $("stat-avisos").textContent = s.notificacionesOk;
  insigniaModo();
  pintarFranjaFuentes();

  // Scheduler (panel + sistema)
  const activo = estado.scheduler?.activo;
  const horarios = (estado.scheduler?.horarios ?? []).join(" y ");
  $("desc-scheduler").innerHTML = activo
    ? `Programación: <b>${escapar(horarios)}</b> (${escapar(estado.scheduler.zona ?? "")})`
    : "desactivada (puedes ingestar a mano o activarla con ENABLE_SCHEDULER=1)";
  $("sched-estado").innerHTML = activo
    ? `Activo · horarios <code>${escapar(horarios)}</code> (${escapar(estado.scheduler.zona ?? "")})`
    : "Desactivado. Actívalo en Docker con la variable <code>ENABLE_SCHEDULER=1</code> (ya viene así en el docker-compose).";
  const ue = estado.scheduler?.ultimaEjecucion;
  $("sched-ultima").textContent = ue ? `Última ejecución del cron: BOE ${fechaBonita(ue.fecha)} → ${ue.estado} en ${(ue.duracionMs / 1000).toFixed(1)} s` : "";

  // Último log del panel
  const log = estado.logs?.[0];
  $("ultimo-log").innerHTML = log
    ? `<span class="etiqueta ${claseEstado(log.estado)}">${escapar(log.estado)}</span> <span>último intento: ${fechaBonita(log.fechaBOE)} · boletín <code>${escapar(log.fuente)}</code> · ${log.itemsNuevos} nuevos</span>`
    : "";
  $("ultima-fecha").innerHTML = estado.ultimaFechaBOE
    ? `Último boletín con datos guardados: <b>${fechaBonita(estado.ultimaFechaBOE)}</b>`
    : "";

  // Recursos
  $("res-ram").textContent = `RAM: ${estado.ram?.rssMB ?? "…"} MB`;
  $("res-heap").textContent = `Heap JS: ${estado.ram?.heapMB ?? "…"} MB`;

  // Botones de ingesta + aviso «en marcha» (encuesta rápida mientras dura)
  refrescarBotonesIngesta();

  // Ajustes (solo la primera vez)
  if (!ajustesInicializados && estado.ajustes) {
    ajustesInicializados = true;
    $("aj-fuente").value = estado.ajustes.fuente ?? "real";
    $("aj-canal").value = estado.ajustes.canalPorDefecto ?? "";
    $("aj-purga").value = String(estado.ajustes.purgaDias ?? 180);
    $("aj-enr").checked = estado.ajustes.enriquecer !== false;
    $("aj-sinnov").checked = estado.ajustes.notificarSinNovedades === true;
    $("aj-token").placeholder = estado.ajustes.tieneToken ? `configurado (${estado.ajustes.discordBotToken}) — déjalo vacío para mantenerlo` : "MTIzNDU2Nzg5MDEy…";
    // v2.3.13: aviso visible cuando hay token pero falta el canal por defecto
    // (con solo el token el bot no envía nada — error clásico al configurarlo)
    $("aj-bot-aviso").classList.toggle("oculto", !(estado.ajustes.tieneToken && !estado.ajustes.canalPorDefecto));
    activas = estado.ajustes.fuentesActivas; // null = todas
    pintarFuentes();
    $("aj-fuente-aviso").classList.toggle("oculto", estado.ajustes.fuente !== "demo");
  }

  // Tabla de logs de ingesta
  pintarLogs();
}

function claseEstado(v) {
  return v === "ok" ? "ok" : v === "error" ? "error" : v === "sin_datos" || v === "omitida" ? "aviso" : "neutra";
}

function pintarLogs() {
  const logs = estado?.logs ?? [];
  const cuerpo = $("tabla-logs").querySelector("tbody");
  if (logs.length === 0) {
    cuerpo.innerHTML = `<tr><td colspan="9" class="vacio">Todavía no se ha ejecutado ninguna ingesta</td></tr>`;
    return;
  }
  cuerpo.innerHTML = logs
    .slice(0, 15)
    .map(
      (l) => `<tr>
      <td><span class="etiqueta ${claseEstado(l.estado)}">${escapar(l.estado)}</span></td>
      <td class="celda-nofecha">${fechaBonita(l.fechaBOE)}</td>
      <td class="texto-suave">${escapar(l.origen)}</td>
      <td><code>${escapar(l.fuente)}</code></td>
      <td class="num">${l.itemsSeccion}</td>
      <td class="num"><b>${l.itemsNuevos}</b></td>
      <td class="num">${l.notificados}</td>
      <td class="num celda-nofecha">${(l.duracionMs / 1000).toFixed(1)} s</td>
      <td class="celda-mensaje" title="${escapar(l.mensaje ?? "")}">${escapar(l.mensaje ?? "—")}</td>
    </tr>`
    )
    .join("");
}

// Último JSON pintado (sin la RAM, que siempre fluctúa): si el estado no ha
// cambiado desde el sondeo anterior, no se repinta nada (v2.3.11).
let estadoSerializado = null;

async function recargarEstado() {
  try {
    const datos = await api("/api/estado");
    const texto = JSON.stringify({ ...datos, ram: null });
    if (texto === estadoSerializado) return;
    estadoSerializado = texto;
    estado = datos;
    pintarEstado();
  } catch (e) {
    if (e.estado === 401) {
      $("insignia-modo").innerHTML = `<span class="punto-ambar"></span> Token admin requerido`;
    }
  }
}

// ─── Panel: últimas convocatorias + ingesta ─────────────────────────────────

function itemConvocatoria(c, conFuente) {
  const url = escapar(c.urlHtml ?? c.urlPdf ?? "#");
  const chip = conFuente ? `<span class="etiqueta chip-fuente ${claseChipFuente(c.fuente)}">${escapar((c.fuente ?? "").toUpperCase())}</span>` : "";
  const ambito = c.ambito ? `<span class="etiqueta neutra">${escapar(ETIQUETAS_AMBITO[c.ambito] ?? c.ambito)}</span>` : "";
  return `<li>
    <div class="fila">
      <a class="titulo" href="${url}" target="_blank" rel="noreferrer">${escapar(c.titulo)}</a>
      ${c.urlPdf ? `<a class="enlace-pdf" href="${escapar(c.urlPdf)}" target="_blank" rel="noreferrer" aria-label="PDF" title="Abrir PDF">📄</a>` : ""}
    </div>
    <div class="meta">
      <span class="etiqueta fuente">${escapar(ETIQUETAS_TIPO[c.tipo] ?? c.tipo)}</span>
      ${ambito}
      ${chip}
      <span class="org">🏛 ${escapar(c.departamento)}</span>
      <span class="fecha">${fechaBonita(c.fechaBOE)}</span>
    </div>
  </li>`;
}

async function cargarUltimas() {
  try {
    const datos = await api("/api/convocatorias?pagina=1");
    const caja = $("ultimas");
    if (datos.items.length === 0) {
      caja.innerHTML = `<li class="vacio">Todavía no hay convocatorias. Ejecuta la primera ingesta o activa el modo demo en Sistema.</li>`;
      return;
    }
    caja.innerHTML = datos.items.slice(0, 8).map((c) => itemConvocatoria(c, true)).join("");
  } catch {
    /* reintento con la recarga general */
  }
}

async function ingestarAhora(origen = "manual", fecha = undefined) {
  ingestaManualEnMarcha = true;
  refrescarBotonesIngesta();
  try {
    const datos = await api("/api/ingesta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fecha ? { fecha } : {}) });
    pintarResultadoIngesta(datos, origen === "prueba-panel" ? $("resultado-ingesta") : $("resultado-ingesta-2"));
    if (datos.estado === "ok") aviso(`Ingesta completada (${(datos.duracionMs / 1000).toFixed(1)} s)`, `${datos.itemsSeccion} anuncios · ${datos.itemsNuevos} nuevos · ${datos.notificados} avisos Discord`);
    else if (datos.estado === "omitida") aviso("Ya hay una ingesta en marcha", datos.mensaje ?? "Espera a que termine (mira la consola en Sistema).", false);
    else aviso(`La ingesta terminó con estado: ${datos.estado}`, datos.mensaje, true);
  } catch (e) {
    // 409 = el servidor ya estaba ingestando: no es un fallo, solo hay que esperar.
    if (e.estado === 409) {
      if (e.datos) pintarResultadoIngesta(e.datos, origen === "prueba-panel" ? $("resultado-ingesta") : $("resultado-ingesta-2"));
      aviso("Ya hay una ingesta en marcha", e.datos?.mensaje ?? "Cuando termine verás el resultado aquí.", false);
    } else {
      aviso("Error al ejecutar la ingesta", e.message, true);
    }
  } finally {
    ingestaManualEnMarcha = false;
    refrescarBotonesIngesta();
  }
}

/** Marca los botones de ingesta y el aviso «en marcha» según el estado real
 * del servidor (encuestas cada 4 s mientras dura la ingesta). */
function refrescarBotonesIngesta() {
  const enCurso = estado?.ingestaEnCurso === true || ingestaManualEnMarcha;
  const boton = $("boton-ingestar");
  if (boton) {
    boton.disabled = enCurso;
    boton.textContent = enCurso ? "⏳ Ingesta en marcha…" : "🔄 Ingestar ahora";
  }
  const botonFecha = $("boton-ingestar-fecha");
  if (botonFecha) botonFecha.disabled = enCurso;
  const caja = $("ingesta-curso");
  if (caja) caja.classList.toggle("oculto", !enCurso);
}

function pintarResultadoIngesta(datos, caja) {
  if (!caja) return;
  const filas = (datos.porFuente ?? [])
    .map((f) => `<div class="${f.estado === "error" ? "mal" : f.estado === "ok" ? "ok" : ""}">${f.estado === "ok" ? "✓" : f.estado === "error" ? "✗" : "–"} ${escapar(f.id)}: ${f.items} anuncios, ${f.nuevos} nuevos${f.detalle ? ` — ${escapar(f.detalle)}` : ""}</div>`)
    .join("");
  caja.innerHTML = `<div class="resultado-mono">
    <div>estado: ${escapar(datos.estado)} · fuente: ${escapar(datos.fuente)} · ${(datos.duracionMs / 1000).toFixed(1)} s</div>
    <div>anuncios: ${datos.itemsSeccion} · nuevos: ${datos.itemsNuevos} · alertas disparadas: ${datos.alertasDisparadas} · avisos: ${datos.notificados}</div>
    ${filas ? `<div class="mt-10">${filas}</div>` : ""}
    ${datos.mensaje ? `<div class="texto-suave">${escapar(datos.mensaje)}</div>` : ""}
  </div>`;
}

$("boton-ingestar").addEventListener("click", async () => {
  await ingestarAhora("prueba-panel");
  await Promise.all([recargarEstado(), cargarUltimas(), cargarConsola()]);
});
$("boton-ingestar-fecha").addEventListener("click", async () => {
  const fecha = $("aj-fecha").value ? $("aj-fecha").value.replaceAll("-", "") : undefined;
  await ingestarAhora("manual", fecha);
  await Promise.all([recargarEstado(), cargarConsola()]);
});

// ─── Convocatorias ───────────────────────────────────────────────────────────

let paginaConvs = 1;
let tematicasCargadas = false;

function rellenarSelectorFuentes() {
  const sel = $("b-fuente");
  if (sel.options.length > 1 || !estado) return;
  for (const f of estado.fuentes ?? []) {
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = f.id.toUpperCase();
    sel.appendChild(o);
  }
  const oDemo = document.createElement("option");
  oDemo.value = "demo";
  oDemo.textContent = "DEMO";
  sel.appendChild(oDemo);
}

// v2.3.15: temáticas del filtro de búsqueda (una sola vez, desde la API —
// misma lista que usa el servidor para filtrar)
async function rellenarSelectorTematicas() {
  if (tematicasCargadas) return;
  try {
    const datos = await api("/api/tematicas");
    const sel = $("b-tematica");
    for (const t of datos.tematicas ?? []) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.nombre;
      sel.appendChild(o);
    }
    tematicasCargadas = true;
  } catch {}
}

async function cargarConvocatorias() {
  rellenarSelectorFuentes();
  await rellenarSelectorTematicas();
  const params = new URLSearchParams({ pagina: String(paginaConvs) });
  if ($("b-q").value.trim()) params.set("q", $("b-q").value.trim());
  if ($("b-tipo").value) params.set("tipo", $("b-tipo").value);
  if ($("b-ambito").value) params.set("ambito", $("b-ambito").value);
  if ($("b-fuente").value) params.set("fuente", $("b-fuente").value);
  if ($("b-tematica").value) params.set("tematica", $("b-tematica").value);
  if ($("b-desde").value) params.set("desde", $("b-desde").value.replaceAll("-", ""));
  if ($("b-hasta").value) params.set("hasta", $("b-hasta").value.replaceAll("-", ""));
  try {
    const datos = await api(`/api/convocatorias?${params.toString()}`);
    $("c-resumen").textContent = `${datos.total} resultado${datos.total === 1 ? "" : "s"}`;
    $("pag-info").textContent = `Página ${datos.pagina} de ${datos.paginas}`;
    $("pag-anterior").disabled = datos.pagina <= 1;
    $("pag-siguiente").disabled = datos.pagina >= datos.paginas;
    const caja = $("lista-convocatorias");
    if (datos.items.length === 0) {
      caja.innerHTML = `<li class="vacio">Sin resultados con esos filtros.</li>`;
      return;
    }
    caja.innerHTML = datos.items.map((c) => itemConvocatoria(c, true)).join("");
  } catch (e) {
    aviso("No se pudo buscar", e.message, true);
  }
}

$("form-busqueda").addEventListener("submit", (ev) => {
  ev.preventDefault();
  paginaConvs = 1;
  cargarConvocatorias();
});
$("pag-anterior").addEventListener("click", () => { paginaConvs--; cargarConvocatorias(); });
$("pag-siguiente").addEventListener("click", () => { paginaConvs++; cargarConvocatorias(); });

// ─── Alertas ─────────────────────────────────────────────────────────────────

let cacheAlertas = [];

async function cargarAlertas() {
  try {
    const datos = await api("/api/alertas");
    cacheAlertas = datos.alertas;
    const caja = $("lista-alertas");
    if (datos.alertas.length === 0) {
      caja.innerHTML = `<p class="vacio">Sin alertas todavía. Crea la primera con el formulario de la derecha.</p>`;
      return;
    }
    caja.innerHTML = datos.alertas
      .map(
        (a) => `<div class="mini-caja-alerta">
        <div class="fila">
          <span class="alerta-nombre">${escapar(a.nombre)}</span>
          <span class="etiqueta ${a.activa ? "ok" : "neutra"}">${a.activa ? "activa" : "pausada"}</span>
        </div>
        <div class="meta">
          ${a.keywords ? `<span>🔑 ${escapar(a.keywords)}</span>` : "<span>🔑 todas</span>"}
          · modo ${escapar(a.modoKeywords)}
          ${a.organismo ? ` · 🏛 ${escapar(a.organismo)}` : ""}
          · ámbito ${escapar(a.ambito)}
          ${a.soloConvocatorias ? " · solo convocatorias" : " · cualquier comunicación"}
          ${a.webhook ? " · webhook propio" : ""}
          ${a.canalId ? ` · canal ${escapar(a.canalId)}` : ""}
        </div>
        <div class="meta">
          <span class="etiqueta neutra">${a.stats.totalNotificaciones} avisos</span>
          <span class="etiqueta neutra">${a.stats.ok7dias} en 7 días</span>
          ${a.ultimaNotificacion ? `<span class="texto-suave">último: ${new Date(a.ultimaNotificacion).toLocaleString("es-ES")}</span>` : ""}
          <span class="alerta-acciones">
            <button class="boton secundario mini" data-probar="${escapar(a.id)}">Probar</button>
            <button class="boton secundario mini" data-toggle="${escapar(a.id)}" title="${a.activa ? "Deja de aplicar esta alerta en las ingestas" : "Vuelve a aplicar esta alerta"}">${a.activa ? "⏸ Pausar" : "▶ Reactivar"}</button>
            <button class="boton secundario mini" data-editar="${escapar(a.id)}">Editar</button>
            <button class="boton secundario mini peligro" data-borrar="${escapar(a.id)}">Borrar</button>
          </span>
        </div>
      </div>`
      )
      .join("");
  } catch (e) {
    aviso("No se pudieron cargar las alertas", e.message, true);
  }
}

$("lista-alertas").addEventListener("click", async (ev) => {
  const probar = ev.target.closest("[data-probar]");
  const conmutar = ev.target.closest("[data-toggle]");
  const editar = ev.target.closest("[data-editar]");
  const borrar = ev.target.closest("[data-borrar]");
  if (probar) {
    probar.disabled = true;
    try {
      const datos = await api(`/api/alertas/${encodeURIComponent(probar.dataset.probar)}/probar`, { method: "POST" });
      if (datos.envio.ok) aviso("Mensaje de prueba enviado a Discord", `${datos.coincidencias7dias.total} coincidencias en los últimos 7 días`);
      else aviso("No se pudo enviar", datos.envio.detalle, true);
    } catch (e) {
      aviso("Error en la prueba", e.message, true);
    } finally { probar.disabled = false; }
  }
  if (conmutar) {
    const a = cacheAlertas.find((x) => x.id === conmutar.dataset.toggle);
    if (!a) return;
    conmutar.disabled = true;
    try {
      await api(`/api/alertas/${encodeURIComponent(a.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activa: !a.activa }) });
      aviso(a.activa ? "Alerta pausada" : "Alerta reactivada", a.activa ? "No se aplicará en las próximas ingestas hasta que la reactives." : "Volverá a aplicarse en la próxima ingesta.");
      await cargarAlertas();
      await recargarEstado();
    } catch (e) {
      aviso("No se pudo cambiar el estado", e.message, true);
      conmutar.disabled = false;
    }
  }
  if (editar) {
    const a = cacheAlertas.find((x) => x.id === editar.dataset.editar);
    if (!a) return;
    $("e-id").value = a.id;
    $("e-nombre").value = a.nombre;
    $("e-keywords").value = a.keywords ?? "";
    $("e-modo").value = a.modoKeywords;
    $("e-ambito").value = a.ambito;
    $("e-organismo").value = a.organismo ?? "";
    $("e-solo").checked = a.soloConvocatorias !== false;
    $("e-webhook").value = a.webhook ?? "";
    $("e-canal").value = a.canalId ?? "";
    $("dialogo-alerta").showModal();
  }
  if (borrar) {
    if (!confirm("¿Borrar esta alerta y su historial de notificaciones?")) return;
    try {
      await api(`/api/alertas/${encodeURIComponent(borrar.dataset.borrar)}`, { method: "DELETE" });
      aviso("Alerta borrada");
      await cargarAlertas();
      await recargarEstado();
    } catch (e) {
      aviso("No se pudo borrar", e.message, true);
    }
  }
});

$("form-alerta").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const cuerpo = {
    nombre: $("a-nombre").value,
    keywords: $("a-keywords").value,
    modoKeywords: $("a-modo").value,
    organismo: $("a-organismo").value || null,
    ambito: $("a-ambito").value,
    soloConvocatorias: $("a-solo").checked,
    webhook: $("a-webhook").value || null,
    canalId: $("a-canal").value || null,
  };
  try {
    await api("/api/alertas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    aviso("Alerta creada", "Se aplicará en la próxima ingesta");
    ev.target.reset();
    $("a-solo").checked = true;
    await cargarAlertas();
    await recargarEstado();
  } catch (e) {
    aviso("No se pudo crear la alerta", e.message, true);
  }
});

// Plantillas de alerta: rellenan el formulario con un clic (editables antes de crear).
const PLANTILLAS_ALERTA = {
  tic: {
    nombre: "Informática · TIC (grupos A1/A2)",
    keywords:
      "informática, informático, TIC, tecnologías de la información, sistemas y tecnologías de la información, técnico superior TIC, ciberseguridad, ciencia de datos, administración electrónica, ingeniero informático, ingeniería informática, grupo A1, grupo A2",
  },
  laboral: {
    nombre: "Personal laboral (fijo y temporal)",
    keywords: "personal laboral, personal laboral fijo, personal laboral temporal",
  },
  obra: {
    nombre: "Ingeniería de obra (civil y obras públicas)",
    keywords: "ingeniero de obra, ingeniero de obras, ingeniero técnico de obras públicas, ingeniería de obra, obra civil, ingeniero de caminos",
  },
};
for (const boton of document.querySelectorAll("[data-plantilla]")) {
  boton.addEventListener("click", () => {
    const plantilla = PLANTILLAS_ALERTA[boton.dataset.plantilla];
    if (!plantilla) return;
    $("a-nombre").value = plantilla.nombre;
    $("a-keywords").value = plantilla.keywords;
    $("a-modo").value = "cualquiera";
    $("a-nombre").focus();
  });
}

$("e-guardar").addEventListener("click", async (ev) => {
  ev.preventDefault();
  const id = $("e-id").value;
  const cuerpo = {
    nombre: $("e-nombre").value,
    keywords: $("e-keywords").value,
    modoKeywords: $("e-modo").value,
    ambito: $("e-ambito").value,
    organismo: $("e-organismo").value || null,
    soloConvocatorias: $("e-solo").checked,
    webhook: $("e-webhook").value || null,
    canalId: $("e-canal").value || null,
  };
  try {
    await api(`/api/alertas/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    $("dialogo-alerta").close();
    aviso("Alerta actualizada");
    await cargarAlertas();
  } catch (e) {
    aviso("No se pudo guardar", e.message, true);
  }
});

// ─── Sistema: ajustes, fuentes, consola ──────────────────────────────────────

let ajustesInicializados = false;
let activas = null; // null = todas

$("aj-fuente").addEventListener("change", () => $("aj-fuente-aviso").classList.toggle("oculto", $("aj-fuente").value !== "demo"));

$("boton-guardar-ajustes").addEventListener("click", async () => {
  const boton = $("boton-guardar-ajustes");
  boton.disabled = true;
  try {
    const cuerpo = {
      fuente: $("aj-fuente").value,
      fuentesActivas: activas ?? [],
      enriquecer: $("aj-enr").checked,
      notificarSinNovedades: $("aj-sinnov").checked,
      purgaDias: parseInt($("aj-purga").value || "0", 10) || 0,
      canalPorDefecto: $("aj-canal").value || null,
    };
    if ($("aj-token").value.trim()) cuerpo.discordBotToken = $("aj-token").value.trim();
    await api("/api/ajustes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    $("aj-token").value = "";
    aviso("Ajustes guardados", "Se aplicarán en la próxima ingesta");
    ajustesInicializados = false;
    await recargarEstado();
    ajustesInicializados = true;
  } catch (e) {
    aviso("No se pudieron guardar los ajustes", e.message, true);
  } finally { boton.disabled = false; }
});

// v2.3.13: prueba del bot global — envía un mensaje de verdad al canal por
// defecto. Si falta el token o el canal, la API responde 400 con la pieza
// que falta, así que el fallo se ve aquí y no cuando ya corre la ingesta.
$("boton-probar-bot").addEventListener("click", async () => {
  const boton = $("boton-probar-bot");
  boton.disabled = true;
  boton.textContent = "⏳ Probando…";
  try {
    const datos = await api("/api/discord/probar", { method: "POST" });
    if (datos.ok) aviso("Prueba enviada a Discord", `${datos.detalle} — mira el canal por defecto`);
    else aviso("El bot no pudo enviar", datos.detalle, true);
  } catch (e) {
    aviso("No se pudo probar el bot", e.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = "🔊 Probar bot";
  }
});

function pintarFuentes() {
  const fuentes = estado?.fuentes ?? [];
  const caja = $("lista-fuentes");
  if (fuentes.length === 0) return;
  caja.innerHTML = fuentes
    .map((f) => {
      const marcada = activas === null || activas.includes(f.id);
      return `<label><input type="checkbox" data-fuente="${escapar(f.id)}" ${marcada ? "checked" : ""} />
      <span><span class="nombre">${escapar(f.nombre)}</span><br /><span class="ambito">ámbito ${escapar(f.ambito)}</span></span></label>`;
    })
    .join("");
  caja.querySelectorAll("input[data-fuente]").forEach((input) => {
    input.addEventListener("change", () => {
      const base = activas === null ? fuentes.map((x) => x.id) : activas;
      const siguientes = input.checked ? [...new Set([...base, input.dataset.fuente])] : base.filter((x) => x !== input.dataset.fuente);
      activas = siguientes.length === fuentes.length ? null : siguientes;
    });
  });
}

async function cargarFuentes() {
  if (!estado) await recargarEstado();
  rellenarSelectorFuentes();
  pintarFuentes();
}

$("boton-verificar-fuentes").addEventListener("click", async () => {
  const boton = $("boton-verificar-fuentes");
  boton.disabled = true;
  $("verificar-info").textContent = "Comprobando… (puede tardar ~35 s)";
  try {
    const datos = await api("/api/fuentes/verificar");
    const filas = datos.fuentes
      .map((f) => `<div class="${f.ok ? "ok" : "mal"}">${f.ok ? "✓" : "✗"} ${escapar(f.id)}: ${escapar(f.detalle)} (${f.ms} ms)</div>`)
      .join("");
    $("resultado-verificar").innerHTML = `<div class="resultado-mono resultado-scroll">${filas}</div>`;
    const okN = datos.fuentes.filter((f) => f.ok).length;
    $("verificar-info").textContent = `${okN}/${datos.fuentes.length} boletines alcanzables desde este servidor. Los que fallen no tienen salida de red (revisa el firewall del host: salidas 443/tcp).`;
  } catch (e) {
    $("verificar-info").textContent = "";
    aviso("No se pudo verificar", e.message, true);
  } finally { boton.disabled = false; }
});

async function cargarConsola() {
  if ($("panel").classList.contains("oculto") === false && $("sistema").classList.contains("oculto")) return;
  const nivel = $("consola-nivel").value;
  try {
    const datos = await api(`/api/consola?n=300&nivel=${encodeURIComponent(nivel)}`);
    const caja = $("consola-caja");
    if (datos.lineas.length === 0) {
      caja.innerHTML = `<span class="texto-suave">Sin mensajes todavía. Arranca una ingesta y verás aquí todo lo que ocurre.</span>`;
      return;
    }
    caja.innerHTML = datos.lineas
      .map((l) => `<div><span class="hora">${new Date(l.t).toLocaleTimeString("es-ES")}</span> <span class="nivel-${escapar(l.nivel)}">[${escapar(l.nivel)}]</span> ${escapar(l.msg)}</div>`)
      .join("");
    caja.scrollTop = caja.scrollHeight;
  } catch {
    /* silencio */
  }
}
$("consola-nivel").addEventListener("change", cargarConsola);
$("consola-refrescar").addEventListener("click", cargarConsola);
$("consola-limpiar").addEventListener("click", async () => {
  try {
    await api("/api/consola", { method: "DELETE" });
    await cargarConsola();
  } catch (e) {
    aviso("No se pudo limpiar la consola", e.message, true);
  }
});
setInterval(() => { if (!document.hidden && $("consola-auto").checked && !$("sistema").classList.contains("oculto")) cargarConsola(); }, 5000);

// ─── Arranque ────────────────────────────────────────────────────────────────

recargarEstado().then(cargarUltimas);
// Sondeo en pausa mientras la pestaña del navegador no esté visible; refresco
// inmediato al volver a ella (v2.3.11).
setInterval(() => { if (!document.hidden) recargarEstado(); }, 45000);
// Mientras hay una ingesta en marcha, refresco rápido para que el panel
// reaccione en cuanto termine (botones, franja de boletines y listas).
setInterval(() => { if (!document.hidden && estado?.ingestaEnCurso) recargarEstado(); }, 4000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) recargarEstado(); });

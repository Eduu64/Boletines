// OpoAlerta v2.2.0 · página «Estado del servicio» (vanilla JS).
// Sin estilos en línea (la CSP los bloquea): todo con clases de estilo.css.
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

function formato(d) {
  if (!d) return "—";
  const fecha = new Date(d);
  return Number.isNaN(fecha.getTime()) ? "—" : fecha.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function insignia(estado) {
  if (estado === "ok") return `<span class="etiqueta ok">✓ Con datos</span>`;
  if (estado === "error") return `<span class="etiqueta error">✗ Error</span>`;
  if (estado === "sin_datos") return `<span class="etiqueta aviso">! Sin datos</span>`;
  if (estado === "omitida") return `<span class="etiqueta neutra">› Omitida</span>`;
  if (estado === "sin_ejecutar") return `<span class="etiqueta neutra">· Sin ejecutar</span>`;
  return `<span class="etiqueta neutra">${escapar(estado)}</span>`;
}

/** Tarjetita de salud de una fuente (grid). */
function tarjetaFuente(f) {
  const clase = `tarjeta-fuente estado-${escapar(f.estado === "—" ? "sin_ejecutar" : f.estado)}`;
  const detalle =
    f.estado === "ok" && f.fechaBOE
      ? `boletín ${fechaBonita(f.fechaBOE)}`
      : f.estado === "sin_datos" && f.fechaBOE
        ? `sin empleo el ${fechaBonita(f.fechaBOE)}`
        : f.estado === "error"
          ? "revisa la consola"
          : "aún sin ingesta";
  return `<div class="${clase}">
    <div class="fuente-cabecera">
      <span class="fuente-id">${escapar((f.clave ?? "").toUpperCase())}</span>
      <span class="fuente-estado" aria-hidden="true"></span>
    </div>
    <div class="fuente-dato">${f.convocatorias}</div>
    <div class="fuente-sub" title="${escapar(f.nombre)}">${escapar(detalle)}</div>
  </div>`;
}

async function cargar() {
  try {
    const res = await fetch("/api/estado", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const datos = await res.json();

    $("e-total").textContent = datos.stats.totalConvocatorias;
    $("e-fecha").textContent = datos.ultimaFechaBOE ? fechaBonita(datos.ultimaFechaBOE) : "—";
    const totalIngestas = (datos.fuentesEstado ?? []).reduce((n, f) => n + (f.ingestas || 0), 0);
    $("e-ingestas").textContent = totalIngestas;

    const filas = datos.fuentesEstado ?? [];

    // Tarjetas de salud (16 fuentes, también las que nunca se han ejecutado)
    $("salud-fuentes").innerHTML = filas.length > 0 ? filas.map(tarjetaFuente).join("") : `<p class="vacio">Sin datos todavía.</p>`;

    // Tabla de detalle
    const cuerpo = $("tabla-fuentes").querySelector("tbody");
    if (filas.length === 0) {
      cuerpo.innerHTML = `<tr><td colspan="5" class="vacio">Todavía no se ha ejecutado ninguna ingesta. Arranca la aplicación o pulsa «Ingestar ahora» en el panel.</td></tr>`;
      return;
    }
    cuerpo.innerHTML = filas
      .map(
        (f) => `<tr>
        <td><span class="fuente-id" title="${escapar(f.nombre)}">${escapar((f.clave ?? "").toUpperCase())}</span> <span class="texto-suave">${escapar(f.nombre)}</span></td>
        <td class="num">${f.convocatorias}</td>
        <td class="num">${f.ingestas}</td>
        <td class="celda-nofecha">${formato(f.ultimaEjecucion)}</td>
        <td>${insignia(f.estado)}${f.fechaBOE ? ` <span class="texto-suave">boletín ${fechaBonita(f.fechaBOE)}</span>` : ""}${f.estado === "error" && f.mensaje ? `<br /><span class="texto-suave" title="${escapar(f.mensaje)}">${escapar(String(f.mensaje).slice(0, 90))}</span>` : ""}</td>
      </tr>`
      )
      .join("");
  } catch (e) {
    const cuerpo = $("tabla-fuentes").querySelector("tbody");
    $("salud-fuentes").innerHTML = "";
    cuerpo.innerHTML = `<tr><td colspan="5" class="vacio">No se pudo leer el estado del servicio (${escapar(e.message)}). ¿Está el servidor en marcha?</td></tr>`;
  }
}

cargar();
setInterval(cargar, 45000);

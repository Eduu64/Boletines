// Fuente BOA · Boletín Oficial de Aragón.
// CGI BRSCGI con la lista HTML del boletín:
//   https://www.boa.aragon.es/cgi-bin/EBOA/BRSCGI?CMD=VERLST&BASE=BOLE&DOCS=1-500&SEC=OPRSS&PUBL=AAAAMMDD
// El parámetro SEC=OPRSS NO filtra: hay que quedarse solo con la subsección
// II.b — Oposiciones y concursos (equivale a la 2B del BOE / B.2 del BOCYL).
// El HTML va en Latin-1 y los <h3 class="boasubseccion"> cierran con <h3> (bug
// del portal), por eso el cierre acepta las dos formas.
// Portado del scraper boa.py del proyecto open source opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const BASE = "https://www.boa.aragon.es";
const LISTA_URL = `${BASE}/cgi-bin/EBOA/BRSCGI?CMD=VERLST&BASE=BOLE&DOCS=1-500&SEC=OPRSS&SEPARADOR=&PUBL={fecha}`;
const SECCION_OPOSICIONES = "II.";
const SUBSECCION_OPOSICIONES = "b)";
const RETROCESO_MAX = 6;

const ITEM_RE_JS =
  /<h2 class="boaseccion">([\s\S]*?)<\/?h2>|<h3 class="boasubseccion">([\s\S]*?)<\/?h3>|<h4 class="boaemisor">([\s\S]*?)<\/?h4>|<h5 class="boatitulo">([\s\S]*?)<\/?h5>/g;
const DOCR_RE = /DOCR=(\d+)/;
const HREF_RE = /href="([^"]*CMD=VERDOC[^"]*)"/;

/** Baja el sumario del día; si ese día no hay boletín con oposiciones, prueba
 * hasta RETROCESO_MAX días antes (fines de semana y retrasos de publicación). */
async function bajarConRetroceso(fecha) {
  const base = new Date(`${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}T00:00:00Z`);
  for (let retroceso = 0; retroceso < RETROCESO_MAX; retroceso++) {
    const f = new Date(base.getTime() - retroceso * 86400000);
    const iso = f.toISOString().slice(0, 10).replace(/-/g, "");
    try {
      const texto = await descargar(LISTA_URL.replace("{fecha}", iso), { accept: "text/html", codificacion: "iso-8859-1" });
      if (texto.includes("DOCR=")) return { texto, fechaResuelta: iso };
    } catch {
      /* sin boletín ese día: seguir retrocediendo */
    }
  }
  return { texto: "", fechaResuelta: fecha };
}

function parsear(raw, fecha) {
  const registros = [];
  let seccion = "";
  let subseccion = "";
  let emisor = "";
  let itemsTotales = 0;
  let vioSeccion = false;
  ITEM_RE_JS.lastIndex = 0;
  let m;
  while ((m = ITEM_RE_JS.exec(raw)) !== null) {
    if (m[1] !== undefined) {
      seccion = limpiarHtml(m[1]);
      subseccion = "";
      vioSeccion = true;
      continue;
    }
    if (m[2] !== undefined) {
      subseccion = limpiarHtml(m[2]);
      continue;
    }
    if (m[3] !== undefined) {
      emisor = limpiarHtml(m[3]);
      continue;
    }
    const titulo = limpiarHtml(m[4]);
    const cola = raw.slice(m.index + m[0].length, m.index + m[0].length + 600);
    const docr = DOCR_RE.exec(cola);
    const href = HREF_RE.exec(cola);
    if (!docr) continue;
    itemsTotales++;
    if (!(seccion.startsWith(SECCION_OPOSICIONES) && subseccion.startsWith(SUBSECCION_OPOSICIONES))) continue;
    const url = href ? BASE + href[1].replace(/&amp;/g, "&") : BASE;
    registros.push({ docr: docr[1], titulo, organismo: emisor, url, fecha });
  }
  // Sanity checks del scraper original: distinguir «día sin oposiciones» de
  // «el parseo dejó de funcionar».
  if (raw.includes("Lista de documentos") && itemsTotales === 0) {
    throw new Error("Lista del BOA sin items parseables (¿cambió el formato?)");
  }
  if (itemsTotales > 0 && !vioSeccion) {
    throw new Error("Boletín del BOA sin secciones (¿cambió el formato?)");
  }
  return registros;
}

async function obtener(fecha) {
  const { texto, fechaResuelta } = await bajarConRetroceso(fecha);
  if (!texto) return [];
  return montar(texto, fechaResuelta);
}

/** Parseo + montaje de items (testeable con fixture, sin red). */
export function montar(raw, fecha) {
  return parsear(raw, fecha).map((r) => ({
    identificador: `boa-${r.fecha}-${r.docr}`,
    titulo: r.titulo,
    organismo: r.organismo || "Gobierno de Aragón",
    epigrafe: "II.b · Oposiciones y concursos",
    urlPdf: null,
    urlHtml: r.url,
  }));
}

export const fuenteBOA = {
  id: "boa",
  nombre: "BOA · Aragón (II.b Oposiciones y concursos)",
  ambito: "autonomica",
  licencia: "Reutilización de datos públicos citando fuente (aviso legal Gobierno de Aragón)",
  obtener,
};

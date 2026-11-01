// Fuente DOCM · Diario Oficial de Castilla-La Mancha.
// Sumario del día en HTML server-side:
//   https://docm.jccm.es/docm/cambiarBoletin.do?fecha=AAAAMMDD
// Convocatorias en «II.- AUTORIDADES Y PERSONAL › OPOSICIONES Y CONCURSOS»,
// organismos en <h4 class="tituloOrganismo"> y disposiciones en <p class="sumario">
// con enlace descargarArchivo.do?ruta=AÑO/MM/DD/pdf/AÑO_NNNN.pdf.
// Portado del scraper docm.py del proyecto open source opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const BASE = "https://docm.jccm.es/docm/";
const SECCION_PERSONAL = "AUTORIDADES Y PERSONAL";
const SECCION_SIGUIENTE = "OTRAS DISPOSICIONES";
const SUBSECCION = "OPOSICIONES Y CONCURSOS";

const RUTA_RE = /ruta=(\d{4})\/(\d{2})\/(\d{2})\/pdf\/(\d{4}_\d+)\.pdf/g;
const ITEM_RE_JS = /tituloOrganismo">([\s\S]*?)<\/h4>|<p class ?= ?"sumario">([\s\S]*?)<\/p>/g;
const NID_RE = /\s*\[NID [^\]]+\]\s*$/;

async function obtener(fecha) {
  let html;
  try {
    html = await descargar(`https://docm.jccm.es/docm/cambiarBoletin.do?fecha=${fecha}`, { accept: "text/html", codificacion: "iso-8859-1" });
  } catch {
    return []; // sin boletín ese día (fin de semana, festivo)
  }
  if (!html.includes(SECCION_PERSONAL)) {
    if (html.toLowerCase().includes("sumario") || html.includes("cambiarBoletin")) return []; // día sin personal
    throw new Error("El fragmento no es un sumario del DOCM");
  }

  // Aísla II.- AUTORIDADES Y PERSONAL › OPOSICIONES Y CONCURSOS.
  const ini = html.indexOf(SECCION_PERSONAL);
  const finSec = html.indexOf(SECCION_SIGUIENTE, ini);
  const personal = html.slice(ini, finSec !== -1 ? finSec : html.length);
  const op = personal.indexOf(SUBSECCION);
  if (op === -1) return []; // ese día no hay oposiciones y concursos
  let sub = personal.slice(op + SUBSECCION.length);
  // Termina en la siguiente subcategoría (otro <li> en mayúsculas).
  const siguiente = /<li>\s*[A-ZÁÉÍÓÚ]/.exec(sub);
  if (siguiente) sub = sub.slice(0, siguiente.index);
  return montar(sub);
}

/** Parseo de la subsección a items (testeable con fixture, sin red). */
export function montar(sub) {
  const items = [];
  let organismo = "";
  ITEM_RE_JS.lastIndex = 0;
  let m;
  while ((m = ITEM_RE_JS.exec(sub)) !== null) {
    if (m[1] !== undefined) {
      organismo = limpiarHtml(m[1]);
      continue;
    }
    const sumario = m[2];
    RUTA_RE.lastIndex = 0;
    const ruta = RUTA_RE.exec(sumario);
    if (!ruta) continue;
    const titulo = limpiarHtml(sumario).replace(NID_RE, "").trim();
    items.push({
      identificador: `docm-${ruta[4].replace("_", "-")}`,
      titulo,
      organismo: organismo || "Junta de Comunidades de Castilla-La Mancha",
      epigrafe: "II · Oposiciones y concursos",
      urlPdf: null,
      urlHtml: `${BASE}verArchivoHtml.do?ruta=${ruta[1]}/${ruta[2]}/${ruta[3]}/html/${ruta[4]}.html&tipo=rutaDocm`,
    });
  }
  return items;
}

export const fuenteDOCM = {
  id: "docm",
  nombre: "DOCM · Castilla-La Mancha (Oposiciones y concursos)",
  ambito: "autonomica",
  licencia: "Reutilización de información pública citando la fuente (JCCM)",
  obtener,
};

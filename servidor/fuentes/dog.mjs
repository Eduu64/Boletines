// Fuente DOG · Diario Oficial de Galicia.
// Sumario por secciones en HTML server-side:
//   https://www.xunta.gal/dog/Publicados/YYYY/YYYYMMDD/SeccionesN_gl.html
// La sección «IV. Oposicións e concursos» está en uno de esos ficheros (N
// varía según qué secciones haya ese día). Mejora sobre el scraper original:
// se pide la FECHA solicitada (no solo el último número).
// Portado del scraper dog.py del proyecto open source opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const BASE = "https://www.xunta.gal";
const SECCION_OPOSICIONES = "Oposicións e concursos";
const ITEM_RE_JS = /<p class="dog-toc-organismo">([\s\S]*?)<\/p>|<li class="dog-toc-sumario">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const ANUNCIO_RE = /(Anuncio[^/]+?)_\w+\.html/;

async function obtener(fecha) {
  const AAAA = fecha.slice(0, 4);
  // La sección de oposiciones está en uno de los ficheros SeccionesN_gl.html.
  for (let n = 1; n <= 8; n++) {
    let html;
    try {
      html = await descargar(`${BASE}/dog/Publicados/${AAAA}/${fecha}/Secciones${n}_gl.html`, { accept: "text/html" });
    } catch {
      break; // no hay más secciones ese día
    }
    if (!html.includes(SECCION_OPOSICIONES)) continue;
    return montar(html, fecha);
  }
  return []; // ese día no hay sección de oposiciones
}

/** Parseo + montaje de la sección (testeable con fixture, sin red). */
export function montar(html, fecha) {
  const items = [];
  let organismo = "";
  ITEM_RE_JS.lastIndex = 0;
  let m;
  while ((m = ITEM_RE_JS.exec(html)) !== null) {
    if (m[1] !== undefined) {
      organismo = limpiarHtml(m[1]);
      continue;
    }
    const url = m[2];
    const anuncio = ANUNCIO_RE.exec(url);
    const idDog = anuncio ? anuncio[1] : url.split("/").pop();
    const ident = String(idDog).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    items.push({
      identificador: `dog-${ident}`,
      titulo: limpiarHtml(m[3]),
      organismo: organismo || "Xunta de Galicia",
      epigrafe: "IV · Oposicións e concursos",
      urlPdf: null,
      urlHtml: url.startsWith("http") ? url : `${BASE}${url}`,
    });
  }
  return items;
}

export const fuenteDOG = {
  id: "dog",
  nombre: "DOG · Galicia (Oposicións e concursos)",
  ambito: "autonomica",
  licencia: "Reutilización de datos públicos citando la fuente (Xunta de Galicia)",
  obtener,
};

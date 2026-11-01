// Fuente BOJA · Boletín Oficial de la Junta de Andalucía.
// Feed Atom de la sección «2.2. Oposiciones, concursos y otras convocatorias»
// (último BOJA publicado):
//   https://www.juntadeandalucia.es/boja/distribucion/s53.xml
// Portado del scraper boja.py del proyecto open source opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const FEED_URL = "https://www.juntadeandalucia.es/boja/distribucion/s53.xml";
const SECCION_ESPERADA = "oposiciones";

const ORGANISMO_RE = /<strong>\s*Organismo:\s*<\/strong>\s*(.*?)\s*<\/p>/is;
const PDF_RE = /<a href="(https:\/\/www\.juntadeandalucia\.es\/boja\/[^"]+\.pdf)"/i;
const ID_RE = /\/boja\/(\d{4})\/(\d+)\/(\d+)\.html/;

function idDesdeEnlace(enlace) {
  const m = ID_RE.exec(enlace);
  if (!m) return null;
  return `boja-${m[1]}${m[2]}-${m[3]}`;
}

async function obtener(fecha) {
  void fecha; // el feed trae solo el último boletín; la fecha se usa para el registro
  const feed = await descargar(FEED_URL, { accept: "application/atom+xml" });
  return montarFeed(feed);
}

/** Parseo del feed Atom (testeable con fixture, sin red). */
export function montarFeed(feed) {
  const tituloFeed = /<feed[^>]*>.*?<title>(.*?)<\/title>/s.exec(feed)?.[1] ?? "";
  if (!tituloFeed.toLowerCase().includes(SECCION_ESPERADA)) {
    throw new Error(`El feed de BOJA no es el de oposiciones (título: ${tituloFeed.slice(0, 80)})`);
  }

  const items = [];
  const entradas = feed.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];
  for (const entrada of entradas) {
    const titulo = limpiarHtml(/<title>([\s\S]*?)<\/title>/.exec(entrada)?.[1] ?? "");
    const enlace = /<link[^>]*href="([^"]+)"/.exec(entrada)?.[1]?.trim();
    if (!titulo || !enlace) continue;
    const identificador = idDesdeEnlace(enlace);
    if (!identificador) continue;
    const organismo = limpiarHtml(ORGANISMO_RE.exec(entrada)?.[1] ?? "");
    const pdf = PDF_RE.exec(entrada)?.[1] ?? null;
    items.push({
      identificador,
      titulo,
      organismo: organismo || "Junta de Andalucía",
      epigrafe: "2.2. Oposiciones, concursos y otras convocatorias",
      urlPdf: pdf,
      urlHtml: enlace,
    });
  }
  return items;
}

export const fuenteBOJA = {
  id: "boja",
  nombre: "BOJA · Junta de Andalucía (sección 2.2)",
  ambito: "autonomica",
  licencia: "Reutilización de datos públicos citando la fuente (aviso legal Junta de Andalucía)",
  obtener,
};

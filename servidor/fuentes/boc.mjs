// Fuente BOC · Boletín Oficial de Canarias.
// Cada número publica el sumario HTML en https://www.gobiernodecanarias.org/boc/YYYY/NNN/
// Las convocatorias están en «II. Autoridades y personal», subsección
// «Oposiciones y concursos» (<h3 class="titboc">), organismos en <h5> y cada
// disposición en <li class="justificado_boc"> con dos <a>.
// Portado del scraper boc.py del proyecto open source opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const HOME_URL = "https://www.gobiernodecanarias.org/boc/";
const BASE = "https://www.gobiernodecanarias.org";
const SECCION_OPOSICIONES = "Oposiciones y concursos";

const NUM_RE = /\/boc\/(\d{4})\/(\d+)/g;
const ITEM_RE_JS =
  /<h5>([\s\S]*?)<\/h5>|<li class="justificado_boc">\s*<a href="[^"]*"\s+title="Ir a la disposici[oó]n (\d+)\/(\d+)\/(\d+)"[^>]*>[\s\S]*?<\/a>\s*<a href="[^"]*">([\s\S]*?)<\/a>/g;
const FECHA_RE = /(\d{1,2}) de (\w+) de (\d{4})/;
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

function parsearFechaTexto(raw) {
  const m = FECHA_RE.exec(raw);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  return `${m[3]}${String(mes).padStart(2, "0")}${String(Number(m[1])).padStart(2, "0")}`;
}

/** Descarga el último número publicado (la portada enlaza los últimos). */
async function ultimoSumario() {
  const home = await descargar(HOME_URL, { accept: "text/html" });
  const pares = [];
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(home)) !== null) pares.push([Number(m[1]), Number(m[2])]);
  if (pares.length === 0) throw new Error("No se encontró ningún número de BOC en la portada");
  const [anio, num] = pares[pares.length - 1];
  const raw = await descargar(`${BASE}/boc/${anio}/${num}/`, { accept: "text/html" });
  return { raw, fecha: parsearFechaTexto(raw) };
}

function parsear(raw) {
  if (!raw) return [];
  if (!raw.includes(SECCION_OPOSICIONES)) {
    // Número correcto pero sin oposiciones ese día; si ni parece un sumario
    // del BOC, el formato ha cambiado.
    if (raw.includes("titboc") || raw.includes("Autoridades y personal")) return [];
    throw new Error("El fragmento no es un sumario del BOC de Canarias");
  }
  // Aísla la subsección «Oposiciones y concursos» hasta la siguiente
  // subsección (titboc) o parte (h4).
  const inicio = raw.indexOf(SECCION_OPOSICIONES);
  const resto = raw.slice(inicio + SECCION_OPOSICIONES.length);
  let fin = resto.length;
  for (const marcador of ['<h3 class="titboc"', "<h4"]) {
    const k = resto.indexOf(marcador);
    if (k !== -1) fin = Math.min(fin, k);
  }
  const seccion = resto.slice(0, fin);

  const registros = [];
  let organismo = "";
  ITEM_RE_JS.lastIndex = 0;
  let m;
  while ((m = ITEM_RE_JS.exec(seccion)) !== null) {
    if (m[1] !== undefined) {
      organismo = limpiarHtml(m[1]);
      continue;
    }
    registros.push({ y: m[2], n: m[3], d: m[4], titulo: limpiarHtml(m[5]), organismo });
  }
  return registros;
}

async function obtener(fecha) {
  void fecha; // el BOC se lee por número, no por fecha
  const { raw, fechaSumario } = await ultimoSumario();
  return montar(raw, fechaSumario);
}

/** Parseo + montaje de items (testeable con fixture, sin red). */
export function montar(raw, fechaSumario) {
  return parsear(raw).map((r) => ({
    identificador: `boc-${r.y}-${r.n}-${r.d}`,
    titulo: r.titulo,
    organismo: r.organismo || "Gobierno de Canarias",
    epigrafe: "II · Oposiciones y concursos",
    urlPdf: null,
    urlHtml: `${BASE}/boc/${r.y}/${r.n}/${r.d}.html`,
    ...(fechaSumario ? { fechaSumario } : {}),
  }));
}

export const fuenteBOC = {
  id: "boc",
  nombre: "BOC · Canarias (Oposiciones y concursos)",
  ambito: "autonomica",
  licencia: "Reutilización de información pública citando la fuente (Gobierno de Canarias)",
  obtener,
};

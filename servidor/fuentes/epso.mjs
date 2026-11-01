// Fuente EPSO · Oposiciones de la Unión Europea (EU Careers).
// Las convocatorias de la UE están abiertas a nacionales de cualquier país de
// la UE. Lista HTML server-side (tabla con <tr class="job-row">):
//   https://eu-careers.europa.eu/es/job-opportunities/in-progress
// El prefijo de la referencia marca el tipo: AD/AST = oposición permanente,
// CAST = agente contractual. No hay API/RSS oficial.
// Portado del scraper epso.py del proyecto open source opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const LISTA_URL = "https://eu-careers.europa.eu/es/job-opportunities/in-progress";
const BASE = "https://eu-careers.europa.eu";

const ROW_RE = /<tr class="job-row">([\s\S]*?)<\/tr>/g;
const TITULO_RE = /views-field-title[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
const REF_RE = /epso-reference-number[^>]*>([\s\S]*?)<\/td>/;

function tipoDe(ref) {
  const r = ref.toUpperCase();
  if (r.includes("CAST")) return "contrato";
  if (r.includes("/AD/") || r.includes("/AST")) return "oposicion";
  if (r.includes("TA/") || r.includes("TEMPORAL")) return "temporal";
  return "otro";
}

function idDeRef(ref, url) {
  const slug = ref.toLowerCase().replace("epso/", "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || url.replace(/\/+$/, "").split("/").pop();
}

async function obtener(fecha) {
  void fecha; // la lista no trae fecha por convocatoria; se usa la de la ingesta
  const raw = await descargar(LISTA_URL, { accept: "text/html" });
  return montar(raw);
}

/** Parseo + montaje de la lista (testeable con fixture, sin red). */
export function montar(raw) {
  const items = [];
  let m;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(raw)) !== null) {
    const fila = m[1];
    const tm = TITULO_RE.exec(fila);
    if (!tm) continue;
    const ref = limpiarHtml(REF_RE.exec(fila)?.[1] ?? "");
    items.push({
      identificador: `epso-${idDeRef(ref, tm[1])}`,
      titulo: ref ? `${limpiarHtml(tm[2])} (${ref})` : limpiarHtml(tm[2]),
      organismo: "Unión Europea (EPSO)",
      epigrafe: "EU Careers · Oposiciones en marcha",
      urlPdf: null,
      urlHtml: BASE + tm[1],
    });
  }
  // Si la página cargó pero no hay filas parseables, el formato cambió.
  if (raw.includes("job-row") && items.length === 0) {
    throw new Error("La lista de EPSO no trae filas parseables (¿cambió el formato?)");
  }
  return items;
}

export const fuenteEPSO = {
  id: "epso",
  nombre: "EPSO · Oposiciones de la Unión Europea",
  ambito: "estatal",
  licencia: "Contenido de la UE reutilizable (Decisión 2011/833/UE), citando la fuente",
  obtener,
};

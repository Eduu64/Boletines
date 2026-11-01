// Fuente CIDO · Cercador d'Informació i Documentació Oficials (Diputació de
// Barcelona). NO es un boletín: es un agregador con fichas normalizadas de los
// procesos selectivos de toda Cataluña (DOGC + 4 boletines provinciales + BOE +
// tablones municipales), también como open data JSON:API CC BY 4.0:
//   https://api.diba.cat/dadesobertes/cido/v1/oposicions
// Dos consultas por ejecución (como el scraper original): por ventana de fecha
// (incluye fichas antiguas reactivadas) y por altas recientes (pescan las
// convocatorias sin fecha de publicación que solo salen en el ayuntamiento).
// Portado del scraper cido.py del proyecto open source opoalerta.

import { descargarJson } from "../util.mjs";

const API = "https://api.diba.cat/dadesobertes/cido/v1/oposicions";
const ESTADOS_VIVOS = "1,2,3"; // pendiente de convocatoria, de plazo y plazo abierto
const PAGINA = 500;
const MAX_PAGINAS = 40;
const DIAS_VENTANA = 7;
const RECIENTES = 500;

// idAmbit → ámbito (los consejos comarcales son entes locales supramunicipales).
const AMBITOS = { 4: "autonomica", 5: "local", 6: "local", 7: "local", 8: "local", 10: "estatal", 71: "local", 72: "provincial", 93: "otro", 112: "otro" };

function fechaIso(valor) {
  if (typeof valor !== "string" || valor.length < 10) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(valor.slice(0, 10)) ? valor.slice(0, 10) : null;
}

function fechaAaaaMmdd(iso) {
  return iso.replaceAll("-", "");
}

async function paginar(params, maxPaginas) {
  const paginas = [];
  for (let numero = 0; numero < maxPaginas; numero++) {
    const query = new URLSearchParams({ ...params, "page[limit]": String(PAGINA), "page[offset]": String(numero * PAGINA) });
    const pagina = await descargarJson(`${API}?${query.toString()}`);
    if (pagina.errors) throw new Error(`La API del CIDO devuelve un error: ${JSON.stringify(pagina.errors).slice(0, 200)}`);
    paginas.push(pagina);
    if ((pagina.data ?? []).length < PAGINA) break;
  }
  return paginas;
}

async function obtener(fecha) {
  const desdeIso = new Date(new Date(`${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}T00:00:00Z`).getTime() - DIAS_VENTANA * 86400000).toISOString().slice(0, 10);
  const base = { "filter[idEstat]": ESTADOS_VIVOS, include: "documents" };
  const porFecha = await paginar({ ...base, "filter[maxDataPublicacioDocument][GE]": desdeIso, sort: "-maxDataPublicacioDocument" }, MAX_PAGINAS);
  // Segunda pasada por alta reciente: recoge lo que no tiene fecha de publicación.
  const porId = await paginar({ ...base, sort: "-id" }, Math.max(1, Math.floor(RECIENTES / PAGINA)));
  return montarPaginas([...porFecha, ...porId], fecha);
}

/** Parseo de las páginas de la API a items (testeable con fixture, sin red). */
export function montarPaginas(bruto, fecha) {

  // `included` trae los documentos de todas las fichas juntas; la ficha solo
  // guarda su relación, así que se indexa por id.
  const documentos = new Map();
  for (const pagina of bruto) {
    for (const doc of pagina.included ?? []) {
      if (doc.type === "oposicions-documents") documentos.set(String(doc.id), doc.attributes ?? {});
    }
  }

  const registros = new Map();
  for (const pagina of bruto) {
    for (const ficha of pagina.data ?? []) {
      const id = String(ficha.id ?? "");
      const atributos = ficha.attributes ?? {};
      if (!id || !atributos.titol || registros.has(id)) continue;
      const relacion = (ficha.relationships ?? {}).documents ?? {};
      const docs = (relacion.data ?? []).map((d) => documentos.get(String(d.id))).filter(Boolean);
      registros.set(id, { ...atributos, id, documentos: docs });
    }
  }
  // Respuesta válida pero vacía: no es un error, es «sin datos» (p. ej. filtro
  // de estados vivos sin resultados en un periodo raro).
  if (registros.size === 0) return [];

  const items = [];
  for (const r of registros.values()) {
    const publicaciones = (r.documentos ?? []).map((d) => fechaIso(d.dataPublicacio)).filter(Boolean);
    const fechaPublicacion =
      publicaciones.length > 0
        ? publicaciones.sort().at(-1)
        : fechaIso(r.maxDataPublicacioDocument) || fechaIso(r.dataInici) || fecha;
    items.push({
      identificador: `cido-${r.id}`,
      titulo: String(r.titol).trim(),
      organismo: (r.institucioDesenvolupat ?? "").trim() || "Administració pública catalana",
      epigrafe: "Procesos selectius (CIDO)",
      urlPdf: null,
      urlHtml: r.urlCido || `https://cido.diba.cat/oposicions/${r.id}`,
      tipoAmbitoOverride: AMBITOS[r.idAmbit] ?? "otro",
      fechaSumario: fechaAaaaMmdd(fechaPublicacion),
    });
  }
  return items;
}

export const fuenteCIDO = {
  id: "cido",
  nombre: "CIDO · Procesos selectius de Cataluña (Diputació de Barcelona)",
  ambito: "mixta",
  licencia: "CC BY 4.0 (Diputació de Barcelona), citando la fuente",
  obtener,
};

// Fuente DOGV · Diari Oficial de la Generalitat Valenciana.
// API JSON del portal (sin token, exige cabeceras Referer / X-Request-URL):
//   https://dogv.gva.es/dogv-portal/dogv?date=AAAA-MM-DD&lang=es
// Se filtran las disposiciones de la subsección
// «A) OFERTAS DE EMPLEO PÚBLICO, OPOSICIONES Y CONCURSOS».
// Portado del scraper dogv.py del proyecto open source opoalerta.

import { descargarJson } from "../util.mjs";

const API = "https://dogv.gva.es/dogv-portal";
const FRONTEND = "https://dogv.gva.es/dogv-portal-frontend/es";
const PDF_BASE = "https://dogv.gva.es/datos";
const CABECERAS = { Referer: FRONTEND, "X-Request-URL": FRONTEND };

function esEmpleo(d) {
  const sub = (d.subseccion?.descripcion ?? "").toUpperCase();
  return sub.includes("OFERTAS DE EMPLEO");
}

async function obtener(fecha) {
  const AAAA = fecha.slice(0, 4);
  const MM = fecha.slice(4, 6);
  const DD = fecha.slice(6, 8);
  const url = `${API}/dogv?date=${AAAA}-${MM}-${DD}&lang=es`;
  let datos = await descargarJson(url, CABECERAS);
  if (Array.isArray(datos)) datos = datos[0] ?? null;
  // Sin disposiciones = día sin boletín (fines de semana y festivos): no es un error.
  if (!datos || !Array.isArray(datos.disposiciones)) return [];
  return montarDatos(datos);
}

/** Parseo del sumario a items (testeable con fixture, sin red). */
export function montarDatos(datos) {
  const items = [];
  for (const d of datos.disposiciones) {
    if (!esEmpleo(d)) continue;
    const titulo = (d.titulo ?? "").trim();
    const clave = d.codigoInsercion || String(d.id ?? "");
    if (!titulo || !clave) continue;
    items.push({
      identificador: `dogv-${clave}`,
      titulo,
      organismo: (d.organismo ?? "").trim() || "Generalitat Valenciana",
      epigrafe: "A. Ofertas de empleo público, oposiciones y concursos",
      urlPdf: d.urlPdf ? `${PDF_BASE}${d.urlPdf.startsWith("/") ? "" : "/"}${d.urlPdf}` : null,
      urlHtml: null,
    });
  }
  return items;
}

export const fuenteDOGV = {
  id: "dogv",
  nombre: "DOGV · Generalitat Valenciana (ofertas de empleo)",
  ambito: "autonomica",
  licencia: "Reutilización de información pública citando la fuente (Generalitat Valenciana)",
  obtener,
};

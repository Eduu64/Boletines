// Fuente BOPV · Boletín Oficial del País Vasco (EHAA).
// Sumario HTML server-side del último boletín:
//   https://www.euskadi.eus/bopv2/datos/Ultimo.shtml  (ISO-8859-1 sin declarar)
// y los anteriores en bopv2/datos/YYYY/MM/sYY_NNNN.shtml. Secciones en
// <h4 class="BOPVSumarioSeccion"> y subsecciones en <h5 class="BOPVSumarioSubSeccion">
// (una cabecera VACÍA repite la anterior). Solo la subsección
// «Oposiciones y concursos» de Autoridades y personal.
// Portado del scraper bopv.py del proyecto open source opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const ULTIMO_URL = "https://www.euskadi.eus/bopv2/datos/Ultimo.shtml";
const BASE_DOCS = "https://www.euskadi.eus/bopv2/datos";
const SECCION_OPOSICIONES = "Oposiciones y concursos";
const SECCIONES_CONOCIDAS = ["AUTORIDADES Y PERSONAL", "OTRAS DISPOSICIONES", "ANUNCIOS", "DISPOSICIONES GENERALES"];
const ANTERIORES = 2;

const TOKEN_RE_JS =
  /<h4 class="BOPVSumarioSeccion">([\s\S]*?)<\/h4>|<h5 class="BOPVSumarioSubSeccion">([\s\S]*?)<\/h5>|<h5 class="BOPVSumarioOrganismo">([\s\S]*?)<\/h5>|<p class="BOPVSumarioTitulo"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const DOC_RE = /(\d{7})a\.shtml$/;
const NUMERO_RE = /tituGeneral">Sumario[^<]*<span>(\d+)<\/span>/;
const FECHA_RE = /tituGeneral">Sumario[^<]*<span>\d+<\/span>,\s*[^\d<]*?(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i;
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

function fechaSumario(raw) {
  const m = FECHA_RE.exec(raw);
  if (!m || !MESES[m[2].toLowerCase()]) return null;
  return `${m[3]}${String(MESES[m[2].toLowerCase()]).padStart(2, "0")}${String(Number(m[1])).padStart(2, "0")}`;
}

function parsear(raw) {
  if (!raw) return [];
  const fecha = fechaSumario(raw);
  const registros = [];
  let seccion = "";
  let subseccion = "";
  let organismo = "";
  const vistas = new Set();
  TOKEN_RE_JS.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE_JS.exec(raw)) !== null) {
    if (m[1] !== undefined) {
      const texto = limpiarHtml(m[1]);
      if (texto) {
        seccion = texto;
        subseccion = "";
        vistas.add(texto.toUpperCase());
      }
      continue;
    }
    if (m[2] !== undefined) {
      const texto = limpiarHtml(m[2]);
      if (texto) subseccion = texto;
      continue;
    }
    if (m[3] !== undefined) {
      const texto = limpiarHtml(m[3]);
      if (texto) organismo = texto; // vacío = mismo organismo que el anterior
      continue;
    }
    if (subseccion !== SECCION_OPOSICIONES) continue;
    const doc = DOC_RE.exec(m[4]);
    if (!doc) continue;
    registros.push({ id_bopv: doc[1], titulo: limpiarHtml(m[5]), organismo, fecha });
  }
  if (vistas.size > 0 && ![...vistas].some((v) => SECCIONES_CONOCIDAS.includes(v))) {
    throw new Error("El sumario del BOPV no trae ninguna sección reconocible");
  }
  return registros;
}

async function obtener(fecha) {
  void fecha; // se leen el último boletín y los ANTERIORES previos (idempotente)
  const ultimo = await descargar(ULTIMO_URL, { accept: "text/html", codificacion: "iso-8859-1" });
  const f = fechaSumario(ultimo);
  const numero = NUMERO_RE.exec(ultimo);
  if (!f || !numero) throw new Error("No se encontró la fecha o el número del último sumario del BOPV");

  const sumarios = [ultimo];
  const nBase = parseInt(numero[1], 10);
  const meses = [
    [Number(f.slice(0, 4)), Number(f.slice(4, 6))],
    Number(f.slice(4, 6)) > 1 ? [Number(f.slice(0, 4)), Number(f.slice(4, 6)) - 1] : [Number(f.slice(0, 4)) - 1, 12],
  ];
  for (let n = nBase - 1; n > nBase - 1 - ANTERIORES; n--) {
    if (n < 1) break; // primer boletín del año: el anterior es de otra numeración
    for (const [anio, mes] of meses) {
      try {
        sumarios.push(await descargar(`${BASE_DOCS}/${anio}/${String(mes).padStart(2, "0")}/s${String(anio % 100).padStart(2, "0")}_${String(n).padStart(4, "0")}.shtml`, { accept: "text/html", codificacion: "iso-8859-1" }));
        break;
      } catch {
        continue;
      }
    }
  }

  return sumarios.flatMap((s) => montar(s));
}

/** Parseo + montaje de un sumario (testeable con fixture, sin red). */
export function montar(raw) {
  const items = [];
  for (const r of parsear(raw)) {
    items.push({
      identificador: `bopv-${r.id_bopv}`,
      titulo: r.titulo,
      organismo: r.organismo || "Gobierno Vasco",
      epigrafe: "Oposiciones y concursos",
      urlPdf: null,
      urlHtml: r.fecha ? `${BASE_DOCS}/${r.fecha.slice(0, 4)}/${r.fecha.slice(4, 6)}/${r.id_bopv}a.shtml` : null,
    });
  }
  return items;
}

export const fuenteBOPV = {
  id: "bopv",
  nombre: "BOPV · País Vasco (Oposiciones y concursos)",
  ambito: "autonomica",
  licencia: "Reutilización libre citando la fuente (Gobierno Vasco, Open Data Euskadi)",
  obtener,
};

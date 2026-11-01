// Fuente BOPA · Boletín Oficial del Principado de Asturias.
// Portal Liferay sin sumario por ruta de fecha; un día concreto se pide con:
//   https://miprincipado.asturias.es/bopa/ultimos-boletines?p_r_p_summaryDate=DD/MM/AAAA
// Sumario en <div id="bopa-boletin">: <h4> parte, <h5> sección, <h6> organismo
// y <dl><dt> título … <strong>[Cód. AAAA-NNNNN]</strong>. El PDF de cada
// disposición es /bopa/AAAA/MM/DD/CODIGO.pdf.
// Por qué filtro positivo: su sección de personal mezcla convocatorias con
// actos administrativos (sustituciones, delegaciones, ceses). Si el título no
// dice que hay un proceso selectivo, no entra (igual que el scraper original).
// Portado del scraper bopa.py del proyecto open source opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const BASE = "https://miprincipado.asturias.es";
const SEDE = "https://sede.asturias.es";
const SECCION_PERSONAL = "AUTORIDADES Y PERSONAL";

const BOLETIN_RE = /\/bopa\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{8})\.pdf/;
const CODIGO_RE = /\[C[óo]d\.\s*(\d{4}-\d+)\]/;
const TOKEN_RE_JS = /<h5>([\s\S]*?)<\/h5>|<h6[^>]*>([\s\S]*?)<\/h6>|<dt>([\s\S]*?)<\/dt>/g;
const ES_CONVOCATORIA_RE =
  /convocatoria|se convoca|convocan|proceso selectivo|procesos selectivos|pruebas selectivas|oposici|concurso|bolsa de (?:empleo|trabajo)|listas? de empleo|bols[íi]n|promoci[oó]n interna|provisi[oó]n de puesto|libre designaci[oó]n|listas? de reserva/i;

async function obtener(fecha) {
  const DD = fecha.slice(6, 8);
  const MM = fecha.slice(4, 6);
  const AAAA = fecha.slice(0, 4);
  let raw;
  try {
    raw = await descargar(`${BASE}/bopa/ultimos-boletines?p_r_p_summaryDate=${DD}%2F${MM}%2F${AAAA}`, { accept: "text/html" });
  } catch {
    return []; // sin boletín ese día
  }

  const inicio = raw.indexOf('<div id="bopa-boletin"');
  if (inicio === -1) {
    if (raw.length < 2000) return []; // portal sin contenido ese día
    throw new Error("El fragmento no contiene el sumario del BOPA");
  }
  // La fecha va antes del sumario, en el enlace al boletín completo.
  const boletin = BOLETIN_RE.exec(raw);
  if (!boletin) throw new Error("No se encontró el enlace al PDF del boletín");
  const fechaBoletin = `${boletin[1]}${boletin[2]}${boletin[3]}`;

  return montar(raw.slice(inicio), fecha, fechaBoletin);
}

/** Parseo del sumario a items (testeable con fixture, sin red). */
export function montar(cuerpo, fecha, fechaBoletin) {
  const items = [];
  let seccion = "";
  let organismo = "";
  TOKEN_RE_JS.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE_JS.exec(cuerpo)) !== null) {
    if (m[1] !== undefined) {
      seccion = limpiarHtml(m[1]);
      organismo = "";
      continue;
    }
    if (m[2] !== undefined) {
      organismo = limpiarHtml(m[2]);
      continue;
    }
    if (seccion !== SECCION_PERSONAL) continue;

    const bruto = m[3];
    const codigo = CODIGO_RE.exec(bruto);
    if (!codigo) continue;
    const titulo = limpiarHtml(bruto.replace(CODIGO_RE, "")).trim();
    if (!ES_CONVOCATORIA_RE.test(titulo)) continue;

    items.push({
      identificador: `bopa-${codigo[1]}`,
      titulo,
      organismo: organismo || "Principado de Asturias",
      epigrafe: "Autoridades y Personal",
      urlPdf: null,
      urlHtml: `${SEDE}/bopa/${String(fechaBoletin).slice(0, 4)}/${String(fechaBoletin).slice(4, 6)}/${String(fechaBoletin).slice(6, 8)}/${codigo[1]}.pdf`,
      ...(fechaBoletin && fechaBoletin !== fecha ? { fechaSumario: fechaBoletin } : {}),
    });
  }
  return items;
}

export const fuenteBOPA = {
  id: "bopa",
  nombre: "BOPA · Asturias (Autoridades y Personal)",
  ambito: "autonomica",
  licencia: "Reutilización de información pública citando la fuente (Principado de Asturias)",
  obtener,
};

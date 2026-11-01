// Fuente DOGC · Diari Oficial de la Generalitat de Catalunya.
// API REST sin token (POST form-urlencoded) descubierta a través del portal:
//   1) calendarDOGC {month, year, language} → días con boletín y su numDOGC
//   2) summaryDOGC {numDOGC, language}      → sumario completo
// Se conservan:
//   · «Cargos y personal» salvo nombramientos/ceses (no son convocatorias)
//   · «Administración local» y «Otros sujetos emisores» cuando el título
//     delata empleo público (oposiciones, procesos selectivos, bolsas…)
// Portado del scraper dogc.py del proyecto open source opoalerta.

import { postFormulario } from "../util.mjs";

const API = "https://portaldogc.gencat.cat/eadop-rest/api/dogc";
const PORTAL = "https://dogc.gencat.cat/es";
const CABECERAS = { Referer: `${PORTAL}/sumari-del-dogc/` };

// Un nombramiento, cese o encargo nunca es una convocatoria.
const CERRADO_RE = /se hace p[úu]blico el nombramiento|se hace p[úu]blica la adjudicaci[óo]n|\bde nombramientos? de\b|se nombran?\b|\bde ceses?\b|cese y nombramiento|encargo del despacho|suplencia/i;
// Ambiguas: sólo descartan si el título no trae ninguna señal de convocatoria.
const DUDOSO_RE = /designaci[óo]n|se designan|adjudicaci[óo]n de (?:una |la |)plazas?|\bnombramientos?\b/i;
const CONVOCATORIA_RE = /convocatoria|convocan|proceso selectivo|proceso de selecci[óo]n|pruebas selectivas|oposici|\bbases\b|aspirantes|bolsa/i;
// Empleo en secciones que no lo separan (local y otros emisores).
const EMPLEO_RE = /oposici|procesos? selectivos?|procesos? de selecci[óo]n|pruebas selectivas|bolsa de|oferta (?:p[úu]blica|de empleo|de ocupaci[óo]n|parcial de empleo)|convocatoria.{0,80}(?:plazas?|puestos?|selecci[óo]n|personal)|bases.{0,80}(?:selecci[óo]n|plazas?|puestos?|bolsa|convocatoria)|selecci[óo]n.{0,40}plazas?|provisi[óo]n.{0,40}puestos? de trabajo|concurso de cambio de destino/i;
const NO_EMPLEO_RE = /subvenci|\bayudas?\b|\bbecas?\b|\bpremios?\b|plantilla|relaci[óo]n de puestos de trabajo/i;

function esConvocatoriaPersonal(titulo) {
  if (CERRADO_RE.test(titulo)) return false;
  if (DUDOSO_RE.test(titulo)) return CONVOCATORIA_RE.test(titulo);
  return true;
}

function esEmpleoLocal(titulo) {
  if (NO_EMPLEO_RE.test(titulo)) return false;
  return EMPLEO_RE.test(titulo);
}

function idDeEnlacePdf(enlace, numDOGC, indice) {
  const m = /dogcId=(\d+)/.exec(enlace ?? "") ?? /(\d{4,12})\.pdf/.exec(enlace ?? "");
  return m ? `dogc-${m[1]}` : `dogc-${numDOGC}-${indice}`;
}

async function numDOGCDeFecha(fecha) {
  const mes = parseInt(fecha.slice(4, 6), 10);
  const anio = parseInt(fecha.slice(0, 4), 10);
  const cal = await postFormulario(`${API}/calendarDOGC`, { month: String(mes), year: String(anio), language: "es" }, CABECERAS);
  const dia = parseInt(fecha.slice(6, 8), 10);
  const entrada = (cal.calendar ?? []).find((c) => {
    if (!c.hasDOGC) return false;
    const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(c.date ?? "");
    return !!m && parseInt(m[1], 10) === dia && parseInt(m[2], 10) === mes && parseInt(m[3], 10) === anio;
  });
  const num = /numDOGC=(\d+)/.exec(entrada?.linkDOGC ?? "")?.[1];
  // Sin numDOGC ese día = boletín no publicado (fines de semana y festivos):
  // señalamos «sin datos» devolviendo null y la fuente responde con [].
  return num || null;
}

async function obtener(fecha) {
  const num = await numDOGCDeFecha(fecha);
  if (!num) return []; // día sin DOGC (sábado, domingo o festivo)
  const sum = await postFormulario(`${API}/summaryDOGC`, { numDOGC: num, language: "es" }, CABECERAS);
  return montarSumario(sum, num, fecha);
}

/** Parseo del sumario a items (testeable con fixture, sin red). */
export function montarSumario(sum, num, fecha) {
  void fecha;
  const sumario = sum.sumaris?.[0];
  if (!sumario?.section) throw new Error("Respuesta del DOGC sin secciones");

  const items = [];
  let indice = 0;
  const recorrerOrganismo = (nodo, seccion, organismo) => {
    const propio = (nodo.title ?? "").trim() || organismo;
    for (const sub of nodo.subheader ?? []) recorrerOrganismo(sub, seccion, propio);
    for (const doc of nodo.document ?? []) {
      const titulo = (doc.title ?? "").trim();
      if (!titulo) continue;
      const vale = seccion === "Cargos y personal" ? esConvocatoriaPersonal(titulo) : esEmpleoLocal(titulo);
      if (!vale) continue;
      indice++;
      items.push({
        identificador: idDeEnlacePdf(doc.linkDownloadDocumentPDF, String(sumario.numDOGC ?? num), indice),
        titulo,
        organismo: propio,
        epigrafe: seccion,
        urlPdf: doc.linkDownloadDocumentPDF ?? null,
        urlHtml: null,
      });
    }
  };

  for (const seccion of sumario.section) {
    const nombre = (seccion.title ?? "").trim();
    if (nombre !== "Cargos y personal" && nombre !== "Administración local" && nombre !== "Otros sujetos emisores") continue;
    for (const header of seccion.header ?? []) recorrerOrganismo(header, nombre, "Generalitat de Catalunya");
  }
  return items;
}

export const fuenteDOGC = {
  id: "dogc",
  nombre: "DOGC · Generalitat de Catalunya",
  ambito: "autonomica",
  licencia: "Reutilización de la información pública citando la fuente (aviso legal DOGC / EADOP)",
  obtener,
};

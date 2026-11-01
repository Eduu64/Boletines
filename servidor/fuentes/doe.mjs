// Fuente DOE · Diario Oficial de Extremadura.
// Sumario diario en HTML server-side y ISO-8859-1:
//   https://doe.juntaex.es/ultimosdoe/mostrardoe.php?fecha=AAAAMMDD&t=o
// Epígrafe <span class="DOE6">, organismo <span class="DOE2"> y título
// <span class="DOE4">; cada disposición enlaza su HTML y su PDF.
// Portado del scraper doe.py del proyecto open source opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const BASE = "https://doe.juntaex.es";

function absoluta(u) {
  if (u.startsWith("http")) return u;
  if (u.startsWith("../")) return `${BASE}/${u.slice(3)}`;
  if (u.startsWith("/")) return `${BASE}${u}`;
  return `${BASE}/${u}`;
}

async function obtener(fecha) {
  const html = await descargar(`${BASE}/ultimosdoe/mostrardoe.php?fecha=${fecha}&t=o`, {
    accept: "text/html",
    codificacion: "iso-8859-1",
  });
  return montarHtml(html);
}

/** Parseo del sumario HTML (testeable con fixture, sin red). */
export function montarHtml(html) {

  // Bloque del epígrafe OPOSICIONES Y CONCURSOS hasta el siguiente DOE6.
  const marcas = [...html.matchAll(/<span class="DOE6">([\s\S]*?)<\/span>/gi)];
  const indice = marcas.findIndex((m) => /oposiciones\s+y\s+concursos/i.test(m[1]));
  if (indice < 0) return [];
  const inicio = marcas[indice].index ?? 0;
  const fin = indice + 1 < marcas.length ? marcas[indice + 1].index ?? html.length : html.length;
  const bloque = html.slice(inicio, fin);

  const items = [];
  const vistos = new Set();
  let organismo = "Junta de Extremadura";
  // Recorre los <p> del bloque: un <p> con solo DOE2 es un organismo; un <p>
  // con DOE4 es una disposición (posiblemente precedida de una nota DOE2).
  const parrafos = [...bloque.matchAll(/<p>([\s\S]*?)<\/p>/gi)];
  for (const p of parrafos) {
    const contenido = p[1];
    const doe2s = [...contenido.matchAll(/<span class="DOE2">([\s\S]*?)<\/span>/gi)].map((x) => limpiarHtml(x[1]));
    const doe4 = limpiarHtml(/<span class="DOE4">([\s\S]*?)<\/span>/i.exec(contenido)?.[1] ?? "");
    if (doe2s.length > 0 && !doe4) {
      organismo = doe2s[0];
      continue;
    }
    if (!doe4) continue;
    const trasP = bloque.slice(p.index, p.index + p[0].length + 2000);
    const xmlId = /html\.php\?xml=(\d+)/.exec(trasP)?.[1];
    const pdfHref = /href="([^"]+\.pdf)"/i.exec(trasP)?.[1];
    const clave = xmlId ?? pdfHref ?? "";
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    const nota = doe2s.length > 0 && doe2s[0] !== organismo ? `${doe2s[0]} ` : "";
    items.push({
      identificador: `doe-${clave.replace(/\D/g, "")}`,
      titulo: `${nota}${doe4}`,
      organismo,
      epigrafe: "Oposiciones y concursos",
      urlPdf: pdfHref ? absoluta(pdfHref) : null,
      urlHtml: xmlId ? `${BASE}/otrosFormatos/html.php?xml=${xmlId}` : null,
    });
  }
  return items;
}

export const fuenteDOE = {
  id: "doe",
  nombre: "DOE · Junta de Extremadura (Oposiciones y concursos)",
  ambito: "autonomica",
  licencia: "Reutilización de datos públicos citando la fuente (aviso legal Junta de Extremadura)",
  obtener,
};

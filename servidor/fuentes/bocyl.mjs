// Fuente BOCYL · Boletín Oficial de Castilla y León.
// Sumario diario (UTF-8) por secciones en HTML server-side:
//   https://bocyl.jcyl.es/boletin.do?fechaBoletin=DD/MM/AAAA
// Sección de empleo: «B.2. Oposiciones y Concursos», organismos en
// <h5 class="encabezado6"> y cada disposición en un <p> con su PDF (BOCYL-D-…).
// El boletín puede traer VARIOS bloques B.2 (publicación en dos partes): se
// procesan todos. Portado del scraper bocyl.py del proyecto open source
// opoalerta.

import { descargar, limpiarHtml } from "../util.mjs";

const BASE = "https://bocyl.jcyl.es";

async function obtener(fecha) {
  const DD = fecha.slice(6, 8);
  const MM = fecha.slice(4, 6);
  const AAAA = fecha.slice(0, 4);
  const html = await descargar(`${BASE}/boletin.do?fechaBoletin=${DD}/${MM}/${AAAA}`, { accept: "text/html" });
  return montarHtml(html, fecha);
}

/** Parseo del boletín HTML (testeable con fixture, sin red). */
export function montarHtml(html, fecha) {
  const DD = fecha.slice(6, 8);
  const MM = fecha.slice(4, 6);
  const AAAA = fecha.slice(0, 4);

  const marcaSeccion = /B\.\s*2\.?\s*Oposiciones\s+y\s+Concursos/i;
  const encabezados = [...html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/gi)];
  const items = [];
  const vistos = new Set();

  for (let indice = 0; indice < encabezados.length; indice++) {
    if (!marcaSeccion.test(encabezados[indice][1])) continue;
    const inicio = encabezados[indice].index ?? 0;
    const fin = indice + 1 < encabezados.length ? encabezados[indice + 1].index ?? html.length : html.length;
    const bloque = html.slice(inicio, fin);

    // Divide por organismo (<h5 class="encabezado6">) y coge cada <p> con su PDF.
    const partes = bloque.split(/<h5[^>]*>/i).slice(1);
    for (const parte of partes) {
      const corte = parte.indexOf("</h5>");
      const organismo = limpiarHtml(parte.slice(0, corte >= 0 ? corte : 200)) || "Castilla y León";
      const cuerpo = corte >= 0 ? parte.slice(corte) : parte;
      const parrafos = [...cuerpo.matchAll(/<p>([\s\S]{15,4000}?)<\/p>/gi)];
      for (const p of parrafos) {
        const trasP = cuerpo.slice(p.index + p[0].length, p.index + p[0].length + 2500);
        const pdf =
          /href='([^']*BOCYL-D-\d{8}-\d+-\d+)\.pdf'/.exec(trasP)?.[1] ??
          /href="([^"]*BOCYL-D-\d{8}-\d+-\d+)\.pdf"/.exec(trasP)?.[1];
        if (!pdf) continue;
        const identificador = /BOCYL-D-\d{8}-\d+-\d+/.exec(pdf)?.[0];
        const titulo = limpiarHtml(p[1]);
        if (!identificador || !titulo || vistos.has(identificador)) continue;
        vistos.add(identificador);
        const rutaPdf = `${pdf}.pdf`;
        items.push({
          identificador,
          titulo,
          organismo,
          epigrafe: "B.2. Oposiciones y Concursos",
          urlPdf: rutaPdf.startsWith("http") ? rutaPdf : `${BASE}${rutaPdf.startsWith("/") ? "" : "/"}${rutaPdf}`,
          urlHtml: `${BASE}/boletin.do?fechaBoletin=${DD}/${MM}/${AAAA}`,
        });
      }
    }
  }
  return items;
}

export const fuenteBOCYL = {
  id: "bocyl",
  nombre: "BOCYL · Castilla y León (B.2 Oposiciones y Concursos)",
  ambito: "autonomica",
  licencia: "Reutilización de datos públicos citando la fuente (aviso legal Junta de Castilla y León)",
  obtener,
};

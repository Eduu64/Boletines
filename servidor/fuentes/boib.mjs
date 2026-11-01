// Fuente BOIB · Butlletí Oficial de les Illes Balears.
// Flujo de 3 peticiones (como el scraper boib.py del proyecto open source
// opoalerta): el RSS da el último boletín; su página enlaza la Sección II
// (Autoridades y Personal); dentro se toma la subsección
// «Oposiciones y concursos» / «Oposicions i concursos».

import { descargar, limpiarHtml } from "../util.mjs";

const BASE = "https://www.caib.es";

function absoluta(u) {
  return u.startsWith("http") ? u : `${BASE}${u.startsWith("/") ? "" : "/"}${u}`;
}

async function obtener(fecha) {
  void fecha; // el RSS trae el último boletín publicado
  const rss = await descargar(`${BASE}/eboibfront/es/rss`, { accept: "application/rss+xml" });
  const primerItem = /<item>([\s\S]*?)<\/item>/.exec(rss)?.[1];
  if (!primerItem) throw new Error("El RSS del BOIB no trae boletines");
  const enlaceBoletin = /<link>([\s\S]*?)<\/link>/.exec(primerItem)?.[1]?.trim();
  if (!enlaceBoletin) throw new Error("El item del RSS del BOIB no trae enlace");
  const numBoletin = /\/es\/(\d{4}\/\d+)/.exec(enlaceBoletin)?.[1]?.replace("/", "");

  const boletin = await descargar(enlaceBoletin, { accept: "text/html" });
  const seccionRelativa = boletin.match(/href="([^"]*seccion-ii-autoridades-y-personal[^"]*)"/)?.[1];
  if (!seccionRelativa) return []; // no hay Sección II ese día → no hay oposiciones
  const seccion = seccionRelativa.startsWith("http") ? seccionRelativa : `${BASE}${seccionRelativa}`;
  const html = await descargar(seccion, { accept: "text/html" });
  return montarSeccion(html, enlaceBoletin, numBoletin);
}

/** Parseo de la sección HTML (testeable con fixture, sin red). */
export function montarSeccion(html, enlaceBoletin, numBoletin) {

  // Recorta la subsección de oposiciones (español o catalán) hasta la siguiente <h3>.
  const marca = /(?:Oposiciones y concursos|Oposicions i concursos)/i;
  const marcas = [...html.matchAll(/<h3>([\s\S]*?)<\/h3>/gi)];
  const indice = marcas.findIndex((m) => marca.test(m[1]));
  if (indice < 0) return [];
  const inicio = marcas[indice].index ?? 0;
  const fin = indice + 1 < marcas.length ? marcas[indice + 1].index ?? html.length : html.length;
  const bloque = html.slice(inicio, fin);

  const items = [];
  const vistos = new Set();
  const partes = bloque.split(/<h3 class="organisme">/i).slice(1);
  for (const parte of partes) {
    const corte = parte.indexOf("</h3>");
    const organismo = limpiarHtml(parte.slice(0, corte >= 0 ? corte : 300)) || "Govern de les Illes Balears";
    const cuerpo = corte >= 0 ? parte.slice(corte) : parte;
    const envios = [
      ...cuerpo.matchAll(
        /<li>\s*<p>([\s\S]*?)<\/p>\s*<p class="registre">[\s\S]*?N[úu]mero de registro\s*(\d+)([\s\S]*?)(?:<li>|<\/ul>|$)/gi
      ),
    ];
    for (const envio of envios) {
      const titulo = limpiarHtml(envio[1]);
      const registro = envio[2];
      const enlace =
        /<a[^>]*href="([^"]+)"[^>]*class="html"/.exec(envio[3])?.[1] ??
        /<a[^>]*href="([^"]+)"[^>]*class="pdf"/.exec(envio[3])?.[1];
      const clave = `${numBoletin ?? "x"}-${registro}`;
      if (!titulo || vistos.has(clave)) continue;
      vistos.add(clave);
      items.push({
        identificador: `boib-${clave}`,
        titulo,
        organismo,
        epigrafe: "Sección II · Oposiciones y concursos",
        urlPdf: null,
        urlHtml: enlace ? absoluta(enlace) : enlaceBoletin,
      });
    }
  }
  return items;
}

export const fuenteBOIB = {
  id: "boib",
  nombre: "BOIB · Illes Balears (Sección II · Oposiciones)",
  ambito: "autonomica",
  licencia: "Reutilización de datos públicos citando la fuente (aviso legal CAIB)",
  obtener,
};

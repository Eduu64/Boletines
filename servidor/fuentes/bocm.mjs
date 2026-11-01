// Fuente BOCM · Boletín Oficial de la Comunidad de Madrid.
// Sumario XML del día:  https://www.bocm.es/boletin/CM_Boletin_BOCM/YYYY/MM/DD/BOCM-YYYYMMDDNNN.xml
// · HOY: la portada enlaza el sumario del día (nombre con el nº de boletín).
// · DÍAS PASADOS (backfill): la portada solo enlaza el ÚLTIMO boletín, así que
//   se estima el nº de ese día a partir del último (la numeración es
//   correlativa de lunes a sábado, sin domingos) y se prueban unos pocos
//   candidatos alrededor (los festivos desplazan la serie), verificando cada
//   XML con <fecha_publicacion> antes de aceptarlo.
// Estructura real: sumario.diario.secciones.seccion[nombre] → (apartado[nombre]
// →) organismo[nombre] → disposicion{identificador, titulo, url_html, url_pdf}.
// Se recogen:
//   · Sección I, apartado «B) Autoridades y Personal» (ámbito autonómico)
//   · Sección III, ayuntamientos, cuando el título es «Ofertas de empleo» o
//     parece un proceso selectivo (ámbito local)
// Portado del scraper bocm.py del proyecto open source opoalerta.

import { descargar, dormir, limpiarHtml, bloques, atributosDe } from "../util.mjs";
import { permitirSalida } from "../cortafuegos.mjs";

const BASE = "https://www.bocm.es";
const CATEGORIA_EMPLEO = "ofertas de empleo";
const SUBCATEGORIA_EMPLEO = /proceso selectivo|oposici|oferta empleo|bolsa de (?:empleo|trabajo)/i;

function absoluta(u) {
  const s = String(u ?? "").trim();
  if (!s) return null;
  return s.startsWith("http") ? s : s.startsWith("/") ? `${BASE}${s}` : `${BASE}/${s}`;
}

async function sumarioDelDia(fecha) {
  // Cache por proceso: el backfill y los reintentos no repiten sondas.
  if (cacheSumario.has(fecha)) return cacheSumario.get(fecha);
  const xml = await localizarSumario(fecha);
  cacheSumario.set(fecha, xml);
  return xml;
}

const cacheSumario = new Map();

async function localizarSumario(fecha) {
  const AAAA = fecha.slice(0, 4);
  const MM = fecha.slice(4, 6);
  const DD = fecha.slice(6, 8);
  const portada = await descargar(`${BASE}/`, { accept: "text/html" });

  // Camino rápido: la portada enlaza exactamente el día pedido (hoy).
  const patronHoy = new RegExp(`/boletin/CM_Boletin_BOCM/${AAAA}/${MM}/${DD}/BOCM-\\d+\\.xml`);
  const enlaceHoy = portada.match(patronHoy)?.[0];
  if (enlaceHoy) return descargar(`${BASE}${enlaceHoy}`, { accept: "application/xml" });

  // Si la portada no enlaza un boletín, es que hoy no hay (raro) o pedimos un
  // día pasado: anclamos con el último boletín y estimamos el nº correlativo.
  const ancla = /\/boletin\/CM_Boletin_BOCM\/\d{4}\/\d{2}\/\d{2}\/BOCM-(\d{8})(\d{3})\.xml/.exec(portada);
  if (!ancla) return null; // día sin publicación (fines de semana) y no un error
  const fechaAncla = ancla[1];
  const numeroAncla = parseInt(ancla[2], 10);
  if (fecha >= fechaAncla) return null; // futuro o el propio día sin publicar

  const estimado = numeroAncla - diasPublicables(fecha, fechaAncla);
  const candidatos = [estimado, estimado - 1, estimado + 1, estimado - 2, estimado - 3].filter((n) => n >= 1);
  for (const numero of candidatos) {
    const url = `${BASE}/boletin/CM_Boletin_BOCM/${AAAA}/${MM}/${DD}/BOCM-${fecha}${String(numero).padStart(3, "0")}.xml`;
    try {
      const xml = await descargaUnica(url);
      // Verificación: el XML debe ser el de ESE día (la serie puede llevar
      // desfase por festivos; con la fecha publicada se descarta el equivocado).
      const publicacion = /<fecha_publicacion>([^<]+)<\/fecha_publicacion>/i.exec(xml)?.[1]?.replaceAll("/", "");
      if (publicacion === fecha) return xml;
    } catch {
      /* candidato equivocado (404) o portal saturado: probamos el siguiente */
    }
    await dormir(700); // ritmo respetuoso con bocm.es
  }
  return null; // sin boletín ese día (o serie con más festivos de la ventana)
}

/** Días L-S entre dos fechas AAAAMMDD, sin contar el desde y contando el hasta.
 * Es la distancia en «números de boletín» si no hubiera festivos. */
function diasPublicables(desde, hasta) {
  const t0 = Date.UTC(+desde.slice(0, 4), +desde.slice(4, 6) - 1, +desde.slice(6, 8));
  const t1 = Date.UTC(+hasta.slice(0, 4), +hasta.slice(4, 6) - 1, +hasta.slice(6, 8));
  let n = 0;
  for (let t = t0 + 86400000; t <= t1; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 6) n++; // lunes…sábado
  }
  return n;
}

/** GET de un solo intento (los candidatos erróneos no deben gastar reintentos
 * ni pausas de la descarga normal). */
async function descargaUnica(url) {
  permitirSalida(url); // cortafuegos de salida
  const res = await fetch(url, {
    headers: { "User-Agent": "OpoAlertaDocker/2.2 (+ingesta personal, uso responsable de datos abiertos)", Accept: "application/xml" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const texto = await res.text();
  if (!texto || texto.length < 30) throw new Error("respuesta vacía");
  return texto;
}

/** «– Alcobendas. Ofertas de empleo. Proceso selectivo…» → municipio si es empleo. */
function tituloLocalValido(titulo) {
  const m = /^[–-]\s*([^.]+)\.\s*([^.]+)\./.exec(titulo.trim());
  if (!m) return null;
  const municipio = m[1].trim();
  const categoria = m[2].trim().toLowerCase();
  if (categoria === CATEGORIA_EMPLEO) return municipio;
  const resto = titulo.slice(m.index + m[0].length).toLowerCase();
  if (SUBCATEGORIA_EMPLEO.test(resto)) return municipio;
  return null;
}

function extraer(disp, organismoPorDefecto, epigrafe) {
  const identificador = limpiarHtml(textoHijo(disp, "identificador"));
  const titulo = limpiarHtml(textoHijo(disp, "titulo"));
  if (!identificador || !titulo) return null;
  return {
    identificador,
    titulo,
    organismo: organismoPorDefecto,
    epigrafe,
    urlPdf: absoluta(textoHijo(disp, "url_pdf")),
    urlHtml: absoluta(textoHijo(disp, "url_html")),
  };
}

function textoHijo(xml, etiqueta) {
  const m = new RegExp(`<${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiqueta}>`, "i").exec(xml);
  return m ? m[1] : "";
}

async function obtener(fecha) {
  const xml = await sumarioDelDia(fecha);
  if (!xml) return []; // día sin BOCM (sábado, domingo o festivo)
  return montarXml(xml);
}

/** Parseo del XML del sumario (testeable con fixture, sin red). */
export function montarXml(xml) {
  // El XML trae un <diario> de texto dentro de <metadatos> y después el
  // <diario numero="…"> real con las secciones: nos quedamos con ese.
  const diario = bloques(xml, "diario").find((d) => d.interior.includes("<secciones"))?.interior ?? "";
  const contenedor = bloques(diario, "secciones")[0]?.interior ?? "";
  const secciones = bloques(contenedor, "seccion");
  if (secciones.length === 0) throw new Error("Sumario BOCM sin secciones");

  const items = [];
  for (const seccion of secciones) {
    const nombreSeccion = String(seccion.atributos.nombre ?? "");
    const esAutonomica = nombreSeccion.startsWith("I. ") && !nombreSeccion.startsWith("II.");
    const esLocal = nombreSeccion.startsWith("III.");
    if (!esAutonomica && !esLocal) continue;

    // Sección I: apartados con organismos; sección III: organismos directos.
    const apartados = esAutonomica
      ? bloques(seccion.interior, "apartado")
      : [{ interior: seccion.interior, atributos: { nombre: "" } }];

    for (const apartado of apartados) {
      const nombreApartado = String(apartado.atributos.nombre ?? "");
      if (esAutonomica && !/autoridades y personal/i.test(nombreApartado)) continue;

      for (const organismo of bloques(apartado.interior, "organismo")) {
        const nombreOrganismo = String(organismo.atributos.nombre ?? "").trim() || "BOCM";
        for (const disp of bloques(organismo.interior, "disposicion")) {
          if (esAutonomica) {
            const item = extraer(disp.interior, nombreOrganismo, `${nombreSeccion} · ${nombreApartado}`);
            if (item) items.push(item);
          } else {
            const provisional = extraer(disp.interior, nombreOrganismo, `${nombreSeccion} · Ofertas de empleo`);
            if (!provisional) continue;
            const municipio = tituloLocalValido(provisional.titulo);
            if (!municipio) continue;
            items.push({ ...provisional, organismo: municipio });
          }
        }
      }
    }
  }
  return items;
}

export const fuenteBOCM = {
  id: "bocm",
  nombre: "BOCM · Comunidad de Madrid (I.B + ayuntamientos)",
  ambito: "mixta",
  licencia: "Reutilización de datos públicos citando la fuente (aviso legal BOCM)",
  obtener,
};

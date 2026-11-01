// Fuente BOE · sección 2B (Oposiciones y concursos) — acceso DIRECTO a boe.es.
// Cuatro endpoints, probados en cascada con UNA conexión por cada uno (sin
// reintentos internos y sin relés ni servicios externos de ningún tipo):
//   1) API JSON de datos abiertos   (/datosabiertos/api/boe/sumario/AAAAMMDD)
//   2) HTML de la página del día    (/boe/dias/AAAA/MM/DD/)  ← la más estable
//      en la práctica (comprobado en vivo 30/10/2026 mientras la API devolvía
//      «500 code 101» y xml.php/sumario.php fallaban)
//   3) XML del sumario              (/diario_boe/xml.php?id=BOE-S-AAAAMMDD)
//   4) HTML del sumario             (/diario_boe/sumario.php?id=BOE-S-AAAAMMDD)
// Pensado para redes reales: si un cortafuegos bloquea www.boe.es, cada ruta
// se corta a los 8 s y, con dos cortes de red seguidos, se omite el resto y se
// registra un error claro en vez de quedarse 45 s colgado. Si el BOE contesta
// que esa fecha no tiene boletín (404 / página inexistente), se registra como
// día sin boletín y no como error.
// En producción nunca se define BOE_BASE_URL (todo va a boe.es); la variable
// existe solo para las pruebas automáticas contra un BOE falso.

import { descargar, dormir, bloques, atributosDe, textoDe, limpiarHtml, comoLista } from "../util.mjs";

const BASE = process.env.BOE_BASE_URL || "https://www.boe.es";

// Un intento corto por endpoint: así los 4 caben de verdad en el techo de
// tiempo de la ingesta (antes, 20 s × 2 en el primer endpoint consumían 43 s
// de los 45 s de techo y los otros tres respaldos nunca llegaban a probarse).
const RED = { timeoutMs: 8000, intentos: 1 };

const EPIS_OPOSICIONES = /oposiciones\s+y\s+concursos/i;

/** El BOE respondió que esa fecha no tiene boletín (domingos y festivos):
 * no es un fallo de red ni del parser. */
class SinBoletin extends Error {}

function absolutizar(u) {
  // La API real a veces trae url_pdf como objeto de metadatos (szBytes…);
  // solo aceptamos cadenas.
  if (typeof u !== "string" || !u) return null;
  return u.startsWith("http") ? u : `${BASE}${u.startsWith("/") ? "" : "/"}${u}`;
}

function esItemValido(it) {
  return !!it?.identificador && typeof it.identificador === "string" && it.identificador.startsWith("BOE-") && !!it.titulo;
}

function aItem(it, departamento, epigrafe) {
  return {
    identificador: it.identificador,
    titulo: it.titulo,
    organismo: departamento || "BOE",
    epigrafe,
    urlPdf: absolutizar(it.url_pdf),
    urlHtml: absolutizar(it.url_html),
  };
}

// ─── Parseo del JSON del sumario (testeable con fixture, sin red) ───────────
export function parsearJson(texto) {
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error("JSON no válido");
  }
  const sumario = json?.data?.sumario;
  if (!sumario) throw new SinBoletin("La API no devolvió sumario para esa fecha (sin boletín)");

  const items = [];
  for (const diario of comoLista(sumario.diario)) {
    for (const seccion of comoLista(diario?.seccion)) {
      const codigo = String(seccion?.codigo ?? "").trim().toUpperCase();
      const nombreSeccion = String(seccion?.nombre ?? "");
      const esOposicionesPorCodigo = codigo === "2B";
      for (const dep of comoLista(seccion?.departamento)) {
        const organismo = String(dep?.nombre ?? "").trim();
        for (const epi of comoLista(dep?.epigrafe)) {
          const nombreEpi = String(epi?.nombre ?? "");
          if (!esOposicionesPorCodigo && !EPIS_OPOSICIONES.test(nombreEpi) && !EPIS_OPOSICIONES.test(nombreSeccion)) continue;
          for (const it of comoLista(epi?.item)) {
            if (!esItemValido(it)) continue;
            const depItem = typeof it.departamento === "string" ? it.departamento : organismo;
            items.push(aItem(it, depItem, nombreEpi || null));
          }
        }
      }
    }
  }
  return items;
}

// ─── Parseo del XML del sumario (testeable con fixture, sin red) ────────────
// Tres variantes que llegan a existir:
//   a) API de datos abiertos en XML: <seccion codigo="2B" nombre="… B. Oposi-
//      ciones y concursos"> → <departamento codigo nombre> → <epigrafe nombre>
//      → <item> (el nombre de la SECCIÓN es el que dice 2B; los epígrafes van
//      con sus nombres propios: «Personal laboral», «Personal funcionario»…).
//   b) xml.php clásico anidado: la sección solo dice «II. AUTORIDADES Y
//      PERSONAL» y es el epígrafe el que se llama «B. OPOSICIONES Y CONCURSOS».
//   c) xml.php plano: <epigrafe nombre="B. OPOSICIONES Y CONCURSOS"/> autocerrado
//      con los <item> como hermanos.
export function parsearXml(xml) {
  if (!/<sumario/i.test(xml) && !/<diario/i.test(xml)) throw new Error("XML sin sumario");
  if (/Error en la informaci/i.test(xml)) throw new Error("XML con error del BOE");

  const items = [];
  const vistos = new Set();
  const empujar = (candidato, organismo, epigrafe) => {
    if (!esItemValido(candidato)) return;
    if (vistos.has(candidato.identificador)) return;
    vistos.add(candidato.identificador);
    items.push(aItem(candidato, organismo, epigrafe));
  };
  const candidatoDe = (o) => ({
    identificador: textoDe(o.interior, "identificador"),
    titulo: textoDe(o.interior, "titulo"),
    url_pdf: textoDe(o.interior, "url_pdf") || null,
    url_html: textoDe(o.interior, "url_html") || null,
  });

  for (const diario of bloques(xml, "diario")) {
    const d = diario.interior;
    const secciones = bloques(d, "seccion");
    const nombreEpi = (e) => e.atributos.nombre || textoDe(e.interior, "nombre") || "";

    // Variante a): al menos una sección se declara 2B por código o por nombre.
    let hay2BporSeccion = false;
    for (const sec of secciones) {
      const codigo = String(sec.atributos.codigo ?? "").trim().toUpperCase();
      if (codigo !== "2B" && !EPIS_OPOSICIONES.test(String(sec.atributos.nombre ?? ""))) continue;
      hay2BporSeccion = true;
      for (const dep of bloques(sec.interior, "departamento")) {
        const organismo = dep.atributos.nombre || textoDe(dep.interior, "nombre") || "BOE";
        const epigrafes = bloques(dep.interior, "epigrafe");
        for (const epi of epigrafes) {
          for (const o of bloques(epi.interior, "item")) {
            empujar(candidatoDe(o), organismo, nombreEpi(epi) || "B. OPOSICIONES Y CONCURSOS");
          }
        }
      }
    }
    if (hay2BporSeccion) continue;

    // Variantes b) y c): sin secciones 2B declaradas, se busca el epígrafe 2B.
    // Nombre del departamento: texto plano de <departamento> o su atributo nombre.
    const aperturaDep = d.match(/<departamento\b([^>]*)>/i)?.[1] ?? "";
    const nombreDep = textoDe(d, "departamento") || atributosDe(`<x ${aperturaDep}>`).nombre || "BOE";

    const epigrafes = bloques(d, "epigrafe");
    const en2B = epigrafes.filter((e) => EPIS_OPOSICIONES.test(nombreEpi(e)));

    // Variante c): el epígrafe va AUTOCERRADO y los item cuelgan del diario.
    // Solo se acepta si no hay otros epígrafes (evita arrastrar otras secciones).
    const autocierra2B =
      en2B.length === 0 &&
      /<epigrafe\b[^>]*\/>/i.test(d) &&
      [...d.matchAll(/<epigrafe\b([^>]*?)\/>/gi)].some((m) => EPIS_OPOSICIONES.test(atributosDe(`<x ${m[1]}>`).nombre ?? ""));
    if (en2B.length === 0 && !autocierra2B) continue;

    // Variante b): los item cuelgan del epígrafe 2B.
    const anidados = [];
    for (const epi of en2B) anidados.push(...bloques(epi.interior, "item"));

    // Variante c): item hermanos del epígrafe; solo si el diario no tiene otros
    // epígrafes con contenido.
    const sueltos = epigrafes.length === 0 || epigrafes.length === en2B.length ? bloques(d, "item") : [];

    for (const o of [...anidados, ...sueltos]) {
      empujar(candidatoDe(o), nombreDep, (en2B[0] ? nombreEpi(en2B[0]) : "") || "B. OPOSICIONES Y CONCURSOS");
    }
  }
  if (items.length === 0) throw new Error("XML sin anuncios de la sección 2B");
  return items;
}

/** El API de datos abiertos responde JSON cuando se le pide Accept:
 * application/json, pero si ignora la cabecera devuelve el mismo sumario en
 * XML (como al abrirlo en un navegador). Se aceptan los dos sin depender de
 * ese capricho. */
export function parsearRespuestaApi(texto) {
  // JSON si empieza por llave; si no, XML (recortando cualquier texto que el
  // navegador o el transporte hayan añadido delante).
  if (String(texto ?? "").trimStart().startsWith("{")) return parsearJson(texto);
  return parsearXml(String(texto ?? "").slice(Math.max(0, texto.indexOf("<"))));
}

// ─── Parseo del HTML del sumario (clásico) ──────────────────────────────────

function parsearHtmlSeccion(html, urlBase) {
  // El cuerpo de la sección se ancla a «II. Autoridades y personal … Oposiciones
  // y concursos»: la página lleva un índice superior que repite el nombre de la
  // sección como ancla de navegación y engañaría a la búsqueda ingenua.
  const anclaCuerpo = /AUTORIDADES\s+Y\s+PERSONAL[\s\S]{0,160}?OPOSICIONES\s+Y\s+CONCURSOS/i.exec(html);
  const inicio = anclaCuerpo ? anclaCuerpo.index : html.search(/OPOSICIONES\s+Y\s+CONCURSOS/i);
  if (inicio < 0) throw new Error("HTML sin sección de oposiciones");
  const siguiente = html.slice(inicio).search(/(III\.|IV\.|OTRAS DISPOSICIONES|ANUNCIOS)/i);
  const bloque = html.slice(inicio, siguiente > 0 ? inicio + siguiente : undefined);
  const re = /<a[^>]+href="([^"]*BOE-A-\d{4}-\d{3,7})[^"]*"[^>]*>([^<]{15,400})<\/a>/gi;
  const items = [];
  const vistos = new Set();
  let m;
  while ((m = re.exec(bloque)) !== null) {
    const href = m[1];
    const titulo = m[2].replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
    const id = /BOE-A-\d{4}-\d{3,7}/.exec(href)?.[0];
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    if (/^(PDF|XML|HTML)$/i.test(titulo)) continue;
    items.push({
      identificador: id,
      titulo,
      organismo: "Sección 2B (BOE)",
      epigrafe: "B. OPOSICIONES Y CONCURSOS",
      urlPdf: null,
      urlHtml: `${urlBase}/buscar/doc.php?id=${id}`,
    });
  }
  if (items.length === 0) throw new Error("HTML sin documentos parseables");
  return items;
}

/** Página del día (/boe/dias/AAAA/MM/DD/). Formato real (comprobado en vivo
 * 31/10/2026 con el BOE núm. 270): cada anuncio es
 *   <li class="dispo"><p>Título</p><div class="enlacesDoc">…<a …BOE-A-…>…
 * con el departamento en <h4> entre anuncios, y un índice de navegación al
 * principio que también menciona la sección. Los enlaces no llevan el título:
 * «PDF (BOE-A-2026-22738 - 6 págs. - 289 KB)» / «Otros formatos», así que el
 * título hay que tomarlo del <p>. Si el HTML no trae la estructura .dispo
 * (p. ej. el sumario clásico), cae al parser genérico de enlaces.
 * Exportada para las pruebas offline. */
export function parsearPaginaDia(html) {
  if (/La p&aacute;gina que solicita no existe|no existe la p&aacute;gina/i.test(html)) {
    throw new SinBoletin("El BOE no publicó boletín esa fecha (la página del día no existe)");
  }
  const anclaCuerpo = /AUTORIDADES\s+Y\s+PERSONAL[\s\S]{0,160}?OPOSICIONES\s+Y\s+CONCURSOS/i.exec(html);
  const inicio = anclaCuerpo ? anclaCuerpo.index : html.search(/OPOSICIONES\s+Y\s+CONCURSOS/i);
  if (inicio < 0) throw new Error("HTML sin sección de oposiciones");
  const siguiente = html.slice(inicio).search(/(III\.|IV\.|OTRAS DISPOSICIONES|ANUNCIOS)/i);
  const bloque = html.slice(inicio, siguiente > 0 ? inicio + siguiente : undefined);

  const items = [];
  const vistos = new Set();
  let departamento = "Sección 2B (BOE)";
  // Recorrido en orden: <h4> cambia el departamento vigente; cada li.dispo es
  // un anuncio (título en su <p> y enlaces con el BOE-A-… en enlacesDoc).
  const eventos = bloque.matchAll(
    /<h4[^>]*>([\s\S]*?)<\/h4>|<li[^>]*class="[^"]*dispo[^"]*"[^>]*>([\s\S]*?)(?=<li[^>]*class="[^"]*dispo[^"]*"|<h4[\s>]|$)/gi
  );
  for (const ev of eventos) {
    if (ev[1] !== undefined) {
      departamento = limpiarHtml(ev[1]) || departamento;
      continue;
    }
    const trozo = ev[2] ?? "";
    const id = /BOE-A-\d{4}-\d{3,7}/.exec(trozo)?.[0];
    if (!id || vistos.has(id)) continue;
    const titulo = textoDe(trozo, "p") || limpiarHtml(trozo).slice(0, 300);
    if (!titulo || /^(PDF|XML|HTML)\b/i.test(titulo)) continue;
    vistos.add(id);
    items.push({
      identificador: id,
      titulo,
      organismo: departamento,
      epigrafe: "B. OPOSICIONES Y CONCURSOS",
      urlPdf: absolutizar(/href="([^"]+\.pdf[^"]*)"/i.exec(trozo)?.[1]),
      urlHtml: absolutizar(/href="([^"]*(?:txt\.php|doc\.php)[^"]*)"/i.exec(trozo)?.[1]) || `${BASE}/buscar/doc.php?id=${id}`,
    });
  }
  if (items.length === 0) return parsearHtmlSeccion(html, BASE); // formato clásico
  return items;
}

// ─── Orquestador: 4 accesos directos, una conexión corta por cada uno ───────

let ultimoEndpointUsado = "—";
let directoOk = false;

/** Endpoint del BOE que respondió en la última ingesta (para el registro). */
export function endpointBOEUsado() {
  return ultimoEndpointUsado;
}

/** ¿Se alcanzó boe.es directamente en la última ingesta? Si no, el
 * enriquecimiento del ámbito se salta: si el portal no es alcanzable para el
 * sumario, tampoco lo será para las fichas individuales. */
export function boeDirectoOk() {
  return directoOk;
}

const PRESUPUESTO_MS = 38_000; // 4 rutas × 8 s + pausas, con margen
const PAUSA_ENTRE_RUTAS_MS = 400;
// Si una ingesta acaba con fallo puro de red, durante 10 min se da por hecho
// que www.boe.es no es alcanzable (cortafuegos o red sin salida) y la
// siguiente obtención falla al instante, sin repetir los 8 s por ruta.
let bloqueoDetectadoHasta = 0;

const ES_FALLO_DE_RED = /fetch failed|timeout|aborted|terminated|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i;

/** Versión corta del error de una ruta, para el mensaje final. */
function corto(mensaje) {
  if (/^HTTP \d{3}$/.test(mensaje)) return mensaje;
  if (ES_FALLO_DE_RED.test(mensaje)) return "sin conexión (8 s)";
  return mensaje.slice(0, 90);
}

async function obtener(fecha) {
  const inicio = Date.now();
  const restante = () => PRESUPUESTO_MS - (Date.now() - inicio);
  directoOk = false;

  // Tras un bloqueo de red detectado hace poco no se repiten los 8 s por
  // ruta: se falla al instante y el reintento real llega con la siguiente
  // ingesta (el bloqueo caduca a los 10 min).
  if (Date.now() < bloqueoDetectadoHasta) {
    throw new Error("www.boe.es no respondió hace poco desde esta red (¿cortafuegos?); se reintentará en la próxima ingesta");
  }

  const urlDias = `${BASE}/boe/dias/${fecha.slice(0, 4)}/${fecha.slice(4, 6)}/${fecha.slice(6, 8)}/`;
  const rutas = [
    { nombre: "api-datosabiertos", url: `${BASE}/datosabiertos/api/boe/sumario/${fecha}`, accept: "application/json", parsear: parsearRespuestaApi },
    { nombre: "html-dias", url: urlDias, accept: "text/html", parsear: parsearPaginaDia },
    { nombre: "xml-diario_boe", url: `${BASE}/diario_boe/xml.php?id=BOE-S-${fecha}`, accept: "application/xml", parsear: parsearXml },
    { nombre: "html-sumario", url: `${BASE}/diario_boe/sumario.php?id=BOE-S-${fecha}`, accept: "text/html", parsear: (t) => parsearHtmlSeccion(t, BASE) },
  ];

  const fallos = [];
  let fallosDeRedSeguidos = 0;
  let sinBoletinDesde = null;
  for (const ruta of rutas) {
    if (restante() < 8000) {
      fallos.push("(presupuesto de tiempo agotado)");
      break;
    }
    // Dos cortes de red seguidos delatan que www.boe.es no es alcanzable
    // (cortafuegos, DNS, sin salida a internet): las otras dos rutas caerán
    // igual y solo añadirían 16 s muertos. Un fallo HTTP (500 de la API,
    // 404…) NO cuenta: ahí el portal sí responde y conviene probar el
    // siguiente endpoint.
    if (fallosDeRedSeguidos >= 2) {
      fallos.push("(resto de rutas omitidas: www.boe.es no responde en esta red)");
      break;
    }
    try {
      const texto = await descargar(ruta.url, { ...RED, accept: ruta.accept });
      const items = ruta.parsear(texto);
      directoOk = true;
      bloqueoDetectadoHasta = 0;
      ultimoEndpointUsado = ruta.nombre;
      return items;
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      fallos.push(`${ruta.nombre}: ${corto(mensaje)}`);
      if (e instanceof SinBoletin || /HTTP 404/.test(mensaje)) sinBoletinDesde = sinBoletinDesde ?? ruta.nombre;
      fallosDeRedSeguidos = ES_FALLO_DE_RED.test(mensaje) ? fallosDeRedSeguidos + 1 : 0;
      await dormir(PAUSA_ENTRE_RUTAS_MS);
    }
  }

  // El BOE contestó que esa fecha no tiene boletín: día sin novedades, no
  // error (domingos y festivos nacionales).
  if (sinBoletinDesde) {
    directoOk = true;
    bloqueoDetectadoHasta = 0;
    ultimoEndpointUsado = `sin boletín (${sinBoletinDesde})`;
    return [];
  }

  ultimoEndpointUsado = "ninguno";
  const soloRed =
    fallos.length > 0 &&
    fallos.every((f) => ES_FALLO_DE_RED.test(f) || /sin conexión \(8 s\)|omitidas|presupuesto/.test(f));
  if (soloRed) bloqueoDetectadoHasta = Date.now() + 10 * 60 * 1000;
  throw new Error(
    soloRed
      ? `www.boe.es no es alcanzable desde esta red (${fallos.join(" | ")}) — probable cortafuegos bloqueando www.boe.es o sin salida a internet`
      : `Los accesos directos al BOE fallaron → ${fallos.join(" | ")}`.slice(0, 500)
  );
}

export const fuenteBOE = {
  id: "boe",
  nombre: "BOE · Oposiciones y concursos (sección 2B)",
  ambito: "estatal",
  licencia: "Reutilización permitida citando fuente (Aviso legal BOE)",
  obtener,
};

/** Enriquecimiento: ámbito geográfico del XML de un documento del BOE. */
export async function obtenerAmbitoBOE(identificador) {
  try {
    const xml = await descargar(`${BASE}/diario_boe/xml.php?id=${identificador}`, { accept: "application/xml", timeoutMs: 8000, intentos: 1 });
    const m = /<ambito>([^<]+)<\/ambito>/i.exec(xml);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

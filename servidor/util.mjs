// Utilidades compartidas de la ingesta: descarga HTTP con reintentos,
// decodificación de charsets (DOE/BOA van en ISO-8859-1) y ayudantes de
// extracción para el XML/HTML de los boletines. Cero dependencias externas:
// nada que auditar más allá de este proyecto (seguridad y RAM).

import { permitirSalida } from "./cortafuegos.mjs";

const INTENTOS = 2;
const PAUSA_MS = 2500;
const TIMEOUT_MS = 20000;

export function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Detalle de errores de red (v2.3.21) ────────────────────────────────────
// El fetch de Node envuelve los fallos de red en un genérico «fetch failed»
// y esconde la causa real (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, certificados…)
// en e.cause (a veces anidada varias veces dentro de undici). Sin ese detalle,
// un «fetch failed» a secas no dice si el problema es el proxy interno, el DNS
// o el portal — que es justo lo que hay que saber para diagnosticar.

/** Extrae la causa raíz útil de un error de red («ECONNREFUSED 10.0.0.5:3128»)
 * o cadena vacía si no hay nada aprovechable. Los códigos genéricos de undici
 * (UND_ERR_ABORTED…) se saltan a favor del mensaje específico más profundo,
 * p. ej. «Proxy response (403) !== 200 when HTTP Tunneling» cuando Squid
 * deniega el dominio. */
const CODIGOS_GENERICOS = new Set(["UND_ERR_ABORTED", "RequestAbortedError", "AbortError", "UND_ERR_SOCKET"]);

export function detalleRed(e) {
  let c = e?.cause;
  const vistos = new Set();
  let especifico = ""; // el mensaje más informativo visto en la cadena
  while (c && !vistos.has(c)) {
    vistos.add(c);
    const msg = String(c.message ?? "");
    if (msg && !/^(fetch failed|Request was cancelled)/i.test(msg)) especifico = msg;
    const codigo = c.code;
    if (codigo && codigo !== "Error" && codigo !== 0 && !CODIGOS_GENERICOS.has(codigo)) {
      const donde = c.address || c.hostname || c.host || "";
      const puerto = c.port ? `:${c.port}` : "";
      return `${codigo}${donde ? ` ${donde}${puerto}` : ""}`;
    }
    c = c.cause;
  }
  return especifico.slice(0, 90);
}

/** Mensaje de un error de red con la causa añadida: «fetch failed
 * (ECONNREFUSED 172.18.0.3:3128)». Si el error no trae causa útil, devuelve
 * el mensaje original intacto (HTTP 502, respuesta vacía… no se tocan). */
export function mensajeRed(e) {
  const base = e instanceof Error ? e.message : String(e);
  const extra = detalleRed(e);
  if (!extra || base.includes(extra)) return base;
  return `${base} (${extra})`;
}

/** Descarga un recurso y devuelve el texto decodificado. Lanza si fallan todos los intentos.
 * timeoutMs/intentos/pausaMs son ajustables: la fuente BOE usa una conexión
 * corta por endpoint para poder probar sus 4 accesos directos (una sola
 * conexión cada uno) dentro del techo de tiempo de la ingesta. */
export async function descargar(url, opciones = {}) {
  const {
    accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    cabeceras = {},
    codificacion = "utf-8",
    timeoutMs = TIMEOUT_MS,
    intentos = INTENTOS,
    pausaMs = PAUSA_MS,
  } = opciones;
  permitirSalida(url); // cortafuegos de salida: solo portales de boletines y Discord
  let ultimoError = null;
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA_OPOALERTA, Accept: accept, ...cabeceras },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let texto;
      if (codificacion === "utf-8") texto = await res.text();
      else texto = new TextDecoder(codificacion).decode(await res.arrayBuffer());
      if (!texto || texto.length < 30) throw new Error("respuesta vacía");
      return texto;
    } catch (e) {
      ultimoError = e;
      if (i < intentos - 1) await dormir(pausaMs);
    }
  }
  // v2.3.21: el mensaje lleva la causa real de red (p. ej. «fetch failed
  // (ECONNREFUSED 172.18.0.3:3128)» → el proxy no está vivo o no hay ruta).
  throw new Error(mensajeRed(ultimoError));
}

export async function descargarJson(url, cabeceras = {}) {
  const texto = await descargar(url, { accept: "application/json", cabeceras });
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error("JSON no válido");
  }
}

/** POST form-urlencoded que devuelve JSON parseado. */
export async function postFormulario(url, cuerpo, cabeceras = {}) {
  permitirSalida(url); // cortafuegos de salida
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": UA_OPOALERTA,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        ...cabeceras,
      },
      body: new URLSearchParams(cuerpo).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // v2.3.21: «fetch failed (ECONNREFUSED …)» en vez de un «fetch failed» a secas
    throw new Error(mensajeRed(e));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const UA_OPOALERTA = "OpoAlertaDocker/2.0 (+ingesta personal, uso responsable de datos abiertos)";

/** Limpia entidades HTML y etiquetas sueltas de un fragmento. */
export function limpiarHtml(fragmento) {
  return String(fragmento ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return c >= 32 && c < 0x10ffff ? String.fromCodePoint(c) : " ";
    })
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Mini-extracción XML (suficiente para los sumarios del BOE y del BOCM) ──

/** Devuelve el contenido interior de cada bloque <etiqueta ...>…</etiqueta> del
 * fragmento, en orden. Los sumarios de boletines no anidan una etiqueta dentro
 * de sí misma, así que la búsqueda no ambiciosa es correcta y barata. */
export function bloques(xml, etiqueta) {
  const re = new RegExp(`<${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiqueta}>`, "gi");
  const salida = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    salida.push({
      interior: m[1],
      atributos: atributosDe(m[0].slice(0, m[0].indexOf(">"))),
    });
  }
  return salida;
}

/** Mapa de atributos de una etiqueta de apertura, p. ej. '<seccion nombre="I. …">'. */
export function atributosDe(apertura) {
  const mapa = {};
  const re = /([:\w-]+)\s*=\s*"([^"]*)"|([:\w-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(apertura)) !== null) mapa[(m[1] ?? m[3]).toLowerCase()] = m[2] ?? m[4] ?? "";
  return mapa;
}

/** Texto del primer <etiqueta>…</etiqueta> del fragmento (limpio). */
export function textoDe(xml, etiqueta) {
  const m = new RegExp(`<${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiqueta}>`, "i").exec(xml);
  return m ? limpiarHtml(m[1]) : "";
}

/** x → lista (acepta valor único o array). */
export function comoLista(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

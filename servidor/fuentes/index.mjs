// Registro de boletines y orquestador multi-fuente.
// v2.0.0: las 15 fuentes declaradas del proyecto original opoalerta/opoalerta
// (y las 16 de su código, incluido BOPV, que su README no lista):
//   BOE · BOA · BOC · BOCM · BOCYL · BOIB · BOJA · BOPA · BOPV ·
//   CIDO · DOCM · DOE · DOG · DOGC · DOGV · EPSO
// Cada fuente es un módulo independiente con la misma interfaz:
//   { id, nombre, ambito, licencia, obtener(fecha) → ItemFuente[] }

import { permitirSalida } from "../cortafuegos.mjs";
import { fuenteBOE } from "./boe.mjs";
import { fuenteBOCM } from "./bocm.mjs";
import { fuenteBOJA } from "./boja.mjs";
import { fuenteDOGV } from "./dogv.mjs";
import { fuenteDOGC } from "./dogc.mjs";
import { fuenteBOCYL } from "./bocyl.mjs";
import { fuenteDOE } from "./doe.mjs";
import { fuenteBOIB } from "./boib.mjs";
import { fuenteBOA } from "./boa.mjs";
import { fuenteBOC } from "./boc.mjs";
import { fuenteBOPV } from "./bopv.mjs";
import { fuenteDOG } from "./dog.mjs";
import { fuenteDOCM } from "./docm.mjs";
import { fuenteBOPA } from "./bopa.mjs";
import { fuenteCIDO } from "./cido.mjs";
import { fuenteEPSO } from "./epso.mjs";
import { endpointBOEUsado } from "./boe.mjs";

export const FUENTES = [
  fuenteBOE,
  fuenteBOCM,
  fuenteBOJA,
  fuenteDOGV,
  fuenteDOGC,
  fuenteBOCYL,
  fuenteDOE,
  fuenteBOIB,
  fuenteBOA,
  fuenteBOC,
  fuenteBOPV,
  fuenteDOG,
  fuenteDOCM,
  fuenteBOPA,
  fuenteCIDO,
  fuenteEPSO,
];

export const IDS_FUENTES = FUENTES.map((f) => f.id);

export const MAX_ITEMS_POR_FUENTE = 250;
/** Tope de tiempo por fuente: un portal colgado no puede retener la ingesta
 * indefinidamente (antes un host inalcanzable consumía sus reintentos completos
 * y el usuario, al reintentar, veía «HTTP 409 · ingesta ya en marcha»). */
const TECHO_FUENTE_MS = 45_000;
/* El BOE usa el mismo techo: su orquestador prueba sus 4 rutas DIRECTAS con una
 * conexión de 8 s por ruta (~34 s en el peor caso, cortafuegos incluido). */

export function fuentePorId(id) {
  return FUENTES.find((f) => f.id === id);
}

/** Valida la lista de fuentes activas guardada en los ajustes (JSON). */
export function normalizarFuentesActivas(valor) {
  if (!valor) return null;
  try {
    const lista = JSON.parse(valor);
    if (!Array.isArray(lista)) return null;
    const validos = lista.filter((x) => typeof x === "string" && IDS_FUENTES.includes(x));
    return validos.length > 0 ? FUENTES.filter((f) => validos.includes(f.id)).map((f) => f.id) : null;
  } catch {
    return null;
  }
}

/** Carrera entre la consulta y un reloj: si la fuente tarda más del tope,
 * se registra como error de tiempo y la ingesta continúa con el resto. */
function conTecho(promesa, ms) {
  let reloj;
  const vencido = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error(`sin respuesta en ${ms / 1000} s (tiempo agotado)`)), ms);
  });
  return Promise.race([promesa, vencido]).finally(() => clearTimeout(reloj));
}

/**
 * Consulta secuencialmente las fuentes activas para una fecha.
 * Cada fuente se ejecuta de forma independiente: un fallo no impide al resto.
 * Entre fuentes hay una pausa de 1 s para ser respetuosos con los portales.
 */
export async function consultarFuentes(fecha, activas, pausaMs = 1000) {
  const lista = activas && activas.length > 0 ? FUENTES.filter((f) => activas.includes(f.id)) : FUENTES;
  const resultados = [];
  for (let i = 0; i < lista.length; i++) {
    const f = lista[i];
    try {
      const items = (await conTecho(f.obtener(fecha), TECHO_FUENTE_MS)).slice(0, MAX_ITEMS_POR_FUENTE);
      const detalle = f.id === "boe" ? `endpoint: ${endpointBOEUsado()}` : undefined;
      resultados.push({
        id: f.id,
        nombre: f.nombre,
        estado: items.length === 0 ? "sin_datos" : "ok",
        items,
        ...(items.length === 0 ? { detalle: "Sin anuncios de empleo ese día (o boletín no publicado)" } : detalle ? { detalle } : {}),
      });
    } catch (e) {
      resultados.push({
        id: f.id,
        nombre: f.nombre,
        estado: "error",
        items: [],
        detalle: e instanceof Error ? e.message : String(e),
      });
    }
    if (i < lista.length - 1) await new Promise((r) => setTimeout(r, pausaMs));
  }
  return resultados;
}

/**
 * Verificación de conectividad (p. ej. para comprobar el firewall): una
 * petición ligera por fuente con timeout corto. No guarda nada.
 */
const SONDAS = {
  // Raíz del portal: responde 200 siempre que haya conexión. NO sondear la API
  // de datos abiertos con una fecha sin boletín (p. ej. un festivo): devuelve
  // «500 code 101» y el panel pintaba «BOE caído» con el servicio perfecto.
  boe: "https://www.boe.es/",
  bocm: "https://www.bocm.es/",
  boja: "https://www.juntadeandalucia.es/boja/distribucion/s53.xml",
  dogv: "https://dogv.gva.es/dogv-portal-frontend/es",
  dogc: "https://portaldogc.gencat.cat/eadop-rest/api/dogc/calendarDOGC",
  bocyl: "https://bocyl.jcyl.es/",
  doe: "https://doe.juntaex.es/",
  boib: "https://www.caib.es/eboibfront/es/rss",
  boa: "https://www.boa.aragon.es/",
  boc: "https://www.gobiernodecanarias.org/boc/",
  bopv: "https://www.euskadi.eus/bopv2/datos/Ultimo.shtml",
  dog: "https://www.xunta.gal/dog",
  docm: "https://docm.jccm.es/portaldocm/",
  bopa: "https://miprincipado.asturias.es/bopa/ultimos-boletines?p_r_p_summaryLastBopa=true",
  cido: "https://api.diba.cat/dadesobertes/cido/v1/oposicions?page%5Blimit%5D=1",
  epso: "https://eu-careers.europa.eu/es/job-opportunities/in-progress",
};

export async function verificarFuentes() {
  const salidas = [];
  const sondear = async (f) => {
    const inicio = Date.now();
    try {
      permitirSalida(SONDAS[f.id]); // cortafuegos de salida
      const res = await fetch(SONDAS[f.id], {
        headers: { "User-Agent": "OpoAlertaDocker/2.1 (+verificacion de fuentes)" },
        signal: AbortSignal.timeout(8000),
      });
      return {
        id: f.id,
        nombre: f.nombre,
        ok: res.status < 500, // 4xx = el portal responde pero pide otra cosa: hay conexión
        ms: Date.now() - inicio,
        detalle: `HTTP ${res.status}`,
      };
    } catch (e) {
      return {
        id: f.id,
        nombre: f.nombre,
        ok: false,
        ms: Date.now() - inicio,
        detalle: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      };
    }
  };
  // En lotes de 4 para no saturar (16 fuentes × 8 s de tope = ~35 s peor caso,
  // frente a los más de 2 minutos que tardaba en serie).
  const LOTE = 4;
  for (let i = 0; i < FUENTES.length; i += LOTE) {
    salidas.push(...(await Promise.all(FUENTES.slice(i, i + LOTE).map(sondear))));
  }
  return salidas;
}

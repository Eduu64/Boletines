// Prueba del selector de boletines por alerta (v2.3.19): unitaria, sin servidor.
// Importa el motor REAL de matching y comprueba:
//  1) boletinesDe acepta JSON de la BD, array ya parseado o null → array limpio
//  2) itemCoincide respeta el filtro de boletines (fuente del anuncio)
//  3) retrocompatibilidad: alertas sin boletines siguen mirando todos
import { itemCoincide, boletinesDe } from "../servidor/matching.mjs";

let fallos = 0;
function ok(cond, texto, detalle = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${texto}${cond ? "" : ` — ${detalle}`}`);
  if (!cond) fallos++;
}

console.log("\n═══ 1) boletinesDe: parseo de la columna ═══");
ok(JSON.stringify(boletinesDe({ boletines: null })) === "[]", "null → [] (todos los boletines)");
ok(JSON.stringify(boletinesDe({})) === "[]", "sin columna → []");
ok(JSON.stringify(boletinesDe({ boletines: "" })) === "[]", "cadena vacía → []");
ok(JSON.stringify(boletinesDe({ boletines: '["bocm","boe"]' })) === '["bocm","boe"]', "JSON de la BD → array");
ok(JSON.stringify(boletinesDe({ boletines: ["bocm", "boe"] })) === '["bocm","boe"]', "array ya parseado → intacto");
ok(JSON.stringify(boletinesDe({ boletines: "no es json" })) === "[]", "texto no-JSON → [] (sin petar)");
ok(JSON.stringify(boletinesDe({ boletines: '{"a":1}' })) === "[]", "JSON no-array → []");
ok(JSON.stringify(boletinesDe({ boletines: '["BOCM", " Boe "]' })) === '["bocm","boe"]', "mayúsculas y espacios se normalizan");
ok(JSON.stringify(boletinesDe({ boletines: '["", "bocm"]' })) === '["bocm"]', "huecos vacíos se descartan");

console.log("\n═══ 2) itemCoincide: filtro por boletín del anuncio ═══");
const alertaBocm = { nombre: "t", keywords: "personal laboral", modoKeywords: "cualquiera", soloConvocatorias: true, boletines: '["bocm"]' };
const alertaDos = { nombre: "t", keywords: "personal laboral", modoKeywords: "cualquiera", soloConvocatorias: true, boletines: '["bocm","boe"]' };
const alertaTodos = { nombre: "t", keywords: "personal laboral", modoKeywords: "cualquiera", soloConvocatorias: true }; // sin columna
const itemBocm = { titulo: "Personal laboral fijo del Ayuntamiento", departamento: "Ayuntamiento de Madrid", tipo: "convocatoria", fuente: "bocm" };
const itemBoe = { titulo: "Personal laboral fijo de la Administración", departamento: "Ministerio de Defensa", tipo: "convocatoria", fuente: "boe" };
const itemDemo = { titulo: "Personal laboral (demo)", departamento: "Entidad demo", tipo: "convocatoria", fuente: "demo" };

ok(itemCoincide(alertaBocm, itemBocm) === true, "alerta BOCM + anuncio BOCM → coincide");
ok(itemCoincide(alertaBocm, itemBoe) === false, "alerta BOCM + anuncio BOE con las MISMAS keywords → NO coincide (filtro aplica antes que keywords)");
ok(itemCoincide(alertaDos, itemBoe) === true, "alerta BOCM+BOE + anuncio BOE → coincide");
ok(itemCoincide(alertaDos, itemDemo) === false, "alerta BOCM+BOE + anuncio demo → NO coincide");
ok(itemCoincide(alertaTodos, itemBocm) === true, "sin boletines (columna antigua) → todos los anuncios, como siempre");
ok(itemCoincide(alertaTodos, itemDemo) === true, "sin boletines + fuente demo → coincide (retrocompatible)");

const sinFuente = { titulo: "Personal laboral", departamento: "X", tipo: "convocatoria" };
ok(itemCoincide(alertaBocm, sinFuente) === false, "anuncio SIN fuente + alerta con filtro → no coincide (no explota)");
ok(itemCoincide(alertaTodos, sinFuente) === true, "anuncio SIN fuente + alerta sin filtro → coincide (no explota)");

console.log("\n═══ 3) el filtro se combina con el resto de condiciones ═══");
const combinada = { nombre: "t", keywords: "madrid", modoKeywords: "todas", organismo: "Ayuntamiento de Madrid", soloConvocatorias: true, boletines: '["bocm"]' };
ok(itemCoincide(combinada, itemBocm) === true, "boletín + keywords + organismo correctos → coincide");
ok(itemCoincide(combinada, { ...itemBocm, tipo: "lista" }) === false, "…pero soloConvocatorias sigue descartando listas");
ok(itemCoincide(combinada, { ...itemBocm, departamento: "Diputación de Barcelona" }) === false, "…y el organismo sigue filtrando");

console.log(fallos === 0 ? "\n== SELECTOR DE BOLETINES: todo pasa ✓" : `\n== SELECTOR DE BOLETINES: ${fallos} fallo(s) ✗`);
process.exit(fallos === 0 ? 0 : 1);

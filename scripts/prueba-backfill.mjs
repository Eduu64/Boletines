// Prueba del relleno de días perdidos (v2.3.17). Modo demo (sin red).
// Un escenario por invocación (la BD se abre al importar; así cada caso
// arranca limpia):
//   node scripts/prueba-backfill.mjs diario   → backfillDiario: rellena los
//       huecos de los últimos BACKFILL_DIAS días SIN hoy y salta los ya «ok»
//   node scripts/prueba-backfill.mjs arranque → backfillArranque: igual pero
//       INCLUYE hoy (origen «arranque»)
// Comprueba también los topes de BACKFILL_DIAS (v2.3.17: 0-30).

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ESCENARIO = process.argv[2];
if (ESCENARIO !== "diario" && ESCENARIO !== "arranque") {
  console.error("Uso: node scripts/prueba-backfill.mjs diario|arranque");
  process.exit(2);
}

let fallos = 0;
function ok(nombre, cond, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? ` — ${extra}` : ""}`);
  if (!cond) fallos++;
}

const DIR = mkdtempSync(join(tmpdir(), "oapo-backfill-"));
process.env.DATABASE_URL = `file:${join(DIR, "opoalerta.db")}`;
process.env.ZONA_HORARIA = "Europe/Madrid";
process.env.PERMITIR_WEBHOOKS_LOCALES = ""; // nada de red: alertas no se tocan

const { asegurarEsquema, ejecutar, todas } = await import(new URL("../servidor/bd.mjs", import.meta.url));
const { backfillDiario, backfillArranque, diasBackfill, obtenerAjustes } = await import(
  new URL("../servidor/ingesta.mjs", import.meta.url)
);

function fechaRelativa(diasAtras) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" })
    .format(new Date(Date.now() - diasAtras * 86400000))
    .replace(/-/g, "");
}

// ── Topes de la ventana ──────────────────────────────────────────────────────
delete process.env.BACKFILL_DIAS;
ok("sin BACKFILL_DIAS → 7", diasBackfill() === 7);
for (const [valor, esperado] of [["20", 20], ["99", 30], ["0", 0], ["basura", 7], ["-5", 0]]) {
  process.env.BACKFILL_DIAS = valor;
  ok(`BACKFILL_DIAS=${JSON.stringify(valor)} → ${esperado}`, diasBackfill() === esperado, `sale ${diasBackfill()}`);
}
process.env.BACKFILL_DIAS = "3";

// ── Escenario ────────────────────────────────────────────────────────────────
asegurarEsquema();
const ajustes = obtenerAjustes();
ejecutar(`UPDATE Ajustes SET fuente = 'demo' WHERE id = ?`, ajustes.id); // sin red

function sembrarOk(diasAtras) {
  ejecutar(
    `INSERT INTO IngestaLog (id, fechaBOE, fuente, estado, itemsSeccion, itemsNuevos, notificados, mensaje, duracionMs, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(), fechaRelativa(diasAtras), "demo", "ok", 0, 0, 0, null, 0, "programado"
  );
}

const filas = () => todas(`SELECT fechaBOE, estado, origen FROM IngestaLog WHERE estado = 'ok'`);

if (ESCENARIO === "diario") {
  // Ventana de 3 días: hace2 y hace1. hace1 ya tiene ingesta «ok» (se salta),
  // hace2 falta (se rellena), hace3 queda FUERA de la ventana, hoy no se toca.
  sembrarOk(1);
  await backfillDiario();
  const log = filas();
  ok("hace2 se rellena con origen «reintento»", log.some((f) => f.fechaBOE === fechaRelativa(2) && f.origen === "reintento"));
  ok("hace1 no se duplica (ya estaba «ok»)", log.filter((f) => f.fechaBOE === fechaRelativa(1)).length === 1);
  ok("hace3 queda fuera de la ventana", !log.some((f) => f.fechaBOE === fechaRelativa(3)));
  ok("hoy no se toca (la ingesta programada acaba de hacerlo)", !log.some((f) => f.fechaBOE === fechaRelativa(0)));
} else {
  // Arranque con ventana de 2 días: hace1 ya «ok» (se salta), hoy falta
  // (servidor apagado a la hora de la ingesta) → se rellena con origen «arranque».
  sembrarOk(1);
  sembrarOk(2);
  await backfillArranque();
  const log = filas();
  ok("hoy se rellena con origen «arranque»", log.some((f) => f.fechaBOE === fechaRelativa(0) && f.origen === "arranque"));
  ok("hace1 y hace2 no se duplican", log.filter((f) => f.fechaBOE === fechaRelativa(1) || f.fechaBOE === fechaRelativa(2)).length === 2);
}

rmSync(DIR, { recursive: true, force: true });
if (fallos > 0) {
  console.error(`\nPRUEBA-BACKFILL (${ESCENARIO}): ${fallos} fallos`);
  process.exit(1);
}
console.log(`\nPRUEBA-BACKFILL (${ESCENARIO}): todo pasa ✓`);

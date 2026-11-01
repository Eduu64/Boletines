// Batería completa de pruebas de OpoAlerta v2.3.9.
// Uso: node scripts/prueba-completa.mjs
// 1) fixtures offline de los 16 parsers   2) matching offline (personal laboral…)
// 3) arranca BOE falso + receptor de webhooks + la app
// 4) cuádruple respaldo del BOE           5) E2E del pipeline (demo, Discord…)
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { setTimeout as esperar } from "node:timers/promises";

const RAIZ = new URL("..", import.meta.url).pathname;
let fallos = 0;

// La batería es idempotente: parte SIEMPRE de una base limpia (si se reutiliza
// la BD anterior, la deduplicación daría «nuevos=0» y fallarían aserciones).
rmSync("/tmp/opo-data/prueba-completa.db", { force: true });
rmSync("/tmp/opo-data/prueba-completa.db-wal", { force: true });
rmSync("/tmp/opo-data/prueba-completa.db-shm", { force: true });

function lanzar(comando, args, opciones = {}) {
  return new Promise((resolver) => {
    const hijo = spawn(comando, args, { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"], ...opciones });
    let salida = "";
    hijo.stdout.on("data", (d) => (salida += d.toString()));
    hijo.stderr.on("data", (d) => (salida += d.toString()));
    hijo.on("exit", (codigo) => resolver({ codigo, salida }));
  });
}

async function paso(nombre, comando, args, env = {}) {
  console.log(`\n═══ ${nombre} ═══`);
  const r = await lanzar(comando, args, { env: { ...process.env, ...env } });
  console.log(r.salida.trim().split("\n").slice(-40).join("\n"));
  if (r.codigo !== 0) {
    fallos++;
    console.log(`❌ ${nombre} (código ${r.codigo})`);
  } else {
    console.log(`✅ ${nombre}`);
  }
}

async function esperarPuerto(url, intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await esperar(500);
  }
  return false;
}

async function main() {
  // 1 y 2: sin servidor
  await paso("Fixtures: 16 parsers con datos reales", "node", ["scripts/prueba-fixtures.mjs"]);
  await paso("Matching offline (personal laboral incluido)", "node", ["scripts/test-matching-e2e.js"]);
  await paso("Cortafuegos de salida (lista blanca)", "node", ["scripts/prueba-cortafuegos.mjs"]);

  // 3: servicios auxiliares
  const boeFalso = spawn("node", ["scripts/boe-falso.mjs"], { cwd: RAIZ, stdio: "ignore" });
  const mock = spawn("node", ["scripts/mock-webhook.mjs"], { cwd: RAIZ, stdio: "ignore" });
  const app = spawn(
    "node",
    ["servidor/indice.mjs"],
    {
      cwd: RAIZ,
      stdio: "ignore",
      env: {
        ...process.env,
        DATABASE_URL: "file:/tmp/opo-data/prueba-completa.db",
        PORT: "3000",
        ENABLE_SCHEDULER: "0",
        PERMITIR_WEBHOOKS_LOCALES: "1",
        BOE_BASE_URL: "http://127.0.0.1:4100",
      },
    }
  );
  try {
    const lista = await esperarPuerto("http://127.0.0.1:3000/api/health");
    if (!lista) throw new Error("la app no arrancó");
    await esperar(1200); // dejar terminar el sembrado

    // 4 y 5: contra la app real (misma BD que la app para la limpieza)
    await paso("Cuádruple respaldo del BOE", "node", ["scripts/prueba-fallback.mjs"], { DATABASE_URL: "file:/tmp/opo-data/prueba-completa.db" });
    await paso("E2E del pipeline completo", "node", ["scripts/prueba-e2e.mjs"]);
  } finally {
    app.kill();
    boeFalso.kill();
    mock.kill();
  }

  console.log(fallos === 0 ? "\n== BATERÍA COMPLETA: todo pasa ✓" : `\n== BATERÍA COMPLETA: ${fallos} bloque(s) fallido(s) ✗`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR FATAL:", e);
  process.exit(1);
});

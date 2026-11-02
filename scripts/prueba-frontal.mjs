// Prueba del frontal (v2.3.18): pasarela TCP con cortafuegos de entrada.
// Arranca una app y un frontal locales y comprueba:
//   1. HTTP a través del frontal llega a la app (health 200 con versión).
//   2. Un intento TLS (primer byte 0x16, lo que manda un navegador al pedir
//      https://) se CORTA al instante y sin responder nada — antes llegaba a
//      la app, esta contestaba 400 en claro y Chrome (móvil) reintentaba en
//      bucle hasta «ERR_TOO_MANY_RETRIES».
//   3. El frontal sigue sirviendo HTTP después del intento TLS.
//   4. Varios dispositivos a la vez (dos peticiones concurrentes) → ambas 200.

import { spawn } from "node:child_process";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const DIR = mkdtempSync(join(tmpdir(), "oapo-frontal-"));

let fallos = 0;
const ok = (nombre, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? ` — ${extra}` : ""}`);
  if (!cond) fallos++;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const app = spawn("node", ["servidor/indice.mjs"], {
  cwd: RAIZ,
  stdio: "ignore",
  env: {
    ...process.env,
    PORT: "3211",
    HOST: "127.0.0.1",
    DATABASE_URL: `file:${join(DIR, "opoalerta.db")}`,
    ENABLE_SCHEDULER: "0",
  },
});
const frontal = spawn("node", ["frontal/frontal.mjs"], {
  cwd: RAIZ,
  stdio: "ignore",
  env: {
    ...process.env,
    PORT: "3999",
    HOST: "127.0.0.1",
    DESTINO_HOST: "127.0.0.1",
    DESTINO_PUERTO: "3211",
  },
});

async function health() {
  const res = await fetch("http://127.0.0.1:3999/api/health");
  const cuerpo = await res.json();
  return { estado: res.status, cuerpo };
}

// Espera a que app + frontal estén serviendo (máx. 8 s)
let levantado = false;
for (let i = 0; i < 32 && !levantado; i++) {
  await esperar(250);
  try {
    levantado = (await health()).estado === 200;
  } catch {
    /* aún no */
  }
}

try {
  if (!levantado) {
    ok("app + frontal arrancan y sirven a través del frontal", false);
  } else {
    // 1) HTTP a través del frontal
    const h1 = await health();
    ok("HTTP a través del frontal → health 200", h1.estado === 200, `version=${h1.cuerpo?.version}`);

    // 2) Intento TLS (handshake ClientHello mínimo, primer byte 0x16)
    const tls = await new Promise((resolver) => {
      const datos = [];
      const fin = (resultado) => {
        clearTimeout(temporizador);
        resolver(resultado);
      };
      const temporizador = setTimeout(() => fin({ cerrado: false, http: false, bytes: 0 }), 4000);
      const s = net.connect(3999, "127.0.0.1", () => {
        // ClientHello recortado: solo importa el primer byte (0x16 = handshake)
        s.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05, 0x01, 0x00, 0x00, 0x01, 0x00]));
      });
      s.on("data", (b) => datos.push(b));
      s.on("close", () => fin({ cerrado: true, http: false, bytes: datos.length }));
      s.on("error", () => fin({ cerrado: true, http: false, bytes: datos.length }));
    });
    const recibido = tls.bytes > 0;
    ok("intento https cortado al instante, sin respuesta", tls.cerrado && !recibido, `cerrado=${tls.cerrado} bytes=${tls.bytes}`);

    // 3) El frontal sigue sirviendo después del intento TLS
    const h2 = await health();
    ok("el frontal sigue sirviendo HTTP tras el intento https", h2.estado === 200);

    // 4) Varios dispositivos a la vez
    const [a, b] = await Promise.all([health(), health()]);
    ok("dos clientes a la vez (PC + móvil) → ambos 200", a.estado === 200 && b.estado === 200);
  }
} finally {
  app.kill("SIGTERM");
  frontal.kill("SIGTERM");
  await esperar(300);
  rmSync(DIR, { recursive: true, force: true });
}

if (fallos > 0) {
  console.error(`\nPRUEBA-FRONTAL: ${fallos} fallos`);
  process.exit(1);
}
console.log("\nPRUEBA-FRONTAL: todo pasa ✓");

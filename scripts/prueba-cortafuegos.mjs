// Prueba del cortafuegos de salida (lista blanca de dominios) y de entrada
// (solo red local). Comprueba que se permiten los portales de los boletines +
// Discord + loopback, que se bloquea cualquier otro destino ANTES de tocar la
// red, que el panel solo se sirve a IPs privadas, y los interruptores
// CORTAFUEGOS_SALIDA=off, CORTAFUEGOS_ENTRADA=off y SALIDA_EXTRA (hijos).
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";

const RAIZ = new URL("..", import.meta.url).pathname;
let fallos = 0;
function ok(nombre, cond, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? ` — ${extra}` : ""}`);
  if (!cond) fallos++;
}

const { permitirSalida, cortafuegosActivo, permitirEntrada, descargar } = await import(`${RAIZ}/servidor/cortafuegos.mjs`).then(async (cf) => ({
  ...cf,
  descargar: (await import(`${RAIZ}/servidor/util.mjs`)).descargar,
}));

// ─── Reglas por defecto ─────────────────────────────────────────────────────
ok("cortafuegos activo por defecto", cortafuegosActivo() === true);

const permitidas = [
  "https://www.boe.es/datosabiertos/api/boe/sumario/20261030",
  "https://www.boe.es/boe/dias/2026/10/30/",
  "https://www.bocm.es/boletin/CM_Boletin_BOCM/2026/10/30/BOCM-20261030001.xml",
  "https://www.juntadeandalucia.es/boja/distribucion/s53.xml",
  "https://portaldogc.gencat.cat/eadop-rest/api/dogc/sumario",
  "https://dogc.gencat.cat/es/estadistiques",
  "https://sede.asturias.es/bopa-descargas/algo.pdf",
  "https://cido.diba.cat/oposicion/1234",
  "https://eu-careers.europa.eu/es/job-opportunities",
  "https://discord.com/api/v10/channels/123/messages",
  "https://discordapp.com/api/webhooks/123/abc",
];
for (const u of permitidas) {
  let error = "";
  try {
    permitirSalida(u);
  } catch (e) {
    error = e.message;
  }
  ok(`permitida: ${new URL(u).host}`, error === "", error);
}

const bloqueadas = ["https://ejemplo-aleatorio.net/x", "https://pastebin.com/raw/x", "http://169.254.169.254/latest/meta-data/"];
for (const u of bloqueadas) {
  let error = "";
  try {
    permitirSalida(u);
  } catch (e) {
    error = e.message;
  }
  ok(`bloqueada: ${new URL(u).host}`, /Cortafuegos de salida/.test(error), error.slice(0, 70));
}

for (const u of ["http://127.0.0.1:4100/modo?x=A", "http://localhost:3000/api/health", "http://127.0.0.1:3000/"]) {
  let error = "";
  try {
    permitirSalida(u);
  } catch (e) {
    error = e.message;
  }
  ok(`permitida (loopback): ${u}`, error === "", error);
}

let errorUrl = "";
try {
  permitirSalida("no es una url");
} catch (e) {
  errorUrl = e.message;
}
ok("URL no válida → bloqueada con mensaje claro", /Cortafuegos de salida/.test(errorUrl), errorUrl.slice(0, 60));

// ─── Integración: descargar() respeta el cortafuegos ────────────────────────
const srv = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("contenido local de prueba con longitud suficiente");
});
await new Promise((r) => srv.listen(4198, "127.0.0.1", r));

const texto = await descargar("http://127.0.0.1:4198/prueba");
ok("descargar() a loopback funciona", texto.includes("contenido local"), `${texto.length} bytes`);

let msgBloqueo = "";
let t0 = Date.now();
try {
  await descargar("https://dominio-no-permitido.example/x");
} catch (e) {
  msgBloqueo = e.message;
}
ok("descargar() a dominio no permitido falla al instante (antes de la red)", /Cortafuegos de salida/.test(msgBloqueo) && Date.now() - t0 < 500, `${Date.now() - t0} ms → ${msgBloqueo.slice(0, 60)}`);

srv.close();

// ─── Cortafuegos de ENTRADA: solo IPs privadas (tu LAN) ─────────────────────
const { cortafuegosEntradaActivo: entradaActiva } = await import(`${RAIZ}/servidor/cortafuegos.mjs`);
ok("entrada: activa por defecto (lan)", entradaActiva() === true);

const ipsDentro = [
  "127.0.0.1", // loopback (healthcheck, pruebas)
  "::1", // loopback IPv6
  "192.168.1.50", // LAN típica
  "192.168.0.24", // LAN típica
  "10.0.0.2", // red 10/8
  "172.17.0.1", // gateway de red Docker
  "172.20.0.5", // red Docker del modo reforzado
  "::ffff:192.168.1.7", // IPv4 mapeada en IPv6
  "fe80::1", // enlace local IPv6
  "fd7a:4169::5", // ULA (fc00::/7)
  "169.254.10.10", // enlace local IPv4
];
for (const ip of ipsDentro) ok(`entrada permitida: ${ip}`, permitirEntrada(ip) === true);

const ipsFuera = [
  "8.8.8.8", // IP pública cualquiera
  "1.2.3.4", // IP pública
  "100.64.0.1", // CGNAT (no es LAN)
  "2606:4700::1111", // IPv6 global
  "", // sin IP: fuera
];
for (const ip of ipsFuera) ok(`entrada rechazada: ${ip || "(vacía)"}`, permitirEntrada(ip) === false);

function hijoEntrada(env, ip) {
  const r = spawnSync(
    process.execPath,
    ["-e", `import("${RAIZ}/servidor/cortafuegos.mjs").then((m) => console.log(m.permitirEntrada(${JSON.stringify(ip)}) ? "PERMITIDA" : "BLOQUEADA"))`],
    { env: { ...process.env, ...env }, encoding: "utf8" }
  );
  return (r.stdout || "").trim();
}
ok("CORTAFUEGOS_ENTRADA=off atiende a cualquiera", hijoEntrada({ CORTAFUEGOS_ENTRADA: "off" }, "8.8.8.8") === "PERMITIDA", "");
ok("por defecto una IP pública queda fuera", hijoEntrada({}, "9.9.9.9") === "BLOQUEADA", "");

// ─── FRONTAL del modo reforzado: publica y filtra (E2E con el frontal real) ─
// Levanta la «app» falsa y el frontal REAL (frontal/frontal.mjs) apuntándole:
// una conexión por loopback debe atravesar la tubería (200 de la app) y una
// conexión desde una IP no privada de este entorno debe recibir el 403 del
// cortafuegos de entrada sin llegar a la app.
{
  const srvApp = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("saludo de la app falsa (atraviesa el frontal)");
  });
  await new Promise((r) => srvApp.listen(4199, "127.0.0.1", r));

  const frontal = spawn(process.execPath, [`${RAIZ}/frontal/frontal.mjs`], {
    env: { ...process.env, PORT: "4200", HOST: "0.0.0.0", DESTINO_HOST: "127.0.0.1", DESTINO_PUERTO: "4199" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let salidaFrontal = "";
  frontal.stdout.on("data", (d) => (salidaFrontal += d));
  frontal.stderr.on("data", (d) => (salidaFrontal += d));
  const arriba = await new Promise((res) => {
    const t = setInterval(() => {
      if (/frontal escuchando/.test(salidaFrontal)) {
        clearInterval(t);
        res(true);
      }
    }, 50);
    setTimeout(() => {
      clearInterval(t);
      res(false);
    }, 4000);
  });
  ok("frontal arranca y escucha", arriba, salidaFrontal.split("\n")[0].slice(0, 90));

  if (arriba) {
    try {
      const r = await fetch("http://127.0.0.1:4200/api/health");
      const texto = await r.text();
      ok("frontal: loopback atraviesa la tubería hasta la app", r.status === 200 && texto.includes("app falsa"), `HTTP ${r.status}`);
    } catch (e) {
      ok("frontal: loopback atraviesa la tubería hasta la app", false, e.message);
    }

    // Si este entorno tiene alguna IPv4 que el cortafuegos considera no privada,
    // una conexión a ella debe recibir el 403 del frontal (la app ni se entera).
    const ipGlobal = [...new Set(Object.values(os.networkInterfaces()).flat())]
      .filter((i) => i && !i.internal && !String(i.address).includes(":") && permitirEntrada(i.address) === false)
      .map((i) => i.address)[0];
    if (ipGlobal) {
      const codigo = await new Promise((res) => {
        const s = net.connect(4200, ipGlobal);
        let data = "";
        s.on("data", (d) => {
          data += d;
          s.destroy();
        });
        s.on("close", () => res(/HTTP\/1\.1 403/.test(data) ? 403 : 0));
        s.on("error", () => res(0));
        setTimeout(() => {
          s.destroy();
          res(/HTTP\/1\.1 403/.test(data) ? 403 : 0);
        }, 2000);
      });
      ok(`frontal: una IP no privada (${ipGlobal}) recibe 403 sin tocar la app`, codigo === 403, `respuesta: ${codigo || "sin datos"}`);
    } else {
      console.log("ℹ️  (este entorno no tiene ninguna IP no privada: el 403 del frontal queda cubierto por los unit-tests de permitirEntrada)");
    }
  }
  frontal.kill();
  srvApp.close();
}

// ─── Interruptores por variables de entorno (procesos hijos) ────────────────
function hijo(env, url) {
  const r = spawnSync(process.execPath, ["-e", `import("${RAIZ}/servidor/cortafuegos.mjs").then((m) => { try { m.permitirSalida(${JSON.stringify(url)}); console.log("PERMITIDA"); } catch { console.log("BLOQUEADA"); } })`], { env: { ...process.env, ...env }, encoding: "utf8" });
  return (r.stdout || "").trim();
}
ok("CORTAFUEGOS_SALIDA=off permite cualquier destino", hijo({ CORTAFUEGOS_SALIDA: "off" }, "https://lo-que-sea.example") === "PERMITIDA", "");
ok("SALIDA_EXTRA añade un dominio permitido", hijo({ SALIDA_EXTRA: "portal.interno.org" }, "https://portal.interno.org/x") === "PERMITIDA", "");
ok("SALIDA_EXTRA no abre el resto", hijo({ SALIDA_EXTRA: "portal.interno.org" }, "https://otro.example/x") === "BLOQUEADA", "");

console.log(fallos === 0 ? "\n== CORTAFUEGOS: todo pasa ✓" : `\n== CORTAFUEGOS: ${fallos} comprobaciones fallidas ✗`);
process.exit(fallos === 0 ? 0 : 1);

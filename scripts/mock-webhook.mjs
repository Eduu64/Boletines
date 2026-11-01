// Receptor mock de webhooks de Discord para verificar el envío E2E.
import http from "node:http";
import fs from "node:fs";

const FICHERO = "/tmp/webhooks_capturados.json";
const PUERTO = 3999;

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    const arr = fs.existsSync(FICHERO) ? JSON.parse(fs.readFileSync(FICHERO, "utf8")) : [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(arr));
    return;
  }
  let cuerpo = "";
  req.on("data", (c) => (cuerpo += c));
  req.on("end", () => {
    const arr = fs.existsSync(FICHERO) ? JSON.parse(fs.readFileSync(FICHERO, "utf8")) : [];
    arr.push({ ts: new Date().toISOString(), path: req.url, body: JSON.parse(cuerpo || "{}") });
    fs.writeFileSync(FICHERO, JSON.stringify(arr, null, 2));
    res.writeHead(204);
    res.end();
  });
});

server.listen(PUERTO, "127.0.0.1", () => console.log(`mock webhook listo en 127.0.0.1:${PUERTO}`));

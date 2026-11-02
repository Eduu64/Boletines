// ─────────────────────────────────────────────────────────────────────────────
// FRONTAL del panel (modo reforzado): puerta de ENTRADA con cortafuegos.
//
// ¿Por qué existe este contenedor? Docker no publica puertos de contenedores
// que SOLO están en redes «internal: true» (comportamiento oficial confirmado
// por los mantenedores: moby/moby#53256): la configuración se acepta pero no
// se publica nada (NetworkSettings.Ports vacía). Este frontal vive además en
// la red «salida», donde Docker sí puede publicar el puerto, y reenvía cada
// conexión a la app (opoalerta:3000), que sigue en su red sin internet.
//
// NO es una tubería ciega: aplica el MISMO cortafuegos de entrada que la app
// (permitirEntrada, de servidor/cortafuegos.mjs) a la IP real del visitante —
// el reenvío de Docker conserva la IP de origen. Una IP pública de internet
// recibe aquí un 403 inmediato, antes de tocar la app. La app conserva su
// filtro como segunda capa (lo que ella ve es la IP privada de este frontal:
// siempre aceptada, como debe ser).
//
// TCP puro con node:net: reenvía bytes en ambos sentidos sin entender HTTP,
// no ejecuta código de la app, no guarda nada y no necesita internet.
// Variables de entorno: PORT (3000), HOST (0.0.0.0), DESTINO_HOST (opoalerta),
// DESTINO_PUERTO (3000). CORTAFUEGOS_ENTRADA=lan|off actúa igual que en la app.
// ─────────────────────────────────────────────────────────────────────────────
import net from "node:net";
import { permitirEntrada } from "../servidor/cortafuegos.mjs";

const PUERTO = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DESTINO = {
  host: process.env.DESTINO_HOST || "opoalerta",
  puerto: Number(process.env.DESTINO_PUERTO || 3000),
};

// Respuesta mínima para quien no pertenece a la red local (mismo criterio que
// el 403 de la app: no procesar nada, solo avisar y cerrar).
const CUERPO = "403 — el panel solo se sirve a la red local (cortafuegos de entrada).";
const RECHAZO = [
  "HTTP/1.1 403 Forbidden",
  "Content-Type: text/plain; charset=utf-8",
  `Content-Length: ${Buffer.byteLength(CUERPO)}`,
  "Connection: close",
  "",
  CUERPO,
].join("\r\n");

const servidor = net.createServer((cliente) => {
  const ip = String(cliente.remoteAddress ?? "").trim();
  if (!permitirEntrada(ip)) {
    console.log(new Date().toISOString(), `403 — IP no privada bloqueada por el frontal: ${ip || "(sin IP)"}`);
    cliente.end(RECHAZO, () => cliente.destroy());
    return;
  }

  // v2.3.18: mirar el PRIMER byte antes de tubear. Si es 0x16 es un handshake
  // TLS — alguien llega con https:// o el navegador (sobre todo el móvil)
  // «subió» la dirección a https por su cuenta. Este panel es HTTP: lo correcto
  // es cortar AL INSTANTE. Antes, los bytes TLS cruzaban hasta la app, esta
  // respondía un 400 en texto plano dentro del socket que el navegador espera
  // cifrado, y Chrome lo reintentaba unas cuantas veces hasta rendirse con
  // «ERR_TOO_MANY_RETRIES / es posible que esté inactiva o trasladada». Con el
  // cierre inmediato, el intento https falla limpio y en un segundo: Chrome
  // rebota a http:// por su cuenta (o al menos el error ya no es un bucle).
  cliente.pause();
  cliente.once("readable", () => {
    const primero = cliente.read();
    if (primero && primero.length > 0 && primero[0] === 0x16) {
      console.log(new Date().toISOString(), `conexión TLS cerrada (${ip}): el panel es http:// — el navegador estaba intentando https://`);
      cliente.destroy();
      return;
    }
    // HTTP (o cualquier otra cosa): adelante. El primer trozo ya se ha
    // consumido para espiarlo — se reenvía a mano y la tubería sigue con el resto.
    const app = net.connect(DESTINO.puerto, DESTINO.host);
    if (primero && primero.length > 0) app.write(primero);
    cliente.pipe(app);
    app.pipe(cliente);
    const cerrar = () => {
      cliente.destroy();
      app.destroy();
    };
    cliente.on("error", cerrar);
    app.on("error", cerrar);
    cliente.on("close", () => app.destroy());
    app.on("close", () => cliente.destroy());
    cliente.resume();
  });
});

servidor.listen(PUERTO, HOST, () => {
  console.log(
    new Date().toISOString(),
    `frontal escuchando en http://${HOST}:${PUERTO} → ${DESTINO.host}:${DESTINO.puerto} (solo IPs privadas; una IP pública recibe 403)`
  );
});

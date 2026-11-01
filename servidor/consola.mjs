// Consola del servidor: búfer circular en memoria (500 líneas, ~200 KB máx.)
// con lo que el proceso escribe por consola. Solo lectura desde la web;
// no permite ejecutar nada. Igual que la v1.2.0.

const MAX_LINEAS = 500;
const MAX_CHARS = 500;

const g = globalThis;

function buffer() {
  g.__opoConsola ||= [];
  return g.__opoConsola;
}

function registrar(nivel, args) {
  const msg = args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ")
    .slice(0, MAX_CHARS);
  const buf = buffer();
  buf.push({ t: new Date().toISOString(), nivel, msg });
  if (buf.length > MAX_LINEAS) buf.splice(0, buf.length - MAX_LINEAS);
}

/** Instala la captura de console.* una sola vez. */
export function instalarConsola() {
  if (g.__opoConsolaOk) return;
  g.__opoConsolaOk = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args) => {
    registrar("info", args);
    original.log(...args);
  };
  console.info = (...args) => {
    registrar("info", args);
    original.info(...args);
  };
  console.warn = (...args) => {
    registrar("aviso", args);
    original.warn(...args);
  };
  console.error = (...args) => {
    registrar("error", args);
    original.error(...args);
  };

  buffer().push({ t: new Date().toISOString(), nivel: "info", msg: "[opoalerta] consola del servidor iniciada (solo lectura)" });
}

/** Últimas n líneas, opcionalmente filtradas por nivel. */
export function leerConsola(n = 200, nivel) {
  const todo = buffer();
  const filtradas = nivel && nivel !== "todos" ? todo.filter((l) => l.nivel === nivel) : todo;
  return filtradas.slice(-Math.min(Math.max(n, 1), MAX_LINEAS));
}

/** Vacía el búfer. */
export function limpiarConsola() {
  g.__opoConsola = [];
}

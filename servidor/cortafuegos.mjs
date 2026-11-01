// Cortafuegos de salida (lista blanca de dominios) y de entrada (solo red local).
// SALIDA: la app solo debe hablar con los portales de los 16 boletines de
// ingesta y con Discord (bot y webhooks). Cualquier otra conexión —por un
// error de código, una URL pegada a mano en los ajustes o dependencia
// comprometida— se bloquea con un mensaje claro. Cero dependencias: un
// conjunto de nombres de host y una comprobación antes de cada fetch de salida.
//
// ENTRADA: el panel es personal — solo se sirve a IPs privadas (tu LAN,
// redes Docker, loopback). Una IP pública de internet recibe un 403 sin
// procesar nada. Complementa a PUERTO_PUBLICADO (que decide quién llega a
// abrir TCP): si el puerto queda abierto por error o cambio de red, la app
// sigue solo contestando a tu red.
//
// Variables de entorno:
//   CORTAFUEGOS_SALIDA=lista (por defecto) | off → desactiva el control de salida
//   SALIDA_EXTRA=host1,host2,…                   → dominios adicionales permitidos
//     (p. ej. un proxy corporativo o un portal propio)
//   CORTAFUEGOS_ENTRADA=lan (por defecto) | off  → «lan» solo atiende a IPs
//     privadas (loopback 127/8 y ::1, 10/8, 172.16/12 —redes Docker—,
//     192.168/16, enlace local e IPv6 de enlace/ULA); «off» atiende a todas.
//
// Los portales de prueba locales (BOE falso, receptor de webhooks, panel)
// van a 127.0.0.1/localhost y están siempre permitidos. Con BOE_BASE_URL
// definido (pruebas automáticas) también se permite su host.

// Portales usados por los módulos de ingesta (servidor/fuentes/*.mjs)
const HOSTS_BASE = [
  "www.boe.es", // BOE
  "www.bocm.es", // BOCM Madrid
  "www.juntadeandalucia.es", // BOJA
  "dogv.gva.es", // DOGV
  "portaldogc.gencat.cat", // DOGC
  "dogc.gencat.cat", // DOGC (estadísticas del sumario)
  "bocyl.jcyl.es", // BOCYL
  "doe.juntaex.es", // DOE
  "www.caib.es", // BOIB
  "www.boa.aragon.es", // BOA
  "www.gobiernodecanarias.org", // BOC Canarias
  "www.euskadi.eus", // BOPV
  "www.xunta.gal", // DOG
  "docm.jccm.es", // DOCM
  "miprincipado.asturias.es", // BOPA
  "sede.asturias.es", // BOPA (descargas)
  "api.diba.cat", // CIDO
  "cido.diba.cat", // CIDO (fichas)
  "eu-careers.europa.eu", // EPSO (dominio clásico: hoy solo redirige)
  "selection.eu-careers.europa.eu", // EPSO (v2.3.12: plataforma de selección real, a donde redirige el anterior)
  // Discord: API del bot y webhooks (discordapp.com es el dominio antiguo)
  "discord.com",
  "discordapp.com",
];

const HOSTS = new Set();

function limpiarHost(v) {
  return String(v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[:/].*$/, "");
}

function recargar() {
  HOSTS.clear();
  for (const h of HOSTS_BASE) HOSTS.add(h);
  for (const h of (process.env.SALIDA_EXTRA ?? "").split(",")) {
    const limpio = limpiarHost(h);
    if (limpio) HOSTS.add(limpio);
  }
  const boePruebas = limpiarHost(process.env.BOE_BASE_URL ?? "");
  if (boePruebas) HOSTS.add(boePruebas);
}
recargar();

/** ¿Está activo el control de salida? (CORTAFUEGOS_SALIDA=off lo desactiva). */
export function cortafuegosActivo() {
  return (process.env.CORTAFUEGOS_SALIDA ?? "lista").trim().toLowerCase() !== "off";
}

function esLocal(host) {
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** Lanza un error si la URL de destino no está en la lista blanca. Se llama
 * justo antes de cada fetch de salida (ingesta, verificación de fuentes y
 * envíos a Discord). */
export function permitirSalida(url) {
  if (!cortafuegosActivo()) return;
  let host;
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    throw new Error(`Cortafuegos de salida: URL de destino no válida (${String(url).slice(0, 80)})`);
  }
  if (esLocal(host) || HOSTS.has(host)) return;
  throw new Error(
    `Cortafuegos de salida: conexión a «${host}» bloqueada — solo se permiten los portales de los boletines y Discord (añádelo a SALIDA_EXTRA o pon CORTAFUEGOS_SALIDA=off si lo necesitas)`
  );
}

// ─── Cortafuegos de ENTRADA: el panel solo se sirve a tu red ─────────────────

/** ¿Está activo el control de entrada? (CORTAFUEGOS_ENTRADA=off lo desactiva). */
export function cortafuegosEntradaActivo() {
  return (process.env.CORTAFUEGOS_ENTRADA ?? "lan").trim().toLowerCase() !== "off";
}

/** ¿Puede servirle el panel esta IP de origen? True para redes privadas
 * (tu LAN, redes Docker, loopback) y false para IPs públicas de internet.
 * Se llama al principio de cada petición HTTP, antes de procesar nada. */
export function permitirEntrada(ip) {
  if (!cortafuegosEntradaActivo()) return true; // CORTAFUEGOS_ENTRADA=off
  if (!ip) return false;
  let a = String(ip).trim().toLowerCase();
  if (a.startsWith("::ffff:")) a = a.slice(7); // IPv4 mapeada en IPv6
  if (a === "::1") return true; // loopback IPv6
  if (a.startsWith("fe80:") || a.startsWith("fc") || a.startsWith("fd")) {
    return true; // IPv6 de enlace (fe80::/10) o local única ULA (fc00::/7)
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return false; // IPv6 global u otra cosa: fuera
  const o1 = Number(m[1]);
  const o2 = Number(m[2]);
  if (o1 === 127) return true; // loopback IPv4 (healthcheck, pruebas locales)
  if (o1 === 10) return true; // 10.0.0.0/8
  if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16 (LAN típica)
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12 (redes Docker)
  if (o1 === 169 && o2 === 254) return true; // enlace local
  return false; // IP pública de internet: rechazada
}

// OpoAlerta Docker v2.2.1 · punto de entrada
// Un solo proceso Node: servidor HTTP + programador + SQLite (node:sqlite).
// Sin React, sin Next.js, sin dependencias npm: node_modules no existe.

import { instalarConsola } from "./consola.mjs";
import { asegurarEsquema } from "./bd.mjs";
import { sembrarAlertasIniciales } from "./semilla.mjs";
import { arrancarServidor } from "./api.mjs";
import { iniciarScheduler } from "./scheduler.mjs";

instalarConsola();

// 1) Esquema SQLite garantizado antes de servir peticiones
try {
  asegurarEsquema();
} catch (e) {
  console.error("[opoalerta] no se pudo preparar la base de datos:", e instanceof Error ? e.message : e);
  process.exit(1);
}

// 2) Servidor web (el panel y la API)
arrancarServidor();

// 3) Alertas precargadas (se crean solo si no existen)
try {
  sembrarAlertasIniciales();
} catch (e) {
  console.warn("[opoalerta] no se pudieron sembrar las alertas iniciales:", e instanceof Error ? e.message : e);
}

// 4) El programador solo se activa si ENABLE_SCHEDULER=1 (así el docker-compose
//    lo enciende y el entorno de desarrollo no consume recursos de más).
if (process.env.ENABLE_SCHEDULER === "1") {
  iniciarScheduler();
} else {
  console.log("[opoalerta] programador desactivado (ENABLE_SCHEDULER != 1); puedes ingestar a mano desde el panel");
}

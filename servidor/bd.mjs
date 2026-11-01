// Base de datos SQLite con node:sqlite (integrada en Node 22+, estable en 24).
// · Cero dependencias: nada de Prisma (antes ~50 MB de engine) ni binarios.
// · Mismo esquema que la v1.2.0: una base existente se reutiliza tal cual.
// · WAL para lecturas concurrentes y prepared statements cacheados.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const RUTA = (() => {
  const cruda = process.env.DATABASE_URL || "file:/app/data/opoalerta.db";
  return cruda.startsWith("file:") ? cruda.slice(5) : cruda;
})();

mkdirSync(dirname(RUTA), { recursive: true });

export const bd = new DatabaseSync(RUTA);
bd.exec("PRAGMA journal_mode = WAL;");
bd.exec("PRAGMA synchronous = NORMAL;");
bd.exec("PRAGMA foreign_keys = ON;");
bd.exec("PRAGMA busy_timeout = 4000;");

// ─── Esquema (idempotente, igual que la v1.2.0) ─────────────────────────────

const DDL = [
  `CREATE TABLE IF NOT EXISTS "Convocatoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identificador" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "departamento" TEXT NOT NULL,
    "seccion" TEXT NOT NULL DEFAULT '2B',
    "epigrafe" TEXT,
    "fechaBOE" TEXT NOT NULL,
    "fechaPublicacion" DATETIME NOT NULL,
    "urlPdf" TEXT,
    "urlHtml" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'otro',
    "ambito" TEXT,
    "enriquecido" BOOLEAN NOT NULL DEFAULT false,
    "fuente" TEXT NOT NULL DEFAULT 'boe',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Convocatoria_identificador_key" ON "Convocatoria"("identificador")`,
  `CREATE INDEX IF NOT EXISTS "Convocatoria_fechaBOE_idx" ON "Convocatoria"("fechaBOE")`,
  `CREATE INDEX IF NOT EXISTS "Convocatoria_tipo_idx" ON "Convocatoria"("tipo")`,
  `CREATE INDEX IF NOT EXISTS "Convocatoria_createdAt_idx" ON "Convocatoria"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Convocatoria_fuente_idx" ON "Convocatoria"("fuente")`,
  `CREATE TABLE IF NOT EXISTS "Alerta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "modoKeywords" TEXT NOT NULL DEFAULT 'todas',
    "organismo" TEXT,
    "ambito" TEXT NOT NULL DEFAULT 'todos',
    "soloConvocatorias" BOOLEAN NOT NULL DEFAULT true,
    "webhook" TEXT,
    "canalId" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "Alerta_activa_idx" ON "Alerta"("activa")`,
  `CREATE TABLE IF NOT EXISTS "Notificacion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertaId" TEXT NOT NULL,
    "convocatoriaId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "detalle" TEXT,
    "enviadoAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notificacion_alertaId_fkey" FOREIGN KEY ("alertaId") REFERENCES "Alerta" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notificacion_convocatoriaId_fkey" FOREIGN KEY ("convocatoriaId") REFERENCES "Convocatoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Notificacion_alertaId_convocatoriaId_key" ON "Notificacion"("alertaId", "convocatoriaId")`,
  `CREATE INDEX IF NOT EXISTS "Notificacion_enviadoAt_idx" ON "Notificacion"("enviadoAt")`,
  `CREATE TABLE IF NOT EXISTS "IngestaLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fechaBOE" TEXT NOT NULL,
    "fuente" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "itemsSeccion" INTEGER NOT NULL DEFAULT 0,
    "itemsNuevos" INTEGER NOT NULL DEFAULT 0,
    "notificados" INTEGER NOT NULL DEFAULT 0,
    "mensaje" TEXT,
    "duracionMs" INTEGER NOT NULL DEFAULT 0,
    "origen" TEXT NOT NULL DEFAULT 'programado',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "IngestaLog_fechaBOE_idx" ON "IngestaLog"("fechaBOE")`,
  `CREATE INDEX IF NOT EXISTS "IngestaLog_createdAt_idx" ON "IngestaLog"("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "Ajustes" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "fuente" TEXT NOT NULL DEFAULT 'real',
    "fuentesActivas" TEXT,
    "discordBotToken" TEXT,
    "canalPorDefecto" TEXT,
    "enriquecer" BOOLEAN NOT NULL DEFAULT true,
    "purgaDias" INTEGER NOT NULL DEFAULT 180,
    "notificarSinNovedades" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
  )`,
];

// Migración desde la v1.1.0: columnas nuevas si faltan (sin errores ruidosos).
function columnasDe(tabla) {
  try {
    return new Set(bd.prepare(`PRAGMA table_info("${tabla}")`).all().map((f) => String(f.name).toLowerCase()));
  } catch {
    return new Set();
  }
}

export function asegurarEsquema() {
  for (const sentencia of DDL) bd.exec(sentencia);
  if (!columnasDe("Convocatoria").has("fuente")) {
    bd.exec(`ALTER TABLE "Convocatoria" ADD COLUMN "fuente" TEXT NOT NULL DEFAULT 'boe'`);
    bd.exec(`CREATE INDEX IF NOT EXISTS "Convocatoria_fuente_idx" ON "Convocatoria"("fuente")`);
  }
  if (!columnasDe("Ajustes").has("fuentesactivas")) {
    bd.exec(`ALTER TABLE "Ajustes" ADD COLUMN "fuentesActivas" TEXT`);
  }
}

// ─── Ayudantes (prepared statements cacheados) ──────────────────────────────

const preparadas = new Map();

/** Statement preparado y cacheado. */
export function st(sql) {
  let s = preparadas.get(sql);
  if (!s) {
    s = bd.prepare(sql);
    preparadas.set(sql, s);
  }
  return s;
}

/** Primera fila o undefined (campos en objeto). */
export function obtenerFila(sql, ...params) {
  return st(sql).get(...params);
}

/** Todas las filas. */
export function todas(sql, ...params) {
  return st(sql).all(...params);
}

/** Ejecuta y devuelve { cambios, ultimaInsercion }. */
export function ejecutar(sql, ...params) {
  return st(sql).run(...params);
}

export function nuevoId() {
  return randomUUID();
}

export function hoyIsoUtc() {
  return new Date().toISOString();
}

export function fechaPublicacionIso(fechaYYYYMMDD) {
  return `${fechaYYYYMMDD.slice(0, 4)}-${fechaYYYYMMDD.slice(4, 6)}-${fechaYYYYMMDD.slice(6, 8)}T00:00:00.000Z`;
}

/** fila cruda de SQLite → objeto API (bools reales, sin dobles tipos). */
export function normalizarBooleanos(fila) {
  if (!fila) return fila;
  const salida = { ...fila };
  for (const k of Object.keys(salida)) {
    if (typeof salida[k] === "number" && (k === "activa" || k === "soloConvocatorias" || k === "enriquecer" || k === "notificarSinNovedades" || k === "enriquecido")) {
      salida[k] = salida[k] !== 0;
    }
  }
  return salida;
}

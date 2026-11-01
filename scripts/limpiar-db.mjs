// Vacía las tablas de la BD indicada (DATABASE_URL o argumento).
// Uso: DATABASE_URL=file:/tmp/opo-data/x.db node scripts/limpiar-db.mjs
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const cruda = process.argv[2] || process.env.DATABASE_URL || "file:/app/data/opoalerta.db";
const ruta = cruda.startsWith("file:") ? cruda.slice(5) : cruda;
mkdirSync(dirname(ruta), { recursive: true });
const bd = new DatabaseSync(ruta);
bd.exec("PRAGMA foreign_keys = OFF");
bd.exec("DELETE FROM Notificacion");
bd.exec("DELETE FROM Alerta");
bd.exec("DELETE FROM IngestaLog");
bd.exec("DELETE FROM Convocatoria");
bd.exec("DELETE FROM Ajustes");
bd.exec("VACUUM");
bd.close();
console.log(`BD limpiada: ${ruta}`);

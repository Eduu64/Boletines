// Alertas precargadas en el primer arranque (solo se crean si no existen).
// Incluye la de «personal laboral» que pidió el usuario: puestos que NO exigen
// condición de funcionario (laboral fijo o temporal), sobre todo ingeniería de
// obra. Avisan de CUALQUIER comunicación (convocatorias, listas, correcciones…).

import { obtenerFila, ejecutar, nuevoId } from "./bd.mjs";

export const ALERTAS_SEMILLA = [
  {
    id: "alerta-def-cdm",
    nombre: "Defensa · Centros docentes militares (Cuerpos de Ingenieros)",
    keywords: "centros docentes militares, Cuerpos de Ingenieros, 45238202, ingreso directo y promoción",
    modoKeywords: "cualquiera",
    organismo: "Defensa",
    ambito: "todos",
    soloConvocatorias: false,
  },
  {
    id: "alerta-def-arsenales",
    nombre: "Armada · Ingenieros Técnicos de Arsenales",
    keywords: "Arsenales de la Armada, Ingenieros Técnicos de Arsenales, Cuerpo de Ingenieros Técnicos de Arsenales",
    modoKeywords: "cualquiera",
    organismo: null,
    ambito: "todos",
    soloConvocatorias: false,
  },
  {
    id: "alerta-mad-tic",
    nombre: "Ayuntamiento de Madrid · Técnico/a Superior TIC",
    keywords: "Tecnologías de la Información y la Comunicación, Superior TIC, Superior de Sistemas y Tecnologías de la Información",
    modoKeywords: "cualquiera",
    organismo: "Ayuntamiento de Madrid",
    ambito: "todos",
    soloConvocatorias: false,
  },
  {
    id: "alerta-empleo-laboral",
    nombre: "Empleo público · Personal laboral e Ingeniería de obra",
    keywords:
      "personal laboral, ingeniero de obras, ingeniero de obra, ingeniero técnico de obras públicas, ingeniero técnico de obras públicas e instalaciones, ingeniería de obra, ingeniería de obras, obra civil, ingeniero de caminos",
    modoKeywords: "cualquiera",
    organismo: null,
    ambito: "todos",
    soloConvocatorias: false,
  },
];

/** Crea las alertas iniciales si aún no existen (no toca las editadas). */
export async function sembrarAlertasIniciales() {
  for (const a of ALERTAS_SEMILLA) {
    const existe = obtenerFila(`SELECT id FROM Alerta WHERE id = ?`, a.id);
    if (existe) continue;
    ejecutar(
      `INSERT INTO Alerta (id, nombre, keywords, modoKeywords, organismo, ambito, soloConvocatorias, activa) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      a.id ?? nuevoId(),
      a.nombre,
      a.keywords,
      a.modoKeywords,
      a.organismo,
      a.ambito,
      a.soloConvocatorias ? 1 : 0
    );
    console.log(`[opoalerta] alerta inicial creada: ${a.nombre}`);
  }
}

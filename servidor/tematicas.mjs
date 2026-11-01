// Temáticas predefinidas para el filtro de búsqueda (v2.3.15).
// Cada temática es una lista de palabras o frases que se buscan como substring
// dentro de «título + organismo» — el mismo mecanismo del matching de alertas
// (normalizar: minúsculas, sin acentos, sin puntuación — ver normalizar.mjs).
// Así una temática agrupa lo que un usuario pondría en varias alertas: es un
// filtro de consulta, no crea nada en la base de datos.

import { normalizar } from "./normalizar.mjs";

export const TEMATICAS = [
  {
    id: "tic",
    nombre: "Informática · TIC",
    keywords: ["informatic", "tic", "tecnologias de la informacion", "ciberseguridad", "ciencia de datos", "sistemas y tecnologias", "telecomunicacion", "desarrollo de aplicaciones"],
  },
  {
    id: "laboral",
    nombre: "Personal laboral",
    keywords: ["personal laboral", "laboral fijo", "laboral temporal", "convenio colectivo"],
  },
  {
    id: "sanidad",
    nombre: "Sanidad",
    keywords: ["sanitari", "salud", "enfermer", "medic", "farmac", "psicolog", "veterinari", "fisioterap", "matron"],
  },
  {
    id: "educacion",
    nombre: "Educación · Docencia",
    keywords: ["docen", "maestr", "profesor", "profesa", "educaci", "enseñan", "inspector de educacion", "cuerpo de maestros"],
  },
  {
    id: "defensa",
    nombre: "Defensa · Militares",
    keywords: ["militar", "defensa", "ejercito", "armada", "arsenal", "guardia civil", "intendencia", "tropa y marineria", "oficial de las fuerzas armadas"],
  },
  {
    id: "ingenieria",
    nombre: "Ingeniería · Obra",
    keywords: ["ingenier", "obra civil", "obra publica", "arquitect", "delineacion", "topografia"],
  },
  {
    id: "administrativo",
    nombre: "Administración · Gestión",
    keywords: ["administrativ", "cuerpo de gestion", "cuerpo superior de administradores", "auxiliar administrativo", "subalterno", "ayudante de archivos"],
  },
  {
    id: "justicia",
    nombre: "Justicia",
    keywords: ["judicial", "justicia", "abogac", "fiscal", "procesal", "notari", "registral", "forense"],
  },
  {
    id: "policia",
    nombre: "Policía · Seguridad",
    keywords: ["polic", "guardia civil", "escolta", "seguridad ciudadana", "escala basica"],
  },
  {
    id: "bomberos",
    nombre: "Bomberos · Emergencias",
    keywords: ["bomber", "emergencia", "proteccion civil", "salvamento"],
  },
];

export function tematicaPorId(id) {
  return TEMATICAS.find((t) => t.id === id) ?? null;
}

/** true si «titulo + departamento» menciona alguna keyword de la temática.
 * Regla fina: las keywords cortas (≤4 letras, p. ej. «tic») solo cuentan como
 * PALABRA COMPLETA — como substring pegarían con «matemáticas», «auténtico» o
 * «prácticas» —; las largas van por substring para cazar derivados («informatic»
 * entra en «informática» e «informáticas»). */
export function itemEnTematica(titulo, departamento, tematica) {
  const texto = normalizar(`${titulo ?? ""} ${departamento ?? ""}`);
  return tematica.keywords.some((k) => {
    const kw = normalizar(k);
    if (kw.length <= 4) return new RegExp(`(^| )${kw}( |$)`).test(texto);
    return texto.includes(kw);
  });
}

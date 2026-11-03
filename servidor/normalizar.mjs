// Normalización y clasificación de anuncios (idéntico a la v1.2.0).

/** Quita acentos, minúsculas y puntuación para comparar de forma equivalente. */
export function normalizar(texto) {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 'YYYYMMDD' → 'DD/MM/YYYY'. */
export function fechaBonita(fechaBOE) {
  if (!fechaBOE || fechaBOE.length !== 8) return fechaBOE ?? "";
  return `${fechaBOE.slice(6, 8)}/${fechaBOE.slice(4, 6)}/${fechaBOE.slice(0, 4)}`;
}

/** Clasifica un anuncio a partir de su título. */
export function clasificarTipo(titulo) {
  const t = normalizar(titulo);
  if (t.startsWith("correccion de errores") || t.includes("correccion de errores de")) return "correccion";
  if (
    t.includes("relacion de aprobados") ||
    t.includes("listas de admitidos y excluidos") ||
    t.includes("lista de admitidos y excluidos") ||
    t.includes("lista de aspirantes admitidos") ||
    t.includes("aprobacion de las listas") ||
    t.includes("notas de corte") ||
    t.includes("publicacion de la relacion") ||
    t.includes("relacion de aspirantes")
  ) {
    return "lista";
  }
  const marcaConvocatoria =
    t.includes("convoca") ||
    t.includes("pruebas selectivas") ||
    t.includes("proceso selectivo") ||
    t.includes("acceso libre") ||
    t.includes("promocion interna") ||
    t.includes("turno libre") ||
    t.includes("ingreso por el sistema");
  if (marcaConvocatoria) return "convocatoria";
  if (t.startsWith("resolucion")) return "resolucion";
  return "otro";
}

/** Mapea el ámbito del XML del BOE a una categoría simple.
 * v2.3.22: reconocidos también los nombres propios de las comunidades
 * (antes, un ámbito tipo «Cataluña» o «Comunidad Valenciana» caía en el
 * final «estatal» — el filtro estatal dejaba pasar anuncios autonómicos). */
export function mapearAmbito(ambitoXml) {
  const a = normalizar(ambitoXml ?? "");
  if (!a) return "estatal";
  if (a.includes("municip") || a.includes("local") || a.includes("ayuntamiento")) return "local";
  if (a.includes("provincia") || a.includes("diputacion") || a.includes("cabildo") || a.includes("consell insular") || a.includes("mancomunidad")) return "provincial";
  const comunidad = COMUNIDADES_AUTONOMICAS.some((c) => a.includes(c));
  if (comunidad || a.includes("comunidad autonoma") || a.includes("ciudad autonoma") || a.includes("autonomica") || a.includes("comunidad foral") || a.includes("comunidad de")) {
    return "autonomica";
  }
  return "estatal";
}

/** Nombres (sin acentos) con los que puede aparecer cada comunidad autónoma
 * en metadatos del BOE o en el propio boletín. */
const COMUNIDADES_AUTONOMICAS = [
  "andalucia", "aragon", "asturias", "baleares", "balears", "canarias", "cantabria",
  "castilla y leon", "castilla la mancha", "cataluna", "catalunya", "valenciana", "valencia",
  "extremadura", "galicia", "madrid", "murcia", "navarra", "pais vasco", "euskadi",
  "la rioja", "ceuta", "melilla",
];

/** Ámbito CONOCIDO POR CONSTRUCCIÓN de cada fuente no estatal (v2.3.22).
 * El BOE se clasifica documento a documento (enriquecimiento XML); el resto
 * de boletines ES de una comunidad (o diputación) y antes se guardaba sin
 * ámbito — con lo que pasaban cualquier filtro, incluso «estatal» (el usuario
 * veía DOGC/DOGV/BOCM en una alerta estatal). «boe» y «epso» quedan fuera:
 * el BOE usa el enriquecimiento y EPSO (UE) no tiene categoría. */
export const AMBITO_FIJO_POR_FUENTE = {
  bocm: "autonomica", // Comunidad de Madrid
  boja: "autonomica", // Andalucía
  dogv: "autonomica", // C. Valenciana
  dogc: "autonomica", // Cataluña
  bocyl: "autonomica", // Castilla y León
  doe: "autonomica", // Extremadura
  boib: "autonomica", // Baleares
  boa: "autonomica", // Aragón
  boc: "autonomica", // Canarias
  bopv: "autonomica", // País Vasco
  dog: "autonomica", // Galicia
  docm: "autonomica", // Castilla-La Mancha
  bopa: "autonomica", // Asturias
  cido: "provincial", // Diputación de Barcelona
};

export const ETIQUETAS_TIPO = {
  convocatoria: "Convocatoria",
  lista: "Listas / Aprobados",
  resolucion: "Resolución",
  correccion: "Corrección",
  otro: "Otro",
};

export const ETIQUETAS_AMBITO = {
  estatal: "Estatal",
  autonomica: "Autonómico",
  provincial: "Provincial",
  local: "Local",
  todos: "Todos",
};

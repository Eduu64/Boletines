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

/** Mapea el ámbito del XML del BOE a una categoría simple. */
export function mapearAmbito(ambitoXml) {
  const a = normalizar(ambitoXml ?? "");
  if (!a) return "estatal";
  if (a.includes("municip") || a.includes("local")) return "local";
  if (a.includes("provincia")) return "provincial";
  if (a.includes("comunidad autonoma") || a.includes("ciudad autonoma") || a.includes("autonomica") || a.includes("comunidad foral") || a.includes("comunidad de")) {
    return "autonomica";
  }
  return "estatal";
}

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

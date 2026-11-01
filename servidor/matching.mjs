// Motor de coincidencias: decide qué anuncios disparan cada alerta (igual que v1.2.0).

import { normalizar } from "./normalizar.mjs";

export function partirKeywords(kw) {
  return (kw ?? "")
    .split(/[,\n;]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * true si el anuncio coincide con la alerta:
 * · keywords "todas"/"cualquiera" (sin keywords → todo pasa)
 * · organismo por substring insensible a acentos
 * · ámbito solo excluye si el anuncio tiene ámbito conocido (no perder convocatorias)
 * · soloConvocatorias: solo tipo "convocatoria"
 */
export function itemCoincide(alerta, item) {
  if (alerta.soloConvocatorias && item.tipo !== "convocatoria") return false;
  if (alerta.organismo && alerta.organismo.trim().length > 0) {
    if (!normalizar(item.departamento).includes(normalizar(alerta.organismo))) return false;
  }
  if (alerta.ambito && alerta.ambito !== "todos" && item.tipoAmbito) {
    if (item.tipoAmbito !== alerta.ambito) return false;
  }
  const kws = partirKeywords(alerta.keywords);
  if (kws.length === 0) return true;
  const texto = normalizar(`${item.titulo} ${item.departamento}`);
  const coincide = kws.map((k) => texto.includes(normalizar(k)));
  return alerta.modoKeywords === "cualquiera" ? coincide.some(Boolean) : coincide.every(Boolean);
}

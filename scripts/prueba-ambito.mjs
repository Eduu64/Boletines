// Prueba del ámbito (v2.3.22): unitaria, sin servidor.
// · mapearAmbito reconoce comunidades por su nombre (antes «Cataluña» caía en estatal)
// · AMBITO_FIJO_POR_FUENTE cubre los 14 boletines no estatales (el BOE usa
//   enriquecimiento por documento y EPSO no se clasifica)
// · itemCoincide: un anuncio de boletín autonómico (ámbito conocido) NO pasa una
//   alerta «estatal» y SÍ una «autonómica» (antes pasaba ambas: sin ámbito, no se
//   excluía nunca).

function ok(nombre, cond, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? ` — ${extra}` : ""}`);
  if (!cond) process.exitCode = 1;
}

import { mapearAmbito, AMBITO_FIJO_POR_FUENTE } from "../servidor/normalizar.mjs";
import { itemCoincide } from "../servidor/matching.mjs";
import { IDS_FUENTES } from "../servidor/fuentes/index.mjs";

console.log("═══ 1) mapearAmbito ═══");
ok("General → estatal", mapearAmbito("General") === "estatal");
ok("vacío → estatal", mapearAmbito("") === "estatal" && mapearAmbito(null) === "estatal");
ok("Municipal → local", mapearAmbito("Municipal") === "local");
ok("Ayuntamiento → local", mapearAmbito("Ayuntamiento") === "local");
ok("Provincial → provincial", mapearAmbito("Provincial") === "provincial");
ok("Diputación → provincial", mapearAmbito("Diputación Provincial") === "provincial");
ok("Cabildo → provincial", mapearAmbito("Cabildo Insular") === "provincial");
ok("«Cataluña» → autonomica (antes: estatal)", mapearAmbito("Cataluña") === "autonomica");
ok("«Comunidad Autónoma de Cataluña» → autonomica", mapearAmbito("Comunidad Autónoma de Cataluña") === "autonomica");
ok("«Comunitat Valenciana» → autonomica (antes: estatal)", mapearAmbito("Comunitat Valenciana") === "autonomica");
ok("«Comunidad de Madrid» → autonomica", mapearAmbito("Comunidad de Madrid") === "autonomica");
ok("«Ciudad Autónoma de Ceuta» → autonomica", mapearAmbito("Ciudad Autónoma de Ceuta") === "autonomica");
ok("«País Vasco» → autonomica", mapearAmbito("País Vasco") === "autonomica");
ok("«Provincia de Madrid» → provincial (la provincia manda)", mapearAmbito("Provincia de Madrid") === "provincial");

console.log("═══ 2) AMBITO_FIJO_POR_FUENTE ═══");
const AUTONOMICAS = ["bocm", "boja", "dogv", "dogc", "bocyl", "doe", "boib", "boa", "boc", "bopv", "dog", "docm", "bopa"];
ok("los 13 boletines autonómicos → autonomica", AUTONOMICAS.every((id) => AMBITO_FIJO_POR_FUENTE[id] === "autonomica"), AUTONOMICAS.filter((id) => AMBITO_FIJO_POR_FUENTE[id] !== "autonomica").join(",") || "completo");
ok("cido (Dip. Barcelona) → provincial", AMBITO_FIJO_POR_FUENTE.cido === "provincial");
ok("boe NO tiene ámbito fijo (enriquecimiento por documento)", !("boe" in AMBITO_FIJO_POR_FUENTE));
ok("epso NO se clasifica (UE sin categoría)", !("epso" in AMBITO_FIJO_POR_FUENTE));
ok("cada id del mapa es una fuente real", Object.keys(AMBITO_FIJO_POR_FUENTE).every((id) => IDS_FUENTES.includes(id)));
ok("ninguna fuente no estatal se queda sin ámbito", IDS_FUENTES.filter((id) => id !== "boe" && id !== "epso").every((id) => AMBITO_FIJO_POR_FUENTE[id]));

console.log("═══ 3) el filtro de ámbito ahora sí excluye ═══");
const itemDogc = { fuente: "dogc", tipo: "convocatoria", titulo: "Convocatoria de personal de la Generalitat", departamento: "Generalitat de Catalunya", tipoAmbito: "autonomica" };
const itemBoeEstatal = { fuente: "boe", tipo: "convocatoria", titulo: "Convocatoria de Cuerpo Superior del Estado", departamento: "Ministerio de Hacienda", tipoAmbito: "estatal" };
const itemSinAmbito = { fuente: "boe", tipo: "convocatoria", titulo: "Convocatoria sin clasificar", departamento: "Universidad de X", tipoAmbito: null };

ok("alerta estatal NO ve DOGC (ámbito conocido)", !itemCoincide({ ambito: "estatal", modoKeywords: "cualquiera" }, itemDogc));
ok("alerta autonómica SÍ ve DOGC", itemCoincide({ ambito: "autonomica", modoKeywords: "cualquiera" }, itemDogc));
ok("alerta estatal SÍ ve un anuncio estatal del BOE", itemCoincide({ ambito: "estatal", modoKeywords: "cualquiera" }, itemBoeEstatal));
ok("sin ámbito conocido no se excluye (no perder avisos)", itemCoincide({ ambito: "estatal", modoKeywords: "cualquiera" }, itemSinAmbito));
ok("ámbito «todos» no filtra nada", itemCoincide({ ambito: "todos", modoKeywords: "cualquiera" }, itemDogc));
ok("el ámbito se combina con los boletines (v2.3.19)", !itemCoincide({ ambito: "autonomica", boletines: ["bocm"], modoKeywords: "cualquiera" }, itemDogc));

console.log(process.exitCode ? "\n== ÁMBITO: HAY FALLOS ✗" : "\n== ÁMBITO: todo pasa ✓");

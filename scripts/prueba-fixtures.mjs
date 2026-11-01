// Prueba OFFLINE de los 16 parsers con los fixtures reales capturados por el
// proyecto original opoalerta/opoalerta (scrapers/tests/fixtures). Verifica que
// cada parser extrae los anuncios correctos sin tocar la red.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(RAIZ, "scripts", "fixtures");

let fallos = 0;
function ok(nombre, cond, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? ` — ${extra}` : ""}`);
  if (!cond) fallos++;
}

const leer = (f) => readFileSync(join(FIXTURES, f), "utf8");

// ─── BOE (JSON de datos abiertos) ───────────────────────────────────────────
{
  const { parsearJson } = await import(join(RAIZ, "servidor", "fuentes", "boe.mjs"));
  const items = parsearJson(leer("boe-20250723.json"));
  ok("BOE JSON: extrae anuncios", items.length >= 1, `${items.length} items`);
  ok("BOE JSON: identificadores BOE-A-*", items.every((i) => i.identificador.startsWith("BOE-A-")));
  ok("BOE JSON: urls absolutas a boe.es", items.every((i) => (i.urlHtml ?? "").startsWith("https://www.boe.es/")));
}

// ─── BOCM (XML) ─────────────────────────────────────────────────────────────
{
  const { montarXml } = await import(join(RAIZ, "servidor", "fuentes", "bocm.mjs"));
  const items = montarXml(leer("bocm-sumario.xml"));
  ok("BOCM: 6 anuncios (3 autonómicos + 3 locales)", items.length === 6, `${items.length} items`);
  ok("BOCM: identificadores sin prefijo", items.every((i) => !i.identificador.startsWith("bocm:")));
  const ayuntamientos = items.filter((i) => /^[A-ZÁÉÍÓÚ]/.test(i.organismo) && i.epigrafe.includes("III."));
  ok("BOCM: locales con municipio como organismo", ayuntamientos.length === 3, ayuntamientos.map((i) => i.organismo).join(", "));
}

// ─── BOJA (Atom) ────────────────────────────────────────────────────────────
{
  const { montarFeed } = await import(join(RAIZ, "servidor", "fuentes", "boja.mjs"));
  const items = montarFeed(leer("boja-s53.xml"));
  ok("BOJA: extrae anuncios del feed", items.length >= 1, `${items.length} items`);
  ok("BOJA: ids boja-…", items.every((i) => /^boja-\d{7}-\d+$/.test(i.identificador)), items[0]?.identificador);
}

// ─── DOGV (API JSON) ────────────────────────────────────────────────────────
{
  const { montarDatos } = await import(join(RAIZ, "servidor", "fuentes", "dogv.mjs"));
  const datos = JSON.parse(leer("dogv-20260724.json"));
  const items = montarDatos(datos);
  ok("DOGV: 26 anuncios de empleo (fixture original)", items.length === 26, `${items.length} items`);
  ok("DOGV: ids únicos", new Set(items.map((i) => i.identificador)).size === items.length);
  ok("DOGV: sin nombramientos (solo ofertas de empleo)", items.every((i) => !/NOMBRAMIENTOS Y CESES/i.test(i.titulo)));
}

// ─── DOGC (API REST) ────────────────────────────────────────────────────────
{
  const { montarSumario } = await import(join(RAIZ, "servidor", "fuentes", "dogc.mjs"));
  const sum = JSON.parse(leer("dogc-9729.json"));
  const num = /numDOGC=(\d+)/.exec(JSON.stringify(sum))?.[1] ?? "9729";
  const items = montarSumario(sum, num, "20260724");
  ok("DOGC: 8 convocatorias (fixture original)", items.length === 8, `${items.length} items`);
  ok("DOGC: sin «encargo del despacho»", items.every((i) => !/encargo del despacho/i.test(i.titulo)));
  ok("DOGC: pdf del portal", items.every((i) => (i.urlPdf ?? "").includes("portaldogc.gencat.cat")));
}

// ─── BOCYL (HTML) ───────────────────────────────────────────────────────────
{
  const { montarHtml } = await import(join(RAIZ, "servidor", "fuentes", "bocyl.mjs"));
  const items = montarHtml(leer("bocyl-boletin.html"), "20260724");
  ok("BOCYL: 3 anuncios (fixture original)", items.length === 3, `${items.length} items`);
  ok("BOCYL: ids BOCYL-D-*", items.every((i) => /^BOCYL-D-\d{8}-\d+-\d+$/.test(i.identificador)));
}

// ─── DOE (HTML ISO-8859-1) ──────────────────────────────────────────────────
{
  const { montarHtml } = await import(join(RAIZ, "servidor", "fuentes", "doe.mjs"));
  const items = montarHtml(leer("doe-sumario.html"));
  ok("DOE: extrae anuncios", items.length >= 1, `${items.length} items`);
  ok("DOE: ids doe-<num>", items.every((i) => /^doe-\d+$/.test(i.identificador)));
  ok("DOE: tildes decodificadas (latin-1 → texto limpio)", items.every((i) => !/Ã|Â/.test(i.titulo)));
}

// ─── BOIB (HTML sección II) ─────────────────────────────────────────────────
{
  const { montarSeccion } = await import(join(RAIZ, "servidor", "fuentes", "boib.mjs"));
  const items = montarSeccion(leer("boib-seccion.html"), "https://www.caib.es/eboibfront/es/2026/1234", "20261234");
  ok("BOIB: al menos 2 anuncios", items.length >= 2, `${items.length} items`);
  ok("BOIB: ids boib-20261234-<registro>", items.every((i) => /^boib-20261234-\d+$/.test(i.identificador)));
}

// ─── BOA (HTML Latin-1) ─────────────────────────────────────────────────────
{
  const { montar } = await import(join(RAIZ, "servidor", "fuentes", "boa.mjs"));
  const items = montar(leer("boa-lista.html"), "20260715");
  ok("BOA: 3 anuncios II.b (fixture original)", items.length === 3, `${items.length} items`);
  ok("BOA: solo subsección b) de la sección II", items.every((i) => i.epigrafe === "II.b · Oposiciones y concursos"));
  ok("BOA: organismo presente", items.every((i) => i.organismo && i.organismo !== "Gobierno de Aragón"), items.map((i) => i.organismo).join(" | "));
}

// ─── BOC Canarias (HTML) ────────────────────────────────────────────────────
{
  const { montar } = await import(join(RAIZ, "servidor", "fuentes", "boc.mjs"));
  const items = montar(leer("boc-sumario.html"), "20260715");
  ok("BOC: extrae anuncios", items.length >= 1, `${items.length} items`);
  ok("BOC: ids boc-AAAA-NNN-D", items.every((i) => /^boc-\d{4}-\d+-\d+$/.test(i.identificador)));
  ok("BOC: url de disposición", items.every((i) => i.urlHtml.includes("/boc/")));
}

// ─── BOPV (HTML Latin-1) ────────────────────────────────────────────────────
{
  const { montar } = await import(join(RAIZ, "servidor", "fuentes", "bopv.mjs"));
  const items = montar(leer("bopv-sumario.html"));
  ok("BOPV: 5 anuncios (fixture original)", items.length === 5, `${items.length} items`);
  const osakidetza = items.filter((i) => /osakidetza/i.test(i.organismo));
  ok("BOPV: 3 de Osakidetza", osakidetza.length === 3, `${osakidetza.length}`);
  ok("BOPV: url construida con fecha del sumario", items.every((i) => (i.urlHtml ?? "").includes("/2026/09/")));
}

// ─── DOG (HTML gallego) ─────────────────────────────────────────────────────
{
  const { montar } = await import(join(RAIZ, "servidor", "fuentes", "dog.mjs"));
  const items = montar(leer("dog-seccion.html"), "20260724");
  ok("DOG: extrae anuncios", items.length >= 1, `${items.length} items`);
  ok("DOG: organismo presente", items.every((i) => i.organismo.length > 0));
}

// ─── DOCM (HTML) ────────────────────────────────────────────────────────────
{
  const { montar } = await import(join(RAIZ, "servidor", "fuentes", "docm.mjs"));
  const raw = leer("docm-sumario.html");
  // mismo recorte que obtener(): AUTORIDADES Y PERSONAL → OPOSICIONES Y CONCURSOS
  const ini = raw.indexOf("AUTORIDADES Y PERSONAL");
  const finSec = raw.indexOf("OTRAS DISPOSICIONES", ini);
  const personal = raw.slice(ini, finSec !== -1 ? finSec : raw.length);
  const op = personal.indexOf("OPOSICIONES Y CONCURSOS");
  let sub = personal.slice(op + "OPOSICIONES Y CONCURSOS".length);
  const siguiente = /<li>\s*[A-ZÁÉÍÓÚ]/.exec(sub);
  if (siguiente) sub = sub.slice(0, siguiente.index);
  const items = montar(sub);
  ok("DOCM: extrae anuncios", items.length >= 1, `${items.length} items`);
  ok("DOCM: sin marcas [NID …] en títulos", items.every((i) => !i.titulo.includes("[NID")));
  ok("DOCM: url verArchivoHtml.do", items.every((i) => i.urlHtml.includes("verArchivoHtml.do")));
}

// ─── BOPA (HTML Liferay) ────────────────────────────────────────────────────
{
  const { montar } = await import(join(RAIZ, "servidor", "fuentes", "bopa.mjs"));
  const raw = leer("bopa-20260715.html");
  const inicio = raw.indexOf('<div id="bopa-boletin"');
  const items = montar(raw.slice(inicio), "20260715", "20260715");
  ok("BOPA: extrae convocatorias (filtro positivo)", items.length >= 1, `${items.length} items`);
  ok("BOPA: códigos AAAA-NNNNN", items.every((i) => /^bopa-\d{4}-\d+$/.test(i.identificador)));
  const titulos = items.map((i) => i.titulo.toLowerCase());
  ok("BOPA: sin actos administrativos (instalación eléctrica, padrón)", titulos.every((t) => !t.includes("instalación eléctrica") && !t.includes("padrón")));
}

// ─── CIDO (JSON:API, 2 páginas) ─────────────────────────────────────────────
{
  const { montarPaginas } = await import(join(RAIZ, "servidor", "fuentes", "cido.mjs"));
  const paginas = JSON.parse(leer("cido.json")); // [página por fecha, página por id]
  const items = montarPaginas(paginas, "20260724");
  ok("CIDO: 13 fichas tras deduplicar (fixture original)", items.length === 13, `${items.length} items`);
  ok("CIDO: ids únicos cido-<id>", new Set(items.map((i) => i.identificador)).size === items.length);
  ok("CIDO: urls del portal", items.every((i) => (i.urlHtml ?? "").includes("cido.diba.cat")));
}

// ─── EPSO (HTML UE) ─────────────────────────────────────────────────────────
{
  const { montar } = await import(join(RAIZ, "servidor", "fuentes", "epso.mjs"));
  const items = montar(leer("epso-lista.html"));
  ok("EPSO: 3 filas (fixture original)", items.length === 3, `${items.length} items`);
  ok("EPSO: referencia en el título", items.every((i) => /\((EU|EPSO|CAST|AD|AST)/i.test(i.titulo) || i.titulo.includes("(")), items[0]?.titulo);
  ok("EPSO: organismo UE", items.every((i) => i.organismo === "Unión Europea (EPSO)"));
}

// ─── BOE página del día (HTML real 30/10/2026, con índice de navegación) ────
{
  const { parsearPaginaDia } = await import(join(RAIZ, "servidor", "fuentes", "boe.mjs"));
  const items = parsearPaginaDia(leer("boe-dias-20261030.html"));
  ok("BOE días: 28 anuncios del BOE núm. 270", items.length === 28, `${items.length} items`);
  ok("BOE días: ids BOE-A-2026 únicos", new Set(items.map((i) => i.identificador)).size === 28 && items.every((i) => /^BOE-A-2026-\d+$/.test(i.identificador)));
  ok("BOE días: título del <p>, sin basura PDF/XML/HTML", items.every((i) => !/^(PDF|XML|HTML)\b/i.test(i.titulo) && i.titulo.length > 30), items[0]?.titulo.slice(0, 60));
  ok("BOE días: departamento del <h4> como organismo", items[0]?.organismo.startsWith("MINISTERIO DE ASUNTOS EXTERIORES") && items.at(-1)?.organismo === "UNIVERSIDADES");
  ok("BOE días: url del PDF y de la ficha", items[0]?.urlPdf === "https://www.boe.es/boe/dias/2026/10/30/pdfs/BOE-A-2026-22738.pdf" && items[0]?.urlHtml === "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-22738");
}

// ─── BOE API de datos abiertos en XML (real, 31/10/2026, BOE núm. 271) ──────
{
  const { parsearRespuestaApi } = await import(join(RAIZ, "servidor", "fuentes", "boe.mjs"));
  const items = parsearRespuestaApi(leer("boe-api-20261031.xml"));
  ok("BOE API XML: 33 anuncios de la sección 2B", items.length === 33, `${items.length} items`);
  ok("BOE API XML: rango de ids 22804→22836", items[0]?.identificador === "BOE-A-2026-22804" && items.at(-1)?.identificador === "BOE-A-2026-22836");
  const laboral = items.find((i) => i.identificador === "BOE-A-2026-22808");
  ok("BOE API XML: personal laboral capturado (Tribunal de Cuentas)", laboral?.epigrafe === "Personal laboral" && laboral?.organismo === "TRIBUNAL DE CUENTAS");
  ok("BOE API XML: urls del PDF completas", items.every((i) => (i.urlPdf ?? "").startsWith("https://www.boe.es/boe/dias/2026/10/31/pdfs/")));
}

console.log(fallos === 0 ? "\n== FIXTURES: los 16 parsers pasan ✓" : `\n== FIXTURES: ${fallos} comprobaciones fallidas ✗`);
process.exit(fallos === 0 ? 0 : 1);

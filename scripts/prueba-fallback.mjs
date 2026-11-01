// Prueba del CUÁDRUPLE RESPALDO del BOE: simula caídas con el servidor falso
// y comprueba que la ingesta usa cada endpoint de reserva (JSON → XML anidado
// → XML plano → HTML sumario → HTML página del día) y registra bien el fallo
// total. Requiere la app arrancada con BOE_BASE_URL apuntando al servidor falso
// (puerto 4100) y el resto de boletines desactivados en los ajustes.
const BASE = "http://127.0.0.1:3000";
const BOE = "http://127.0.0.1:4100";

function ok(nombre, cond, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? ` — ${extra}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function json(url, opts) {
  const res = await fetch(BASE + url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function ingesta(fecha) {
  return json("/api/ingesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fecha }),
  });
}

function detalleBOE(resumen) {
  return resumen?.porFuente?.find((f) => f.id === "boe")?.detalle ?? "";
}

async function main() {
  // fuente real (no demo), solo BOE y sin enriquecimiento para acelerar
  await json("/api/ajustes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fuente: "real", enriquecer: false, fuentesActivas: ["boe"] }),
  });

  // A) solo viva la API JSON → endpoint api-datosabiertos
  await fetch(`${BOE}/modo?x=A`);
  const a = await ingesta("20261021");
  ok(
    "caída 1: JSON vivo → api-datosabiertos",
    a.data?.estado === "ok" && detalleBOE(a.data).includes("api-datosabiertos") && a.data?.itemsSeccion === 3,
    `estado=${a.data?.estado} detalle=${detalleBOE(a.data)} items=${a.data?.itemsSeccion}`
  );

  // B) cae la API JSON → usa el XML del sumario (anidado)
  await fetch(`${BOE}/modo?x=B`);
  const b = await ingesta("20261022");
  ok(
    "caída 2: JSON muerto → xml-diario_boe (anidado)",
    b.data?.estado === "ok" && detalleBOE(b.data).includes("xml-diario_boe") && b.data?.itemsSeccion === 3,
    `estado=${b.data?.estado} detalle=${detalleBOE(b.data)} items=${b.data?.itemsSeccion}`
  );

  // F) variante PLANA del XML (item hermanos del epígrafe autocerrado)
  await fetch(`${BOE}/modo?x=F`);
  const f = await ingesta("20261025");
  ok(
    "caída 3: XML variante plana → xml-diario_boe",
    f.data?.estado === "ok" && detalleBOE(f.data).includes("xml-diario_boe") && f.data?.itemsSeccion === 3,
    `estado=${f.data?.estado} detalle=${detalleBOE(f.data)} items=${f.data?.itemsSeccion}`
  );

  // C) caen JSON y XML → usa el HTML del sumario
  await fetch(`${BOE}/modo?x=C`);
  const c = await ingesta("20261023");
  ok(
    "caída 4: JSON+XML muertos → html-sumario",
    c.data?.estado === "ok" && detalleBOE(c.data).includes("html-sumario") && c.data?.itemsSeccion === 3,
    `estado=${c.data?.estado} detalle=${detalleBOE(c.data)} items=${c.data?.itemsSeccion}`
  );

  // E) caen JSON, XML y sumario → usa la página del día /boe/dias/ (nuevo v2.0.0)
  await fetch(`${BOE}/modo?x=E`);
  const e = await ingesta("20261026");
  ok(
    "caída 5: JSON+XML+sumario muertos → html-dias",
    e.data?.estado === "ok" && detalleBOE(e.data).includes("html-dias") && e.data?.itemsSeccion === 3,
    `estado=${e.data?.estado} detalle=${detalleBOE(e.data)} items=${e.data?.itemsSeccion}`
  );

  // D) caída total → error registrado, sin colgar la app
  await fetch(`${BOE}/modo?x=D`);
  const d = await ingesta("20261024");
  ok(
    "caída total → estado error con detalle de los 4 endpoints",
    d.data?.estado === "error" && (d.data?.mensaje || "").includes("api-datosabiertos") && (d.data?.mensaje || "").includes("xml-diario_boe") && (d.data?.mensaje || "").includes("html-sumario") && (d.data?.mensaje || "").includes("html-dias"),
    `estado=${d.data?.estado} msg=${(d.data?.mensaje || "").slice(0, 140)}`
  );

  // deduplicación entre fuentes: los mismos identificadores no se repiten
  const conv = await json("/api/convocatorias?q=Maestros");
  const con9 = (conv.data?.items ?? []).filter((x) => x.identificador === "BOE-A-2026-91001");
  ok("deduplicación entre fuentes (1 sola copia del anuncio)", con9.length === 1, `copias=${con9.length}`);

  // limpieza: quitar las convocatorias/log del ensayo del BOE falso y
  // restaurar los ajustes (todas las fuentes)
  await json("/api/ajustes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fuente: "demo", enriquecer: true, fuentesActivas: [] }),
  });
  const { DatabaseSync } = await import("node:sqlite");
  const { existsSync, mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const ruta = (process.env.DATABASE_URL || "file:/app/data/opoalerta.db").replace(/^file:/, "");
  if (existsSync(ruta)) {
    const bd = new DatabaseSync(ruta);
    bd.exec("DELETE FROM Notificacion WHERE convocatoriaId IN (SELECT id FROM Convocatoria WHERE identificador LIKE 'BOE-A-2026-91%')");
    bd.exec("DELETE FROM Convocatoria WHERE identificador LIKE 'BOE-A-2026-91%'");
    bd.exec("DELETE FROM IngestaLog WHERE fechaBOE IN ('20261021','20261022','20261023','20261024','20261025','20261026')");
    bd.close();
    console.log("🧹 limpieza del ensayo del BOE falso hecha");
  } else {
    console.log(`⚠️ limpieza omitida: no se ve la BD de la app (${ruta}); define DATABASE_URL`);
  }
}

main().catch((e) => {
  console.error("ERROR FATAL:", e);
  process.exitCode = 1;
});

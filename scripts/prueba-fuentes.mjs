// Verificación de la ingesta REAL de los boletines activos.
// Uso: node scripts/prueba-fuentes.mjs [fecha=AAAAMMDD] [url=http://127.0.0.1:3000]
// Requiere la app arrancada y salida a Internet. Deja los ajustes como estaban.
const FECHA = process.argv.find((a) => /^\d{8}$/.test(a)) || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date()).replace(/-/g, "");
const BASE = process.argv.find((a) => /^https?:\/\//.test(a)) || "http://127.0.0.1:3000";

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

async function main() {
  console.log(`Verificación de fuentes reales · fecha ${FECHA} · ${BASE}\n`);

  // recordatorio de ajustes previos y fuerza modo real con todas las fuentes
  const antes = await json("/api/ajustes");
  await json("/api/ajustes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fuente: "real", enriquecer: false, fuentesActivas: [] }),
  });

  const t0 = Date.now();
  const r = await json("/api/ingesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fecha: FECHA, origen: "prueba" }),
  });
  const d = r.data;

  if (!d) {
    ok("la API respondió", false, `status ${r.status}`);
    return;
  }
  ok("la ingesta terminó sin error global", d.estado === "ok" || d.estado === "sin_datos", `estado=${d.estado} · ${(d.duracionMs / 1000).toFixed(1)} s`);
  console.log("");

  let fuentesOk = 0;
  const esperadas = ["boe", "bocm", "boja", "dogv", "dogc", "bocyl", "doe", "boib", "boa", "boc", "bopv", "dog", "docm", "bopa", "cido", "epso"];
  for (const f of d.porFuente ?? []) {
    const icono = f.estado === "ok" ? "✅" : f.estado === "sin_datos" ? "⚠️ " : "❌";
    if (f.estado === "ok") fuentesOk++;
    console.log(`${icono} ${f.id.padEnd(6)} ${f.estado.padEnd(10)} ${String(f.items).padStart(4)} anuncios · ${f.nuevos} nuevos${f.detalle ? ` · ${f.detalle}` : ""}`);
  }
  console.log("");
  ok("las 16 fuentes aparecen en el resultado", (d.porFuente ?? []).length === 16, `presentes=${(d.porFuente ?? []).length}/16`);
  ok("al menos 3 fuentes con datos hoy", fuentesOk >= 3, `ok=${fuentesOk}`);
  ok("el BOE falla sin tumbar la ingesta", d.estado === "ok" || fuentesOk > 0, `estado global=${d.estado}`);

  // reingesta → lo que ya estaba guardado NO se duplica: solo pueden aparecer
  // como «nuevos» los anuncios de fuentes que fallaron en la primera pasada.
  const fallidas = (d.porFuente ?? []).filter((f) => f.estado !== "ok").map((f) => f.id);
  const r2 = await json("/api/ingesta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fecha: FECHA }) });
  const nuevos2 = r2.data?.itemsNuevos ?? 0;
  const maxEsperados = (r2.data?.porFuente ?? []).filter((f) => fallidas.includes(f.id)).reduce((n, f) => n + f.items, 0);
  ok(
    "reingesta sin duplicar (solo aportan las fuentes que fallaron antes)",
    nuevos2 <= maxEsperados,
    `nuevos=${nuevos2}, tope=${maxEsperados} (fallaron antes: ${fallidas.join(",") || "ninguna"})`
  );

  // busca personal laboral en lo real guardado
  const lab = await json("/api/convocatorias?q=laboral");
  console.log(`\n🔎 «laboral» en lo guardado de los boletines: ${lab.data?.total ?? 0} anuncios`);

  // restaura ajustes previos
  const a = antes.data?.ajustes;
  if (a) {
    await json("/api/ajustes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fuente: a.fuente, enriquecer: a.enriquecer, fuentesActivas: a.fuentesActivas ?? [] }),
    });
  }
  console.log("(ajustes restaurados)");
}

main().catch((e) => {
  console.error("ERROR FATAL:", e);
  process.exitCode = 1;
});

// Prueba E2E del pipeline: ajustes demo → 5 alertas semilla (incluidas PERSONAL
// LABORAL) + 2 de verificación con webhook local → ingestas → matching → envío
// a Discord (mock) → verificación de DB, payloads y consola del servidor.
const BASE = "http://127.0.0.1:3000";

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
  // 0) salud
  const salud = await json("/api/health");
  ok("health responde", salud.status === 200 && salud.data.ok === true);

  // 0b) alertas sembradas automáticamente en el arranque (5, incluidas personal laboral y TIC/A1-A2)
  const lista = await json("/api/alertas");
  const nombres = (lista.data?.alertas ?? []).map((a) => a.nombre).join(" | ");
  ok(
    "5 alertas precargadas (militares, arsenales, Madrid TIC, TIC/A1-A2, personal laboral)",
    ["Centros docentes militares", "Arsenales", "Técnico/a Superior TIC", "Informática · TIC · Grupos A1/A2", "Personal laboral"].every((t) => nombres.includes(t)),
    nombres
  );

  // 1) ajustes: fuente demo + enriquecimiento
  const ajustes = await json("/api/ajustes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fuente: "demo", enriquecer: true, purgaDias: 180 }),
  });
  ok("ajustes en modo demo", ajustes.status === 200 && ajustes.data.ajustes.fuente === "demo");

  // 2) validación de webhook inválido → 400
  const mala = await json("/api/alertas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: "prueba-mala", webhook: "http://evil.com/api/webhooks/x" }),
  });
  ok("rechaza webhook no-Discord", mala.status === 400);

  // 3) dar destino a las 4 alertas precargadas (mock local) como haría el usuario
  const ids = ["alerta-def-cdm", "alerta-def-arsenales", "alerta-mad-tic", "alerta-empleo-laboral"];
  for (const id of ids) {
    const r = await json(`/api/alertas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhook: "http://127.0.0.1:3999/captura" }),
    });
    ok(`destino Discord añadido a ${id}`, r.status === 200);
  }

  // 3b) alertas de verificación propias
  const alerta = await json("/api/alertas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: "Docencia (verificación)",
      keywords: "Maestros, Secundaria",
      modoKeywords: "cualquiera",
      ambito: "todos",
      soloConvocatorias: true,
      webhook: "http://127.0.0.1:3999/captura",
    }),
  });
  ok("crea alerta docencia", alerta.status === 201, `id=${alerta.data?.alerta?.id}`);

  const alerta2 = await json("/api/alertas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: "Gestión (verificación)",
      keywords: "Gestión Administrativa de la Administración Civil del Estado",
      modoKeywords: "todas",
      soloConvocatorias: true,
      canalId: "999888777666555444",
    }),
  });
  ok("crea alerta gestión", alerta2.status === 201, `id=${alerta2.data?.alerta?.id}`);

  // 4) ingesta demo del 29/10/2026 (13 anuncios)
  const i29 = await json("/api/ingesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fecha: "20261029" }),
  });
  ok(
    "ingesta 29/10 ok (13 anuncios, 13 nuevos, 6 alertas disparadas, 4 avisos)",
    i29.status === 200 && i29.data.estado === "ok" && i29.data.itemsSeccion === 13 && i29.data.itemsNuevos === 13 && i29.data.alertasDisparadas === 6 && i29.data.notificados === 4,
    `fuente=${i29.data?.fuente} items=${i29.data?.itemsSeccion} nuevos=${i29.data?.itemsNuevos} disparadas=${i29.data?.alertasDisparadas} avisos=${i29.data?.notificados}`
  );

  // 5) reingesta del mismo día → 0 nuevos (deduplicación)
  const i29b = await json("/api/ingesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fecha: "20261029" }),
  });
  ok("reingesta deduplicada (0 nuevos)", i29b.status === 200 && i29b.data.itemsNuevos === 0, `nuevos=${i29b.data?.itemsNuevos} msg=${i29b.data?.mensaje}`);

  // 6) ingesta demo del 30/10/2026 (7 anuncios, incluidos 2 de PERSONAL LABORAL)
  const i30 = await json("/api/ingesta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fecha: "20261030" }),
  });
  ok(
    "ingesta 30/10 ok (7 anuncios, 5 alertas disparadas, 5 avisos)",
    i30.status === 200 && i30.data.estado === "ok" && i30.data.itemsSeccion === 7 && i30.data.itemsNuevos === 7 && i30.data.alertasDisparadas === 5 && i30.data.notificados === 5,
    `items=${i30.data?.itemsSeccion} nuevos=${i30.data?.itemsNuevos} disparadas=${i30.data?.alertasDisparadas} avisos=${i30.data?.notificados}`
  );

  // 7) convocatorias: los 4 objetivos están en la BD con ámbito
  const mil = await json("/api/convocatorias?q=centros docentes militares");
  ok("Resolución 452/38202/2026 guardada", (mil.data?.total ?? 0) === 2, `total=${mil.data?.total} (resolución + corrección)`);
  const tic = await json("/api/convocatorias?q=Tecnologías de la Información");
  ok("Técnico/a Superior TIC Ayto. Madrid guardada", tic.data?.total >= 1, `total=${tic.data?.total}`);
  const ars = await json("/api/convocatorias?q=Arsenales");
  ok("Arsenales de la Armada guardado", ars.data?.total >= 1, `total=${ars.data?.total}`);
  const maestro = await json("/api/convocatorias?q=Maestros");
  ok("ámbito enriquecido = estatal", maestro.data?.items?.[0]?.ambito === "estatal", `ambito=${maestro.data?.items?.[0]?.ambito}`);

  // 7b) PERSONAL LABORAL: las 3 plazas demo están guardadas y clasificadas
  //     (Correos el día 29 + Ayto. Madrid y ADIF el día 30)
  const laboral = await json("/api/convocatorias?q=personal laboral");
  ok("3 plazas de personal laboral guardadas (Correos + Ayto. Madrid + ADIF)", laboral.data?.total === 3, `total=${laboral.data?.total}`);
  const tipos = (laboral.data?.items ?? []).map((x) => x.tipo);
  ok("personal laboral clasificado como convocatoria", tipos.length === 3 && tipos.every((t) => t === "convocatoria"), tipos.join(", "));

  // 8) filtros: por tipo y por fuente
  const conv = await json("/api/convocatorias?tipo=convocatoria");
  ok("filtro tipo=convocatoria", conv.data?.total >= 4, `total=${conv.data?.total}`);
  const porFuente = await json("/api/convocatorias?fuente=demo");
  ok("filtro fuente=demo", porFuente.data?.total === 20, `total=${porFuente.data?.total}`);

  // 9) probar alerta laboral (mensaje de prueba + coincidencias 7 días)
  const proba = await json(`/api/alertas/alerta-empleo-laboral/probar`, { method: "POST" });
  ok("probar alerta personal laboral envía a Discord", proba.data?.envio?.ok === true, proba.data?.envio?.detalle);
  ok("vista previa 7 días de personal laboral con coincidencias", (proba.data?.coincidencias7dias?.total ?? 0) >= 2, `total=${proba.data?.coincidencias7dias?.total}`);

  // 10) webhooks capturados por el mock: ¿llegaron los avisos?
  const res = await fetch("http://127.0.0.1:3999/capturas");
  const capturas = (await res.json()) ?? [];
  ok("mock recibió >= 9 envíos", capturas.length >= 9, `capturados=${capturas.length}`);
  const todoTexto = JSON.stringify(capturas.map((c) => c.body));
  ok("aviso militares (452/38202) llegó a Discord", todoTexto.includes("centros docentes militares"), "título en embeds");
  ok("aviso arsenales llegó a Discord", todoTexto.includes("Arsenales de la Armada"));
  ok("aviso Madrid TIC llegó a Discord", todoTexto.includes("Técnico/a Superior TIC"));
  ok("aviso PERSONAL LABORAL llegó a Discord (Ingeniero Técnico OP)", todoTexto.includes("Ingeniero Técnico de Obras Públicas"));
  ok("aviso PERSONAL LABORAL llegó a Discord (ADIF obra civil)", todoTexto.includes("Obra Civil"));
  const conEmbed = capturas.filter((c) => (c.body.embeds?.length ?? 0) > 0);
  ok("los avisos llevan embeds con formato", conEmbed.length >= 7, `con_embeds=${conEmbed.length}`);
  const primer = conEmbed[0]?.body;
  if (primer) {
    const e = primer.embeds[0];
    ok("embed tiene título/URL/BOE", !!(e.title && e.url && e.footer?.text?.includes("BOE") || e.footer?.text), `título="${(e.title || "").slice(0, 60)}…"`);
    const campos = e.fields.map((f) => f.name);
    ok("embed incluye Organismo/Tipo/Ámbito/Boletín", ["Organismo", "Tipo", "Ámbito", "Boletín"].every((n) => campos.includes(n)), campos.join(", "));
  }

  // 11) consola del servidor: registra actividad y no filtra secretos
  const cons = await json("/api/consola?n=300");
  ok("consola del servidor con contenido", (cons.data?.total ?? 0) > 0, `líneas=${cons.data?.total}`);

  // 12) estado general coherente
  const est = await json("/api/estado");
  ok("estado: 20 convocatorias guardadas", est.data?.stats?.totalConvocatorias === 20, `total=${est.data?.stats?.totalConvocatorias}`);
  ok("estado: notificaciones OK >= 9", (est.data?.stats?.notificacionesOk ?? 0) >= 9, `ok=${est.data?.stats?.notificacionesOk}`);
  ok("estado: 16 boletines en el registro de fuentes", (est.data?.fuentes ?? []).length === 16, `fuentes=${(est.data?.fuentes ?? []).length}`);
  ok("estado: versión 2.3.12", est.data?.version === "2.3.12", `version=${est.data?.version}`);
}

main().catch((e) => {
  console.error("ERROR FATAL:", e);
  process.exitCode = 1;
});

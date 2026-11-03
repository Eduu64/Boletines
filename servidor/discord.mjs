// Cliente de Discord: webhooks por alerta y/o bot global con canal por defecto.
// Sin dependencias externas, fetch nativo, reintentos ante 429. Igual que v1.2.0.

import { permitirSalida } from "./cortafuegos.mjs";
import { detalleRed } from "./util.mjs";
import { ETIQUETAS_AMBITO, ETIQUETAS_TIPO, fechaBonita } from "./normalizar.mjs";

const API_DISCORD = "https://discord.com/api/v10";
const COLOR_CONVOCATORIA = 0x10b981;
const COLOR_LISTA = 0xf59e0b;
const COLOR_OTRO = 0x64748b;
const MAX_EMBEDS = 10;

export function colorDe(tipo) {
  if (tipo === "convocatoria") return COLOR_CONVOCATORIA;
  if (tipo === "lista") return COLOR_LISTA;
  return COLOR_OTRO;
}

/** Construye el payload (mensaje con embeds) para una alerta y sus anuncios. */
export function construirPayload(alertaNombre, items) {
  const embeds = items.slice(0, MAX_EMBEDS).map((it) => ({
    title: it.titulo.length > 256 ? `${it.titulo.slice(0, 253)}…` : it.titulo,
    url: it.urlHtml ?? it.urlPdf ?? undefined,
    color: colorDe(it.tipo),
    fields: [
      { name: "Organismo", value: it.departamento.slice(0, 200) || "—", inline: false },
      { name: "Tipo", value: ETIQUETAS_TIPO[it.tipo] ?? "Otro", inline: true },
      { name: "Ámbito", value: it.tipoAmbito ? (ETIQUETAS_AMBITO[it.tipoAmbito] ?? it.tipoAmbito) : "Sin clasificar", inline: true },
      { name: "Boletín", value: fechaBonita(it.fechaBOE), inline: true },
    ],
    footer: { text: `${it.identificador} • OpoAlerta` },
  }));

  const contenido = `📢 **${alertaNombre}**: ${items.length} ${items.length === 1 ? "novedad" : "novedades"} en los boletines oficiales (empleo público)`;
  return {
    username: "OpoAlerta",
    allowed_mentions: { parse: [] },
    content: contenido,
    embeds,
  };
}

/**
 * Valida una URL de webhook. Por seguridad solo se acepta Discord.
 * Con PERMITIR_WEBHOOKS_LOCALES=1 se aceptan además webhooks http de localhost
 * (útil para verificar el envío con un receptor propio en pruebas).
 */
export function validarWebhook(url) {
  try {
    const u = new URL(url);
    const esDiscord = (u.hostname === "discord.com" || u.hostname === "discordapp.com") && u.protocol === "https:" && u.pathname.startsWith("/api/webhooks/");
    if (esDiscord) return true;
    if (process.env.PERMITIR_WEBHOOKS_LOCALES === "1") {
      const esLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname) && u.pathname.length > 1;
      if (esLocal) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function postear(url, cabeceras, payload) {
  try {
    permitirSalida(url); // cortafuegos de salida: solo discord.com / discordapp.com
  } catch (e) {
    return { ok: false, detalle: e instanceof Error ? e.message : String(e) };
  }
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabeceras },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    // v2.3.21: con la causa real («fetch failed (ECONNREFUSED …)») se ve al
    // instante si el problema es el proxy interno, el DNS o la propia red.
    const causa = detalleRed(e);
    return { ok: false, detalle: `Sin conexión con Discord: ${e instanceof Error ? e.message : e}${causa ? ` (${causa})` : ""}` };
  }

  // Rate limit: esperar lo que pida Discord y reintentar una vez
  if (res.status === 429) {
    try {
      const rl = await res.json();
      const espera = Math.min((rl.retry_after ?? 1) * 1000, 10000);
      await new Promise((r) => setTimeout(r, espera));
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceras },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      return { ok: false, detalle: "Rate limit de Discord y fallo al reintentar" };
    }
  }

  if (res.ok) return { ok: true, detalle: `Enviado (HTTP ${res.status})` };

  let extra = "";
  try {
    const cuerpo = await res.json();
    if (cuerpo?.message) extra = ` — ${cuerpo.message}`;
  } catch {
    /* sin cuerpo */
  }
  if (res.status === 401) return { ok: false, detalle: `Token del bot no válido (401)${extra} — cópialo otra vez de discord.com/developers → tu aplicación → Bot → Reset Token → Copy (si lo regeneraste, el anterior deja de valer; el Client Secret no sirve)` };
  if (res.status === 403) return { ok: false, detalle: `Permisos insuficientes en el canal (403)${extra}` };
  if (res.status === 404) return { ok: false, detalle: `Webhook o canal no encontrado (404)${extra}` };
  return { ok: false, detalle: `HTTP ${res.status}${extra}` };
}

/** Envía por webhook de Discord (modo por-alerta). */
export function enviarWebhook(webhookUrl, payload) {
  if (!validarWebhook(webhookUrl)) {
    return Promise.resolve({ ok: false, detalle: "La URL del webhook no es válida (debe empezar por https://discord.com/api/webhooks/)" });
  }
  return postear(webhookUrl, {}, payload);
}

/** Envía como bot de Discord a un canal concreto (modo global).
 * Antes de salir comprueba la forma del token: un token de bot SIEMPRE tiene
 * dos puntos (id.sello.firma, en base64url, p. ej. MTIzNDU2Nzg5…​.XXX.YYY). Si
 * lo pegado no los tiene, casi seguro que es el Client Secret (o un token
 * mal copiado): mejor decírselo al usuario que dejar que Discord responda un
 * 401 críptico (v2.3.15). */
export function enviarBot(token, canalId, payload) {
  const canal = canalId.replace(/\D/g, "");
  if (!canal) return Promise.resolve({ ok: false, detalle: "ID de canal no válido" });
  if (!token || token.trim().length < 20) return Promise.resolve({ ok: false, detalle: "Token del bot no configurado" });
  const limpio = token.trim();
  if (!/^\S+\.\S+\.\S+$/.test(limpio)) {
    return Promise.resolve({ ok: false, detalle: "Eso no parece un token de bot (los tokens de bot tienen dos puntos, p. ej. MTIzNDU2Nzg5….XXX.YYY): probablemente copiaste el Client Secret. El token se copia en discord.com/developers → tu aplicación → Bot → Reset Token → Copy" });
  }
  return postear(`${API_DISCORD}/channels/${canal}/messages`, { Authorization: `Bot ${limpio}` }, payload);
}

/** Mensaje de prueba para verificar la configuración desde la web. */
export function payloadPrueba(destino) {
  return {
    username: "OpoAlerta",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "✅ Prueba de OpoAlerta",
        color: COLOR_CONVOCATORIA,
        description: `Si ves esto, el destino **${destino}** funciona. Cuando salga una convocatoria en los boletines que coincida con tus alertas, te avisaré aquí con este formato.`,
        fields: [
          { name: "Ejemplo", value: "Resolución de … por la que se convoca proceso selectivo para ingreso en el Cuerpo de Maestros", inline: false },
          { name: "Tipo", value: "Convocatoria", inline: true },
          { name: "Sección", value: "Empleo público · todos los boletines", inline: true },
        ],
        footer: { text: "OpoAlerta • BOE + autonómicos" },
      },
    ],
  };
}

// Programador interno con cron propio (5 campos: min hora dom mes dow).
// · Sustituye a node-cron: una dependencia menos, mismo comportamiento para
//   las expresiones que usa la app (* , - /).
// · Un solo temporizador que marca cada 20 s y compara la hora LOCAL de la
//   zona configurada (Europe/Madrid por defecto); no se ejecuta dos veces el
//   mismo minuto aunque el tick se desvíe.

import { ejecutarIngesta, backfillArranque, backfillDiario } from "./ingesta.mjs";

const CAMPO_VALIDO = /^[\d*\/,\-]+$/;

/** ¿La expresión es un cron de 5 campos válido para este planificador? */
export function cronValido(exp) {
  const campos = String(exp ?? "").trim().split(/\s+/);
  if (campos.length !== 5) return false;
  if (!campos.every((c) => CAMPO_VALIDO.test(c))) return false;
  const limites = [59, 23, 31, 12, 7]; // dow: 0-7 (0 y 7 = domingo)
  return campos.every((c, i) => enumeraCampo(c, limites[i]) !== null);
}

/** Expande un campo cron a la lista de valores que matchea (o null si es inválido). */
function enumeraCampo(campo, maximo) {
  const valores = new Set();
  for (const parte of campo.split(",")) {
    const m = /^(?:\*|(\d+))(?:\/(\d+))?(?:-(\d+))?$/.exec(parte);
    if (!m) return null;
    const desde = m[1] === undefined ? 0 : parseInt(m[1], 10);
    const paso = m[2] !== undefined && m[2] !== "" ? parseInt(m[2], 10) : 1;
    const hasta = m[3] !== undefined && m[3] !== "" ? parseInt(m[3], 10) : m[1] === undefined ? maximo : desde;
    if (paso < 1 || desde > hasta || hasta > maximo) return null;
    for (let v = desde; v <= hasta; v += paso) {
      valores.add(v === maximo && maximo === 7 ? 0 : v); // dow 7 ≡ 0
    }
  }
  return [...valores];
}

function partesHora(zona, fecha = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: zona, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p = {};
  for (const parte of fmt.formatToParts(fecha)) p[parte.type] = parte.value;
  const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minuto: parseInt(p.minute, 10),
    hora: parseInt(p.hour === "24" ? "0" : p.hour, 10),
    diaMes: parseInt(p.day, 10),
    mes: parseInt(p.month, 10),
    diaSemana: dias[p.weekday] ?? 0,
  };
}

function coincideExpresion(exp, hora) {
  const campos = exp.trim().split(/\s+/);
  const [minutos, horas, diasMes, meses, diasSemana] = campos.map((c, i) => enumeraCampo(c, [59, 23, 31, 12, 7][i]));
  if (!minutos || !horas || !diasMes || !meses || !diasSemana) return false;
  return minutos.includes(hora.minuto) && horas.includes(hora.hora) && meses.includes(hora.mes) && diasSemana.includes(hora.diaSemana) && (campos[2] === "*" || campos[4] === "*" ? true : diasMes.includes(hora.diaMes) || diasSemana.includes(hora.diaSemana));
}

/** Divide HORARIO_INGESTA en expresiones cron válidas. Primero prueba la
 * cadena completa (así «0 9,17 * * *» con comas de campo funciona); si no es
 * válida, cae al separador «,» que separa varias expresiones completas. */
export function parsearHorarios(cadena) {
  const limpios = (cadena || "").split(",").map((h) => h.trim()).filter((h) => h.length > 0);
  const reconstruida = limpios.join(",");
  if (limpios.length > 0 && cronValido(reconstruida)) return [reconstruida];
  return limpios.filter((h) => cronValido(h));
}

const g = globalThis;

export function estadoScheduler() {
  return (
    g.__opoScheduler ?? {
      activo: false,
      horarios: [],
      zona: process.env.ZONA_HORARIA || "Europe/Madrid",
    }
  );
}

async function lanzarProgramado(esElUltimoHorario) {
  try {
    const r = await ejecutarIngesta({ origen: "programado" });
    const est = estadoScheduler();
    est.ultimaEjecucion = { fecha: r.fechaBOE, origen: "programado", estado: r.estado, duracionMs: r.duracionMs, en: new Date().toISOString() };
  } catch {
    /* el log de ingesta ya guarda el error */
  }
  // v2.3.17: tras el ÚLTIMO horario del día, rellenar los días anteriores que
  // se quedaron sin ingesta correcta (sin hoy: acaba de intentarse). Si un
  // boletín cayó un martes y el contenedor siguió en pie, el martes se
  // recupera sin esperar a un reinicio. Cualquier día sin hueco se descarta
  // con una consulta: no cuesta nada cuando todo va bien.
  if (esElUltimoHorario) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      await backfillDiario();
    } catch {
      /* registrado en el log de ingesta */
    }
  }
}

/** Arranca el cron diario y el relleno inicial. Idempotente. */
export function iniciarScheduler() {
  if (g.__opoArranqueHecho) return;
  g.__opoArranqueHecho = true;

  const zona = process.env.ZONA_HORARIA || "Europe/Madrid";
  const horarios = parsearHorarios(process.env.HORARIO_INGESTA || "0 9 * * *,35 11 * * *"); // 09:00 y reintento 11:35

  const comprobar = () => {
    const ahora = partesHora(zona);
    const clave = `${ahora.hora}:${ahora.minuto}`;
    if (g.__opoCronMinuto === clave) return; // mismo minuto ya gestionado
    g.__opoCronMinuto = clave;
    for (let i = 0; i < horarios.length; i++) {
      if (coincideExpresion(horarios[i], ahora)) {
        void lanzarProgramado(i === horarios.length - 1);
        break;
      }
    }
  };
  comprobar();
  setInterval(comprobar, 20000).unref();

  g.__opoScheduler = { activo: horarios.length > 0, horarios, zona };
  console.log(`[opoalerta] programador activo: ${horarios.join(" y ")} (${zona})`);

  // Relleno de los últimos días al arrancar (por si el servidor estuvo apagado)
  setTimeout(() => {
    void (async () => {
      try {
        await backfillArranque();
      } catch {
        /* registrado en el log */
      }
    })();
  }, 15000);
}

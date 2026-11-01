# OpoAlerta Docker v2.3.4

Alertas personales de **ofertas de empleo público** (oposiciones, personal laboral, bolsas): ingesta diaria del **BOE y de 15 boletines oficiales más**, panel web local y avisos automáticos a **Discord**.

**Todo local y privado**: un solo proceso Node con SQLite integrada, sin React, sin Next.js, sin Prisma y **sin una sola dependencia npm** (`node_modules` no existe). Solo hablas con los boletines oficiales y con Discord.

```bash
cp .env.example .env        # opcional: ajusta valores
docker compose up -d --build
# panel: http://IP-DEL-SERVIDOR:3000 — SOLO responde a tu red local
# (internet recibe un 403); ¿blindaje extra? modo reforzado con proxy interno:
#   docker compose -f docker-compose.reforzado.yml up -d --build
```

También en local si tienes **Node 22.5+** (`node -v`):

```bash
node servidor/indice.mjs    # panel en http://localhost:3000
```

---

## Novedades v2.3.4

- **Adiós al problema de permisos de `./data`**: la base de datos pasa a un **volumen con nombre** (`opoalerta-data`) en ambos compose. Con la carpeta `./data` montada desde el host pasaba esto: si la carpeta no existía, Docker la creaba como **root**, y la app (usuario sin privilegios `opoalerta`) no podía escribir su SQLite — y crearla a mano no arreglaba nada salvo que acertaras con el uid exacto del contenedor. El volumen con nombre se inicializa **con el dueño de `/app/data` en la imagen** (comportamiento estándar de Docker), así que funciona a la primera y sin tocar el host. Nombre fijo: estable aunque renombres la carpeta del proyecto. OJO: `docker compose down` conserva el volumen; **`down -v` lo borra** (con la base de datos dentro). Copia de seguridad y migración: ver «Tus datos» más abajo.

## Novedades v2.3.3

- **Cortafuegos de entrada: el panel solo se sirve a tu red local**. La app comprueba la IP de origen de cada petición y solo responde a IPs privadas (192.168/10/172.16, redes Docker y loopback) — una IP pública de internet recibe un **403 inmediato** sin procesar nada, y el intento queda anotado en la consola del servidor (`CORTAFUEGOS_ENTRADA=lan` por defecto; `off` lo desactiva). Es el espejo del cortafuegos de salida: ahora la app filtra en ambos sentidos. Se publica en todas las interfaces (`PUERTO_PUBLICADO=0.0.0.0` por defecto) para que tu LAN entre sin configurar nada e inmune a cambios de IP por DHCP; si quieres que Docker ni siquiera abra el puerto en la interfaz pública, pon `PUERTO_PUBLICADO=<IP-LAN>`. Visible en `/api/estado` (`cortafuegos.entrada`). Verificado con 19 comprobaciones nuevas en `scripts/prueba-cortafuegos.mjs`.

## Novedades v2.3.2

- **El panel ya no se publica a ciegas en todas las interfaces**: Docker ata el puerto a `127.0.0.1` por defecto (solo el propio servidor; túnel SSH `ssh -L 3000:localhost:3000 usuario@servidor`) y `PUERTO_PUBLICADO` decide la interfaz. Sustituido en v2.3.3 por el cortafuegos de entrada, que filtra a nivel de aplicación y permite abrir el panel a la LAN sin exponerlo a internet.

## Novedades v2.3.1

- **Modo reforzado con proxy interno (opcional)**: `docker compose -f docker-compose.reforzado.yml up -d --build` monta además un **proxy Squid** y deja la app en una red Docker **sin internet**: su única salida es ese proxy, que solo permite túneles TLS hacia los 16 boletines y Discord. Es la **segunda capa** sobre el cortafuegos de la app (que sigue activo): aunque el código se viera comprometido, ninguna conexión a otro destino saldría —muere en la red— y tampoco puede iniciar conexiones a tu LAN (192.168.x.x). El panel sigue abriéndose desde tu LAN por el puerto publicado. Coste: ~25 MB de RAM. **100 % Docker**: dos contenedores y dos redes gestionadas por Docker; el sistema operativo del host no se toca (sin iptables, sin ufw, sin servicios ni usuarios del host) — solo comandos de `docker compose`. Verificado con 8 pruebas funcionales (túnel permitido, dominio y puerto bloqueados, HTTP plano bloqueado y el `fetch` nativo de Node 24 atravesando el proxy con `NODE_USE_ENV_PROXY`, sin dependencias); en tu servidor: `bash scripts/prueba-proxy.sh`. **Por qué Squid y no Caddy**: Caddy es un *reverse* proxy (se pone delante de un servidor); como proxy de salida (*forward*) necesita un plugin no oficial con imagen a medida. Squid trae ACLs de dominio de serie, pesa ~7 MB instalados y su config son 20 líneas; tinyproxy es aún más pequeño pero filtra por subcadena (menos estricto).

## Novedades v2.3.0

- **BOE arreglado de verdad**: su orquestador prueba ahora sus 4 accesos directos con **una conexión de 8 s por endpoint** (antes el 1.º consumía 43 s de los 45 de techo y los otros tres respaldos nunca llegaban a probarse). Sin relés ni servicios externos: solo tu red → boe.es. Si un cortafuegos bloquea www.boe.es, la ingesta falla en ~17 s con un mensaje que lo dice claro (y queda anotado 10 min para no repetir la espera); si el BOE contesta 404 (domingo/festivo), se registra como «sin boletín» y no como error.
- **Cortafuegos de salida integrado (lista blanca)**: la app solo puede conectar a los portales de los 16 boletines y a Discord (discord.com/discordapp.com). Cualquier otra conexión —error de código, URL pegada a mano, dependencia comprometida— se bloquea **antes de salir** con un mensaje claro. `CORTAFUEGOS_SALIDA=off` lo desactiva; `SALIDA_EXTRA=host1,host2` añade dominios. Los dominios exactos están en `servidor/cortafuegos.mjs`.
- Prueba nueva `scripts/prueba-cortafuegos.mjs` (permitidas/bloqueadas/interruptores) integrada en la batería completa.

## Novedades v2.2.0

- **Fin del «HTTP 409» en la ingesta**: si ya hay una ingesta en marcha, el panel muestra ahora «Ya hay una ingesta en marcha» con su motivo (y el botón cambia a «⏳ Ingesta en marcha…», deshabilitado) en lugar de un error críptico. La API devuelve el motivo en el campo `error` del 409 y `/api/estado` expone `ingestaEnCurso` (sondeo rápido cada 4 s mientras dura).
- **Botón «⏸ Pausar / ▶ Reactivar» en cada alerta** (antes solo Probar/Editar/Borrar y no había forma de desactivar una alerta desde el panel): pausa la alerta sin borrarla; el estado `activa` se guarda y respeta el programador.
- **Ingestas que ya no se cuelgan**: techo de 45 s por boletín (antes un portal inalcanzable retenía el bloqueo minutos y todo lo demás devolvía 409) y presupuesto total de 90 s para el enriquecimiento del ámbito (si boe.es no responde, se aborta pronto y los anuncios se guardan sin ámbito; antes podía estar hasta 80 minutos intentándolo).
- **BOCM (Madrid) con días pasados**: la portada solo enlaza el último boletín, así que el backfill nunca encontraba el de días anteriores y Madrid salía «sin datos» siempre. Ahora se estima el nº correlativo (lunes a sábado) desde el último boletín, se prueban pocos candidatos y se verifican con `<fecha_publicacion>`; verificado en vivo: 62 anuncios de Madrid de dos días distintos.
- **Servidor accesible desde fuera**: la dirección de escucha era `process.env.HOSTNAME` (el ID del contenedor en Docker, no una IP): el panel podía quedar atado a una interfaz equivocada y no verse desde el navegador. Ahora se usa `HOST` (por defecto `0.0.0.0`).
- **Modo embebible opcional**: `PERMITIR_EMBEBER=1` permite mostrar el panel dentro de un iframe externo (p. ej. paneles de vista previa); por defecto sigue prohibido enmarcar la app (anti-clickjacking).

## Novedades v2.1.0

- **Bug crítico corregido**: el servidor buscaba los estáticos en `publico/static/…` (que no existe), así que **el CSS y el JavaScript del panel daban 404** y la GUI se veía como HTML sin estilos ni interactividad. Ahora `/static/X` se sirve desde `publico/X`.
- **GUI rediseñada completa** (profesional y responsive, estilo opoalerta.es): cabecera con marca, pestañas segmentadas, tarjetas de estadísticas, **franja de los 16 boletines con su estado en el Panel**, chips de boletín por ámbito, tablas y formularios limpios, vista móvil sin desbordes. Además, todos los estilos van por clases: la CSP estricta bloquea los `style="…"` en línea y por eso muchas reglas no se aplicaban.
- **Estado del servicio veraz**: el estado de cada fuente es ahora el del **boletín más reciente con registro** (antes mostraba el del día más viejo del backfill y daba la impresión de que el BOE «estaba caído»). La página de estado muestra ahora los 16 boletines (también los que nunca se han ejecutado), en tarjetas y en tabla.
- **Fin de semana sin falsos errores**: DOGV, DOGC, CIDO y BOCM devuelven ahora «sin datos» (correcto) en lugar de «error» cuando el día no tiene boletín (sábados, domingos y festivos).
- **Personal laboral verificado con el BOE real**: las convocatorias de personal laboral se publican en la **sección 2B** (epígrafes «Personal laboral», «Personal funcionario y laboral»), no en la 2A (que solo trae nombramientos y situaciones de quien ya fue seleccionado). La 2B se lee completa, así que ya entra todo. Ver **informe de verificación**.
- **Menos RAM y disco**: techo de heap 160 MB + semiespacio 2 MB (`NODE_OPTIONS`), purga de `IngestaLog` mayor de 180 días, checkpoint del WAL tras cada purga (el `-wal` no crece sin fin), caché LRU de estáticos en memoria y `.dockerignore` más estricto (sin scripts ni fixtures en el contexto de build).
- **Verificador de firewall en lotes de 4** (~35 s peor caso, antes >2 min en serie).
- Backfill del arranque de **más antiguo a más reciente** (el último registro de cada fuente es siempre el día más nuevo).
- Pruebas idempotentes (`prueba-completa.mjs` limpia su BD al empezar).

## Qué hay dentro

| | |
| --- | --- |
| **Ingesta** | BOE (sección 2B) + BOCM · BOJA · DOGV · DOGC · BOCYL · DOE · BOIB · BOA · BOC (Canarias) · BOPV · DOG · DOCM · BOPA · CIDO · EPSO (UE) — **16 fuentes**, todas las del proyecto open source [opoalerta/opoalerta](https://github.com/opoalerta/opoalerta) |
| **Panel web** | HTML + JS vanilla (4 pestañas: Panel, Convocatorias, Alertas, Sistema) + página «Estado del servicio». Sin framework, sin build |
| **Alertas** | Palabras clave (modo «todas»/«cualquiera»), organismo, ámbito, solo-convocatorias; matching sin acentos ni puntuación |
| **Avisos** | Discord: bot global (token + canal) o webhook por alerta. Reintentos ante rate-limit |
| **Base de datos** | SQLite con `node:sqlite` (integrada en Node). WAL, esquema idempotente, compatible con la v1.2.0 (misma base se reutiliza). Vive en el volumen Docker `opoalerta-data` (permisos correctos sin tocar el host) |
| **Programador** | Cron propio (5 campos, `* , - /`) dentro del proceso. Ingesta 09:00 + reintento 11:35 (hora de España) y *backfill* de los días perdidos al arrancar |
| **Seguridad** | CSP estricta (todo `self`, sin inline), `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy`, webhook solo Discord (o localhost en pruebas), comparación de token en tiempo constante, límite de escrituras por IP, usuario no root, `cap_drop ALL` |

## Fuentes y cómo se leen

Cada boletín es un módulo de `servidor/fuentes/` con la misma interfaz (`id, nombre, ámbito, licencia, obtener(fecha)`). Añadir uno nuevo = un archivo más y registrarlo en `servidor/fuentes/index.mjs`.

| Fuente | Sección de empleo que se lee | Método |
| --- | --- | --- |
| BOE | **2B · Oposiciones y concursos** — aquí se publica TODO el empleo: funcionarios **y personal laboral** (epígrafes «Personal laboral», «Personal funcionario y laboral»…) | 4 endpoints de respaldo: API JSON de datos abiertos → XML del sumario → HTML del sumario → página HTML del día |
| BOCM | I.B Autoridades y Personal + III ayuntamientos («Ofertas de empleo») | XML del sumario |
| BOJA | 2.2 Oposiciones, concursos y otras convocatorias | Feed Atom |
| DOGV | A) Ofertas de empleo público, oposiciones y concursos | API JSON |
| DOGC | Cargos y personal (sin nombramientos) + empleo local | API REST |
| BOCYL | B.2 Oposiciones y Concursos | HTML |
| DOE | Oposiciones y concursos | HTML (ISO-8859-1) |
| BOIB | Sección II · Oposiciones y concursos | RSS + HTML |
| BOA | II.b Oposiciones y concursos | CGI HTML (Latin-1, con retroceso de 6 días) |
| BOC (Canarias) | II Oposiciones y concursos | HTML |
| BOPV | Oposiciones y concursos (último + 2 anteriores) | HTML (ISO-8859-1) |
| DOG | IV. Oposicións e concursos | HTML |
| DOCM | II Autoridades y Personal › Oposiciones y concursos | HTML (ISO-8859-1) |
| BOPA | Autoridades y Personal (filtro positivo de proceso selectivo) | HTML |
| CIDO | Procesos selectius de toda Cataluña (agregador de la Diputació de Barcelona, incluye empleo local) | API JSON:API (CC BY 4.0) |
| EPSO | Oposiciones de la Unión Europea (AD/AST/CAST) | HTML |

Un boletín caído **no impide al resto**: cada fuente se ejecuta por separado y registra su propio estado (ok / sin datos / error). Los boletines que no publican cierto día (fines de semana, festivos) se registran como **«sin datos», que no es un error**.

### Personal laboral (sección 2B, no 2A)

En el BOE, la **2A es «Nombramientos, situaciones e incidencias»**: solo comunica quién ya ha sido nombrado (catedráticos, destinos resueltos…), no convoca plazas. Las **convocatorias de personal laboral** (fijo y temporal) se publican en la **2B «Oposiciones y concursos»** — comprobado con el BOE real del sábado 31/10/2026: epígrafe «Personal laboral» (p. ej. Tribunal de Cuentas, personal laboral fijo por promoción interna) y «Personal funcionario y laboral» (decenas de ayuntamientos). La ingesta lee la 2B completa y el matching cruza con tus palabras clave («personal laboral», categorías…), así que estas plazas **sí disparan tus alertas**. La alerta precargada **«Empleo público · Personal laboral e Ingeniería de obra»** ya viene lista.

## Firewall: qué necesita salir a Internet

**Cortafuegos integrado (v2.3.0)**: además de lo que permita tu red, la app aplica por sí misma una **lista blanca de salida**: solo inicia conexiones hacia esos mismos portales y a Discord, y bloquea cualquier otro destino antes de abrir la conexión. No hace falta iptables ni capacidades extra en el contenedor (`cap_drop: ALL` sigue igual). Para añadir un dominio: `SALIDA_EXTRA=portal.interno.org`; para desactivarlo: `CORTAFUEGOS_SALIDA=off`.

**Modo reforzado (v2.3.1, opcional)**: esa misma garantía también a nivel de red. `docker-compose.reforzado.yml` añade un **proxy interno Squid** y deja la app en una red Docker sin internet: la única salida posible es el proxy, con la misma lista blanca (`proxy/dominios.list`). Dos capas independientes: si un fallo futuro de la app se saltara su lista, la conexión seguiría muriendo en la red. Solo túneles TLS (443), sin caché y sin registro de URLs (las URLs de webhook llevan token). Si usas `SALIDA_EXTRA`, añade el dominio también a `proxy/dominios.list`. Verifica tu despliegue con `bash scripts/prueba-proxy.sh`.

**El panel solo al alcance de tu red (v2.3.3)**: el espejo del cortafuegos de salida — ahora también de **entrada**. La app mira la IP de origen de cada petición y solo sirve el panel a IPs privadas (tu LAN, redes Docker y loopback); una IP pública recibe un 403 inmediato (`CORTAFUEGOS_ENTRADA=lan` por defecto). Por eso el puerto puede publicarse en todas las interfaces sin miedo: internet no obtiene respuesta. Capa extra opcional: `PUERTO_PUBLICADO=<IP-LAN>` hace que Docker ni siquiera escuche en la interfaz pública. Es todo lógica de la app y publicación estándar de Docker: nada de iptables del host, nada del sistema operativo.

**Todo dentro de Docker, nada del sistema operativo**: el modo reforzado son dos contenedores (app + proxy Squid) y dos redes internas de Docker. No se instala nada en el host, no se toca iptables ni ufw, no hay servicios ni usuarios nuevos del sistema: el aislamiento lo hace Docker con `internal: true` y el filtrado lo hace el contenedor del proxy. Lo único que Docker publica fuera, como siempre, es el puerto del panel y el volumen con nombre `opoalerta-data` (la base de datos).

## Tus datos: dónde viven y cómo copiarlos

Desde v2.3.4 la base de datos vive en el **volumen con nombre** `opoalerta-data` (no en la carpeta `./data` del proyecto): Docker le da los permisos correctos solo, y sobrevive a `docker compose down`, `up --build` y reinicios del servidor.

```bash
# Copia de seguridad (desde la carpeta donde tengas el proyecto):
docker run --rm -v opoalerta-data:/datos -v "$PWD":/respaldo alpine \
  tar czf /respaldo/opoalerta-datos-$(date +%F).tgz -C /datos .

# Restaurar una copia (con el stack parado):
docker run --rm -v opoalerta-data:/datos -v "$PWD":/respaldo alpine sh -c \
  "cd /datos && tar xzf /respaldo/opoalerta-datos-AAAA-MM-DD.tgz && chown -R $(docker run --rm opoalerta-docker:2.3.4 id -u):$(docker run --rm opoalerta-docker:2.3.4 id -g) /datos"

# ¿Venías de un despliegue anterior con ./data y quieres conservarla? (una vez)
docker run --rm -v opoalerta-data:/datos -v "$PWD/data":/origen alpine sh -c \
  "cp -r /origen/. /datos/ && chown -R $(docker run --rm opoalerta-docker:2.3.4 id -u):$(docker run --rm opoalerta-docker:2.3.4 id -g) /datos"
```

El volumen es el mismo en el modo normal y en el reforzado, así que puedes alternar entre ellos sin perder nada. ¿Prefieres volver a la carpeta visible `./data`? Cambia el `volumes:` del compose a `- ./data:/app/data` — pero entonces asegúrate de que `./data` pertenezca al uid del usuario del contenedor (`docker exec opoalerta id -u`), o la app no podrá escribir.

La app solo inicia conexiones HTTPS (443) hacia los portales oficiales y Discord:

`www.boe.es · www.bocm.es · www.juntadeandalucia.es · dogv.gva.es · portaldogc.gencat.cat · dogc.gencat.cat · bocyl.jcyl.es · doe.juntaex.es · www.caib.es · www.boa.aragon.es · www.gobiernodecanarias.org · www.euskadi.eus · www.xunta.gal · docm.jccm.es · miprincipado.asturias.es · sede.asturias.es · api.diba.cat · cido.diba.cat · eu-careers.europa.eu · discord.com · discordapp.com`

**Comprobación integrada**: en el panel → Sistema → «🔌 Comprobar conexión (firewall)» (o `GET /api/fuentes/verificar`) hace una sonda ligera por boletín (en lotes de 4, ~35 s) y te dice exactamente cuáles tienen salida de red desde tu servidor.

## Variables de entorno

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `PUERTO` | `3000` | Puerto del panel en el host |
| `PUERTO_PUBLICADO` | `0.0.0.0` | Interfaz donde Docker publica el panel: `0.0.0.0` todas (el filtro de entrada rechaza a internet); `<IP-LAN>` solo la interfaz local, aún más estricto |
| `CORTAFUEGOS_ENTRADA` | `lan` | El panel solo se sirve a IPs privadas (tu LAN); una IP pública recibe un 403. `off` lo desactiva |
| `ENABLE_SCHEDULER` | `1` | Ingesta programada dentro del proceso |
| `HORARIO_INGESTA` | `0 9 * * *,35 11 * * *` | Expresiones cron (admite varias y comas de campo) |
| `ZONA_HORARIA` / `TZ` | `Europe/Madrid` | Zona horaria de los horarios |
| `BACKFILL_DIAS` | `7` (0-14) | Días que se rellenan al arrancar si faltan |
| `DISCORD_BOT_TOKEN` / `DISCORD_CANAL_ID` | — | Bot global (también desde la web) |
| `ADMIN_TOKEN` | — | Si se define, exige `x-admin-token` en toda escritura de la API y en la consola |
| `LIMITE_MEMORIA` | `256m` | Techo del contenedor (la app ronda 50-80 MB) |
| `PERMITIR_WEBHOOKS_LOCALES` | — | Solo pruebas: permite webhooks `http://127.0.0.1` |
| `CORTAFUEGOS_SALIDA` | `lista` | Lista blanca de salida activa; `off` la desactiva |
| `SALIDA_EXTRA` | — | Dominios extra permitidos, separados por comas (p. ej. proxy corporativo) |

## Pruebas (sin red, contra servidor falso y en vivo)

```bash
node scripts/prueba-completa.mjs            # batería completa (recomendado; limpia su BD sola)
node scripts/prueba-fixtures.mjs            # 16 parsers con fixtures reales del proyecto original
node scripts/test-matching-e2e.js           # matching offline (personal laboral incluido)
node scripts/prueba-cortafuegos.mjs         # cortafuegos de salida: lista blanca e interruptores
bash scripts/prueba-proxy.sh                # modo reforzado con proxy interno (requiere Docker y el stack en marcha)
node scripts/prueba-fallback.mjs            # cuádruple respaldo del BOE (con scripts/boe-falso.mjs)
node scripts/prueba-e2e.mjs                 # pipeline completo: demo → matching → Discord (mock)
node scripts/prueba-fuentes.mjs 20261031    # ingesta real de los 16 boletines (fecha AAAAMMDD)
```

## Historia

- **v1.2.0**: port del scraper del BOE + 7 boletines sobre Next.js/React/Prisma.
- **v2.0.0**: reescritura completa sin React (HTML+JS vanilla y Node puro), 16 fuentes, 4.º respaldo del BOE, verificador de firewall integrado, consola y página de estado reescritas.
- **v2.1.0**: corrección del bug de estáticos (CSS/JS 404 → GUI sin estilos), rediseño visual completo y responsive, estado por fuente veraz, fines de semana sin falsos errores, personal laboral verificado contra el BOE real (2B), ajustes de RAM y purga de logs, verificador de firewall paralelizado.
- **v2.2.0**: adios al HTTP 409 (estado de ingesta visible + mensaje claro), botón Pausar/Reactivar en alertas, techo de 45 s por fuente y presupuesto de enriquecimiento (ingestas que no se cuelgan), BOCM con días pasados (backfill de Madrid funcional), escucha en `HOST` correcta y `PERMITIR_EMBEBER` opcional para iframes.
- **v2.3.0**: BOE en cascada de 4 accesos directos (1 conexión de 8 s por endpoint, sin relés, fallo rápido y claro ante cortafuegos, 404 = sin boletín) y **cortafuegos de salida con lista blanca** (solo boletines + Discord; `CORTAFUEGOS_SALIDA`/`SALIDA_EXTRA`).
- **v2.3.1**: modo reforzado opcional con **proxy interno Squid** (red Docker sin internet + lista blanca a nivel de red; `docker-compose.reforzado.yml`, `proxy/`, `scripts/prueba-proxy.sh`).
- **v2.3.2**: el panel se publica por defecto solo en `127.0.0.1` (nunca desde internet); `PUERTO_PUBLICADO` abre el acceso a tu red local y solo a ella.
- **v2.3.3**: **cortafuegos de entrada** — la app solo sirve el panel a IPs privadas (tu LAN); una IP pública de internet recibe un 403 inmediato (`CORTAFUEGOS_ENTRADA=lan`). La publicación vuelve a `0.0.0.0` para que tu LAN entre sin tocar nada, con el filtro en la app como portero.
- **v2.3.4**: la base de datos pasa de `./data` (bind mount con problemas de permisos: Docker creaba la carpeta como root y la app no podía escribir) a un **volumen con nombre** `opoalerta-data` (permisos correctos desde la imagen, estable entre modos y renombres de carpeta; `down -v` lo borra — ver «Tus datos»).

Datos de los boletines oficiales: reutilización permitida citando la fuente (ver licencia de cada uno en el panel). Código inspirado en [opoalerta/opoalerta](https://github.com/opoalerta/opoalerta).

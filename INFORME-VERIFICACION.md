# Informe de verificación · OpoAlerta Docker v2.1.0

Fecha de verificación: **31/10/2026 (sábado)**. Entorno: sandbox de pruebas aislado con salida parcial a Internet (ver §3). La app es la subida `opoalerta-docker-v2.0.0.zip`, auditada, corregida y re-publicada como **v2.1.0**.

---

## 1. Resumen ejecutivo

Se ha hecho una revisión completa de código, ingesta, base de datos, interfaz y despliegue. Resultado:

- **Bug crítico encontrado y corregido**: el servidor buscaba `/static/estilo.css`, `/static/app.js`… en `publico/static/` (directorio inexistente). **Todos los estáticos daban 404**: la GUI se veía como HTML sin estilos, sin JavaScript y sin interactividad (pestañas muertas, sin datos). Esta era la causa principal del aspecto «fea y desordenada» que notabas.
- **«Estado del servicio → BOE caído» explicado y corregido**: la página tomaba el estado de la fila de log más reciente **por tiempo de inserción**; como el backfill inserta primero hoy y después los días anteriores, lo que se mostraba era el estado del **día más viejo** (un error puntual de hace días parecía «BOE caído» hoy). Ahora el estado por fuente es el del **boletín más reciente con registro** (y dentro de esa fecha, la ejecución más nueva). Verificado en los dos sentidos (§5).
- **Personal laboral verificado contra el BOE real del 31/10/2026**: se publica en la **sección 2B** (epígrafes «Personal laboral» y «Personal funcionario y laboral»), **no en la 2A** — la 2A solo trae nombramientos/situaciones de personas ya seleccionadas. La app ya lee la 2B completa: el personal laboral entra correctamente y dispara alertas (verificado end-to-end con el pipeline Discord, §4).
- **Fines de semana sin falsos «caídos»**: DOGV, DOGC, CIDO y BOCM marcaban «error» cuando el día simplemente no tiene boletín; ahora devuelven «sin datos» (correcto).
- **Ingesta real ejecutada hoy (sábado)**: 10 de 16 fuentes consultadas con éxito desde el sandbox (4 con datos —BOIB 25, BOJA 13, EPSO 16, BOC 2— y 6 «sin datos» por ser sábado); las 6 restantes fallaron **solo por el cortafuegos del sandbox**, no por el código (§3). Los 16 parsers pasan la batería offline de fixtures.
- **Optimización RAM/disco**: techo de heap 160 MB + semiespacio 2 MB, purga de `IngestaLog` (>180 días) con checkpoint del WAL, caché LRU de estáticos, `.dockerignore` más estricto y limpieza de código muerto (`public/` huérfano, `itemsXml`, `.gitignore` de la época Next.js).
- **GUI rediseñada**: profesional y responsive (estilo opoalerta.es), todo con clases CSS (la CSP bloquea los estilos en línea), franja de los 16 boletines en el Panel, chips por ámbito, vista móvil sin desbordes (verificada a 390 px).

## 2. Qué hace la aplicación (verificación de función)

- **Ingesta multi-fuente**: 16 módulos (`servidor/fuentes/`) con la misma interfaz; consulta secuencial con pausa de 1 s; cada fuente con su propio estado (ok / sin_datos / error) y deduplicación por `identificador` (índice único SQLite). Un boletín caído no tumba el resto.
- **BOE**: 4 endpoints en cascada (API datos abiertos → XML sumario → HTML sumario → página del día) con 2 reintentos por endpoint. Verificado con servidor falso: los 5 escenarios de caída caen siempre en un respaldo válido y, en caída total, la ingesta continúa con el resto de boletines.
- **Alertas → Discord**: matching sin acentos/puntuación, modos «todas/cualquiera», filtro organismo/ámbito/solo-convocatorias; envío por bot global o webhook por alerta, en lotes de 10 embeds, con reintento ante 429. Verificado con receptor mock: 12 avisos capturados con embeds completos (título, URL, organismo, tipo, ámbito, boletín).
- **Programador**: cron propio de 5 campos, 09:00 y 11:35 (Europe/Madrid), sin dobles disparos en el mismo minuto; backfill de hasta 14 días al arrancar (ahora de más antiguo a más reciente).
- **API web**: `/api/health`, `/api/estado`, `/api/ingesta`, `/api/convocatorias`, `/api/alertas[/:id][/probar]`, `/api/ajustes`, `/api/consola`, `/api/fuentes/verificar`. Escrituras protegidas por `ADMIN_TOKEN` (comparación en tiempo constante) y límite de 40 escrituras/min por IP.
- **Seguridad**: CSP `default-src 'self'` (ahora sin romper la GUI: no queda ningún `style=""`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, webhooks solo Discord, ruta de estáticos blindada contra traversals (`normalize` + prefijo forzado).

## 3. Ingesta real del sábado 31/10/2026 (16 fuentes)

Ejecutada contra los portales oficiales desde el sandbox (ingesta real, origen «prueba»):

| Resultado | Fuentes | Detalle |
| --- | --- | --- |
| ✅ Con datos (4) | BOIB (25) · BOJA (13) · EPSO (16) · BOC (2) | Ingesta y guardado correctos; 2 anuncios contienen «laboral» en el título |
| ⚠️ Sin datos (6) | BOA · BOCM · BOCYL · BOPA · DOCM · DOE | Correcto: no publican empleo el sábado (o no publican) |
| ⚠️ Sin datos tras el fix (2) | DOGV · DOGC | Antes «error» en sábado; ahora «sin datos» (§6) |
| ❌ Red del sandbox (4) | BOE · BOPV · CIDO (+BOA red) | `curl` directo confirma **sin salida de red del sandbox** a `www.boe.es`, `euskadi.eus`, `api.diba.cat`, `portaldogc.gencat.cat` (timeout de conexión). No es un fallo del código |

Sobre el BOE, que no es alcanzable desde el sandbox:

- **Tú mismo verificaste** que `https://www.boe.es/datosabiertos/api/boe/sumario/20261031` responde en sábado (HTTP 200).
- Verificación independiente del contenido real del BOE de hoy (31/10/2026, diario nº 271): secciones presentes **1 · 2A · 2B**; la **2B** «Oposiciones y concursos» incluye el epígrafe **«Personal laboral»** (BOE-A-2026-22808, Tribunal de Cuentas, personal laboral fijo por promoción interna) y **«Personal funcionario y laboral»** (Admin. Local: Alcobendas, Vigo, Badajoz, Santander…). La 2A solo trae «Nombramientos, situaciones e incidencias» (catedráticos, destinos…).
- Conclusión: el parser (`codigo === "2B"`) captura **todo** el empleo del BOE, incluido el personal laboral. **No hace falta leer la 2A** para convocatorias: solo contiene nombramientos de quien ya superó el proceso.
- La cascada de 4 endpoints del BOE está además verificada offline contra `boe-falso.mjs` (5 escenarios, todos OK).

## 4. Batería de pruebas automatizadas

`node scripts/prueba-completa.mjs` (ahora limpia su BD al empezar: ejecuciones repetibles):

- ✅ **Fixtures de los 16 parsers** (datos reales capturados del proyecto original opoalerta): BOE, BOCM, BOJA, DOGV, DOGC, BOCYL, DOE, BOIB, BOA, BOC, BOPV, DOG, DOCM, BOPA, CIDO, EPSO — todos extraen, filtran y decodifican (Latin-1 incluido) correctamente.
- ✅ **Matching offline**: 7 títulos reales (incl. personal laboral de Mostoles y bolsa de empleo temporal del BOCYL) disparan sus alertas.
- ✅ **Cuádruple respaldo del BOE**: caídas 1-5 → usa `xml-diario_boe`, `xml-diario_boe` (variante plana), `html-sumario`, `html-dias`; caída total → estado `error` con detalle de los 4 endpoints y el resto de la app sigue viva; deduplicación entre fuentes correcta.
- ✅ **E2E del pipeline**: 4 alertas precargadas (incl. «Empleo público · Personal laboral e Ingeniería de obra»), ingesta demo 29/10 (13 anuncios, 5 alertas disparadas, 4 avisos) y 30/10 (7 anuncios, 4 avisos), reingesta deduplicada (0 nuevos), **3 plazas de personal laboral guardadas y clasificadas como «convocatoria»**, enriquecimiento de ámbito, filtros de búsqueda, webhook rechazado si no es Discord, **12 mensajes capturados en el mock de Discord con embeds completos**, consola y estado coherentes, versión 2.1.0.

Resultado: **BATERÍA COMPLETA: todo pasa ✓** (ejecutada dos veces para confirmar idempotencia).

## 5. «Estado del servicio» — causa raíz y verificación del arreglo

Causa: `apiEstado` tomaba por fuente `ORDER BY createdAt DESC LIMIT 1`; el backfill inserta los días de más nuevo a más viejo, de modo que la última fila insertada era la del **día más antiguo**. Si ese día el BOE dio un error puntual, la página decía «BOE error» aunque la ingesta de hoy hubiera ido bien.

Arreglo (dos capas):

1. `apiEstado`: por fuente se toma ahora la fila con `fechaBOE` más reciente y, a igualdad, la ejecución más nueva (`ROW_NUMBER() OVER (PARTITION BY fuente ORDER BY fechaBOE DESC, createdAt DESC)`).
2. `backfillArranque`: recorre los días de **más antiguo a más reciente**, así el último registro de cada fuente siempre es el más nuevo.

Verificación con datos simulados sobre la API real:

- 7 filas de boe (hoy ok…, día más viejo error, insertado el último) → la API informa `estado=ok, fechaBOE=20261031`. ✔️ (antes: «error»)
- Error insertado para HOY → la API informa `estado=error, fechaBOE=20261031` con el mensaje. ✔️ (reporte honesto)

Además, la página de estado muestra ahora las **16 fuentes** (también las sin ninguna ejecución, como «sin ejecutar») en tarjetas de salud y en tabla.

## 6. Robustez de fuentes: «sin datos» ≠ «error»

Corregido para que un día sin publicación (fin de semana/festivo) no aparezca como caído:

- **DOGV**: sin `disposiciones` → `[]` (sin datos).
- **DOGC**: sin `numDOGC` ese día → `[]` (sin datos).
- **CIDO**: respuesta válida sin fichas → `[]` (sin datos); los errores de la API siguen siendo error.
- **BOCM**: portada sin enlace al sumario de ese día → `[]` (sin datos).

BOA/BOPA/BOPV ya lo gestionaban correctamente (retroceso de días, página sin contenido, etc.).

## 7. Optimización de RAM y disco

- **Node**: `NODE_OPTIONS=--max-old-space-size=160 --max-semi-space-size=2` (antes 192/defecto). Heap usado típico medido: **~9 MB**; RSS del proceso en marcha: **~70 MB** (dentro del techo del contenedor de 256 MB). La semiespacio pequeña reduce la presión de GC en las ingestas (muchos JSON/HTML medianos) y el techo más bajo garantiza que un pico no trote el OOM-killer.
- **SQLite**: purga automática de `IngestaLog` con más de 180 días (antes crecía sin fin: 16 filas/día/despliegue), `wal_checkpoint(TRUNCATE)` tras cada purga (el fichero `-wal` no crece indefinidamente) y `VACUUM` solo cuando la purga es grande (>500 filas).
- **Memoria del servidor web**: caché LRU de estáticos (máx. 15 ficheros, ~60 KB) — menos I/O de disco por petición; el búfer de consola sigue limitado a 500 líneas y el rastreador de rate-limit a 5.000 IPs.
- **Disco del proyecto**: eliminado `public/` raíz (resto de la época Next.js, sin referencias), eliminado `itemsXml` (código muerto en `util.mjs`), `.gitignore` reescrito (quitados ~40 líneas de Next.js/Vercel/Yarn), `.dockerignore` ahora excluye `scripts/`, `public/`, `*.zip` y `*.md` (el contexto de build baja a ~100 KB; la imagen solo copia `servidor/`, `publico/` y `package.json`).

## 8. GUI: qué se cambió y cómo se verificó

- **Causa del aspecto roto**: además del 404 de estáticos, la CSP `style-src 'self'` bloquea los atributos `style="…"`; la GUI antigua dependía de decenas de ellos. Solución: **todo el aspecto pasa a clases** (`estilo.css` reescrito como sistema de diseño) y el bug de `/static/` corregido.
- **Diseño**: cabecera con marca (logo + nombre + subtítulo), insignia de modo, pestañas segmentadas, tarjetas de estadísticas, **franja de 16 boletines con semáforo** en el Panel, leyenda (con datos / sin datos / error / sin ejecutar), buscador con etiquetas por campo, chips de boletín coloreados por ámbito (estatal/autonómico/local/UE…), tablas con cabecera mayúscula y scroll horizontal en móvil, consola oscura, toasts y diálogo accesibles, pie coherente. Estética alineada con opoalerta.es (claro, verde esmeralda, tarjetas).
- **Verificado con navegador headless** (Chromium): sin errores de consola ni violaciones CSP; capturas de Panel vacío y con datos, Convocatorias, Sistema, Estado del servicio y **vista móvil iPhone (390 px) sin desbordes** (medido `scrollWidth` del body = ancho del viewport, tras corregir rejillas con `minmax(0, 1fr)` y `white-space` de etiquetas).

## 9. Despliegue

- Dockerfile `node:24-alpine` (sin build, sin dependencias), usuario no root, `cap_drop ALL`, `no-new-privileges`, healthcheck interno, techo de memoria 256 m — todo se mantiene.
- `docker compose up -d --build` y listo; la base de datos existente de v2.0.0 se reutiliza sin migración (mismo esquema, la purga de logs entra en la siguiente ingesta).

## 10. Conclusión

La aplicación ingiere de verdad de las **16 fuentes** (las alcanzables desde cada servidor; cada una con respaldos y estado propio), el personal laboral del BOE se captura por la vía correcta (**2B**), el panel ya no confunde «sin datos» con «BOE caído», y la interfaz es profesional, ordenada y responsive. Pendiente solo para ti: comprobar desde tu servidor el firewall con el botón «🔌 Comprobar conexión» para confirmar la salida 443 hacia los 17 dominios del §«Firewall» del README (en este sandbox boe.es y 3 portales más están bloqueados a nivel de red, por eso no pudieron verse en vivo; el BOE lo verificaste tú y su contenido se analizó aparte).

## Modo reforzado con proxy interno (v2.3.1)

Verificación funcional del proxy de salida (Squid 6.13) con la lista blanca del proyecto, ejecutada el 01/11/2026 con el binario real de Squid y el `fetch` nativo de Node v24.22.1:

| # | Caso | Resultado |
| --- | --- | --- |
| 1 | `squid -k parse` de la configuración | ✅ sin errores |
| 2 | CONNECT a dominio de la lista → túnel TLS + HTTP 200 | ✅ |
| 3 | CONNECT a dominio fuera de la lista | ✅ denegado (`TCP_DENIED/403`) |
| 4 | CONNECT a puerto no TLS (4444) | ✅ denegado (`TCP_DENIED/403`) |
| 5 | HTTP plano por el proxy (sin CONNECT) | ✅ denegado (403) |
| 6 | `fetch` de Node 24 con `NODE_USE_ENV_PROXY=1` → atraviesa el proxy | ✅ |
| 7 | `fetch` de Node 24 a dominio bloqueado → falla sin salir | ✅ |
| 8 | Registro de túneles en el access.log del proxy | ✅ |

RAM medida del proxy en marcha: ~23 MB. La config de `proxy/squid.conf` valida con `squid -k parse` (rutas estándar de Alpine). En el servidor real, `bash scripts/prueba-proxy.sh` verifica el despliegue reforzado de extremo a extremo (BOE y Discord por proxy, example.com bloqueado, sin salida directa sin proxy, panel visible por el puerto publicado).

**v2.3.6 — la prueba del panel es una escalera de diagnóstico A→D**: A (la app responde dentro del contenedor, como su healthcheck), B (`docker compose port`: qué interfaz publica Docker), C (loopback del host), D (la IP de la LAN del servidor, lo que abre el navegador). Cada paso fallido imprime causa probable y comando de arreglo (recrear el stack, corregir `PUERTO_PUBLICADO`, cortafuegos del host, volumen de BD). Además: `curl`/`wget` de la prueba ignoran el `http_proxy` del entorno (`--noproxy '*'` — un servidor con proxy de salida en el shell daba falsos «panel no accesible»), y las comprobaciones previas detectan bucles de reinicio de la app (estado, `RestartCount`, exit code, OOM + log): las pruebas de red usan `exec` con procesos Node nuevos y pasarían aunque el panel estuviera muerto.

**v2.3.7 — diagnóstico extra del paso C**: cuando el host no llega al puerto publicado (app viva + publicación confirmada), el script conecta DIRECTO al contenedor por su IP (salta docker-proxy y DNAT), muestra la publicación real según `docker inspect` (bug `:0` de `docker compose port`), lo que escucha en el puerto del host (`ss -tln`) y la ruta del host al contenedor (`ip route get`): si la ruta no sale por el bridge `br-*` hay **colisión de subred** con una VPN u otra red en 172.16/12 — causa clásica de «todo funciona dentro de Docker y nada desde el host». La prueba B usa `docker inspect` como fuente fiable y el veredicto C enumera los 3 casos con su arreglo (publicación → `systemctl restart docker`; colisión → mover subred; cortafuegos del host → ufw/firewalld/OUTPUT).

## El frontal del panel: por qué el modo reforzado tiene 3 contenedores (v2.3.8, afinado en v2.3.9)

**Causa raíz del «paso C» fallando en el servidor** — confirmada con los mantenedores de Docker ([moby/moby#53256](https://github.com/moby/moby/discussions/53256)): los puertos publicados se instalan a través de la red de puerta de enlace del contenedor; un contenedor que SOLO está en redes `internal: true` no tiene ninguna, así que la configuración de puertos se acepta pero **no se publica nada** (`NetworkSettings.Ports` vacía). Encaja exactamente con los síntomas: la app viva por dentro (A ✓), publicación aparente pero sin efecto, y el host sin poder alcanzar el panel por loopback ni por LAN — desde la v2.3.1, en el modo reforzado, el panel nunca pudo haber funcionado así.

**Arreglo (el recomendado por el mantenedor)**: contenedor **frontal** (`frontal/Dockerfile` + `frontal/frontal.mjs`) en las redes `interna` + `salida` que recibe el puerto publicado (`PUERTO_PUBLICADO`/`PUERTO`) y lo reenvía a `opoalerta:3000`. La app pierde su bloque `ports:` y conserva intacto el aislamiento (sin internet, sin LAN, proxy con lista blanca como única salida). En la v2.3.8 el frontal era una tubería socat «ciega» (todas las visitas llegaban desde su IP privada, así que el cortafuegos de entrada de la app dejaba de discriminar — la objeción razonable al diseño). La **v2.3.9** lo convierte en la **puerta con cortafuegos** del modo reforzado: ~60 líneas de Node que aplican el MISMO `permitirEntrada` de `servidor/cortafuegos.mjs` (módulo compartido, cero divergencia de política) a la **IP real del visitante** — el reenvío de Docker conserva la IP de origen — de modo que una IP pública recibe el **403 en la puerta**, antes de tocar la app, y la app conserva su filtro como segunda barrera. Endurecido como el resto: `cap_drop ALL`, `no-new-privileges`, usuario sin privilegios, techo de 64 MB (`LIMITE_FRONTAL`) y healthcheck de extremo a extremo por la tubería. **Verificado en el sandbox** (sin Docker: el frontal real con un servidor falso): loopback atraviesa la tubería (HTTP 200) y una IP no privada real del entorno recibe el 403 sin llegar a la app (`scripts/prueba-cortafuegos.mjs`). La validación del despliegue completo es `bash scripts/prueba-proxy.sh` en el servidor: comprueba la publicación en el frontal y, si algo falla, distingue frontal caído (X/Y), capa de publicación, colisión de subred y cortafuegos del host.

Nota sobre el despliegue: la solución entregada ejecuta ese mismo Squid dentro de un contenedor Alpine (`proxy/Dockerfile`, alpine:3.20 + paquete squid). Todo el modo reforzado son tres contenedores (frontal + app + proxy) y dos redes de Docker: en el servidor no se instala ni se configura nada del sistema operativo (sin iptables, sin ufw, sin servicios del host); solo comandos de `docker compose`.

## Empaquetado del frontal corregido (v2.3.10)

Bug detectado al desplegar la v2.3.9 en el servidor: el servicio `frontal` se construía con `build: ./frontal`, así que el **contexto de construcción era solo la carpeta `frontal/`** y los `COPY servidor/cortafuegos.mjs` / `COPY frontal/frontal.mjs` de `frontal/Dockerfile` — rutas relativas a la raíz del proyecto — fallaban siempre con `«/frontal/frontal.mjs» not found`. Es decir: ningún despliegue de la v2.3.9 pudo construir el frontal, fuera cual fuese la forma de copiar los archivos (el mensaje «failed to compute cache key … not found» es BuildKit sin el archivo en el contexto). Corrección: `build: { context: ., dockerfile: frontal/Dockerfile }` — contexto raíz, mismas rutas de COPY, mismas capas — más un `.dockerignore` en la raíz para que los contextos (ahora compartidos por app y frontal) solo suban `servidor/`, `publico/`, `frontal/` y `package.json`: scripts, fixtures, zips, README, datos y el `.env` (tokens) quedan fuera del demonio de Docker. Precisión documental: la confirmación del comportamiento de Docker es la discusión [moby/moby#53256](https://github.com/moby/moby/discussions/53256) («A container connected only to `--internal` networks has no gateway, so there's nowhere to publish the ports», mantenedor robmry), no un issue. Verificación de esta versión: sintaxis de los `.mjs` con `node --check`, batería completa offline en verde (`node scripts/prueba-completa.mjs`) y paquete revisado (los `COPY` del frontal comprobados contra el árbol real del zip).

## Rendimiento del panel y de «Estado del servicio» (v2.3.11)

Síntomas reportados tras desplegar la v2.3.10 (equipo modesto): panel «un poco lento» y la pestaña de estado con esfuerzo al abrirla. Auditoría del recorrido: el JSON de `/api/estado` es pequeño, la base queda acotada por la purga de 180 días y el frontal es una tubería TCP sin lógica — el coste estaba en **trabajo sincrónico repetido**: `asegurarEsquema()` se ejecutaba en CADA petición de la API (~27 sentencias DDL con `IF NOT EXISTS` por sondeo), `/api/estado` recalculaba todas sus consultas en cada sondeo (panel: 45 s, y 4 s durante ingesta; página de estado: 45 s), y las dos consultas de «estado por fuente» (ventana `PARTITION BY fuente` y `GROUP BY fuente`) recorrian y ordenaban toda `IngestaLog` sin índice por `fuente`. Correcciones: esquema comprobado una sola vez por proceso; caché de 3 s para `/api/estado` (el JSON se calcula una vez y se reutiliza; cualquier escritura la invalida); índice `IngestaLog(fuente, fechaBOE DESC, createdAt DESC)` (DDL idempotente: se crea solo sobre la base existente al arrancar); en el frontend, sin repintado si el JSON no cambió (se excluye la RAM, que fluctúa en cada sondeo) y sondeo en pausa con la pestaña del navegador oculta. Además, cualquier respuesta de más de 800 ms se registra en el log del contenedor: si la sensación de lentitud persiste, ahora hay un dato objetivo por petición (`docker logs opoalerta`). Verificado: batería completa offline en verde (incluye el sondeo de estado del E2E con `version=2.3.11`) y cronometrado del endpoint en el sandbox (1.ª petición calcula, siguientes dentro del TTL sirven la caché).

## EPSO arreglado, alerta TIC y GUI sin marca (v2.3.12)

Tres peticiones del usuario sobre la v2.3.11: añadir una alerta de oposiciones para informáticos/TIC (grupos A1/A2), arreglar el «portal europeo» (`eu-careers.europa.eu`) y quitar la marca de la GUI (cabecera y pie).

**Diagnóstico de EPSO con la página real**: `eu-careers.europa.eu/es/job-opportunities/in-progress` responde hoy un **redirect** hacia el nuevo subdominio **`selection.eu-careers.europa.eu`**, donde vive la plataforma de selección de EU Careers. Las dos listas blancas — `HOSTS_BASE` de `servidor/cortafuegos.mjs` y `proxy/dominios.list` del proxy del modo reforzado (coincidencia exacta de host, espejo manual) — solo tenían el dominio clásico: la app abría su CONNECT hacia `eu-careers.europa.eu` (permitido), pero el **segundo salto** del redirect — un CONNECT nuevo hacia `selection.…` — lo rechazaba el proxy. El parser no cambió: sobre el HTML real del día extrae 16 ofertas (Ciberseguridad, IA, Ciencia de datos, Nubes y redes…) con las mismas expresiones `job-row`/`views-field-title`/`epso-reference-number`. Arreglo: `LISTA_URL`/`BASE` apuntan al dominio nuevo (sin redirect), `selection.eu-careers.europa.eu` añadido a ambas listas (el dominio clásico sigue permitido), y la sonda de «Comprobar conexión (firewall)» usa el dominio nuevo. Fixture `epso-lista.html` regenerado con el HTML real (3 filas) y aserción nueva del dominio de destino.

**Alerta TIC**: semilla nueva `alerta-tic-informatica` («Informática · TIC · Grupos A1/A2», modo «cualquiera», solo convocatorias) — se siembra al arrancar como las demás y SOLO si no existe, así que la base ya desplegada la recibe en el siguiente arranque sin migración. Deliberadamente sin «A1»/«A2» a secas (el matching es por substring y dispararía con todo el grupo administrativo): incluye las frases «grupo A1»/«grupo A2», que también cazan «subgrupo A1/A2» por substring, y los títulos con «(A1)» entre paréntesis quedan fuera. En la GUI, tres plantillas de un clic sobre el formulario «Alerta nueva» (TIC/A1-A2, personal laboral, ingeniería de obra) que rellenan nombre/keywords/modo sin enviar nada (editables antes de crear). Verificación: `scripts/test-matching-e2e.js` ampliado a 11 títulos reales — Cuerpo de Gestión de Sistemas y TI (A1) del BOE, «Ciberseguridad (EPSO/AD/430/26)», «Técnico/a Superior TIC (Grupo A2)» de ayuntamiento — más un caso negativo (corrección de errores de actividad administrativa, Subgrupo C1) que no debe coincidir con ninguna alerta. Todo en verde.

**GUI minimalista**: fuera logo, nombre y versión de la cabecera y del pie en las dos páginas (panel y estado del servicio); queda un título sobrio («Empleo público»), la navegación intacta y un pie de una línea («Sin telemetría · todo en local»). Tarjetas, campos, tablas y formularios: sin cambios (era lo que ya gustaba). `publico/logo.svg` eliminado; el favicon (icono neutro) se conserva. Cero cambios de API; en el CSS solo la regla `.marca-*` → `.marca-limpia` y la fila `.plantillas`.

## Bot verificable, DOGC con reintentos y pie fuera (v2.3.13)

Tres peticiones del usuario sobre la v2.3.12: verificar por qué «el bot no funciona» tras pegar el token, averiguar qué pasa con el «error 500» de la web de Cataluña y eliminar el pie «Sin telemetría · todo en local».

**Bot de Discord**: el módulo soporta dos modos — webhook por alerta o bot global — y el bot global exige **token Y canal** (`destinoDe`: token de ajustes/`DISCORD_BOT_TOKEN` + canal de la alerta, de `canalPorDefecto` o de `DISCORD_CANAL_ID`); con solo el token devolvía `{tipo: "ninguno"}` y no enviaba nada, sin ningún error visible. Ese era casi con certeza el fallo del usuario. Arreglo en dos capas: (1) endpoint `POST /api/discord/probar` que envía un mensaje de prueba real al canal por defecto y, si falta algo, responde 400 nombrando la pieza que falta (sin nada → «Sin bot configurado…»; sin token → «Falta el token del bot»; sin canal → «…con solo el token el bot no sabe a dónde escribir»); (2) botón «🔊 Probar bot» en Ajustes generales (fila compartida con «Guardar ajustes», regla `.botones-fila` nueva) y aviso automático bajo el campo de canal cuando hay token pero no canal. El proxy Squid ya permitía `discord.com`/`discordapp.com` y el cortafuegos de salida también: por red no estaba el problema. Verificado en E2E: 400 sin configurar, 400 «Falta el token» con canal-only, y restauración del canal a null para no contaminar el resto de la batería.

**DOGC «error 500»**: la URL que consultaba el usuario (`dogc.gencat.cat/ca/serveis/Consulta-del-DOGC/`) es la página pública del boletín; el parser no la usa — habla con la API interna `portaldogc.gencat.cat/eadop-rest/api/dogc` (`calendarDOGC` → `summaryDOGC`). Verificación en vivo desde el sandbox: la página del usuario responde 200, el sumari responde 200 y la API responde 200 en todas las variantes probadas (con y sin Referer/UA; `summaryDOGC` del DOGC 9784 del 30/10/2026, 35 KB). Conclusión: el 500 es **intermitencia del servicio EADOP de la Generalitat** (o su WAF contra la IP del servidor del usuario), no del cortafuegos ni del parser — ambos dominios ya estaban en `HOSTS_BASE` y en `proxy/dominios.list`. Mitigación: `postFormulario` acepta ahora `reintentos=N` (esperas crecientes 700 ms · 1,4 s; reintenta 5xx y fallos de red, nunca 4xx) y el DOGC lo usa con 2 reintentos en ambas llamadas; si aun así falla, el detalle del panel explica que el servicio de la Generalitat falla de forma intermitente, que no es el cortafuegos y que reintente la ingesta. El sumari es una SPA que llama a la misma API, así que no hay fallback HTML posible.

**Pie eliminado**: fuera la línea «Sin telemetría · todo en local · datos de los boletines oficiales» del panel y «Sin telemetría · todo en local» de la página de estado, y su regla `.pie` del CSS (`.pie-formulario` del diálogo de edición, que es otra cosa, se conserva).

**Persistencia de los ajustes web** (pregunta del usuario): sí — alertas, ajustes (incluidos token y canal), convocatorias y logs viven en SQLite dentro del volumen con nombre `opoalerta-data` montado en `/app/data` (v2.3.4); sobreviven a `docker compose down`, `up`, `restart` y `build` sin tocarlos. Solo `docker compose down -v` los borra (advertido en README) y la copia de seguridad es un contenedor alpine efímero sobre ese volumen (comando en README, «Tus datos»).

**Reversión (v2.3.14)**: el usuario pidió quitar los reintentos («olvida lo de los reintentos»; su prueba de cortafuegos salió fallida y el DOGC no le importa lo suficiente). `postFormulario` y el DOGC vuelven a su estado exacto de la v2.3.12 (sin parámetro `reintentos`, sin mensaje ampliado); el resto de la v2.3.13 — botón «Probar bot», endpoint `POST /api/discord/probar`, aviso token-sin-canal, pie eliminado — se conserva. Batería completa en verde tras la reversión.

## Cortafuegos de entrada: el panel solo se sirve a la red local (v2.3.3)

Nueva capa simétrica a la de salida: `servidor/cortafuegos.mjs` añade `permitirEntrada(ip)`, llamada al principio de cada petición HTTP (antes de procesar nada). Solo responden las IPs privadas — loopback (127/8, ::1), 10/8, 172.16/12 (redes Docker), 192.168/16, enlace local e IPv6 de enlace/ULA —; una IP pública recibe un 403 inmediato y el intento se registra en la consola del servidor. `CORTAFUEGOS_ENTRADA=lan` (por defecto) | `off`. Visible en `/api/estado` → `cortafuegos.entrada`.

Comprobaciones nuevas en `scripts/prueba-cortafuegos.mjs` (19): 11 IPs dentro (loopback v4/v6, LAN 192.168, 10/8, gateways Docker 172.16-31, IPv4 mapeada en IPv6, fe80, ULA fd, link-local) y 5 fuera (públicas v4, CGNAT 100.64/10, IPv6 global, vacía), más los interruptores `CORTAFUEGOS_ENTRADA=off` y por defecto con procesos hijos. Resultado: ✅ todo pasa (con la batería completa en verde, v2.3.3).

Por qué la publicación vuelve a `0.0.0.0`: con el filtro en la app como portero, la LAN entra sin tocar nada e inmune a cambios de IP por DHCP, y una IP pública no obtiene respuesta. Capa opcional más estricta: `PUERTO_PUBLICADO=<IP-LAN>` hace que Docker ni siquiera escuche en la interfaz pública. Todo es lógica de la app y publicación estándar de Docker: nada del sistema operativo.

## Permisos de datos: ./data → volumen con nombre (v2.3.4)

Problema real del bind mount `./data:/app/data` con contenedor sin privilegios: si `./data` no existía en el host, Docker la creaba **root:root** y la app (usuario `opoalerta`, uid de sistema de Alpine) no podía escribir su SQLite (SQLITE_CANTOPEN); crear la carpeta a mano tampoco bastaba salvo coincidencia exacta de uid. Solución estándar: **volumen con nombre** `opoalerta-data` (nombre explícito, estable entre carpetas y modos) en ambos compose — Docker lo inicializa con el dueño de `/app/data` de la imagen, que el Dockerfile ya crea con `mkdir + chown opoalerta` antes de `USER opoalerta` (v2.3.4). Sin comandos del host, sin tocar el SO.

Notas operativas documentadas en el README («Tus datos»): `docker compose down` conserva el volumen; `down -v` lo borra (advertido); copia de seguridad y restauración con un contenedor alpine efímero; migración de un `./data` antiguo en un solo comando. Alternativa bind mount documentada con su requisito de uid. No ejecutable en este sandbox (sin daemon de Docker); el comportamiento de inicialización de volúmenes con nombre es estándar de Docker (copy-on-first-use del contenido y dueño del directorio de la imagen).

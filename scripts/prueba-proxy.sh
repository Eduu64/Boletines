#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Verificación del MODO REFORZADO en tu servidor (requiere Docker):
#
#   docker compose -f docker-compose.reforzado.yml up -d --build
#   bash scripts/prueba-proxy.sh
#
# Comprueba que: los dominios de la lista alcanzan la red A TRAVÉS del proxy,
# los dominios fuera de la lista no salen, sin el proxy no hay salida directa
# (red internal) y el panel sigue visible por el puerto publicado.
#
# La prueba del panel es una ESCALERA DE DIAGNÓSTICO en 4 pasos (A→D): dice
# exactamente dónde se rompe la cadena host → puerto publicado → app:
#   A  la app responde DENTRO del contenedor (127.0.0.1:3000)
#   B  Docker publica el puerto (y en qué interfaz)
#   C  el host alcanza el puerto por loopback (127.0.0.1)
#   D  el host alcanza el puerto por su IP de la LAN (lo que hace tu navegador)
# Cada paso fallido imprime la causa probable y el comando de arreglo.
#
# Si algo falla, el script imprime EL DETALLE (salida real del comando) para
# poder ver la causa, y antes de empezar verifica que el stack está en marcha
# y que la app no esté en bucle de reinicios. Ejecútalo desde la carpeta del
# proyecto. Si Docker exige privilegios:  sudo bash scripts/prueba-proxy.sh
#
# Pega la salida COMPLETA (incluidos los bloques ┌──…└──) si pides ayuda.
# ─────────────────────────────────────────────────────────────────────────────
set -u
C="docker compose -f docker-compose.reforzado.yml"
PASAN=0; FALLAN=0
pasa() { PASAN=$((PASAN+1)); echo "✅ $1"; }
falla() { FALLAN=$((FALLAN+1)); echo "❌ $1"; }
detalle() { # imprime con sangría la salida real de un comando que falló
  if [ -s "$1" ]; then
    echo "   ┌── detalle (salida real del comando):"
    sed 's/^/   │ /' "$1"
    echo "   └──"
  fi
}
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# ─── Comprobaciones previas (no cuentan como pruebas) ────────────────────────
echo "── Comprobaciones previas"

if [ ! -f docker-compose.reforzado.yml ]; then
  echo "❌ No veo docker-compose.reforzado.yml aquí."
  echo "   Ejecuta el script desde la carpeta del proyecto:  cd opoalerta-docker && bash scripts/prueba-proxy.sh"
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "❌ No puedo hablar con Docker con este usuario (¿falta permiso?). Prueba:"
  echo "     sudo bash scripts/prueba-proxy.sh"
  echo "   o añade tu usuario al grupo docker:  sudo usermod -aG docker \$USER  (cierra sesión y vuelve)"
  exit 2
fi
echo "✅ Docker accesible y estamos en la carpeta del proyecto"

SERVICIOS=$($C ps --services --status running 2>/dev/null || $C ps --services 2>/dev/null || true)
if ! echo "$SERVICIOS" | grep -qx "opoalerta"; then
  echo "❌ El contenedor «opoalerta» NO está en marcha. Por eso fallarían las 5 pruebas."
  echo "   Esto es lo que Docker ve (incluidos contenedores parados):"
  $C ps -a 2>&1 | sed 's/^/   │ /'
  echo "   Últimas líneas del log de la app (la causa suele estar aquí):"
  $C logs --tail 25 opoalerta 2>&1 | sed 's/^/   │ /'
  echo
  echo "   Si aún no lo has lanzado (o el «up» dio error):"
  echo "     docker compose -f docker-compose.reforzado.yml up -d --build"
  echo "   Si el error del «up» habla de «container name /opoalerta already in use»:"
  echo "     tienes el compose NORMAL arrancado — páralo con «docker compose down»"
  echo "     (sin -f) y lanza de nuevo el reforzado."
  exit 2
fi
if ! echo "$SERVICIOS" | grep -qx "proxy"; then
  echo "⚠️  El contenedor «proxy» no está en marcha: las salidas por proxy fallarán."
  $C logs --tail 15 proxy 2>&1 | sed 's/^/   │ /'
fi
if ! echo "$SERVICIOS" | grep -qx "frontal"; then
  echo "⚠️  El contenedor «frontal» no está en marcha: el panel NO será accesible."
  echo "   (Si tu stack es anterior a v2.3.9 no tiene frontal o lo tiene sin filtro: actualiza y recrea:"
  echo "    docker compose -f docker-compose.reforzado.yml up -d --build --force-recreate)"
  $C logs --tail 15 frontal 2>&1 | sed 's/^/   │ /'
fi

# ¿La app está en bucle de reinicios? (con exec las pruebas de red pasarían
# igual, pero el panel estaría muerto: síntoma clásico «4 pasan y falla el panel»)
ESTADO=$(docker inspect -f '{{.State.Status}}|{{.RestartCount}}|{{.State.ExitCode}}|{{.State.OOMKilled}}' opoalerta 2>/dev/null || echo "?|?|?|?")
EST=$(echo "$ESTADO" | cut -d'|' -f1); REINICIOS=$(echo "$ESTADO" | cut -d'|' -f2)
SALIDA=$(echo "$ESTADO" | cut -d'|' -f3); OOM=$(echo "$ESTADO" | cut -d'|' -f4)
echo "✅ Contenedor «opoalerta»: estado=$EST reinicios=$REINICIOS última_salida=$SALIDA oom=$OOM"
echo "   · frontal: $(docker inspect -f '{{.State.Status}}' frontal 2>/dev/null || echo '¿no existe?') · proxy: $(docker inspect -f '{{.State.Status}}' proxy 2>/dev/null || echo '¿no existe?')"
if [ "$EST" = "restarting" ] || [ "${REINICIOS:-0}" -ge 3 ] 2>/dev/null; then
  echo "⚠️  La app se está REINICIANDO EN BUCLE: el panel no funcionará aunque el resto pase."
  echo "   Últimas líneas del log (la causa del reinicio está aquí):"
  $C logs --tail 30 opoalerta 2>&1 | sed 's/^/   │ /'
  echo
fi
echo

echo "── Pruebas"

# 0) El proxy está sano (proceso vivo y configuración válida)
if $C exec -T proxy squid -k check >"$TMP" 2>&1; then
  pasa "proxy Squid en marcha y con la configuración válida"
else
  falla "proxy Squid no responde (las salidas por proxy fallarán)"
  detalle "$TMP"
fi

# 1) Dominio de la lista a través del proxy: el BOE responde
if $C exec -T opoalerta node -e "fetch('https://www.boe.es/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >"$TMP" 2>&1; then
  pasa "salida por proxy a www.boe.es (dominio de la lista)"
else
  falla "salida por proxy a www.boe.es"
  detalle "$TMP"
fi

# 2) Discord a través del proxy: endpoint público de su API
if $C exec -T opoalerta node -e "fetch('https://discord.com/api/v10/gateway').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >"$TMP" 2>&1; then
  pasa "salida por proxy a discord.com (los avisos funcionarán)"
else
  falla "salida por proxy a discord.com"
  detalle "$TMP"
fi

# 3) Dominio FUERA de la lista: el túnel se deniega (2 capas: app + red)
if $C exec -T opoalerta node -e "fetch('https://example.com/').then(()=>process.exit(1)).catch(()=>process.exit(0))" >"$TMP" 2>&1; then
  pasa "dominio fuera de la lista (example.com) bloqueado"
else
  falla "example.com NO debería ser alcanzable"
  detalle "$TMP"
fi

# 4) Sin el proxy no hay salida directa (red internal: true)
if $C exec -T -e NODE_USE_ENV_PROXY=0 -e HTTPS_PROXY= -e HTTP_PROXY= opoalerta node -e "fetch('https://www.boe.es/').then(()=>process.exit(1)).catch(()=>process.exit(0))" >"$TMP" 2>&1; then
  pasa "sin proxy no hay salida directa (red sin internet)"
else
  falla "hay salida directa sin proxy (revisar las redes del compose)"
  detalle "$TMP"
fi

# ─── 5) El panel visible: escalera de diagnóstico A → D ──────────────────────
PUERTO=${PUERTO:-}
if [ -z "$PUERTO" ] && [ -f .env ]; then
  PUERTO=$(sed -n 's/^PUERTO=//p' .env | head -1 | tr -d '[:space:]')
fi
PUERTO=${PUERTO:-3000}
PUB=$(sed -n 's/^PUERTO_PUBLICADO=//p' .env 2>/dev/null | head -1 | tr -d '[:space:]')
PUB=${PUB:-0.0.0.0}
curl_inseguro() { # curl sin proxy del entorno (un http_proxy del shell daba falsos fallos)
  if command -v curl >/dev/null 2>&1; then
    curl --noproxy '*' -s -m 8 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null
  else
    if wget --no-proxy -q -T 8 -O /dev/null "$1" 2>/dev/null; then echo 200; else echo 000; fi
  fi
}

echo
echo "── 5) Panel en el puerto publicado (diagnóstico A→D)"

# A) ¿Responde la app DENTRO del contenedor? (lo mismo que su healthcheck)
if $C exec -T opoalerta wget -q -T 8 -O /dev/null "http://127.0.0.1:3000/api/health" >"$TMP" 2>&1; then
  echo "✅ A · la app responde dentro del contenedor (127.0.0.1:3000/api/health)"
  PASO_A=1
else
  echo "❌ A · la app NO responde DENTRO del contenedor → nada de lo de fuera puede funcionar"
  detalle "$TMP"
  echo "   ┌── línea de escucha en el log (debe existir: «servidor web escuchando en http://0.0.0.0:3000»):"
  $C logs opoalerta 2>&1 | grep -i "escuchando" | tail -2 | sed 's/^/   │ /'
  echo "   └── últimos 30 renglones del log de la app (la causa suele estar aquí):"
  $C logs --tail 30 opoalerta 2>&1 | sed 's/^/   │ /'
  PASO_A=0
fi

# B) ¿Docker publica el puerto del FRONTAL? ¿En qué interfaz? («docker compose
#    port» tiene un bug que responde «:0»; docker inspect es la fuente fiable.
#    El dueño de la publicación es el frontal: la app vive en una red interna
#    y Docker no publica puertos de redes internas — moby/moby#53256)
PUBLICACION=$($C port frontal 3000 2>/dev/null | head -1)
PUBREAL=$(docker inspect -f '{{range $p, $b := .NetworkSettings.Ports}}{{$p}} ← {{range $b}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' frontal 2>/dev/null)
if [ -n "$PUBLICACION" ] && ! echo "$PUBLICACION" | grep -q ':0$'; then
  echo "✅ B · Docker publica el puerto (frontal) como: $PUBLICACION"
  PASO_B=1
elif [ -n "$PUBREAL" ]; then
  echo "✅ B · publicación real (docker inspect): $PUBREAL   [«compose port» dijo «${PUBLICACION:-nada}»: bug de compose]"
  PASO_B=1
else
  echo "❌ B · Docker NO publica el puerto 3000 (debería hacerlo el «frontal»)"
  echo "   · estado del frontal: $(docker inspect -f '{{.State.Status}}' frontal 2>/dev/null || echo '¿no existe? (stack anterior a v2.3.9?)')"
  $C logs --tail 15 frontal 2>&1 | sed 's/^/   │ /'
  PASO_B=0
fi

# C) ¿Lo alcanza el propio host por loopback?
CODIGO_C=$(curl_inseguro "http://127.0.0.1:${PUERTO}/api/health")
if [ "$CODIGO_C" = "200" ]; then
  echo "✅ C · el host alcanza http://127.0.0.1:${PUERTO} (HTTP 200)"
  PASO_C=1
else
  echo "❌ C · el host NO alcanza http://127.0.0.1:${PUERTO} (curl: ${CODIGO_C:-000})"
  PASO_C=0
fi

# D) ¿Lo alcanza la IP de la LAN del servidor? (lo que hace tu navegador)
IPLAN=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$IPLAN" ]; then
  IPLAN=$(ip -4 addr show scope global 2>/dev/null | awk '/inet /{print $2; exit}' | cut -d/ -f1)
fi
if [ -n "$IPLAN" ]; then
  CODIGO_D=$(curl_inseguro "http://${IPLAN}:${PUERTO}/api/health")
  if [ "$CODIGO_D" = "200" ]; then
    echo "✅ D · la IP de LAN ${IPLAN}:${PUERTO} responde (HTTP 200) — tu navegador debería entrar"
    PASO_D=1
  else
    echo "❌ D · la IP de LAN ${IPLAN}:${PUERTO} NO responde (curl: ${CODIGO_D:-000})"
    PASO_D=0
  fi
else
  echo "⚠️  D · no pude averiguar la IP de LAN del servidor; paso omitido"
  PASO_D=-1
fi

# ── Diagnóstico extra del paso C: ¿dónde se rompe host → contenedor? ─────────
# Salta docker-proxy y el DNAT: conecta al FRONTAL y a la app por su IP.
if [ "$PASO_C" = "0" ] && [ "$PASO_A" = "1" ]; then
  echo
  echo "── Diagnóstico extra del paso C (host → contenedores, saltando la publicación)"
  echo "· Publicación real (docker inspect, frontal): ${PUBREAL:-NINGUNA}"
  if [ -z "$PUBREAL" ]; then
    echo "   → NADA está publicado: Docker no publica puertos de contenedores que"
    echo "     solo están en redes «internal: true» (comportamiento oficial de Docker:"
    echo "     moby/moby#53256). La v2.3.8 añadió el «frontal» que lo resuelve:"
    echo "       docker compose -f docker-compose.reforzado.yml up -d --build --force-recreate"
  else
    IPFRONTAL=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' frontal 2>/dev/null | awk '{print $1}')
    IPOPO=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' opoalerta 2>/dev/null)
    CODIGO_X=$(curl_inseguro "http://${IPFRONTAL}:3000/api/health")
    if [ "$CODIGO_X" = "200" ]; then
      echo "✅ X · el host SÍ llega DIRECTO al frontal http://${IPFRONTAL}:3000 (HTTP 200)"
      echo "   → Frontal y ruta OK: la rotura está SOLO en la capa de publicación"
      echo "     (docker-proxy / reglas iptables de Docker). Suele bastar:"
      echo "       sudo systemctl restart docker"
      echo "       docker compose -f docker-compose.reforzado.yml up -d"
      echo "     Si se repite: revisa cadenas manuales →  sudo iptables-save | grep -i docker-user"
    else
      echo "❌ X · el host NO llega DIRECTO al frontal http://${IPFRONTAL}:3000 (curl: ${CODIGO_X:-000})"
      RUTA=$(ip route get "$IPFRONTAL" 2>/dev/null | head -1)
      echo "· Ruta del host hacia ${IPFRONTAL}: ${RUTA:-no disponible (¿falta el comando ip?)}"
      case "$RUTA" in
        *"dev br-")
          echo "   → La ruta es correcta (bridge de Docker) y aún así no llega: un"
          echo "     cortafuegos del host está filtrando (ufw/firewalld/OUTPUT)."
          ;;
        *"dev ")
          echo "   → ⚠️ LA RUTA NO VA POR UN BRIDGE DE DOCKER: otra interfaz captura ese"
          echo "     tráfico (una VPN, otra red del host en 172.x…). COLISIÓN DE SUBRED:"
          echo "     dentro de Docker todo funciona; desde el host, nada. Pega «ip -br addr»."
          ;;
        *)
          echo "   → No pude determinar la ruta; pega «ip -br addr» y «ip route»."
          ;;
      esac
      if [ -n "$IPOPO" ]; then
        CODIGO_Y=$(curl_inseguro "http://${IPOPO}:3000/api/health")
        if [ "$CODIGO_Y" = "200" ]; then
          echo "✅ Y · el host sí llega directo a la APP (http://${IPOPO}:3000 → 200): el problema"
          echo "     es solo el FRONTAL (¿caído?). Mira:  $C logs --tail 30 frontal"
        else
          echo "❌ Y · tampoco llega directo a la app (http://${IPOPO}:3000 → ${CODIGO_Y:-000}):"
          echo "     la rotura es de red del host (ruta/cortafuegos), no de la publicación."
        fi
      fi
    fi
    ESCUCHA=$(ss -tln 2>/dev/null | grep -E "[:.]${PUERTO}[[:space:]]" || true)
    if [ -n "$ESCUCHA" ]; then
      echo "· Escuchando en el puerto ${PUERTO} del host: $(echo "$ESCUCHA" | head -2 | tr '\n' ' ')"
    else
      echo "· NADA escucha en el puerto ${PUERTO} del host: si la publicación real existe,"
      echo "  rearma las reglas con  sudo systemctl restart docker"
    fi
  fi
fi

# Veredicto con la causa y el arreglo
echo
if [ "$PASO_A" = "0" ]; then
  falla "panel caído: la app no responde ni dentro del contenedor (paso A)"
  echo "   → La causa está en el LOG de arriba (paso A). Causas típicas:"
  echo "     · «no se pudo preparar la base de datos» → volumen sin permisos:"
  echo "       docker compose -f docker-compose.reforzado.yml down"
  echo "       docker volume rm opoalerta-data   # ⚠️ borra la BD (volumen recién creado, sin datos aún)"
  echo "       docker compose -f docker-compose.reforzado.yml up -d --build"
  echo "     · reinicios con otra causa → pega el bloque del log para verla."
elif [ "$PASO_B" = "0" ]; then
  falla "panel inaccesible: la app está viva pero NADA publica el puerto (paso B)"
  echo "   → En el modo reforzado el puerto lo publica el contenedor «frontal» (mira"
  echo "     su estado y su log más arriba). Si tu stack es ANTERIOR a v2.3.9 no"
  echo "     tiene frontal: actualiza el proyecto y recrea (TUS DATOS NO SE TOCAN,"
  echo "     el volumen se conserva):"
  echo "       docker compose -f docker-compose.reforzado.yml up -d --build --force-recreate"
  echo "     Si el frontal está y aun así no publica: revisa PUERTO y PUERTO_PUBLICADO del .env."
elif [ "$PASO_C" = "0" ]; then
  falla "panel inaccesible: app viva y puerto publicado, pero el host no llega (paso C)"
  echo "   → El bloque «Diagnóstico extra del paso C» de arriba distingue los casos:"
  echo "     1) NADA publicado → stack anterior a v2.3.9 (sin frontal): actualiza y recrea."
  echo "     2) el host SÍ llega directo al FRONTAL → capa de publicación de Docker:"
  echo "        sudo systemctl restart docker y luego up -d."
  echo "     3) el host NO llega al frontal y la ruta no va por un bridge → COLISIÓN de"
  echo "        subred (una VPN u otra red usa el mismo 172.x): mover una de las dos."
  echo "     4) el host NO llega y la ruta SÍ va por el bridge → cortafuegos del host"
  echo "        (ufw/firewalld/OUTPUT) filtrando hacia los contenedores."
  echo "     · Si PUERTO_PUBLICADO=<IP> apunta a una IP que ya no es la del servidor"
  echo "       (DHCP): sed -i 's/^PUERTO_PUBLICADO=.*/PUERTO_PUBLICADO=0.0.0.0/' .env"
  echo "       y recrea: docker compose -f docker-compose.reforzado.yml up -d --force-recreate"
elif [ "$PASO_D" = "0" ]; then
  falla "panel accesible solo desde el propio servidor, no desde la LAN (paso D)"
  echo "   → Loopback responde (C ✅) pero ${IPLAN}:${PUERTO} no. Causas típicas:"
  echo "     · PUERTO_PUBLICADO=127.0.0.1 en el .env (resto de una versión antigua):"
  echo "         sed -i 's/^PUERTO_PUBLICADO=.*/PUERTO_PUBLICADO=0.0.0.0/' .env"
  echo "         docker compose -f docker-compose.reforzado.yml up -d --force-recreate"
  echo "     · Un cortafuegos del HOST (ufw/firewalld) filtrando la interfaz LAN:"
  echo "         sudo ufw status verbose   # o el equivalente de tu sistema"
  echo "     · El .env dice PUERTO_PUBLICADO=${PUB}: Docker publicó «$PUBLICACION»."
elif [ "$PASO_D" = "1" ] && [ "$PASO_C" = "1" ] && [ "$PASO_B" = "1" ] && [ "$PASO_A" = "1" ]; then
  pasa "panel accesible en el puerto ${PUERTO} (loopback y LAN; tu navegador entrará por http://${IPLAN}:${PUERTO})"
else
  falla "diagnóstico del panel incompleto (revisa los pasos A–D de arriba)"
  echo "   → Pega la salida completa del script (bloques ┌──…└── incluidos)."
fi

echo
echo "RESULTADO: $PASAN pasan, $FALLAN fallan"
if [ "$FALLAN" -gt 0 ]; then
  echo "Si pides ayuda: pega la salida COMPLETA de este script (los bloques ┌──…└── son la clave)."
fi
exit $FALLAN

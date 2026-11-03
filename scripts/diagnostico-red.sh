#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Diagnóstico de red del MODO REFORZADO, capa por capa (v2.3.21).
#
#   bash scripts/diagnostico-red.sh
#
# Para cuando la ingesta dice «fetch failed» y los 3 contenedores están
# healthy: comprueba EN ORDEN cada eslabón y dice exactamente cuál falla y
# cómo arreglarlo. No cambia nada: solo lee y prueba conexiones.
#
# Eslabones:
#   1. host → internet (¿el servidor tiene salida? ¿resuelve DNS el host?)
#   2. app → proxy (¿la app ve la variable de proxy? ¿llega al puerto 3128?)
#   3. proxy → DNS (¿Squid puede resolver nombres?)
#   4. proxy → internet (¿el contenedor del proxy tiene ruta al 443?)
#   5. camino completo app → proxy → boe.es (lo que hace la ingesta)
#
# Si pides ayuda, pega la salida COMPLETA del script.
# ─────────────────────────────────────────────────────────────────────────────
set -u
C="docker compose -f docker-compose.reforzado.yml"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

verde()  { echo "✅ $1"; }
rojo()   { echo "❌ $1"; }
aviso()  { echo "⚠️  $1"; }
paso()   { echo; echo "── $1"; }
detalle(){ if [ -s "$1" ]; then echo "   ┌── salida real:"; sed 's/^/   │ /' "$1"; echo "   └──"; fi; }

echo "═══ Diagnóstico de red · OpoAlerta modo reforzado ═══"

if [ ! -f docker-compose.reforzado.yml ]; then
  echo "❌ No veo docker-compose.reforzado.yml aquí."
  echo "   Ejecútalo desde la carpeta del proyecto:  cd opoalerta-docker && bash scripts/diagnostico-red.sh"
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker no responde a este usuario. Prueba:  sudo bash scripts/diagnostico-red.sh"
  exit 2
fi

# ─── 0. Stack en marcha ──────────────────────────────────────────────────────
paso "0 · Contenedores"
for N in opoalerta opoalerta-proxy opoalerta-frontal; do
  EST=$(docker inspect -f '{{.State.Status}} (reinicios: {{.RestartCount}})' "$N" 2>/dev/null || echo "NO EXISTE")
  if [ "$EST" = "NO EXISTE" ]; then rojo "$N: $EST — ¿arrancaste con docker compose -f docker-compose.reforzado.yml up -d --build?"; else verde "$N: $EST"; fi
done

# ─── 1. Host → internet ─────────────────────────────────────────────────────
paso "1 · El HOST tiene salida a internet"
if curl -sI --max-time 8 https://www.boe.es -o "$TMP" 2>&1; then
  verde "el host alcanza https://www.boe.es ($(head -1 "$TMP" | tr -d '\r'))"
else
  rojo "el PROPIO SERVIDOR no alcanza www.boe.es — el problema NO es OpoAlerta:"
  echo "   · ¿el servidor tiene internet? prueba:  curl -sI https://www.google.com"
  echo "   · ¿tu router/ISP/proveedor bloquea o filtra? (VPN, firewall del router, CGNAT…)"
  detalle "$TMP"
fi
if curl -sI --max-time 8 https://discord.com -o "$TMP" 2>&1; then
  verde "el host alcanza https://discord.com"
else
  aviso "el host no alcanza discord.com (los avisos a Discord fallarán aunque la ingesta funcione)"
fi

# ─── 2. App → proxy ─────────────────────────────────────────────────────────
paso "2 · La APP ve el proxy (variables y puerto)"
ENVPROXY=$(docker exec opoalerta env 2>/dev/null | grep -E "^(HTTP_PROXY|HTTPS_PROXY|NO_PROXY|NODE_USE_ENV_PROXY)=" || true)
if [ "$(echo "$ENVPROXY" | grep -c HTTPS_PROXY)" -ge 1 ] && echo "$ENVPROXY" | grep -q "NODE_USE_ENV_PROXY=1"; then
  verde "variables de proxy presentes en la app:"
  echo "$ENVPROXY" | sed 's/^/   │ /'
else
  rojo "la app NO tiene las variables del proxy (NODE_USE_ENV_PROXY / HTTP_PROXY / HTTPS_PROXY)"
  echo "   Causa típica: el contenedor se creó con el compose NORMAL o una versión vieja."
  echo "   Arreglo:  docker compose -f docker-compose.reforzado.yml up -d --build --force-recreate"
fi
if docker exec opoalerta node -e "fetch('http://proxy:3128',{signal:AbortSignal.timeout(5000)}).then(r=>{console.log('HTTP',r.status);process.exit(0)}).catch(e=>{console.log('FALLO',e.cause?.code||e.message);process.exit(1)})" >"$TMP" 2>&1; then
  verde "la app llega al puerto 3128 del proxy ($(cat "$TMP" | tr -d '\n') — cualquier respuesta HTTP vale: el puerto está abierto)"
else
  rojo "la app NO llega al proxy ($(cat "$TMP" | tr -d '\n'))"
  echo "   Si dice ENOTFOUND/EAI_AGAIN: la app no resuelve el nombre «proxy» → redes del compose mal creadas:"
  echo "     docker compose -f docker-compose.reforzado.yml down && docker compose -f docker-compose.reforzado.yml up -d --build"
  echo "   Si dice ECONNREFUSED: el proxy no escucha → mira el paso 3."
fi

# ─── 3. Proxy → DNS ─────────────────────────────────────────────────────────
paso "3 · El PROXY resuelve nombres (DNS)"
if docker exec opoalerta-proxy nslookup www.boe.es >"$TMP" 2>&1; then
  verde "DNS del contenedor proxy OK ($(grep -m1 -A1 "Name" "$TMP" | tr -d '\n' | sed 's/  */ /g'))"
else
  rojo "el contenedor del proxy NO resuelve nombres — esta es la causa más probable de todos los «fetch failed»:"
  detalle "$TMP"
  echo "   Suele ser el DNS del host roto o filtrado (systemd-resolved, Pi-Hole, firewall del router que"
  echo "   bloquea DNS externo). Prueba en el host:  resolvectl status | head -5 ; nslookup www.boe.es"
  echo "   Arreglo rápido: añade DNS públicos al proxy en docker-compose.reforzado.yml, servicio «proxy»:"
  echo "     dns: [1.1.1.1, 9.9.9.9]     # y luego: docker compose -f docker-compose.reforzado.yml up -d --force-recreate proxy"
fi

# ─── 4. Proxy → internet ────────────────────────────────────────────────────
paso "4 · El contenedor del PROXY tiene ruta a internet (TCP 443)"
if docker exec opoalerta-proxy sh -c 'nc -z -w 6 www.boe.es 443' >"$TMP" 2>&1; then
  verde "el proxy conecta con www.boe.es:443"
else
  rojo "el contenedor del proxy NO puede abrir conexiones al 443 externo"
  detalle "$TMP"
  echo "   Si el paso 1 (host) sí funcionó, esto casi siempre es el FIREWALL del host bloqueando el"
  echo "   tráfico NAT de los contenedores (ufw/firewalld). Comprueba:  sudo ufw status verbose"
  echo "   Con ufw, la salida de los contenedores se arregla permitiendo el reenvío o recreando las"
  echo "   redes con Docker parado:  sudo ufw allow out on docker0 ; o revisa DEFAULT_FORWARD_POLICY."
fi

# ─── 5. Camino completo (lo que hace la ingesta) ─────────────────────────────
paso "5 · Camino COMPLETO app → proxy → www.boe.es (igual que la ingesta)"
if docker exec opoalerta node -e "fetch('https://www.boe.es/datosabiertos/api/boe/sumario/20260102',{signal:AbortSignal.timeout(15000)}).then(r=>{console.log('HTTP',r.status);process.exit(0)}).catch(e=>{console.log('FALLO',e.message,'·',e.cause?.code||e.cause?.message||'');process.exit(1)})" >"$TMP" 2>&1; then
  verde "la ingesta debería funcionar ($(cat "$TMP" | tr -d '\n')). Si aún falla, vuelve a lanzar una ingesta desde el panel."
else
  rojo "el camino completo falla: $(cat "$TMP" | tr -d '\n')"
  echo "   Interpreta la causa entre paréntesis:"
  echo "   · ECONNREFUSED <ip>:3128 → el Squid no vive en esa IP (paso 3/4 y recrea el stack)"
  echo "   · ENOTFOUND / EAI_AGAIN → DNS roto DENTRO de la app o del proxy (paso 3)"
  echo "   · UND_ERR_CONNECT_TIMEOUT / ETIMEDOUT → el proxy no puede salir al 443 (paso 4, firewall)"
  echo "   · HTTP 403 en el CONNECT → la lista blanca no contiene el dominio (¿dominios.list viejo?)"
  echo "     Arreglo: docker compose -f docker-compose.reforzado.yml up -d --build --force-recreate"
fi

echo
echo "═══ Fin del diagnóstico — pega esta salida completa si pides ayuda ═══"

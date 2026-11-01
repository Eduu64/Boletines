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
# ─────────────────────────────────────────────────────────────────────────────
set -u
C="docker compose -f docker-compose.reforzado.yml"
PASAN=0; FALLAN=0
pasa() { PASAN=$((PASAN+1)); echo "✅ $1"; }
falla() { FALLAN=$((FALLAN+1)); echo "❌ $1"; }

if ! $C ps >/dev/null 2>&1; then
  echo "El stack no está en marcha. Lanza antes:"
  echo "  docker compose -f docker-compose.reforzado.yml up -d --build"
  exit 2
fi

# 1) Dominio de la lista a través del proxy: el BOE responde
if $C exec -T opoalerta node -e "fetch('https://www.boe.es/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  pasa "salida por proxy a www.boe.es (dominio de la lista)"
else
  falla "salida por proxy a www.boe.es"
fi

# 2) Discord a través del proxy: endpoint público de su API
if $C exec -T opoalerta node -e "fetch('https://discord.com/api/v10/gateway').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  pasa "salida por proxy a discord.com (los avisos funcionarán)"
else
  falla "salida por proxy a discord.com"
fi

# 3) Dominio FUERA de la lista: el túnel se deniega (2 capas: app + red)
if $C exec -T opoalerta node -e "fetch('https://example.com/').then(()=>process.exit(1)).catch(()=>process.exit(0))" >/dev/null 2>&1; then
  pasa "dominio fuera de la lista (example.com) bloqueado"
else
  falla "example.com NO debería ser alcanzable"
fi

# 4) Sin el proxy no hay salida directa (red internal: true)
if $C exec -T -e NODE_USE_ENV_PROXY=0 -e HTTPS_PROXY= -e HTTP_PROXY= opoalerta node -e "fetch('https://www.boe.es/').then(()=>process.exit(1)).catch(()=>process.exit(0))" >/dev/null 2>&1; then
  pasa "sin proxy no hay salida directa (red sin internet)"
else
  falla "hay salida directa sin proxy (revisar las redes del compose)"
fi

# 5) El panel sigue visible desde el host (puerto publicado de la red interna)
if curl -s -m 8 -o /dev/null "http://127.0.0.1:${PUERTO:-3000}/api/health"; then
  pasa "panel accesible en el puerto publicado (tu LAN lo sigue viendo)"
else
  falla "panel no accesible en el puerto publicado"
fi

echo
echo "RESULTADO: $PASAN pasan, $FALLAN fallan"
exit $FALLAN

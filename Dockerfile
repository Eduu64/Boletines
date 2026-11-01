# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# OpoAlerta Docker v2.3.6 · imagen minimalista
# · Sin build: el código se ejecuta tal cual (Node puro, cero dependencias npm)
# · node:24-alpine (LTS): trae node:sqlite estable integrado
# · Un solo proceso: servidor HTTP + programador + SQLite (node:sqlite)
# · Ajustes de RAM: heap viejo limitado (160 MB) y semiespacio pequeña (2 MB),
#   que recortan ~20 MB de RSS en una app de este tamaño sin perder rendimiento
# ─────────────────────────────────────────────────────────────────────────────

FROM node:24-alpine

WORKDIR /app

# tzdata para la zona horaria de las ingestas; wget para el healthcheck
RUN apk add --no-cache tzdata

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/data/opoalerta.db \
    ZONA_HORARIA=Europe/Madrid \
    NODE_OPTIONS=--max-old-space-size=160 --max-semi-space-size=2

# usuario no privilegiado
RUN addgroup -S opoalerta && adduser -S opoalerta -G opoalerta

# Solo lo que se ejecuta (~1 MB de código): sin node_modules (no existen),
# sin CLI de Prisma, sin React, sin build, sin scripts de prueba.
COPY servidor ./servidor
COPY publico ./publico
COPY package.json ./

RUN mkdir -p /app/data && chown -R opoalerta:opoalerta /app

USER opoalerta
VOLUME /app/data
EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=8s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "servidor/indice.mjs"]

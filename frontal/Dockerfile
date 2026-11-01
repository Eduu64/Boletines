# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# OpoAlerta Docker v2.3.9 · imagen del FRONTAL del panel (modo reforzado)
#
# ¿Por qué existe? Docker NO puede publicar puertos de un contenedor que solo
# está en redes «internal: true»: los puertos publicados se instalan a través
# de la red de puerta de enlace del contenedor y una red interna no tiene
# ninguna — la configuración se acepta pero no se publica nada
# (NetworkSettings.Ports queda vacía; comportamiento oficial confirmado por
# los mantenedores: moby/moby#53256).
#
# Este frontal es la puerta de ENTRADA: recibe el puerto publicado en el host,
# comprueba la IP real del visitante con el MISMO cortafuegos de entrada que
# la app (permitirEntrada, de servidor/cortafuegos.mjs — una IP pública de
# internet recibe un 403 aquí, antes de tocar la app) y reenvía la conexión a
# opoalerta:3000. No ejecuta código de la app, no guarda nada y no necesita
# internet. Comparte la base node:24-alpine con la app (cero disco extra más
# allá de su archivo) y corre como usuario sin privilegios.
#
# Se construye con: docker compose -f docker-compose.reforzado.yml up -d --build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine

WORKDIR /app

# tzdata para la zona horaria de los logs; wget (busybox) para el healthcheck
RUN apk add --no-cache tzdata

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DESTINO_HOST=opoalerta \
    DESTINO_PUERTO=3000 \
    TZ=Europe/Madrid

# Solo dos archivos: el frontal y el módulo compartido del cortafuegos
COPY servidor/cortafuegos.mjs ./servidor/cortafuegos.mjs
COPY frontal/frontal.mjs ./frontal/frontal.mjs

# El usuario «node» ya existe en la imagen base (uid 1000)
USER node

EXPOSE 3000

CMD ["node", "frontal/frontal.mjs"]

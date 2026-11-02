# Imagen mínima del proxy interno de OpoAlerta (modo reforzado).
# Squid en Alpine: ~7 MB instalados y ~20-25 MB de RAM en marcha.
# Se construye con: docker compose -f docker-compose.reforzado.yml up -d --build
FROM alpine:3.20

RUN apk add --no-cache squid \
 && mkdir -p /var/cache/squid /var/log/squid /var/run/squid \
 && chown -R squid:squid /var/cache/squid /var/log/squid /var/run/squid

COPY squid.conf dominios.list /etc/squid/

# v2.3.17: el pid file residual del arranque anterior metía a Squid en un
# bucle de reinicio («Squid is already running … pid file /tmp/squid.pid with
# pid 1»). Este script lo borra antes de arrancar (ver proxy/entrada.sh).
COPY entrada.sh /etc/squid/entrada.sh

EXPOSE 3128
USER squid
CMD ["sh", "/etc/squid/entrada.sh"]

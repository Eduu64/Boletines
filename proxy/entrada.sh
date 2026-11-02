# Entrada del contenedor proxy (v2.3.17).
#
# BUG corregido: tras un reinicio del contenedor (docker restart, reinicio del
# daemon, apagón con restart: unless-stopped…), Squid moría en bucle con
#   «Instance.cc(122) ThrowIfAlreadyRunningWith … Squid is already running:
#    Found fresh instance pid file (/tmp/squid.pid) with pid 1»
# Motivo: la capa escribible del contenedor SOBREVIVE al reinicio (solo se
# borra al recrerar el contenedor). El pid file del arranque anterior quedaba
# en /tmp con el pid 1 (aquí Squid es el proceso 1 del contenedor); el Squid
# nuevo nacía otra vez como pid 1, leía el fichero viejo, comprobaba si había
# un proceso vivo con ese pid —sí: él mismo— y moría por «ya hay otro Squid».
# Docker lo relanzaba… y el ciclo se repetía para siempre. De paso, con el
# proxy en bucle toda la salida de la app (Discord incluido) fallaba con
# «Sin conexión con Discord: fetch failed».
#
# Solución: borrar los pid files residuales ANTES de arrancar. En este
# contenedor no puede haber otro Squid (el CMD es el único proceso), así que
# el borrado es siempre seguro; el healthcheck («squid -k check») sigue
# funcionando porque el Squid vivo deja su pid file recién arrancado.
rm -f /tmp/squid.pid /var/run/squid/*.pid 2>/dev/null || true

# exec: Squid se convierte en el proceso principal (pid 1) y recibe las
# señales de Docker (stop funciona como debe).
exec squid -N -f /etc/squid/squid.conf

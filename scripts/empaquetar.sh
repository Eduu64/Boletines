# Empaquetado de OpoAlerta Docker → zip listo para desplegar.
# Uso: bash scripts/empaquetar.sh            (crea dist/opoalerta-docker-vX.Y.Z.zip)
#      DESTINO=/ruta bash scripts/empaquetar.sh   (otra carpeta de salida)
set -e
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(dirname "$AQUI")"
DESTINO="${DESTINO:-$RAIZ/dist}"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$RAIZ/package.json')).version")"

# La app no necesita node_modules (cero dependencias); se excluyen datos
# locales, git, archivos de entorno real y zips previos. Los fixtures de
# pruebas SÍ van dentro.
mkdir -p "$DESTINO"
cd "$RAIZ"
rm -f "$DESTINO/opoalerta-docker-v$VERSION.zip"
zip -r "$DESTINO/opoalerta-docker-v$VERSION.zip" . \
  -x "data/*" "dist/*" ".git/*" "node_modules/*" ".env" "*.log" "*.zip" > /dev/null

echo "Empaquetado: $DESTINO/opoalerta-docker-v$VERSION.zip"
ls -lh "$DESTINO/opoalerta-docker-v$VERSION.zip"

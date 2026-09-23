# Imagen local trusted para bootstrap de helpers

Esta receta construye una imagen de operador local para ejecutar el instalador
Docker-only sin depender del Python del host. No es una imagen publicada ni
certifica una instalación legacy o servicios Treseko. El instalador sigue
validando firma, checksum, tamaño y estructura del paquete entrante antes de
crear backend versionado o wrappers; el Dockerfile sólo contiene código
confiable del bootstrap y sus dependencias.

## Build reproducible local

Usa una etiqueta base explícita, nunca `latest`, y una etiqueta local única:

```bash
BASE_TAG=python:3.12-slim-bookworm
COMPOSE_TAG=docker/compose-bin:v5.4.0
LOCAL_TAG=treseko-helper-bootstrap:local-$(uuidgen | tr '[:upper:]' '[:lower:]')
docker build \
  --build-arg BASE_IMAGE="$BASE_TAG" \
  --build-arg COMPOSE_IMAGE="$COMPOSE_TAG" \
  -f scripts/update-runtime/bootstrap/Dockerfile \
  -t "$LOCAL_TAG" .
```

El contexto debe ser el checkout confiable que contiene únicamente los
ficheros `COPY` de la receta; la receta no hace `COPY .`, no copia `.env`,
paquetes de actualización ni artefactos de usuario. Antes de usar la imagen,
inspecciona y registra localmente el ID resuelto:

```bash
docker image inspect --format '{{.Id}}' "$LOCAL_TAG" | tee .treseko-helper-bootstrap-image-id
docker image inspect --format '{{.Id}}' "$BASE_TAG"
docker image inspect --format '{{.Id}}' "$COMPOSE_TAG"
docker image inspect --format '{{json .RepoDigests}}' "$LOCAL_TAG"
docker run --rm --entrypoint /usr/local/bin/python "$LOCAL_TAG" -c \
  'import sys; print(sys.version); import docker, cryptography, sqlalchemy'
docker run --rm --entrypoint /bin/sh "$LOCAL_TAG" -c \
  'command -v docker; docker --version; docker compose version; command -v ssh; ssh -V'
docker run --rm --entrypoint /usr/local/bin/python "$LOCAL_TAG" -c \
  'import asyncio; from sqlalchemy.ext.asyncio import create_async_engine; exec("async def f():\n e=create_async_engine(\"postgresql+asyncpg://bootstrap_user@127.0.0.1/bootstrap_db\")\n await e.dispose()") ; asyncio.run(f())'
```

El archivo de ID y cualquier salida de `inspect` son evidencia local del build,
no un digest publicado. Un operador debe pasar al bootstrap una referencia
inmutable ya inspeccionada (`repo@sha256:...` o `sha256:...`) y el Docker CLI y
socket autorizados explícitamente. La CLI Linux incluida es la que usan los
helpers dentro de la imagen; el CLI exterior sólo controla el contenedor.

La allowlist Python está en
`scripts/update-runtime/bootstrap/helper-modules.txt` y se refleja en las
instrucciones `COPY` explícitas. Incluye los tres helpers actuales y los
módulos importables del cuarto `host_bridge`, pero no lo habilita en
`HelperInstallation` hasta que termine el puente de Socrates.

## Dependencias y límites

La imagen fija Python 3.12, instala `cryptography`, `SQLAlchemy` y `asyncpg`
desde el entorno de los helpers, obtiene el CLI Docker y `openssh-client` de
los repositorios de la distribución base, y añade Compose v2 desde la imagen
Linux explícita `docker/compose-bin:v5.4.0`. El smoke de SQLAlchemy sólo crea y
libera un engine `postgresql+asyncpg` contra una URL dummy; no abre una
conexión. El build puede usar `pip`/`apt` para crear la imagen, pero no los
ejecuta durante la validación de paquetes ni instala nada en el host. No monta
Docker socket ni inicia PostgreSQL o servicios durante la validación. El socket y la red sólo se
otorgan en la ejecución final del bootstrap cuando la configuración privada
los declara y el operador lo autoriza.

El test Docker usa una clave Ed25519 efímera únicamente en un contexto temporal
de prueba para firmar el fixture. Sustituye el trust anchor sólo en ese contexto
generado, conserva la receta y verifica sus imports/dependencias reales; no
representa la clave embebida de producción ni publica una imagen.

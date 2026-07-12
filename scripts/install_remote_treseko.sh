#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Instalacion remota de Treseko Community por SSH.

Uso:
  scripts/install_remote_treseko.sh usuario@servidor [opciones]

Opciones:
  --ssh-port PUERTO        Puerto SSH. Default: 22
  --remote-dir RUTA        Ruta remota de instalacion. Default: /opt/treseko-platform
  --http-port PUERTO       Puerto HTTP publico del frontend. Default: 9095
  --skip-docker-install    No intentar instalar Docker si falta.

Ejemplo:
  scripts/install_remote_treseko.sh ubuntu@192.168.1.50 --http-port 9095

Requisitos del servidor:
  - Linux con systemd.
  - Usuario con sudo.
  - Docker instalado, o Ubuntu/Debian con apt para instalarlo automaticamente.
USAGE
}

TARGET="${1:-}"
if [ -z "$TARGET" ] || [ "$TARGET" = "-h" ] || [ "$TARGET" = "--help" ]; then
  usage
  exit 0
fi
shift || true

SSH_PORT="22"
REMOTE_DIR="/opt/treseko-platform"
HTTP_PORT="9095"
INSTALL_DOCKER="true"
ADMIN_EMAIL="admin@qa.local"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ssh-port)
      SSH_PORT="${2:?Falta valor para --ssh-port}"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="${2:?Falta valor para --remote-dir}"
      shift 2
      ;;
    --http-port)
      HTTP_PORT="${2:?Falta valor para --http-port}"
      shift 2
      ;;
    --skip-docker-install)
      INSTALL_DOCKER="false"
      shift
      ;;
    *)
      echo "Opcion no reconocida: $1" >&2
      usage
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

generate_secret() {
  python3 - "$1" <<'PY'
import secrets
import string
import sys

length = int(sys.argv[1])
alphabet = string.ascii_letters + string.digits + "-_"
print("".join(secrets.choice(alphabet) for _ in range(length)))
PY
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Falta el comando local '$1'." >&2
    exit 1
  fi
}

require_cmd ssh
require_cmd scp
require_cmd tar
require_cmd python3

shell_quote() {
  printf '%q' "$1"
}

ADMIN_PASSWORD="$(generate_secret 24)"
DB_PASSWORD="$(generate_secret 32)"
SECRET_KEY="$(generate_secret 64)"
ARCHIVE="$(mktemp /tmp/treseko-platform.XXXXXX.tgz)"
REMOTE_ARCHIVE="/tmp/treseko-platform.tgz"

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

echo "Preparando paquete local..."
tar \
  --exclude .git \
  --exclude node_modules \
  --exclude '*/node_modules' \
  --exclude dist \
  --exclude '*/dist' \
  --exclude .venv \
  --exclude '*/.venv' \
  --exclude logs \
  --exclude '*/logs' \
  -czf "$ARCHIVE" \
  -C "$REPO_ROOT" .

echo "Subiendo paquete a ${TARGET}..."
scp -P "$SSH_PORT" "$ARCHIVE" "${TARGET}:${REMOTE_ARCHIVE}"

echo "Instalando Treseko en ${TARGET}:${REMOTE_DIR}..."
ssh -p "$SSH_PORT" "$TARGET" bash -s <<REMOTE
TRESEKO_REMOTE_DIR=$(shell_quote "$REMOTE_DIR")
TRESEKO_HTTP_PORT=$(shell_quote "$HTTP_PORT")
TRESEKO_INSTALL_DOCKER=$(shell_quote "$INSTALL_DOCKER")
TRESEKO_DB_PASSWORD=$(shell_quote "$DB_PASSWORD")
TRESEKO_SECRET_KEY=$(shell_quote "$SECRET_KEY")
TRESEKO_ADMIN_PASSWORD=$(shell_quote "$ADMIN_PASSWORD")
export TRESEKO_REMOTE_DIR TRESEKO_HTTP_PORT TRESEKO_INSTALL_DOCKER TRESEKO_DB_PASSWORD TRESEKO_SECRET_KEY TRESEKO_ADMIN_PASSWORD

$(cat <<'REMOTE_BODY'
set -euo pipefail

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "El usuario remoto no es root y sudo no esta disponible." >&2
    exit 1
  fi
  SUDO="sudo"
fi

if ! command -v docker >/dev/null 2>&1; then
  if [ "${TRESEKO_INSTALL_DOCKER}" != "true" ]; then
    echo "Docker no esta instalado y se pidio no instalarlo automaticamente." >&2
    exit 1
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Docker no esta instalado. Instala Docker Compose v2 manualmente o usa Ubuntu/Debian con apt." >&2
    exit 1
  fi
  echo "Instalando Docker y Compose plugin..."
  $SUDO apt-get update
  $SUDO apt-get install -y docker.io docker-compose-plugin
  $SUDO systemctl enable --now docker || true
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 no esta disponible. Instala docker-compose-plugin." >&2
  exit 1
fi

$SUDO mkdir -p "${TRESEKO_REMOTE_DIR}"
$SUDO tar -xzf /tmp/treseko-platform.tgz -C "${TRESEKO_REMOTE_DIR}"
$SUDO mkdir -p "${TRESEKO_REMOTE_DIR}/secrets"

DATABASE_URL="postgresql+asyncpg://treseko:${TRESEKO_DB_PASSWORD}@db:5432/treseko"

printf '%s' "${TRESEKO_DB_PASSWORD}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/db-password" >/dev/null
printf '%s' "${DATABASE_URL}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/database-url" >/dev/null
printf '%s' "${TRESEKO_SECRET_KEY}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/secret-key" >/dev/null
printf '%s' "${TRESEKO_ADMIN_PASSWORD}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/admin-password" >/dev/null
$SUDO chmod 0600 "${TRESEKO_REMOTE_DIR}"/secrets/*

$SUDO tee "${TRESEKO_REMOTE_DIR}/compose.production.env" >/dev/null <<ENV
APP_ENV=production
TRESEKO_HTTP_PORT=${TRESEKO_HTTP_PORT}
TRESEKO_DB_PASSWORD_FILE=${TRESEKO_REMOTE_DIR}/secrets/db-password
TRESEKO_DATABASE_URL_FILE=${TRESEKO_REMOTE_DIR}/secrets/database-url
TRESEKO_SECRET_KEY_FILE=${TRESEKO_REMOTE_DIR}/secrets/secret-key
DB_USER=treseko
DB_NAME=treseko
AUTO_BACKUP_ENABLED=true
LOG_LEVEL=INFO
ENV
$SUDO chmod 0600 "${TRESEKO_REMOTE_DIR}/compose.production.env"

cd "${TRESEKO_REMOTE_DIR}"
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env build
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm \
  -v "${TRESEKO_REMOTE_DIR}/secrets/admin-password:/run/secrets/admin-password:ro" \
  --entrypoint python backend /app/seed_admin.py --password-file /run/secrets/admin-password
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend

rm -f /tmp/treseko-platform.tgz
REMOTE_BODY
)
REMOTE

cat <<SUMMARY

Treseko Community quedo instalado.

URL:
  http://${TARGET#*@}:${HTTP_PORT}

Usuario inicial:
  ${ADMIN_EMAIL}

Contraseña temporal:
  ${ADMIN_PASSWORD}

Importante:
  - Guarda esta contraseña ahora.
  - Treseko pedira cambiarla en el primer login.
  - Los secretos quedaron en el servidor dentro de ${REMOTE_DIR}/secrets con permisos 0600.

SUMMARY

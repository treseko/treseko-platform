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
  --worker-browsers LISTA  Navegadores Playwright del worker separados por espacio.
                           Default: chromium firefox webkit
  --worker-minimal         Worker para VM de prueba: solo Chromium, sin Cypress/Puppeteer.
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
WORKER_BROWSERS="chromium firefox webkit"
WORKER_INSTALL_CYPRESS="true"
WORKER_INSTALL_PUPPETEER="true"

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
    --worker-browsers)
      WORKER_BROWSERS="${2:?Falta valor para --worker-browsers}"
      shift 2
      ;;
    --worker-minimal)
      WORKER_BROWSERS="chromium"
      WORKER_INSTALL_CYPRESS="false"
      WORKER_INSTALL_PUPPETEER="false"
      shift
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
AI_CREDENTIALS_MASTER_KEY="$(generate_secret 64)"
AI_ENGINE_INTERNAL_TOKEN="$(generate_secret 64)"
ARCHIVE="$(mktemp /tmp/treseko-platform.XXXXXX.tgz)"
REMOTE_ARCHIVE="/tmp/treseko-platform.tgz"

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

echo "Preparando paquete local..."
COPYFILE_DISABLE=1 tar \
  --exclude .git \
  --exclude '._*' \
  --exclude '*/._*' \
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
ssh -p "$SSH_PORT" "$TARGET" \
  "TRESEKO_REMOTE_DIR=$(shell_quote "$REMOTE_DIR") TRESEKO_HTTP_PORT=$(shell_quote "$HTTP_PORT") TRESEKO_INSTALL_DOCKER=$(shell_quote "$INSTALL_DOCKER") TRESEKO_WORKER_BROWSERS=$(shell_quote "$WORKER_BROWSERS") TRESEKO_WORKER_INSTALL_CYPRESS=$(shell_quote "$WORKER_INSTALL_CYPRESS") TRESEKO_WORKER_INSTALL_PUPPETEER=$(shell_quote "$WORKER_INSTALL_PUPPETEER") TRESEKO_DB_PASSWORD=$(shell_quote "$DB_PASSWORD") TRESEKO_SECRET_KEY=$(shell_quote "$SECRET_KEY") TRESEKO_AI_CREDENTIALS_MASTER_KEY=$(shell_quote "$AI_CREDENTIALS_MASTER_KEY") TRESEKO_AI_ENGINE_INTERNAL_TOKEN=$(shell_quote "$AI_ENGINE_INTERNAL_TOKEN") TRESEKO_ADMIN_PASSWORD=$(shell_quote "$ADMIN_PASSWORD") TRESEKO_SUDO_PASSWORD=$(shell_quote "${TRESEKO_SUDO_PASSWORD:-}") bash -s" <<'REMOTE_BODY'
set -euo pipefail

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "El usuario remoto no es root y sudo no esta disponible." >&2
    exit 1
  fi
  if ! sudo -n true >/dev/null 2>&1; then
    if [ -z "${TRESEKO_SUDO_PASSWORD:-}" ]; then
      echo "Sudo requiere autenticacion y no se proporciono una contraseña para la sesion remota." >&2
      exit 1
    fi
    if ! printf '%s\n' "$TRESEKO_SUDO_PASSWORD" | sudo -S -v >/dev/null; then
      echo "No se pudo autenticar sudo en el servidor remoto." >&2
      exit 1
    fi
  fi
  unset TRESEKO_SUDO_PASSWORD
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
  COMPOSE_PACKAGE="docker-compose-plugin"
  if ! apt-cache show "$COMPOSE_PACKAGE" 2>/dev/null | grep -q '^Package:'; then
    COMPOSE_PACKAGE="docker-compose-v2"
  fi
  $SUDO apt-get update
  $SUDO apt-get install -y docker.io "$COMPOSE_PACKAGE"
  $SUDO systemctl enable --now docker || true
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 no esta disponible. Instala docker-compose-plugin." >&2
  exit 1
fi

$SUDO mkdir -p "${TRESEKO_REMOTE_DIR}"
$SUDO tar -xzf /tmp/treseko-platform.tgz -C "${TRESEKO_REMOTE_DIR}"
$SUDO find "${TRESEKO_REMOTE_DIR}" -type f -name '._*' -delete
$SUDO mkdir -p "${TRESEKO_REMOTE_DIR}/secrets"

DATABASE_URL="postgresql+asyncpg://treseko:${TRESEKO_DB_PASSWORD}@db:5432/treseko"

printf '%s' "${TRESEKO_DB_PASSWORD}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/db-password" >/dev/null
printf '%s' "${DATABASE_URL}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/database-url" >/dev/null
printf '%s' "${TRESEKO_SECRET_KEY}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/secret-key" >/dev/null
printf '%s' "${TRESEKO_AI_CREDENTIALS_MASTER_KEY}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/ai-credentials-master-key" >/dev/null
printf '%s' "${TRESEKO_AI_ENGINE_INTERNAL_TOKEN}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/ai-engine-internal-token" >/dev/null
printf '%s' "${TRESEKO_ADMIN_PASSWORD}" | $SUDO tee "${TRESEKO_REMOTE_DIR}/secrets/admin-password" >/dev/null
$SUDO chmod 0600 "${TRESEKO_REMOTE_DIR}"/secrets/*

$SUDO tee "${TRESEKO_REMOTE_DIR}/compose.production.env" >/dev/null <<ENV
APP_ENV=production
TRESEKO_HTTP_PORT=${TRESEKO_HTTP_PORT}
TRESEKO_DB_PASSWORD_FILE=${TRESEKO_REMOTE_DIR}/secrets/db-password
TRESEKO_DATABASE_URL_FILE=${TRESEKO_REMOTE_DIR}/secrets/database-url
TRESEKO_SECRET_KEY_FILE=${TRESEKO_REMOTE_DIR}/secrets/secret-key
TRESEKO_AI_CREDENTIALS_MASTER_KEY_FILE=${TRESEKO_REMOTE_DIR}/secrets/ai-credentials-master-key
TRESEKO_AI_ENGINE_INTERNAL_TOKEN_FILE=${TRESEKO_REMOTE_DIR}/secrets/ai-engine-internal-token
DB_USER=treseko
DB_NAME=treseko
AUTO_BACKUP_ENABLED=true
LOG_LEVEL=INFO
ENV
$SUDO chmod 0600 "${TRESEKO_REMOTE_DIR}/compose.production.env"

cd "${TRESEKO_REMOTE_DIR}"
for service_to_build in migrator backend engine frontend automation-worker; do
  echo "Construyendo servicio ${service_to_build}..."
  if [ "${service_to_build}" = "automation-worker" ]; then
    $SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation build \
      --build-arg "TRESEKO_WORKER_BROWSERS=${TRESEKO_WORKER_BROWSERS}" \
      --build-arg "TRESEKO_WORKER_INSTALL_CYPRESS=${TRESEKO_WORKER_INSTALL_CYPRESS}" \
      --build-arg "TRESEKO_WORKER_INSTALL_PUPPETEER=${TRESEKO_WORKER_INSTALL_PUPPETEER}" "${service_to_build}"
  else
    $SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation build "${service_to_build}"
  fi
  $SUDO docker builder prune -af >/dev/null || true
done
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
# Reinstalaciones sobre el mismo volumen conservan el rol PostgreSQL, pero la
# contraseña generada para esta instalación cambia. Ajustarla desde el socket
# local evita romper migraciones sin eliminar datos persistentes.
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env exec -T -u postgres db \
  psql -U treseko -d treseko -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE treseko PASSWORD '${TRESEKO_DB_PASSWORD}';" </dev/null
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm -T migrator </dev/null
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm -T \
  -v "${TRESEKO_REMOTE_DIR}/secrets/admin-password:/run/secrets/admin-password:ro" \
  --entrypoint python backend /app/seed_admin.py --password-file /run/secrets/admin-password </dev/null
$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend

wait_for_healthy_service() {
  service="$1"
  container_id="$($SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env ps -q "$service" | tail -n 1)"
  if [ -z "$container_id" ]; then
    echo "No se pudo localizar el contenedor del servicio '$service'." >&2
    exit 1
  fi

  for _attempt in $(seq 1 90); do
    health="$($SUDO docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id" 2>/dev/null | tr -d '\r' || true)"
    case "$health" in
      healthy)
        return 0
        ;;
      unhealthy)
        echo "El servicio '$service' quedo unhealthy." >&2
        $SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env logs --tail=80 "$service" >&2 || true
        exit 1
        ;;
    esac
    sleep 2
  done

  echo "Tiempo de espera agotado esperando que '$service' este saludable." >&2
  $SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env logs --tail=80 "$service" >&2 || true
  exit 1
}

wait_for_healthy_service backend

$SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation up -d automation-worker
worker_container="$($SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation ps -q automation-worker)"
if [ -z "$worker_container" ]; then
  echo "No se pudo iniciar automation-worker." >&2
  exit 1
fi

for _attempt in $(seq 1 30); do
  worker_state="$($SUDO docker inspect --format '{{.State.Status}}' "$worker_container" 2>/dev/null || true)"
  if [ "$worker_state" = "running" ]; then
    break
  fi
  if [ "$worker_state" = "exited" ] || [ "$worker_state" = "dead" ]; then
    echo "automation-worker termino durante la instalacion." >&2
    $SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env logs --tail=100 automation-worker >&2 || true
    exit 1
  fi
  sleep 2
done

worker_state="$($SUDO docker inspect --format '{{.State.Status}}' "$worker_container" 2>/dev/null || true)"
if [ "$worker_state" != "running" ]; then
  echo "automation-worker no quedo en ejecucion (estado: ${worker_state:-desconocido})." >&2
  $SUDO docker compose -f docker-compose.prod.yml --env-file compose.production.env logs --tail=100 automation-worker >&2 || true
  exit 1
fi

echo "automation-worker iniciado. Si no tiene token, quedara esperando emparejamiento desde Automatizacion > Workers."

rm -f /tmp/treseko-platform.tgz
REMOTE_BODY

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

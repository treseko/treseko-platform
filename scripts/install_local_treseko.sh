#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Instalacion local de Treseko Community con Docker.

Uso:
  scripts/install_local_treseko.sh [opciones]

Opciones:
  --http-port PUERTO   Puerto local del frontend. Default: 9095
  --with-demo          Carga datos demo despues de crear el admin.
  --reset              Borra contenedores/volumenes locales antes de instalar.
  --force              Regenera secretos/configuracion local existente.

Ejemplos:
  scripts/install_local_treseko.sh
  scripts/install_local_treseko.sh --http-port 9095 --with-demo
  scripts/install_local_treseko.sh --reset --with-demo
USAGE
}

HTTP_PORT="9095"
WITH_DEMO="false"
RESET="false"
FORCE="false"
ADMIN_EMAIL="admin@qa.local"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --http-port)
      HTTP_PORT="${2:?Falta valor para --http-port}"
      shift 2
      ;;
    --with-demo)
      WITH_DEMO="true"
      shift
      ;;
    --reset)
      RESET="true"
      FORCE="true"
      shift
      ;;
    --force)
      FORCE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
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
LOCAL_DIR="${REPO_ROOT}/.treseko-local"
SECRETS_DIR="${LOCAL_DIR}/secrets"
ENV_FILE="${REPO_ROOT}/compose.production.env"

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

require_cmd docker
require_cmd python3

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 no esta disponible. Instala Docker Desktop o docker-compose-plugin." >&2
  exit 1
fi

if [ -f "$ENV_FILE" ] && [ "$FORCE" != "true" ]; then
  echo "Ya existe ${ENV_FILE}." >&2
  echo "Usa --force para regenerar la configuracion o --reset para recrear todo el entorno local." >&2
  exit 1
fi

mkdir -p "$SECRETS_DIR"
chmod 0700 "$LOCAL_DIR" "$SECRETS_DIR" 2>/dev/null || true

ADMIN_PASSWORD="$(generate_secret 24)"
DB_PASSWORD="$(generate_secret 32)"
SECRET_KEY="$(generate_secret 64)"
DATABASE_URL="postgresql+asyncpg://treseko:${DB_PASSWORD}@db:5432/treseko"

printf '%s' "$DB_PASSWORD" > "${SECRETS_DIR}/db-password"
printf '%s' "$DATABASE_URL" > "${SECRETS_DIR}/database-url"
printf '%s' "$SECRET_KEY" > "${SECRETS_DIR}/secret-key"
printf '%s' "$ADMIN_PASSWORD" > "${SECRETS_DIR}/admin-password"
chmod 0600 "${SECRETS_DIR}"/* 2>/dev/null || true

cat > "$ENV_FILE" <<ENV
APP_ENV=production
TRESEKO_HTTP_PORT=${HTTP_PORT}
TRESEKO_DB_PASSWORD_FILE=${SECRETS_DIR}/db-password
TRESEKO_DATABASE_URL_FILE=${SECRETS_DIR}/database-url
TRESEKO_SECRET_KEY_FILE=${SECRETS_DIR}/secret-key
DB_USER=treseko
DB_NAME=treseko
AUTO_BACKUP_ENABLED=true
LOG_LEVEL=INFO
ENV

if [ "$RESET" = "true" ]; then
  echo "Reiniciando entorno local y volumenes..."
  docker compose -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" down -v --remove-orphans || true
fi

echo "Construyendo y levantando Treseko local..."
docker compose -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" build
docker compose -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" up -d db redis
docker compose -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" run --rm migrator
docker compose -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" run --rm \
  -v "${SECRETS_DIR}/admin-password:/run/secrets/admin-password:ro" \
  --entrypoint python backend /app/seed_admin.py --password-file /run/secrets/admin-password
docker compose -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" up -d backend engine frontend

if [ "$WITH_DEMO" = "true" ]; then
  echo "Cargando datos demo..."
  docker compose -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" run --rm \
    --entrypoint python backend /app/seed_demo_showcase.py
fi

cat <<SUMMARY

Treseko Community local quedo listo.

URL:
  http://localhost:${HTTP_PORT}

Usuario inicial:
  ${ADMIN_EMAIL}

Contraseña temporal:
  ${ADMIN_PASSWORD}

Importante:
  - Guarda esta contraseña ahora.
  - Treseko pedira cambiarla en el primer login.
  - La configuracion local quedo en compose.production.env.
  - Los secretos locales quedaron en .treseko-local/secrets.

SUMMARY

#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Instalacion local de Treseko Community con Docker.

Uso:
  scripts/install_local_treseko.sh [opciones]

Opciones:
  --http-port PUERTO   Puerto del frontend. Default: 9095
  --bind-address IP    127.0.0.1 (solo este equipo) o 0.0.0.0 (red). Default: 127.0.0.1
  --with-demo          Carga datos demo despues de crear el admin.
  --update             Actualiza una instalacion existente sin regenerar nada.
  --install-root RUTA  Reutiliza config/secretos de una instalacion ya existente.
  --uninstall          Detiene y elimina contenedores/redes, conservando datos.
  --purge-data         Con --uninstall, elimina tambien volumenes y config local.
  --confirm-purge      Confirmacion no interactiva obligatoria para --purge-data.
  --reset              Alias destructivo legado; requiere --confirm-reset.
  --confirm-reset      Confirmacion no interactiva obligatoria para --reset.

Ejemplos:
  scripts/install_local_treseko.sh
  scripts/install_local_treseko.sh --http-port 9095 --with-demo
  scripts/install_local_treseko.sh --reset --with-demo
USAGE
}

HTTP_PORT="9095"
BIND_ADDRESS="127.0.0.1"
WITH_DEMO="false"
RESET="false"
UPDATE="false"
UNINSTALL="false"
PURGE_DATA="false"
CONFIRM_PURGE="false"
CONFIRM_RESET="false"
INSTALL_ROOT_OVERRIDE=""
ADMIN_EMAIL="admin@qa.local"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --http-port)
      HTTP_PORT="${2:?Falta valor para --http-port}"
      shift 2
      ;;
    --bind-address)
      BIND_ADDRESS="${2:?Falta valor para --bind-address}"
      shift 2
      ;;
    --with-demo)
      WITH_DEMO="true"
      shift
      ;;
    --update)
      UPDATE="true"
      shift
      ;;
    --install-root)
      INSTALL_ROOT_OVERRIDE="${2:?Falta valor para --install-root}"
      shift 2
      ;;
    --uninstall)
      UNINSTALL="true"
      shift
      ;;
    --purge-data)
      PURGE_DATA="true"
      shift
      ;;
    --confirm-purge)
      CONFIRM_PURGE="true"
      shift
      ;;
    --confirm-reset)
      CONFIRM_RESET="true"
      shift
      ;;
    --reset)
      RESET="true"
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

if ! [[ "$HTTP_PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$HTTP_PORT < 1 || 10#$HTTP_PORT > 65535 )); then
  echo "--http-port debe ser un numero entre 1 y 65535." >&2
  exit 1
fi

if [[ "$BIND_ADDRESS" != "127.0.0.1" && "$BIND_ADDRESS" != "0.0.0.0" ]]; then
  echo "--bind-address solo admite 127.0.0.1 o 0.0.0.0." >&2
  exit 1
fi

if [ "$UPDATE" = "true" ] && [ "$UNINSTALL" = "true" ]; then
  echo "--update y --uninstall son incompatibles." >&2
  exit 1
fi
if [ "$PURGE_DATA" = "true" ] && [ "$UNINSTALL" != "true" ]; then
  echo "--purge-data solo se puede usar junto con --uninstall." >&2
  exit 1
fi
if [ "$CONFIRM_PURGE" = "true" ] && [ "$PURGE_DATA" != "true" ]; then
  echo "--confirm-purge solo se puede usar junto con --purge-data." >&2
  exit 1
fi
if [ "$UPDATE" = "true" ] && [ "$WITH_DEMO" = "true" ]; then
  echo "--with-demo no se puede combinar con --update." >&2
  exit 1
fi
if [ "$RESET" = "true" ] && [ "$CONFIRM_RESET" != "true" ]; then
  echo "La recreacion destructiva requiere --confirm-reset explicito." >&2
  exit 1
fi
if [ "$CONFIRM_RESET" = "true" ] && [ "$RESET" != "true" ]; then
  echo "--confirm-reset solo se puede usar junto con --reset." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
INSTALL_ROOT="${REPO_ROOT}"
if [ -n "$INSTALL_ROOT_OVERRIDE" ]; then
  INSTALL_ROOT="$(cd -- "$INSTALL_ROOT_OVERRIDE" 2>/dev/null && pwd -P)" || { echo "La ruta de instalacion no existe: $INSTALL_ROOT_OVERRIDE" >&2; exit 1; }
fi
LOCAL_DIR="${INSTALL_ROOT}/.treseko-local"
SECRETS_DIR="${LOCAL_DIR}/secrets"
ENV_FILE="${INSTALL_ROOT}/compose.production.env"

is_recognized_installation() {
  [ -f "$ENV_FILE" ] && [ -f "${INSTALL_ROOT}/docker-compose.prod.yml" ] && [ -d "$SECRETS_DIR" ] || return 1
  for secret in db-password database-url secret-key ai-credentials-master-key ai-engine-internal-token admin-password; do
    [ -f "${SECRETS_DIR}/${secret}" ] || return 1
  done
}

assert_purge_paths() {
  local root local_dir env_file
  root="$(cd -- "$INSTALL_ROOT" && pwd -P)"
  local_dir="$(cd -- "$(dirname -- "$LOCAL_DIR")" && pwd -P)/$(basename -- "$LOCAL_DIR")"
  env_file="$(cd -- "$(dirname -- "$ENV_FILE")" && pwd -P)/$(basename -- "$ENV_FILE")"
  case "$local_dir" in "$root/.treseko-local") ;; *) echo "Ruta de purga insegura: $LOCAL_DIR" >&2; exit 1 ;; esac
  case "$env_file" in "$root/compose.production.env") ;; *) echo "Ruta de purga insegura: $ENV_FILE" >&2; exit 1 ;; esac
}

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
if [ "$UNINSTALL" != "true" ] && [ "$UPDATE" != "true" ]; then
  require_cmd python3
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 no esta disponible. Instala Docker Desktop o docker-compose-plugin." >&2
  exit 1
fi

PROJECT_NAME=""
if [ "$UPDATE" = "true" ] || [ "$UNINSTALL" = "true" ] || [ "$RESET" = "true" ]; then
  require_cmd python3
  PROJECT_NAME="$(sed -n 's/^TRESEKO_COMPOSE_PROJECT_NAME=//p' "$ENV_FILE" | tail -n 1 | tr -d '\r')"
  if [ -z "$PROJECT_NAME" ]; then
    compose_projects="$(docker compose ls --all --format json)" || { echo "No se pudo consultar la identidad Compose existente." >&2; exit 1; }
    PROJECT_NAME="$(printf '%s' "$compose_projects" | python3 -c 'import json,os,sys; target=os.path.realpath(sys.argv[1]); rows=json.load(sys.stdin); names=set(); [(names.add(str(row.get("Name", "")))) for row in rows if any(os.path.realpath(item.strip()) == target for item in str(row.get("ConfigFiles", "")).split(",") if item.strip())]; print(next(iter(names)) if len(names)==1 else "")' "${INSTALL_ROOT}/docker-compose.prod.yml")"
  fi
  if [ -z "$PROJECT_NAME" ] || [[ ! "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "No se pudo identificar sin ambiguedad el proyecto Compose existente; se cancela para evitar crear volumenes paralelos." >&2
    exit 1
  fi
  if [ "$UPDATE" = "true" ] && ! grep -q '^TRESEKO_COMPOSE_PROJECT_NAME=' "$ENV_FILE"; then
    [ ! -L "$ENV_FILE" ] || { echo "El archivo de ambiente no puede ser un enlace simbolico." >&2; exit 1; }
    printf 'TRESEKO_COMPOSE_PROJECT_NAME=%s\n' "$PROJECT_NAME" >> "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
fi

compose() {
  if [ -n "$PROJECT_NAME" ]; then
    docker compose --project-directory "$REPO_ROOT" -p "$PROJECT_NAME" -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" "$@"
  else
    docker compose -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" "$@"
  fi
}

if [ "$UPDATE" = "true" ] || [ "$UNINSTALL" = "true" ]; then
  if ! is_recognized_installation; then
    echo "No existe ${ENV_FILE}; no se puede actualizar o desinstalar sin la configuracion existente." >&2
    exit 1
  fi
fi

if [ "$UNINSTALL" = "true" ]; then
  if [ "$PURGE_DATA" = "true" ] && [ "$CONFIRM_PURGE" != "true" ]; then
    echo "La purga de datos requiere --confirm-purge explicito." >&2
    exit 1
  fi
  if [ "$PURGE_DATA" = "true" ]; then
    assert_purge_paths
    echo "PURGA: deteniendo contenedores y eliminando volumenes y configuracion local de ${REPO_ROOT}."
    compose down -v --remove-orphans
  else
    echo "Desinstalacion conservadora: deteniendo contenedores y redes; se conservan volumenes y configuracion."
    compose down --remove-orphans
  fi
  if [ "$PURGE_DATA" = "true" ]; then
    rm -rf -- "$LOCAL_DIR"
    rm -f -- "$ENV_FILE"
  fi
  exit 0
fi

if [ "$UPDATE" = "true" ]; then
  require_cmd python3
  expected_version=$(tr -d '\r\n' < "${REPO_ROOT}/VERSION")
  python3 "${REPO_ROOT}/scripts/atomic_local_update.py" \
    --docker "$(command -v docker)" --project "$PROJECT_NAME" \
    --candidate-root "$REPO_ROOT" --install-root "$INSTALL_ROOT" \
    --env-file "$ENV_FILE" --version "$expected_version"
  exit 0
fi

if [ "$RESET" = "true" ] && is_recognized_installation; then
  assert_purge_paths
  echo "Reiniciando entorno local y volumenes..."
  compose down -v --remove-orphans || true
  rm -rf -- "$LOCAL_DIR"
  rm -f -- "$ENV_FILE"
fi

if [ -f "$ENV_FILE" ]; then
  echo "Ya existe ${ENV_FILE}." >&2
  echo "Usa --update para actualizar o --uninstall para retirarlo de forma conservadora." >&2
  exit 1
fi

mkdir -p "$SECRETS_DIR"
chmod 0700 "$LOCAL_DIR" "$SECRETS_DIR" 2>/dev/null || true

ADMIN_PASSWORD="$(generate_secret 24)"
DB_PASSWORD="$(generate_secret 32)"
SECRET_KEY="$(generate_secret 64)"
AI_CREDENTIALS_MASTER_KEY="$(generate_secret 64)"
AI_ENGINE_INTERNAL_TOKEN="$(generate_secret 64)"
DATABASE_URL="postgresql+asyncpg://treseko:${DB_PASSWORD}@db:5432/treseko"

printf '%s' "$DB_PASSWORD" > "${SECRETS_DIR}/db-password"
printf '%s' "$DATABASE_URL" > "${SECRETS_DIR}/database-url"
printf '%s' "$SECRET_KEY" > "${SECRETS_DIR}/secret-key"
printf '%s' "$AI_CREDENTIALS_MASTER_KEY" > "${SECRETS_DIR}/ai-credentials-master-key"
printf '%s' "$AI_ENGINE_INTERNAL_TOKEN" > "${SECRETS_DIR}/ai-engine-internal-token"
printf '%s' "$ADMIN_PASSWORD" > "${SECRETS_DIR}/admin-password"
chmod 0600 "${SECRETS_DIR}"/* 2>/dev/null || true

cat > "$ENV_FILE" <<ENV
APP_ENV=production
TRESEKO_HTTP_PORT=${HTTP_PORT}
TRESEKO_BIND_ADDRESS=${BIND_ADDRESS}
TRESEKO_DB_PASSWORD_FILE=${SECRETS_DIR}/db-password
TRESEKO_DATABASE_URL_FILE=${SECRETS_DIR}/database-url
TRESEKO_SECRET_KEY_FILE=${SECRETS_DIR}/secret-key
TRESEKO_AI_CREDENTIALS_MASTER_KEY_FILE=${SECRETS_DIR}/ai-credentials-master-key
TRESEKO_AI_ENGINE_INTERNAL_TOKEN_FILE=${SECRETS_DIR}/ai-engine-internal-token
DB_USER=treseko
DB_NAME=treseko
AUTO_BACKUP_ENABLED=true
LOG_LEVEL=INFO
QA_ORGANIZACION_ID=
ENV

if [ -z "$PROJECT_NAME" ]; then
  new_config="$(docker compose --project-directory "$REPO_ROOT" -f "${REPO_ROOT}/docker-compose.prod.yml" --env-file "$ENV_FILE" config --format json)" || { echo "No se pudo resolver la identidad Compose para la nueva instalacion." >&2; exit 1; }
  PROJECT_NAME="$(printf '%s' "$new_config" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("name", ""))')"
  if [[ ! "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "Docker Compose devolvio una identidad invalida para la nueva instalacion." >&2
    exit 1
  fi
  printf 'TRESEKO_COMPOSE_PROJECT_NAME=%s\n' "$PROJECT_NAME" >> "$ENV_FILE"
fi

echo "Construyendo y levantando Treseko local..."
compose build
compose up -d db redis
compose run --rm migrator
compose run --rm \
  -v "${SECRETS_DIR}/admin-password:/run/secrets/admin-password:ro" \
  --entrypoint python backend /app/seed_admin.py --password-file /run/secrets/admin-password
compose --profile automation up -d backend engine frontend automation-worker

if [ "$WITH_DEMO" = "true" ]; then
  echo "Cargando datos demo..."
  compose run --rm \
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

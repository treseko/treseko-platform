#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLATFORM_LIB="${SCRIPT_DIR}/native_platform.sh"
if [ ! -r "$PLATFORM_LIB" ]; then
  echo "Falta ${PLATFORM_LIB}; el paquete de instalacion esta incompleto." >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$PLATFORM_LIB"

INSTALL_DIR="${INSTALL_DIR:-/opt/treseko}"
TRESEKO_USER="${TRESEKO_USER:-treseko}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
ENGINE_PORT="${ENGINE_PORT:-3010}"
FRONTEND_PORT="${FRONTEND_PORT:-}"
SECRETS_DIR="${TRESEKO_SECRETS_DIR:-/etc/treseko/secrets}"
BUILD_WORK_DIR="${TRESEKO_BUILD_WORK_DIR:-}"
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${INSTALL_DIR}/data/ms-playwright}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"
TRESEKO_UPDATE_SERVER_URL="${TRESEKO_UPDATE_SERVER_URL:-https://updates.treseko.com}"
TRESEKO_ENABLE_SELF_UPDATE_APPLY="${TRESEKO_ENABLE_SELF_UPDATE_APPLY:-false}"
TRESEKO_UPDATE_DB_HISTORY_ENABLED="${TRESEKO_UPDATE_DB_HISTORY_ENABLED:-true}"
TRESEKO_UPDATE_STEP_TIMEOUT_SECONDS="${TRESEKO_UPDATE_STEP_TIMEOUT_SECONDS:-300}"
TRESEKO_AUTO_DB_ROLLBACK_ON_MIGRATION_FAILURE="${TRESEKO_AUTO_DB_ROLLBACK_ON_MIGRATION_FAILURE:-false}"
MAX_BACKUPS="${MAX_BACKUPS:-3}"
AUTO_BACKUP_ENABLED="${AUTO_BACKUP_ENABLED:-true}"
CHECK_PENDING_UPDATE="${CHECK_PENDING_UPDATE:-true}"
LOG_LEVEL="${LOG_LEVEL:-INFO}"

read_secret_file() {
  name="$1"
  file_name="${name}_FILE"
  file_path="${!file_name:-}"
  if [ -z "$file_path" ]; then
    echo "$file_name es obligatorio. No pases secretos en variables de ambiente." >&2
    return 1
  fi
  if [ ! -r "$file_path" ]; then
    echo "$file_name no existe o no es legible: $file_path" >&2
    return 1
  fi
  cat "$file_path"
}

DATABASE_URL="$(read_secret_file DATABASE_URL)"
SECRET_KEY="$(read_secret_file SECRET_KEY)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta este instalador como root." >&2
  exit 1
fi

if [ "$(uname -s)" != "Linux" ]; then
  echo "El instalador bare-metal esta soportado solo en Linux. En otros sistemas usa Docker." >&2
  exit 1
fi

treseko_detect_linux_platform
if [ -z "$FRONTEND_PORT" ]; then
  if [ "$TRESEKO_LINUX_FAMILY" = "rhel" ]; then
    FRONTEND_PORT="8080"
  else
    FRONTEND_PORT="80"
  fi
fi
export INSTALL_DIR FRONTEND_PORT
treseko_select_python
treseko_nginx_configure_paths

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd/systemctl es obligatorio para la instalacion bare-metal. Usa Docker si tu sistema no lo tiene." >&2
  exit 1
fi

if [ "${#SECRET_KEY}" -lt 32 ]; then
  echo "SECRET_KEY debe tener al menos 32 caracteres." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm es obligatorio para construir frontend/engine/worker." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo "Node.js 20 o superior es obligatorio para construir frontend/engine/worker." >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx es obligatorio para servir el frontend." >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync es obligatorio para copiar artefactos de forma segura." >&2
  exit 1
fi

if [ -z "$BUILD_WORK_DIR" ]; then
  BUILD_WORK_DIR="$(mktemp -d /tmp/treseko-install-build.XXXXXX)"
  CLEAN_BUILD_WORK_DIR=true
else
  mkdir -p "$BUILD_WORK_DIR"
  CLEAN_BUILD_WORK_DIR=false
fi

cleanup_build_work_dir() {
  if [ "${CLEAN_BUILD_WORK_DIR:-false}" = "true" ] && [ -n "${BUILD_WORK_DIR:-}" ]; then
    rm -rf "$BUILD_WORK_DIR"
  fi
}
trap cleanup_build_work_dir EXIT

copy_node_project_for_build() {
  source_dir="$1"
  target_dir="$2"
  rsync -a --delete \
    --exclude node_modules \
    --exclude dist \
    --exclude coverage \
    --exclude .vite \
    "$source_dir/" "$target_dir/"
}

echo "Instalando Treseko en ${INSTALL_DIR}"
echo "Plataforma: ${TRESEKO_DISTRO_ID} ${TRESEKO_DISTRO_VERSION} (${TRESEKO_LINUX_FAMILY})"
echo "Raiz de codigo: ${REPO_ROOT}"
echo "Workspace de build: ${BUILD_WORK_DIR}"

NOLOGIN_SHELL="$(treseko_select_nologin_shell)"
useradd --system --no-create-home --shell "$NOLOGIN_SHELL" "${TRESEKO_USER}" 2>/dev/null || true
install -d -m 0750 -o root -g "${TRESEKO_USER}" "${SECRETS_DIR}"
printf '%s' "$DATABASE_URL" > "${SECRETS_DIR}/database-url"
printf '%s' "$SECRET_KEY" > "${SECRETS_DIR}/secret-key"
if [ ! -s "${SECRETS_DIR}/ai-credentials-master-key" ]; then
  openssl rand -hex 32 > "${SECRETS_DIR}/ai-credentials-master-key"
fi
if [ ! -s "${SECRETS_DIR}/ai-engine-internal-token" ]; then
  openssl rand -hex 32 > "${SECRETS_DIR}/ai-engine-internal-token"
fi
chown root:"${TRESEKO_USER}" "${SECRETS_DIR}/database-url" "${SECRETS_DIR}/secret-key" "${SECRETS_DIR}/ai-credentials-master-key" "${SECRETS_DIR}/ai-engine-internal-token"
chmod 0640 "${SECRETS_DIR}/database-url" "${SECRETS_DIR}/secret-key" "${SECRETS_DIR}/ai-credentials-master-key" "${SECRETS_DIR}/ai-engine-internal-token"

mkdir -p \
  "${INSTALL_DIR}/backend" \
  "${INSTALL_DIR}/frontend/html" \
  "${INSTALL_DIR}/engine" \
  "${INSTALL_DIR}/worker" \
  "${INSTALL_DIR}/data/updates" \
  "${INSTALL_DIR}/data/backups" \
  "${PLAYWRIGHT_BROWSERS_PATH}" \
  "${INSTALL_DIR}/logs"

"${TRESEKO_PYTHON_BIN}" -m venv "${INSTALL_DIR}/backend/venv"
"${INSTALL_DIR}/backend/venv/bin/pip" install --upgrade pip
"${INSTALL_DIR}/backend/venv/bin/pip" install -r "${REPO_ROOT}/backend/requirements.txt"

rsync -a --delete "${REPO_ROOT}/backend/app" "${INSTALL_DIR}/backend/"
rsync -a --delete "${REPO_ROOT}/backend/alembic" "${INSTALL_DIR}/backend/"
cp "${REPO_ROOT}/backend/alembic.ini" "${INSTALL_DIR}/backend/alembic.ini"
cp "${REPO_ROOT}/backend/entrypoint.sh" "${INSTALL_DIR}/backend/entrypoint.sh"
cp "${REPO_ROOT}/backend/seed_admin.py" "${INSTALL_DIR}/backend/seed_admin.py"
cp "${REPO_ROOT}/backend/reset_user_password.py" "${INSTALL_DIR}/backend/reset_user_password.py"
cp "${REPO_ROOT}/VERSION" "${INSTALL_DIR}/VERSION"
chmod +x "${INSTALL_DIR}/backend/entrypoint.sh"

copy_node_project_for_build "${REPO_ROOT}/frontend" "${BUILD_WORK_DIR}/frontend"
npm --prefix "${BUILD_WORK_DIR}/frontend" ci
npm --prefix "${BUILD_WORK_DIR}/frontend" run build
rsync -a --delete "${BUILD_WORK_DIR}/frontend/dist/" "${INSTALL_DIR}/frontend/html/"

copy_node_project_for_build "${REPO_ROOT}/engine" "${BUILD_WORK_DIR}/engine"
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH}" npm --prefix "${BUILD_WORK_DIR}/engine" ci
rsync -a --delete "${BUILD_WORK_DIR}/engine/" "${INSTALL_DIR}/engine/"

copy_node_project_for_build "${REPO_ROOT}/automation-worker" "${BUILD_WORK_DIR}/automation-worker"
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH}" npm --prefix "${BUILD_WORK_DIR}/automation-worker" ci
rsync -a --delete "${BUILD_WORK_DIR}/automation-worker/" "${INSTALL_DIR}/worker/"

cat > /etc/systemd/system/treseko-backend.service <<SYSTEMD
[Unit]
Description=Treseko Backend
After=network.target

[Service]
Type=simple
User=${TRESEKO_USER}
WorkingDirectory=${INSTALL_DIR}/backend
Environment=DATABASE_URL_FILE=${SECRETS_DIR}/database-url
Environment=SECRET_KEY_FILE=${SECRETS_DIR}/secret-key
Environment=AI_CREDENTIALS_MASTER_KEY_FILE=${SECRETS_DIR}/ai-credentials-master-key
Environment=AI_ENGINE_INTERNAL_TOKEN_FILE=${SECRETS_DIR}/ai-engine-internal-token
Environment=UPDATES_DIR=${INSTALL_DIR}/data/updates
Environment=BACKUPS_DIR=${INSTALL_DIR}/data/backups
Environment=DB_BACKUP_DIR=${INSTALL_DIR}/data/backups
Environment=TRESEKO_DEPLOY_MODE=systemd
Environment=TRESEKO_APP_DIR=${INSTALL_DIR}/backend
Environment=TRESEKO_VERSION_FILE=${INSTALL_DIR}/VERSION
Environment=TRESEKO_FRONTEND_DIR=${INSTALL_DIR}/frontend/html
Environment=TRESEKO_ENGINE_DIR=${INSTALL_DIR}/engine
Environment=TRESEKO_WORKER_DIR=${INSTALL_DIR}/worker
Environment=TRESEKO_UPDATE_SERVER_URL=${TRESEKO_UPDATE_SERVER_URL}
Environment=TRESEKO_ENABLE_SELF_UPDATE_APPLY=${TRESEKO_ENABLE_SELF_UPDATE_APPLY}
Environment=TRESEKO_UPDATE_DB_HISTORY_ENABLED=${TRESEKO_UPDATE_DB_HISTORY_ENABLED}
Environment=TRESEKO_UPDATE_STEP_TIMEOUT_SECONDS=${TRESEKO_UPDATE_STEP_TIMEOUT_SECONDS}
Environment=TRESEKO_AUTO_DB_ROLLBACK_ON_MIGRATION_FAILURE=${TRESEKO_AUTO_DB_ROLLBACK_ON_MIGRATION_FAILURE}
Environment=MAX_BACKUPS=${MAX_BACKUPS}
Environment=AUTO_BACKUP_ENABLED=${AUTO_BACKUP_ENABLED}
Environment=CHECK_PENDING_UPDATE=${CHECK_PENDING_UPDATE}
Environment=LOG_LEVEL=${LOG_LEVEL}
Environment=PORT=${BACKEND_PORT}
Environment=ENGINE_URL=http://127.0.0.1:${ENGINE_PORT}
Environment=REDIS_URL=${REDIS_URL}
Environment=PATH=${INSTALL_DIR}/backend/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${INSTALL_DIR}/backend/entrypoint.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSTEMD

NPM_BIN="$(command -v npm)"
cat > /etc/systemd/system/treseko-engine.service <<SYSTEMD
[Unit]
Description=Treseko Engine
After=network.target treseko-backend.service
Requires=treseko-backend.service

[Service]
Type=simple
User=${TRESEKO_USER}
WorkingDirectory=${INSTALL_DIR}/engine
Environment=NODE_ENV=production
Environment=ENGINE_PORT=${ENGINE_PORT}
Environment=BACKEND_WS_URL=ws://127.0.0.1:${BACKEND_PORT}/ws/engine-sync
Environment=AI_ENGINE_INTERNAL_TOKEN_FILE=${SECRETS_DIR}/ai-engine-internal-token
Environment=PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH}
ExecStart=${NPM_BIN} start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSTEMD

mkdir -p "$(dirname "$TRESEKO_NGINX_CONFIG")"
cat > "$TRESEKO_NGINX_CONFIG" <<NGINX
server {
  listen ${FRONTEND_PORT};
  server_name _;

  root ${INSTALL_DIR}/frontend/html;
  index index.html;
  client_max_body_size 25m;

  location /api/ {
    proxy_pass http://127.0.0.1:${BACKEND_PORT}/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /ws/ {
    proxy_pass http://127.0.0.1:${BACKEND_PORT}/ws/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location ~ ^/(informes|informes-internos|static)/ {
    proxy_pass http://127.0.0.1:${BACKEND_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
NGINX

if [ -n "$TRESEKO_NGINX_ENABLED" ]; then
  mkdir -p "$(dirname "$TRESEKO_NGINX_ENABLED")"
  ln -sf "$TRESEKO_NGINX_CONFIG" "$TRESEKO_NGINX_ENABLED"
  if [ -L /etc/nginx/sites-enabled/default ]; then
    unlink /etc/nginx/sites-enabled/default
  fi
fi
chown -R "${TRESEKO_USER}:${TRESEKO_USER}" "${INSTALL_DIR}"
treseko_configure_selinux

run_backend_env() {
  runuser -u "${TRESEKO_USER}" -- env \
    DATABASE_URL_FILE="${SECRETS_DIR}/database-url" \
    SECRET_KEY_FILE="${SECRETS_DIR}/secret-key" \
    AI_CREDENTIALS_MASTER_KEY_FILE="${SECRETS_DIR}/ai-credentials-master-key" \
    AI_ENGINE_INTERNAL_TOKEN_FILE="${SECRETS_DIR}/ai-engine-internal-token" \
    UPDATES_DIR="${INSTALL_DIR}/data/updates" \
    BACKUPS_DIR="${INSTALL_DIR}/data/backups" \
    DB_BACKUP_DIR="${INSTALL_DIR}/data/backups" \
    TRESEKO_DEPLOY_MODE=systemd \
    TRESEKO_APP_DIR="${INSTALL_DIR}/backend" \
    TRESEKO_VERSION_FILE="${INSTALL_DIR}/VERSION" \
    TRESEKO_FRONTEND_DIR="${INSTALL_DIR}/frontend/html" \
    TRESEKO_ENGINE_DIR="${INSTALL_DIR}/engine" \
    TRESEKO_WORKER_DIR="${INSTALL_DIR}/worker" \
    TRESEKO_UPDATE_SERVER_URL="${TRESEKO_UPDATE_SERVER_URL}" \
    TRESEKO_ENABLE_SELF_UPDATE_APPLY="${TRESEKO_ENABLE_SELF_UPDATE_APPLY}" \
    TRESEKO_UPDATE_DB_HISTORY_ENABLED="${TRESEKO_UPDATE_DB_HISTORY_ENABLED}" \
    TRESEKO_UPDATE_STEP_TIMEOUT_SECONDS="${TRESEKO_UPDATE_STEP_TIMEOUT_SECONDS}" \
    TRESEKO_AUTO_DB_ROLLBACK_ON_MIGRATION_FAILURE="${TRESEKO_AUTO_DB_ROLLBACK_ON_MIGRATION_FAILURE}" \
    MAX_BACKUPS="${MAX_BACKUPS}" \
    AUTO_BACKUP_ENABLED="${AUTO_BACKUP_ENABLED}" \
    CHECK_PENDING_UPDATE="${CHECK_PENDING_UPDATE}" \
    LOG_LEVEL="${LOG_LEVEL}" \
    PORT="${BACKEND_PORT}" \
    ENGINE_URL="http://127.0.0.1:${ENGINE_PORT}" \
    REDIS_URL="${REDIS_URL}" \
    PATH="${INSTALL_DIR}/backend/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    "$@"
}

echo "Aplicando migraciones iniciales..."
run_backend_env "${INSTALL_DIR}/backend/entrypoint.sh" migrate-only

echo "Creando o asegurando admin inicial..."
run_backend_env "${INSTALL_DIR}/backend/venv/bin/python" "${INSTALL_DIR}/backend/seed_admin.py"

systemctl daemon-reload
systemctl enable treseko-backend treseko-engine
systemctl restart treseko-backend
systemctl restart treseko-engine
nginx -t
systemctl reload nginx

echo "Treseko instalado. Frontend: http://localhost:${FRONTEND_PORT}; Engine: http://localhost:${ENGINE_PORT}"

#!/bin/sh
set -eu

DB_BACKUP_DIR="${DB_BACKUP_DIR:-/data/backups}"
UPDATES_DIR="${UPDATES_DIR:-/data/updates}"
APP_DIR="${TRESEKO_APP_DIR:-/app}"
VERSION_FILE="${TRESEKO_VERSION_FILE:-}"
BACKEND_APP_DIR="${TRESEKO_BACKEND_APP_DIR:-$APP_DIR/app}"
ALEMBIC_DIR="${TRESEKO_ALEMBIC_DIR:-$APP_DIR/alembic}"
FRONTEND_HTML_DIR="${TRESEKO_FRONTEND_HTML_DIR:-${TRESEKO_FRONTEND_DIR:-/usr/share/nginx/html}}"
ENGINE_DIR="${TRESEKO_ENGINE_DIR:-/engine}"
WORKER_DIR="${TRESEKO_WORKER_DIR:-/worker}"
AUTO_BACKUP_ENABLED="${AUTO_BACKUP_ENABLED:-true}"
CHECK_PENDING_UPDATE="${CHECK_PENDING_UPDATE:-true}"
MAX_BACKUPS="${MAX_BACKUPS:-3}"
PORT="${PORT:-8000}"
MAINTENANCE_MARKER="$FRONTEND_HTML_DIR/.maintenance"
ENTRYPOINT_UPDATE_IN_PROGRESS="false"
ENTRYPOINT_CODE_BACKUP=""
ENTRYPOINT_DB_BACKUP=""
ENTRYPOINT_UPDATE_FAILED_FILE=""
ENTRYPOINT_UPDATE_DIR=""
AUTO_DB_ROLLBACK_ON_FAILURE="${TRESEKO_AUTO_DB_ROLLBACK_ON_MIGRATION_FAILURE:-false}"

read_version() {
  if [ -n "$VERSION_FILE" ] && [ -r "$VERSION_FILE" ]; then
    cat "$VERSION_FILE"
    return 0
  fi
  for candidate in /VERSION "$APP_DIR/../VERSION" "$APP_DIR/VERSION"; do
    if [ -r "$candidate" ]; then
      cat "$candidate"
      return 0
    fi
  done
  echo unknown
}

echo "=== Treseko Startup ==="
echo "Version: $(read_version)"

load_env_from_file() {
  var_name="$1"
  file_var_name="${var_name}_FILE"
  eval current_value="\${$var_name:-}"
  eval file_value="\${$file_var_name:-}"
  if [ -z "$current_value" ] && [ -n "$file_value" ]; then
    if [ ! -r "$file_value" ]; then
      echo "$file_var_name no existe o no es legible: $file_value" >&2
      return 1
    fi
    loaded_value="$(cat "$file_value")"
    export "$var_name=$loaded_value"
  fi
}

load_env_from_file DATABASE_URL
load_env_from_file SECRET_KEY

maintenance_on() {
  if [ -d "$FRONTEND_HTML_DIR" ]; then
    echo "Activando mantenimiento web."
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$MAINTENANCE_MARKER"
  fi
}

maintenance_off() {
  if [ -f "$MAINTENANCE_MARKER" ]; then
    echo "Desactivando mantenimiento web."
    rm -f "$MAINTENANCE_MARKER"
  fi
}

backup_runtime_code() {
  mkdir -p "$DB_BACKUP_DIR"
  ENTRYPOINT_CODE_BACKUP="$DB_BACKUP_DIR/pre-entrypoint-code-$(date -u +%Y%m%d_%H%M%S).tar.gz"
  backup_src="$UPDATES_DIR/entrypoint-backup-src-$(date -u +%Y%m%d_%H%M%S)"
  rm -rf "$backup_src"
  mkdir -p "$backup_src"
  echo "Creando backup de codigo pre-update: $ENTRYPOINT_CODE_BACKUP"
  [ -d "$BACKEND_APP_DIR" ] && cp -a "$BACKEND_APP_DIR" "$backup_src/backend_app"
  [ -d "$ALEMBIC_DIR" ] && cp -a "$ALEMBIC_DIR" "$backup_src/backend_alembic"
  [ -d "$FRONTEND_HTML_DIR" ] && cp -a "$FRONTEND_HTML_DIR" "$backup_src/frontend_html"
  [ -d "$ENGINE_DIR" ] && cp -a "$ENGINE_DIR" "$backup_src/engine"
  [ -d "$WORKER_DIR" ] && cp -a "$WORKER_DIR" "$backup_src/worker"
  tar -C "$backup_src" -czf "$ENTRYPOINT_CODE_BACKUP" . 2>/dev/null || {
      echo "No se pudo crear backup de codigo pre-update."
      rm -rf "$backup_src"
      return 1
    }
  rm -rf "$backup_src"
}

restore_runtime_code() {
  if [ -z "$ENTRYPOINT_CODE_BACKUP" ] || [ ! -f "$ENTRYPOINT_CODE_BACKUP" ]; then
    echo "No hay backup de codigo para restaurar."
    return 1
  fi
  restore_dir="$UPDATES_DIR/entrypoint-rollback-$(date -u +%Y%m%d_%H%M%S)"
  rm -rf "$restore_dir"
  mkdir -p "$restore_dir"
  echo "Restaurando codigo desde backup: $ENTRYPOINT_CODE_BACKUP"
  tar -xzf "$ENTRYPOINT_CODE_BACKUP" -C "$restore_dir"

  if [ -d "$restore_dir/backend_app" ]; then
    rm -rf "$BACKEND_APP_DIR"
    mkdir -p "$(dirname "$BACKEND_APP_DIR")"
    cp -a "$restore_dir/backend_app" "$BACKEND_APP_DIR"
  fi
  if [ -d "$restore_dir/backend_alembic" ]; then
    rm -rf "$ALEMBIC_DIR"
    mkdir -p "$(dirname "$ALEMBIC_DIR")"
    cp -a "$restore_dir/backend_alembic" "$ALEMBIC_DIR"
  fi
  if [ -d "$restore_dir/frontend_html" ]; then
    mkdir -p "$FRONTEND_HTML_DIR"
    find "$FRONTEND_HTML_DIR" -mindepth 1 ! -name '.maintenance' ! -name 'maintenance.html' -exec rm -rf {} +
    cp -a "$restore_dir/frontend_html/." "$FRONTEND_HTML_DIR/"
  fi
  if [ -d "$restore_dir/engine" ]; then
    mkdir -p "$ENGINE_DIR"
    rm -rf "$ENGINE_DIR"/*
    cp -a "$restore_dir/engine/." "$ENGINE_DIR/"
  fi
  if [ -d "$restore_dir/worker" ]; then
    mkdir -p "$WORKER_DIR"
    rm -rf "$WORKER_DIR"/*
    cp -a "$restore_dir/worker/." "$WORKER_DIR/"
  fi
  rm -rf "$restore_dir"
}

restore_database_backup() {
  if [ "$AUTO_DB_ROLLBACK_ON_FAILURE" != "true" ]; then
    echo "Rollback automatico de DB deshabilitado. Define TRESEKO_AUTO_DB_ROLLBACK_ON_MIGRATION_FAILURE=true para habilitarlo."
    return 0
  fi
  if [ -z "$ENTRYPOINT_DB_BACKUP" ] || [ ! -f "$ENTRYPOINT_DB_BACKUP" ]; then
    echo "No hay backup de DB para restaurar."
    return 1
  fi
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql no disponible; no se puede restaurar automaticamente la DB."
    return 1
  fi
  pg_url="$(database_url_for_pg_dump)"
  if [ -z "$pg_url" ]; then
    echo "DATABASE_URL no es PostgreSQL; no se puede restaurar automaticamente la DB."
    return 1
  fi

  echo "Restaurando DB desde backup pre-migracion: $ENTRYPOINT_DB_BACKUP"
  {
    echo "DROP SCHEMA IF EXISTS public CASCADE;"
    echo "CREATE SCHEMA public;"
    echo "GRANT ALL ON SCHEMA public TO public;"
    gzip -dc "$ENTRYPOINT_DB_BACKUP"
  } | psql "$pg_url"
}

rollback_on_exit() {
  status="$?"
  if [ "$status" -ne 0 ] && [ "$ENTRYPOINT_UPDATE_IN_PROGRESS" = "true" ]; then
    echo "Startup fallo durante un update preparado."
    if [ -n "$ENTRYPOINT_UPDATE_FAILED_FILE" ] && [ -n "$ENTRYPOINT_UPDATE_DIR" ]; then
      echo "$ENTRYPOINT_UPDATE_DIR" > "$ENTRYPOINT_UPDATE_FAILED_FILE" || true
    fi
    echo "Intentando rollback automatico de codigo del entrypoint."
    restore_runtime_code || echo "Rollback automatico de codigo no pudo completarse."
    echo "Intentando rollback automatico de DB del entrypoint si esta habilitado."
    restore_database_backup || echo "Rollback automatico de DB no pudo completarse."
  fi
}

trap rollback_on_exit EXIT

database_url_for_pg_dump() {
  python - <<'PY'
import os
from urllib.parse import urlsplit, urlunsplit

url = os.getenv("DATABASE_URL", "")
if url.startswith("postgresql+asyncpg://"):
    url = "postgresql://" + url.split("://", 1)[1]
elif url.startswith("postgres+asyncpg://"):
    url = "postgresql://" + url.split("://", 1)[1]
elif url.startswith("postgres://"):
    url = "postgresql://" + url.split("://", 1)[1]

parts = urlsplit(url)
if parts.scheme not in {"postgresql", "postgres"}:
    print("")
else:
    print(urlunsplit(parts))
PY
}

apply_pending_update() {
  flag_file="$UPDATES_DIR/update-ready"
  failed_file="$UPDATES_DIR/update-failed"
  if [ "$CHECK_PENDING_UPDATE" != "true" ] || [ ! -f "$flag_file" ]; then
    return 0
  fi

  update_dir="$(cat "$flag_file" 2>/dev/null || true)"
  if [ -z "$update_dir" ] || [ ! -d "$update_dir" ]; then
    echo "Update pendiente invalido: $update_dir"
    rm -f "$flag_file"
    return 1
  fi

  maintenance_on
  ENTRYPOINT_UPDATE_IN_PROGRESS="true"
  ENTRYPOINT_UPDATE_FAILED_FILE="$failed_file"
  ENTRYPOINT_UPDATE_DIR="$update_dir"
  rm -f "$failed_file"
  backup_runtime_code
  echo "Aplicando update pendiente desde: $update_dir"

  if [ -d "$update_dir/backend/app" ]; then
    echo "  Reemplazando backend..."
    rm -rf "$BACKEND_APP_DIR"
    mkdir -p "$(dirname "$BACKEND_APP_DIR")"
    cp -a "$update_dir/backend/app" "$BACKEND_APP_DIR"
  fi

  if [ -d "$update_dir/backend/alembic/versions" ]; then
    echo "  Agregando migraciones..."
    mkdir -p "$ALEMBIC_DIR/versions"
    cp -a "$update_dir/backend/alembic/versions/." "$ALEMBIC_DIR/versions/"
  fi

  if [ -f "$update_dir/backend/requirements.txt" ]; then
    echo "  Instalando dependencias backend..."
    pip install --no-cache-dir -r "$update_dir/backend/requirements.txt"
  fi

  if [ -d "$update_dir/frontend/dist" ]; then
    echo "  Reemplazando frontend..."
    mkdir -p "$FRONTEND_HTML_DIR"
    find "$FRONTEND_HTML_DIR" -mindepth 1 ! -name '.maintenance' ! -name 'maintenance.html' -exec rm -rf {} +
    cp -a "$update_dir/frontend/dist/." "$FRONTEND_HTML_DIR/"
  fi

  if [ -d "$update_dir/engine" ]; then
    echo "  Reemplazando engine..."
    mkdir -p "$ENGINE_DIR"
    rm -rf "$ENGINE_DIR"/*
    cp -a "$update_dir/engine/." "$ENGINE_DIR/"
  fi

  if [ -d "$update_dir/automation-worker" ]; then
    echo "  Reemplazando worker..."
    mkdir -p "$WORKER_DIR"
    rm -rf "$WORKER_DIR"/*
    cp -a "$update_dir/automation-worker/." "$WORKER_DIR/"
  fi

  rm -f "$flag_file"
  echo "Update pendiente aplicado."
}

backup_database() {
  if [ "$AUTO_BACKUP_ENABLED" != "true" ]; then
    return 0
  fi
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "pg_dump no disponible; se omite backup pre-migracion."
    return 0
  fi
  pg_url="$(database_url_for_pg_dump)"
  if [ -z "$pg_url" ]; then
    echo "DATABASE_URL no es PostgreSQL; se omite backup pre-migracion."
    return 0
  fi

  mkdir -p "$DB_BACKUP_DIR"
  backup_path="$DB_BACKUP_DIR/pre-migration-$(date -u +%Y%m%d_%H%M%S).sql.gz"
  echo "Creando backup pre-migracion: $backup_path"
  pg_dump --clean --if-exists "$pg_url" | gzip > "$backup_path"
  ENTRYPOINT_DB_BACKUP="$backup_path"
  ls -t "$DB_BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +"$((MAX_BACKUPS + 1))" | xargs -r rm -f
}

run_migrations() {
  echo "Ejecutando migraciones..."
  (cd "$APP_DIR" && alembic upgrade head)

  expected_schema_file="$BACKEND_APP_DIR/expected_schema.json"
  if [ -f "$expected_schema_file" ]; then
    export TRESEKO_EXPECTED_SCHEMA_FILE="$expected_schema_file"
    expected_revision="$(python - <<'PY'
import json
import os
try:
    with open(os.environ['TRESEKO_EXPECTED_SCHEMA_FILE'], encoding='utf-8') as fh:
        print(json.load(fh).get('revision') or '')
except Exception:
    print('')
PY
)"
    if [ -n "$expected_revision" ]; then
      current_revision="$(cd "$APP_DIR" && alembic current 2>/dev/null | head -1 | awk '{print $1}')"
      if [ "$current_revision" != "$expected_revision" ]; then
        echo "WARNING: schema revision esperada=$expected_revision actual=$current_revision"
      fi
    fi
  fi
}

apply_pending_update
backup_database
run_migrations
maintenance_off
ENTRYPOINT_UPDATE_IN_PROGRESS="false"
if [ -n "$ENTRYPOINT_UPDATE_FAILED_FILE" ]; then
  rm -f "$ENTRYPOINT_UPDATE_FAILED_FILE"
fi

if [ "${1:-}" = "migrate-only" ]; then
  echo "Migraciones listas."
  exit 0
fi

if [ "${1:-}" = "seed-admin" ]; then
  shift
  echo "Creando o asegurando admin inicial..."
  exec python "$APP_DIR/seed_admin.py" "$@"
fi

echo "Iniciando backend..."
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"

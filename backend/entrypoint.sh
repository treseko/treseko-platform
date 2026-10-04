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
ENTRYPOINT_UPDATE_TASK_ID=""
ENTRYPOINT_UPDATE_VERSION=""
ENTRYPOINT_UPDATE_WORKER_STAGED="false"
AUTO_DB_ROLLBACK_ON_FAILURE="${TRESEKO_AUTO_DB_ROLLBACK_ON_MIGRATION_FAILURE:-false}"
# Backend lanzado en segundo plano mientras se confirma la convergencia.
BACKEND_PID=""
# Motivo ultimo por el que la convergencia de componentes sigue pendiente.
CONVERGENCE_REASON=""
# Marcador leido por el historial de updates para distinguir un arranque
# interrumpido de un arranque que esta aplicando un update en curso.
CONVERGENCE_PENDING_FILE="$UPDATES_DIR/update-convergence-pending"

migrate_instance_identity() {
  persistent_identity_file="${TRESEKO_INSTANCE_ID_FILE:-$UPDATES_DIR/instance_id}"
  legacy_identity_file="${HOME:-/root}/.treseko/instance_id"
  if [ ! -s "$persistent_identity_file" ] && [ -s "$legacy_identity_file" ]; then
    mkdir -p "$(dirname "$persistent_identity_file")"
    cp -p "$legacy_identity_file" "$persistent_identity_file"
    chmod 600 "$persistent_identity_file"
    echo "Identidad de instalacion migrada al almacenamiento persistente."
  fi
}

read_version() {
  if [ -n "$VERSION_FILE" ] && [ -r "$VERSION_FILE" ]; then
    cat "$VERSION_FILE"
    return 0
  fi
  for candidate in "$APP_DIR/VERSION" /VERSION "$APP_DIR/../VERSION"; do
    if [ -r "$candidate" ]; then
      cat "$candidate"
      return 0
    fi
  done
  echo unknown
}

echo "=== Treseko Startup ==="
echo "Version: $(read_version)"
migrate_instance_identity

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
load_env_from_file DB_PASSWORD
load_env_from_file SECRET_KEY
load_env_from_file AI_ENGINE_INTERNAL_TOKEN

installation_mode_gate() {
  python_bin="$(command -v python || command -v python3 || true)"
  [ -n "$python_bin" ] || { echo "Python runtime unavailable for installation mode gate" >&2; return 2; }
  INSTALLATION_MODE_COMMAND="$1" PYTHONPATH="$APP_DIR${PYTHONPATH:+:$PYTHONPATH}" "$python_bin" - <<'PY'
import os
try:
    from app.services.update_installation_mode import InstallationModeError, require
except ModuleNotFoundError as exc:
    # A 1.0.2 image has no gate module. Preserve its ordinary legacy boot and
    # migrate-only path; coordinated signals must still fail closed. The
    # coordinator uses the explicit coordinated-serve command, so allowing
    # legacy here does not bypass the newer admission path.
    if (exc.name or "").startswith("app.services") and not (
        os.environ.get("TRESEKO_COORDINATED_BACKEND_BOOT", "").strip()
    ) and os.environ.get("INSTALLATION_MODE_COMMAND") in {"legacy", "migrate-only"}:
        raise SystemExit(0)
    print("Installation mode gate unavailable", file=os.sys.stderr)
    raise SystemExit(2)

try:
    require(os.environ["INSTALLATION_MODE_COMMAND"])
except InstallationModeError as exc:
    print(f"Installation mode admission blocked: {exc.code}", file=os.sys.stderr)
    raise SystemExit(2)
PY
}

if [ "${TRESEKO_DEPLOY_MODE:-}" = "docker" ] && [ -n "${DB_PASSWORD:-}" ]; then
  encoded_db_password="$(python -c \
    'import os, urllib.parse; print(urllib.parse.quote(os.environ["DB_PASSWORD"], safe=""))')"
  DATABASE_URL="postgresql+asyncpg://${DB_USER:-treseko}:${encoded_db_password}@${DB_HOST:-db}:${DB_PORT:-5432}/${DB_NAME:-treseko}"
  export DATABASE_URL
fi

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

validate_frontend_runtime() {
  expected_version="$1"
  [ -n "$expected_version" ] || return 1
  [ -r "$FRONTEND_HTML_DIR/VERSION" ] || {
    echo "Frontend actualizado sin VERSION." >&2
    return 1
  }
  [ -r "$FRONTEND_HTML_DIR/version.json" ] || {
    echo "Frontend actualizado sin version.json." >&2
    return 1
  }
  FRONTEND_EXPECTED_VERSION="$expected_version" FRONTEND_HTML_DIR="$FRONTEND_HTML_DIR" python - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["FRONTEND_HTML_DIR"])
expected = os.environ["FRONTEND_EXPECTED_VERSION"].strip()
version_file = (root / "VERSION").read_text(encoding="utf-8").strip()
metadata = json.loads((root / "version.json").read_text(encoding="utf-8"))
metadata_version = str(metadata.get("version") or "").strip()
if version_file != expected or metadata_version != expected:
    raise SystemExit(
        f"Frontend inconsistente despues del update: VERSION={version_file!r}, "
        f"version.json={metadata_version!r}, esperado={expected!r}"
    )
PY
}

backup_runtime_code() {
  mkdir -p "$DB_BACKUP_DIR"
  ENTRYPOINT_CODE_BACKUP="$DB_BACKUP_DIR/pre-entrypoint-code-$(date -u +%Y%m%d_%H%M%S).tar.gz"
  backup_src="$UPDATES_DIR/entrypoint-backup-src-$(date -u +%Y%m%d_%H%M%S)"
  rm -rf "$backup_src"
  mkdir -p "$backup_src"
  echo "Creando backup de codigo pre-update: $ENTRYPOINT_CODE_BACKUP"
  if [ -d "$BACKEND_APP_DIR" ]; then
    mkdir -p "$backup_src/backend_app"
    find "$BACKEND_APP_DIR" -mindepth 1 -maxdepth 1 ! -name static -exec cp -a {} "$backup_src/backend_app/" \;
  fi
  [ -d "$ALEMBIC_DIR" ] && cp -a "$ALEMBIC_DIR" "$backup_src/backend_alembic"
  [ -d "$FRONTEND_HTML_DIR" ] && cp -a "$FRONTEND_HTML_DIR" "$backup_src/frontend_html"
  [ -d "$ENGINE_DIR" ] && cp -a "$ENGINE_DIR" "$backup_src/engine"
  [ -d "$WORKER_DIR" ] && cp -a "$WORKER_DIR" "$backup_src/worker"
  [ -f "$APP_DIR/VERSION" ] && cp -a "$APP_DIR/VERSION" "$backup_src/VERSION"
  [ -f "$APP_DIR/entrypoint.sh" ] && cp -a "$APP_DIR/entrypoint.sh" "$backup_src/entrypoint.sh"
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
  # Keep persistent runtimes quiescent while restoring them. The Engine or
  # Worker may otherwise restart asynchronously and recreate node_modules
  # during the rollback copy.
  for runtime_dir in "$ENGINE_DIR" "$WORKER_DIR"; do
    if [ -d "$runtime_dir" ]; then
      rm -f "$runtime_dir/.treseko-update-restart"
      : > "$runtime_dir/.treseko-update-rollback"
    fi
  done
  echo "Restaurando codigo desde backup: $ENTRYPOINT_CODE_BACKUP"
  tar -xzf "$ENTRYPOINT_CODE_BACKUP" -C "$restore_dir"

  if [ -d "$restore_dir/backend_app" ]; then
    mkdir -p "$BACKEND_APP_DIR"
    find "$BACKEND_APP_DIR" -mindepth 1 -maxdepth 1 ! -name static -exec rm -rf {} +
    find "$restore_dir/backend_app" -mindepth 1 -maxdepth 1 ! -name static -exec cp -a {} "$BACKEND_APP_DIR/" \;
  fi
  if [ -d "$restore_dir/backend_alembic" ]; then
    rm -rf "$ALEMBIC_DIR"
    mkdir -p "$(dirname "$ALEMBIC_DIR")"
    cp -a "$restore_dir/backend_alembic" "$ALEMBIC_DIR"
  fi
  if [ -d "$restore_dir/frontend_html" ]; then
    mkdir -p "$FRONTEND_HTML_DIR"
    find "$FRONTEND_HTML_DIR" -mindepth 1 -maxdepth 1 ! -name '.maintenance' ! -name '.treseko-update-fence' ! -name 'maintenance.html' -exec rm -rf {} +
    find "$restore_dir/frontend_html" -mindepth 1 -maxdepth 1 ! -name '.maintenance' ! -name '.treseko-update-fence' -exec cp -a {} "$FRONTEND_HTML_DIR/" \;
    # El backup puede contener la marca activa del update fallido. No debe
    # sobrevivir al rollback: maintenance_off debe poder liberar la interfaz.
    rm -f "$MAINTENANCE_MARKER"
  fi
  if [ -d "$restore_dir/engine" ]; then
    mkdir -p "$ENGINE_DIR"
    find "$ENGINE_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$restore_dir/engine/." "$ENGINE_DIR/"
  fi
  if [ -d "$restore_dir/worker" ]; then
    mkdir -p "$WORKER_DIR"
    find "$WORKER_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$restore_dir/worker/." "$WORKER_DIR/"
  fi
  rm -f "$ENGINE_DIR/.treseko-update-restart" "$WORKER_DIR/.treseko-update-restart"
  rm -f "$ENGINE_DIR/.treseko-update-rollback" "$WORKER_DIR/.treseko-update-rollback"
  if [ -f "$restore_dir/VERSION" ]; then
    cp -a "$restore_dir/VERSION" "$APP_DIR/VERSION"
  fi
  if [ -f "$restore_dir/entrypoint.sh" ]; then
    cp -a "$restore_dir/entrypoint.sh" "$APP_DIR/entrypoint.sh"
    chmod 755 "$APP_DIR/entrypoint.sh"
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

# El Automation Worker solo puede consumir su marca de reinicio cuando su
# heartbeat contra la API termina bien, y la API no puede responder mientras el
# entrypoint aun no ha arrancado el backend. Por eso la convergencia del Worker
# se confirma con el backend ya en marcha y todavia en mantenimiento: la
# version instalada, la tarea aplicada y la baja de mantenimiento ocurren
# despues de esa confirmacion, nunca antes.
start_backend_background() {
  echo "Iniciando backend en segundo plano para confirmar componentes."
  uvicorn app.main:app --host 0.0.0.0 --port "$PORT" &
  BACKEND_PID=$!
  trap 'stop_backend_background; exit 143' TERM INT
}

stop_backend_background() {
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Deteniendo backend en segundo plano."
    kill -TERM "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  BACKEND_PID=""
}

serve_backend_background() {
  echo "Backend en marcha; esperando proceso."
  set +e
  wait "$BACKEND_PID"
  backend_status=$?
  set -e
  BACKEND_PID=""
  exit "$backend_status"
}

wait_for_worker_restart_convergence() {
  expected_version="$1"
  timeout_seconds="${TRESEKO_UPDATE_WORKER_CONVERGENCE_TIMEOUT_SECONDS:-120}"
  deadline=$(($(date +%s) + timeout_seconds))
  echo "Esperando que el Automation Worker consuma su marca de reinicio..."
  while [ -f "$WORKER_DIR/.treseko-update-restart" ]; do
    if [ -n "$BACKEND_PID" ] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo "El backend dejo de ejecutarse durante la convergencia del Worker." >&2
      return 1
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "El Worker no consumio la marca de reinicio en ${timeout_seconds}s (¿hay trabajos activos?). La actualizacion no converge en Automation Worker." >&2
      return 1
    fi
    sleep 2
  done
  if [ ! -f "$WORKER_DIR/VERSION" ] || [ "$(tr -d '[:space:]' < "$WORKER_DIR/VERSION")" != "$expected_version" ]; then
    echo "El Worker reinicio con una VERSION distinta de ${expected_version}." >&2
    return 1
  fi
  echo "Automation Worker convergio en ${expected_version}."
}

# El paquete de update firma y verifica su checksum antes de escribir estos
# archivos. El manifiesto deja constancia de ese origen para que los entrypoints
# de los componentes distingan un runtime instalado por la propia actualizacion
# de un runtime divergente, en lugar de bloquear el arranque.
write_runtime_manifest() {
  target_dir="$1"
  target_version="$2"
  [ -d "$target_dir" ] || return 0
  printf '{"schema": 1, "source": "legacy-payload", "version": "%s", "task_id": "%s", "applied_at": "%s"}\n' \
    "$target_version" "${ENTRYPOINT_UPDATE_TASK_ID:-}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$target_dir/.treseko-runtime-manifest.json"
}

write_convergence_pending() {
  if [ "$ENTRYPOINT_UPDATE_IN_PROGRESS" != "true" ]; then
    return 0
  fi
  printf '{"schema": 1, "status": "applying", "task_id": "%s", "version": "%s"}\n' \
    "${ENTRYPOINT_UPDATE_TASK_ID:-}" "${ENTRYPOINT_UPDATE_VERSION:-}" \
    > "$CONVERGENCE_PENDING_FILE"
}

# Solo cuando migraciones y componentes convergieron se publica la version, se
# marca la tarea aplicada y se levanta el mantenimiento. El orden es contrato:
# la instalacion nunca comunica una release que todavia no esta completa.
finalize_pending_update() {
  commit_installed_version
  mark_update_applied
  maintenance_off
  ENTRYPOINT_UPDATE_IN_PROGRESS="false"
  rm -f "$CONVERGENCE_PENDING_FILE"
  if [ -n "$ENTRYPOINT_UPDATE_FAILED_FILE" ]; then
    rm -f "$ENTRYPOINT_UPDATE_FAILED_FILE"
  fi
}

rollback_on_exit() {
  status="$?"
  # Nunca restaurar codigo mientras el backend sigue corriendo, y limpiar el
  # marcador para que el siguiente arranque vuelva a tratar la tarea como
  # interrumpida si llego hasta aqui sin converger.
  stop_backend_background
  rm -f "$CONVERGENCE_PENDING_FILE"
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

  update_payload="$(cat "$flag_file" 2>/dev/null || true)"
  update_dir="$update_payload"
  case "$update_payload" in
    \{*)
      update_dir="$(UPDATE_PAYLOAD="$update_payload" python - <<'PY'
import json, os
try:
    print(json.loads(os.environ["UPDATE_PAYLOAD"]).get("path") or "")
except Exception:
    print("")
PY
)"
      ENTRYPOINT_UPDATE_TASK_ID="$(UPDATE_PAYLOAD="$update_payload" python - <<'PY'
import json, os
try:
    print(json.loads(os.environ["UPDATE_PAYLOAD"]).get("task_id") or "")
except Exception:
    print("")
PY
)"
      ENTRYPOINT_UPDATE_VERSION="$(UPDATE_PAYLOAD="$update_payload" python - <<'PY'
import json, os
try:
    print(json.loads(os.environ["UPDATE_PAYLOAD"]).get("version") or "")
except Exception:
    print("")
PY
)"
      ;;
  esac
  if [ -z "$ENTRYPOINT_UPDATE_VERSION" ] && [ -r "$update_dir/VERSION" ]; then
    ENTRYPOINT_UPDATE_VERSION="$(tr -d '[:space:]' < "$update_dir/VERSION")"
  fi
  if [ -z "$update_dir" ] || [ ! -d "$update_dir" ]; then
    echo "Update pendiente invalido: $update_dir"
    rm -f "$flag_file"
    return 1
  fi

  # Validar todo el staging antes de activar mantenimiento o reemplazar runtime.
  # El preflight usa solo la biblioteca estandar y protege instalaciones antiguas.
  if [ -f "$update_dir/backend/app/services/update_package_preflight.py" ]; then
    echo "Validando integridad del paquete antes de aplicar..."
    PYTHONPATH="$update_dir/backend" python -m app.services.update_package_preflight --root "$update_dir"
  else
    echo "Paquete sin preflight de integridad; se rechaza antes de modificar la instalacion." >&2
    return 1
  fi

  maintenance_on
  ENTRYPOINT_UPDATE_IN_PROGRESS="true"
  ENTRYPOINT_UPDATE_FAILED_FILE="$failed_file"
  ENTRYPOINT_UPDATE_DIR="$update_dir"
  rm -f "$failed_file"
  backup_runtime_code
  expected_payload_version="${ENTRYPOINT_UPDATE_VERSION:-$(cat "$update_dir/VERSION" 2>/dev/null || true)}"
  write_convergence_pending
  echo "Aplicando update pendiente desde: $update_dir"

  if [ -d "$update_dir/backend/app" ]; then
    echo "  Reemplazando backend..."
    # static es un volumen persistente con adjuntos, evidencias y branding.
    # Nunca debe eliminarse al reemplazar el codigo de la aplicacion.
    mkdir -p "$BACKEND_APP_DIR"
    find "$BACKEND_APP_DIR" -mindepth 1 -maxdepth 1 ! -name static -exec rm -rf {} +
    find "$update_dir/backend/app" -mindepth 1 -maxdepth 1 ! -name static -exec cp -a {} "$BACKEND_APP_DIR/" \;
    if [ -d "$update_dir/backend/app/static" ]; then
      mkdir -p "$BACKEND_APP_DIR/static"
      cp -a "$update_dir/backend/app/static/." "$BACKEND_APP_DIR/static/"
    fi
  fi

  # The entrypoint belongs to the backend runtime, not only to the image that
  # originally installed it. A legacy 1.0.2 installation must receive the
  # compatible bootstrap before its next restart; otherwise it keeps executing
  # the old gate against the new application code and can enter a restart loop.
  if [ -f "$update_dir/backend/entrypoint.sh" ]; then
    echo "  Actualizando entrypoint de backend..."
    cp "$update_dir/backend/entrypoint.sh" "$APP_DIR/entrypoint.sh"
    chmod 755 "$APP_DIR/entrypoint.sh"
  fi

  # La version instalada no se publica aqui: se confirma la ultima, despues de
  # migrar y de converger todos los componentes (ver commit_installed_version).
  # Adelantarla dejaba la instalacion comunicando una version que todavia no
  # estaba completa en el resto de los modulos.

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
    find "$FRONTEND_HTML_DIR" -mindepth 1 -maxdepth 1 ! -name '.maintenance' ! -name '.treseko-update-fence' ! -name 'maintenance.html' -exec rm -rf {} +
    find "$update_dir/frontend/dist" -mindepth 1 -maxdepth 1 ! -name '.maintenance' ! -name '.treseko-update-fence' -exec cp -a {} "$FRONTEND_HTML_DIR/" \;
    expected_frontend_version="${ENTRYPOINT_UPDATE_VERSION:-$(cat "$update_dir/VERSION")}"
    validate_frontend_runtime "$expected_frontend_version"
    write_runtime_manifest "$FRONTEND_HTML_DIR" "$expected_frontend_version"
  fi

  # Frontend es otro contenedor. La marca permite que su entrypoint cierre
  # nginx y Docker lo levante con el bundle ya reemplazado.
  if [ -d "$FRONTEND_HTML_DIR" ]; then
    : > "$FRONTEND_HTML_DIR/.treseko-update-restart"
  fi

  if [ -d "$update_dir/engine" ]; then
    echo "  Reemplazando engine..."
    mkdir -p "$ENGINE_DIR"
    find "$ENGINE_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$update_dir/engine/." "$ENGINE_DIR/"
    # El Engine detecta esta marca y se reinicia despues de que el backend
    # termine de reemplazar sus fuentes. No se corta una ejecucion en curso.
    : > "$ENGINE_DIR/.treseko-update-restart"
    # Engine corre con UID dedicado 10001. El backend aplica el update como
    # root, por lo que debe devolverle propiedad para que pueda consumir la
    # marca y reiniciarse.
    write_runtime_manifest "$ENGINE_DIR" "$expected_payload_version"
    chown -R 10001:10001 "$ENGINE_DIR"
  fi

  if [ -d "$update_dir/automation-worker" ]; then
    echo "  Reemplazando worker..."
    mkdir -p "$WORKER_DIR"
    # Pairing and local configuration belong to this installation, including
    # workers whose backend is on another host. Never replace them from a release.
    find "$WORKER_DIR" -mindepth 1 -maxdepth 1 ! -name '.runner-token' ! -name '.runner-token.pairing' ! -name '.worker-instance-id' ! -name '.env' -exec rm -rf {} +
    find "$update_dir/automation-worker" -mindepth 1 -maxdepth 1 ! -name '.runner-token' ! -name '.runner-token.pairing' ! -name '.worker-instance-id' ! -name '.env' -exec cp -a {} "$WORKER_DIR/" \;
    # Workers nuevos consumen esta marca cuando terminan el job activo. Las
    # releases anteriores requieren un reinicio manual unico para adoptar este
    # comportamiento, sin interrumpir ejecuciones en curso.
    : > "$WORKER_DIR/.treseko-update-restart"
    write_runtime_manifest "$WORKER_DIR" "$expected_payload_version"
    ENTRYPOINT_UPDATE_WORKER_STAGED="true"
  fi

  rm -f "$flag_file"
  echo "Update pendiente aplicado; faltan migraciones, convergencia de componentes y confirmacion de version."
}

mark_update_applied() {
  if [ -n "$ENTRYPOINT_UPDATE_TASK_ID" ]; then
    UPDATE_TASK_ID="$ENTRYPOINT_UPDATE_TASK_ID" UPDATE_VERSION="$ENTRYPOINT_UPDATE_VERSION" python - <<'PY' > "$UPDATES_DIR/update-applied"
import json, os
print(json.dumps({"task_id": os.environ["UPDATE_TASK_ID"], "version": os.environ.get("UPDATE_VERSION", "")}))
PY
  fi
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

component_versions_converged() {
  expected_version="$1"

  if [ -z "$expected_version" ]; then
    CONVERGENCE_REASON="falta la version esperada del update"
    echo "No se puede verificar la convergencia: falta la version esperada." >&2
    return 1
  fi

  # El frontend se sirve desde un volumen compartido, pero su proceso nginx
  # debe consumir la marca antes de considerar completado el update.
  if [ "${TRESEKO_DEPLOY_MODE:-docker}" = "docker" ] && [ -f "$FRONTEND_HTML_DIR/.treseko-update-restart" ]; then
    CONVERGENCE_REASON="Frontend: nginx aun no consumo la marca de reinicio"
    return 1
  fi
  if ! FRONTEND_EXPECTED_VERSION="$expected_version" FRONTEND_HTML_DIR="$FRONTEND_HTML_DIR" python - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["FRONTEND_HTML_DIR"])
expected = os.environ["FRONTEND_EXPECTED_VERSION"].strip()
version_path = root / "VERSION"
metadata_path = root / "version.json"
if not version_path.is_file() or not metadata_path.is_file():
    raise SystemExit(1)
if version_path.read_text(encoding="utf-8").strip() != expected:
    raise SystemExit(1)
metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
if str(metadata.get("version") or "").strip() != expected:
    raise SystemExit(1)
PY
  then
    CONVERGENCE_REASON="Frontend: VERSION o version.json distinto de ${expected_version}"
    return 1
  fi

  # El Engine expone su propia version. No alcanza con que exista el archivo
  # VERSION: hay que confirmar que el proceso cargado ya sea el nuevo.
  engine_url="${ENGINE_URL:-http://engine:3010}"
  if ! ENGINE_EXPECTED_VERSION="$expected_version" ENGINE_HEALTH_URL="${engine_url%/}/health" python - <<'PY'
import json
import os
import urllib.request

try:
    with urllib.request.urlopen(os.environ["ENGINE_HEALTH_URL"], timeout=3) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if str(payload.get("version") or "").strip() != os.environ["ENGINE_EXPECTED_VERSION"].strip():
        raise SystemExit(1)
except Exception:
    raise SystemExit(1)
PY
  then
    CONVERGENCE_REASON="Engine: /health no responde con la version ${expected_version}"
    return 1
  fi
  if [ -f "$ENGINE_DIR/.treseko-update-restart" ]; then
    CONVERGENCE_REASON="Engine: el proceso aun no consumo la marca de reinicio"
    return 1
  fi

  # La marca de reinicio del Worker se confirma fuera de esta funcion, una vez
  # que el backend responde: su proceso solo la consume tras un heartbeat exitoso
  # y, antes de arrancar la API, esa espera no puede terminar. Aqui solo se
  # exige que el runtime instalado contenga la version esperada.
  # Las instalaciones sin perfil automation no tienen worker que esperar.
  if [ -f "$WORKER_DIR/.runner-token" ]; then
    if [ ! -f "$WORKER_DIR/VERSION" ] || [ "$(tr -d '[:space:]' < "$WORKER_DIR/VERSION")" != "$expected_version" ]; then
      CONVERGENCE_REASON="Automation Worker: VERSION distinto de ${expected_version}"
      return 1
    fi
  elif [ "$ENTRYPOINT_UPDATE_WORKER_STAGED" = "true" ]; then
    # El payload reescribio el runtime del worker. Aunque no haya proceso
    # emparejado que consuma la marca, el codigo instalado debe ser el nuevo
    # antes de dar la actualizacion por aplicada.
    if [ ! -f "$WORKER_DIR/VERSION" ] || [ "$(tr -d '[:space:]' < "$WORKER_DIR/VERSION")" != "$expected_version" ]; then
      CONVERGENCE_REASON="Automation Worker: VERSION distinto de ${expected_version}"
      return 1
    fi
  fi

  CONVERGENCE_REASON=""
  return 0
}

wait_for_component_convergence() {
  expected_version="$1"
  timeout_seconds="${TRESEKO_UPDATE_COMPONENT_CONVERGENCE_TIMEOUT_SECONDS:-180}"
  started_at="$(date +%s)"
  deadline=$((started_at + timeout_seconds))
  last_reason=""

  echo "Esperando convergencia de componentes en ${expected_version} (timeout ${timeout_seconds}s)."
  while :; do
    if component_versions_converged "$expected_version"; then
      # La marca de reinicio del Worker no puede consumirse antes de que el
      # backend responda, asi que pre-arranque solo se confirma su VERSION y
      # su reinicio se comprueba despues, con el backend ya en marcha.
      if [ -f "$WORKER_DIR/.treseko-update-restart" ]; then
        echo "Frontend y Engine convergieron en ${expected_version}; VERSION del Worker confirmada, reinicio del Worker pendiente."
      else
        echo "Frontend, Engine y Worker convergieron en ${expected_version}."
      fi
      return 0
    fi
    if [ -n "$CONVERGENCE_REASON" ] && [ "$CONVERGENCE_REASON" != "$last_reason" ]; then
      echo "Convergencia pendiente: $CONVERGENCE_REASON"
      last_reason="$CONVERGENCE_REASON"
    fi
    now="$(date +%s)"
    if [ "$now" -ge "$deadline" ]; then
      echo "La actualizacion no convergio en todos los componentes antes del timeout." >&2
      if [ -n "$CONVERGENCE_REASON" ]; then
        echo "Componente pendiente: $CONVERGENCE_REASON" >&2
      fi
      return 1
    fi
    sleep 2
  done
}

write_installed_version() {
  target="$1"
  staged_version_file="$ENTRYPOINT_UPDATE_DIR/VERSION"
  mkdir -p "$(dirname "$target")"
  if [ -r "$staged_version_file" ]; then
    cp "$staged_version_file" "$target"
  else
    printf '%s\n' "$ENTRYPOINT_UPDATE_VERSION" > "$target"
  fi
  committed_version="$(tr -d '[:space:]' < "$target")"
  if [ "$committed_version" != "$ENTRYPOINT_UPDATE_VERSION" ]; then
    echo "Version instalada no confirmada en $target: '$committed_version' != '$ENTRYPOINT_UPDATE_VERSION'." >&2
    return 1
  fi
}

# La version instalada es la ultima pieza del update. Solo se publica cuando
# las migraciones corrieron y todos los componentes convergieron, de modo que
# la instalacion nunca comunica una release que todavia no esta completa. Si
# algo falla antes, el rollback restaura el VERSION anterior sin haberlo
# cambiado nunca.
commit_installed_version() {
  if [ "$ENTRYPOINT_UPDATE_IN_PROGRESS" != "true" ] || [ -z "$ENTRYPOINT_UPDATE_VERSION" ]; then
    return 0
  fi
  write_installed_version "$APP_DIR/VERSION"
  if [ -n "$VERSION_FILE" ] && [ "$VERSION_FILE" != "$APP_DIR/VERSION" ]; then
    # Instalaciones systemd publican la version desde TRESEKO_VERSION_FILE,
    # que queda fuera de APP_DIR. Ambos archivos deben quedar en la release.
    write_installed_version "$VERSION_FILE"
  fi
  echo "Version instalada confirmada en $ENTRYPOINT_UPDATE_VERSION."
}

# A one-shot database participant must not consume the shared update request,
# mutate other components or release a fence owned by the update coordinator.
# In Compose it runs before backend/Engine; waiting for their versions here
# creates a startup cycle. Failure remains nonzero for the caller to recover.
if [ "${1:-}" = "migrate-only" ]; then
  installation_mode_gate migrate-only
  # The update coordinator owns prepared packages. A migration-only process
  # must ignore update-ready, even when its marker points to an invalid path.
  backup_database
  run_migrations
  echo "Migraciones listas; no se aplicaron ni finalizaron updates de componentes."
  exit 0
fi

# The host coordinator owns package application, backups, migrations and global
# version verification in this mode. Never consume a legacy update-ready file
# or remove maintenance here. ASGI defers initialization while its API fence is
# present, then keeps admission closed until initialization succeeds.
if [ "${1:-}" = "coordinated-serve" ]; then
  installation_mode_gate coordinated-serve
  if [ -z "${TRESEKO_BACKEND_UPDATE_CONTROL_DIR:-}" ]; then
    echo "Dedicated API update control directory required" >&2
    exit 2
  fi
  export TRESEKO_COORDINATED_BACKEND_BOOT=true
  echo "Iniciando backend bajo control del coordinador; sin migraciones ni finalizacion local."
  exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
fi

# Local atomic updates use this persistent runtime after host-owned migration.
# It is safe both during candidate verification and after later container
# restarts: never apply a staged package, rerun migrations or remove the fence.
if [ "${1:-}" = "atomic-serve" ]; then
  echo "Iniciando backend bajo control del coordinador atomico; sin migraciones ni cambios de barrera."
  exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
fi

installation_mode_gate legacy
apply_pending_update
backup_database
run_migrations
if [ "$ENTRYPOINT_UPDATE_IN_PROGRESS" = "true" ]; then
  wait_for_component_convergence "$ENTRYPOINT_UPDATE_VERSION"
fi

# El Automation Worker emparejado solo consume su marca de reinicio cuando un
# heartbeat contra la API termina bien, y la API no puede responder antes de
# aqui. Esperar esa marca antes de arrancar el backend nunca termina: por eso
# el backend sube primero, todavia con el mantenimiento activo, y la tarea se
# finaliza recien confirmado el reinicio del Worker.
if [ "$ENTRYPOINT_UPDATE_IN_PROGRESS" = "true" ] \
  && [ -f "$WORKER_DIR/.treseko-update-restart" ] \
  && [ -f "$WORKER_DIR/.runner-token" ] \
  && [ "${1:-}" != "seed-admin" ]; then
  start_backend_background
  if ! wait_for_worker_restart_convergence "$ENTRYPOINT_UPDATE_VERSION"; then
    echo "La actualizacion no converge en Automation Worker; se revierte el update." >&2
    exit 1
  fi
  finalize_pending_update
  serve_backend_background
fi

finalize_pending_update

if [ "${1:-}" = "seed-admin" ]; then
  shift
  echo "Creando o asegurando admin inicial..."
  exec python "$APP_DIR/seed_admin.py" "$@"
fi

echo "Iniciando backend..."
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"

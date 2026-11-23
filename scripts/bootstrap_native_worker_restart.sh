#!/usr/bin/env bash
set -euo pipefail

# One-time compatibility bridge for native 1.0.7 installations. The worker
# shipped by 1.0.7 exits cleanly after an OTA marker; this drop-in ensures
# systemd starts the newly installed worker without restarting it immediately.
if [[ "$(uname -s)" != "Linux" || "$(id -u)" -ne 0 ]]; then
  echo "Ejecuta este bootstrap como root en Linux con systemd (por ejemplo, sudo bash $0)." >&2
  exit 2
fi

SYSTEMCTL_BIN="$(command -v systemctl || true)"
UNIT_NAME="${TRESEKO_WORKER_UNIT:-treseko-worker.service}"
UNIT_DIR="/etc/systemd/system"

if [[ -z "$SYSTEMCTL_BIN" || ! -x "$SYSTEMCTL_BIN" ]]; then
  echo "No se encontro systemctl; no se modifico la instalacion." >&2
  exit 2
fi
if [[ ! "$UNIT_NAME" =~ ^[A-Za-z0-9_.@:-]+\.service$ ]]; then
  echo "Nombre de unidad systemd no valido." >&2
  exit 2
fi

UNIT_FILE="${UNIT_DIR}/${UNIT_NAME}"
DROPIN_DIR="${UNIT_DIR}/${UNIT_NAME}.d"
DROPIN="${DROPIN_DIR}/90-treseko-ota-restart.conf"

if [[ ! -f "$UNIT_FILE" || -L "$UNIT_FILE" ]]; then
  echo "No existe una unidad systemd regular para ${UNIT_NAME}; no se modifico nada." >&2
  exit 2
fi
if ! "$SYSTEMCTL_BIN" show "$UNIT_NAME" --property=LoadState --value 2>/dev/null | grep -qx loaded; then
  echo "La unidad ${UNIT_NAME} no esta cargada; no se modifico nada." >&2
  exit 2
fi

current_restart="$("$SYSTEMCTL_BIN" show "$UNIT_NAME" --property=Restart --value 2>/dev/null || true)"
if [[ "$current_restart" == always ]]; then
  echo "${UNIT_NAME} ya reinicia siempre; bootstrap sin cambios."
  exit 0
fi

if [[ -L "$DROPIN_DIR" || -L "$DROPIN" ]]; then
  echo "El directorio o archivo drop-in es un enlace simbolico; no se modifico nada." >&2
  exit 2
fi
if [[ -e "$DROPIN_DIR" && ! -d "$DROPIN_DIR" ]]; then
  echo "La ruta de drop-ins no es un directorio; no se modifico nada." >&2
  exit 2
fi
if [[ -e "$DROPIN" ]]; then
  if ! grep -q '^# Managed by Treseko OTA bootstrap v1$' "$DROPIN"; then
    echo "Ya existe un drop-in ajeno en ${DROPIN}; no se sobrescribio." >&2
    exit 2
  fi
fi

backup=""
had_dropin=false
if [[ -e "$DROPIN" ]]; then
  had_dropin=true
  backup="${DROPIN}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p -- "$DROPIN" "$backup"
  chmod 0600 "$backup"
fi

mkdir -p -m 0755 "$DROPIN_DIR"
temporary="$(mktemp "${DROPIN_DIR}/.90-treseko-ota-restart.XXXXXX")"
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT
cat > "$temporary" <<'UNIT'
# Managed by Treseko OTA bootstrap v1
[Service]
Restart=always
UNIT
chmod 0644 "$temporary"
mv -f -- "$temporary" "$DROPIN"

restore_previous() {
  if [[ "$had_dropin" == true && -n "$backup" ]]; then
    cp -p -- "$backup" "$DROPIN"
  else
    rm -f -- "$DROPIN"
  fi
  "$SYSTEMCTL_BIN" daemon-reload >/dev/null 2>&1 || true
}

if ! "$SYSTEMCTL_BIN" daemon-reload; then
  restore_previous
  echo "systemd rechazo daemon-reload; se restauro el estado anterior." >&2
  exit 1
fi
actual_restart="$("$SYSTEMCTL_BIN" show "$UNIT_NAME" --property=Restart --value 2>/dev/null || true)"
if [[ "$actual_restart" != always ]]; then
  restore_previous
  echo "systemd no activo Restart=always; se restauro el estado anterior." >&2
  exit 1
fi

echo "Bootstrap completado: ${UNIT_NAME} reiniciara el Worker nuevo cuando consuma la marca OTA."
echo "El servicio no se reinicio y sus trabajos, datos y credenciales no se tocaron."

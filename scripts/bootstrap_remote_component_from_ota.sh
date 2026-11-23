#!/usr/bin/env bash
set -euo pipefail

# Run this from the unpacked single full OTA on the host that owns the legacy
# systemd Engine or Worker. The bootstrap code and its signed component payload
# are both carried by that same archive.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${PACKAGE_ROOT}/backend"

if [[ ! -f "${BACKEND_DIR}/app/services/update_remote_component_bootstrap.py" ]]; then
  echo "El OTA no contiene el bootstrap de componentes remotos." >&2
  exit 2
fi

export PYTHONPATH="${BACKEND_DIR}${PYTHONPATH:+:${PYTHONPATH}}"
exec "${PYTHON_BIN:-python3}" -m app.services.update_remote_component_bootstrap "$@"

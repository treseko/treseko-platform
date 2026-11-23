#!/usr/bin/env bash
set -euo pipefail

# Run on the Linux host that owns the selected legacy Docker volume. The OTA,
# signed component payload, and this bootstrap are all delivered together.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${PACKAGE_ROOT}/backend"

if [[ ! -f "${BACKEND_DIR}/app/services/update_remote_docker_component_bootstrap.py" ]]; then
  echo "El OTA no contiene el bootstrap Docker de componentes remotos." >&2
  exit 2
fi

export PYTHONPATH="${BACKEND_DIR}${PYTHONPATH:+:${PYTHONPATH}}"
exec "${PYTHON_BIN:-python3}" -m app.services.update_remote_docker_component_bootstrap "$@"

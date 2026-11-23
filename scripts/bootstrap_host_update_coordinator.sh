#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
PROTOCOL="treseko-host-update-coordinator/v1"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Este adaptador requiere Linux; usa el adaptador de macOS o Windows correspondiente." >&2
  exit 2
fi
PYTHON_BIN="$(bash "${SCRIPT_DIR}/prepare_host_bootstrap_python.sh" "${PYTHON_BIN}" "${RELEASE_ROOT}")"

export PYTHONPATH="${RELEASE_ROOT}/backend${PYTHONPATH:+:${PYTHONPATH}}"
export TRESEKO_HOST_BOOTSTRAP_PROTOCOL="${PROTOCOL}"
if [[ "${1:-}" == "migrate" ]]; then
  shift
  exec "${PYTHON_BIN}" -m app.services.update_legacy_host_migration "$@"
fi
exec "${PYTHON_BIN}" -m app.services.update_host_coordinator_cli "$@" \
  --source-release-root "${RELEASE_ROOT}"

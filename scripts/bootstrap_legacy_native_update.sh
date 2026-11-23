#!/usr/bin/env bash
set -euo pipefail

# Run from the source-release extracted from a 1.0.8 single-file OTA bundle.
# The Python bridge verifies the external manifest before staging or restarting.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "La migración nativa requiere Linux con systemd." >&2
  exit 2
fi

PYTHON_BIN="$(bash "${SCRIPT_DIR}/prepare_host_bootstrap_python.sh" "${PYTHON_BIN}" "${RELEASE_ROOT}")"
export PYTHONPATH="${RELEASE_ROOT}/backend${PYTHONPATH:+:${PYTHONPATH}}"
exec "${PYTHON_BIN}" -m app.services.update_legacy_host_migration "$@" --native-systemd

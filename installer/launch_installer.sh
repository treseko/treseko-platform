#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Keep the bootstrap distribution self-contained: it may contain only
# installer/, without frontend/public/ from the full release tree.
ICON_PATH="${SCRIPT_DIR}/treseko-installer.png"

if [[ "$(uname -s)" == "Linux" && -f "${ICON_PATH}" ]]; then
  exec python3 "${SCRIPT_DIR}/treseko_installer.py" --icon "${ICON_PATH}"
fi

exec python3 "${SCRIPT_DIR}/treseko_installer.py"

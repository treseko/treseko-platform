#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${1:-python3}"
RELEASE_ROOT="${2:?release root required}"
REQUIREMENTS="${RELEASE_ROOT}/scripts/host-bootstrap-requirements.txt"
[[ -x "$(command -v "${PYTHON_BIN}" || true)" && -f "${REQUIREMENTS}" && ! -L "${REQUIREMENTS}" ]] || {
  echo "Falta Python 3 o el archivo de dependencias firmado del bootstrap." >&2
  exit 2
}
VERSION="$(${PYTHON_BIN} -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
if ! "${PYTHON_BIN}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "El bootstrap requiere Python 3.11 o posterior; instala Python y vuelve a ejecutarlo." >&2
  exit 2
fi
if ! "${PYTHON_BIN}" -m venv --help >/dev/null 2>&1; then
  echo "La instalación de Python no incluye venv; agrega el módulo venv y vuelve a ejecutar." >&2
  exit 2
fi
if command -v shasum >/dev/null 2>&1; then
  HASH="$(shasum -a 256 "${REQUIREMENTS}" | awk '{print $1}')"
else
  HASH="$(sha256sum "${REQUIREMENTS}" | awk '{print $1}')"
fi
CACHE_ROOT="${HOME}/.cache/treseko/host-bootstrap"
TARGET="${CACHE_ROOT}/python-${VERSION}-${HASH:0:16}"
MARKER="${TARGET}/.ready"
mkdir -p "${HOME}/.cache"
[[ ! -L "${HOME}/.cache" ]] || {
  echo "La ruta de cache de Python no es segura." >&2
  exit 2
}
mkdir -p "${HOME}/.cache/treseko"
[[ ! -L "${HOME}/.cache/treseko" && -O "${HOME}/.cache/treseko" ]] || {
  echo "La ruta privada de dependencias del bootstrap no es segura." >&2
  exit 2
}
chmod 700 "${HOME}/.cache/treseko"
mkdir -p "${CACHE_ROOT}"
chmod 700 "${CACHE_ROOT}"
[[ ! -L "${CACHE_ROOT}" && -O "${CACHE_ROOT}" && ! -L "${TARGET}" ]] || {
  echo "La ruta privada de dependencias del bootstrap no es segura." >&2
  exit 2
}
if [[ ! -x "${TARGET}/bin/python" || ! -f "${MARKER}" ]]; then
  mkdir -p "${TARGET}"
  chmod 700 "${TARGET}"
  "${PYTHON_BIN}" -m venv "${TARGET}"
  "${TARGET}/bin/python" -m pip install --disable-pip-version-check --no-warn-script-location \
    --index-url https://pypi.org/simple -r "${REQUIREMENTS}" >&2
  "${TARGET}/bin/python" -c 'import cryptography'
  printf '%s\n' "${HASH}" > "${MARKER}"
  chmod 600 "${MARKER}"
fi
if [[ ! -O "${TARGET}" || ! -O "${MARKER}" || "$(cat "${MARKER}")" != "${HASH}" ]] || \
   ! "${TARGET}/bin/python" -c 'import cryptography,sys; raise SystemExit(0 if cryptography.__version__ == "50.0.0" else 1)'; then
  echo "El entorno privado de dependencias no coincide con el paquete." >&2
  exit 2
fi
printf '%s\n' "${TARGET}/bin/python"

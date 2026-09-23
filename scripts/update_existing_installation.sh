#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PYTHON_BIN="$REPO_DIR/backend/.venv/bin/python"

if [ ! -x "$PYTHON_BIN" ]; then
    echo "backend virtualenv Python is required: $PYTHON_BIN" >&2
    exit 1
fi

cd "$REPO_DIR/backend"
exec "$PYTHON_BIN" -m app.services.update_existing_installation "$@"

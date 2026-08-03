#!/bin/sh
set -eu

# A backend rollback may race with an Engine restart triggered by an update.
# Hold startup until the backend has restored the persistent runtime files.
while [ -f /engine/.treseko-update-rollback ]; do
  echo "Rollback del Engine en curso; esperando restauracion del runtime..."
  sleep 1
done

if [ -d /opt/treseko/engine-source ] && [ -w /engine ] && [ ! -f /engine/package.json ]; then
  cp -a /opt/treseko/engine-source/. /engine/
fi

# El runtime de Engine es persistente. Si una actualizacion reemplazo
# package.json/lock, sus modulos deben reinstalarse antes de iniciar Node.
if [ -f /engine/package-lock.json ] && { [ ! -d /engine/node_modules ] || [ ! -d /engine/node_modules/express ]; }; then
  echo "Instalando dependencias del Engine actualizadas..."
  (cd /engine && npm ci)
fi

# /engine is a dedicated persistent runtime volume. The source sync above runs
# as root and can leave its files (including logs) root-owned on first boot.
# Restore ownership before dropping privileges so the Engine can persist traces.
if [ "$(id -u)" -eq 0 ]; then
  chown -R treseko-engine:treseko-engine /engine
  # Playwright is installed while building the image as root. Make only the
  # known browser cache traversable/readable for the unprivileged runtime.
  if [ -d /root/.cache/ms-playwright ]; then
    chmod 711 /root /root/.cache
    chown -R treseko-engine:treseko-engine /root/.cache/ms-playwright
    export PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
  fi
fi

if [ -z "${AI_ENGINE_INTERNAL_TOKEN:-}" ] && [ -n "${AI_ENGINE_INTERNAL_TOKEN_FILE:-}" ]; then
  if [ ! -r "$AI_ENGINE_INTERNAL_TOKEN_FILE" ]; then
    echo "AI_ENGINE_INTERNAL_TOKEN_FILE no existe o no es legible" >&2
    exit 1
  fi
  AI_ENGINE_INTERNAL_TOKEN="$(cat "$AI_ENGINE_INTERNAL_TOKEN_FILE")"
  export AI_ENGINE_INTERNAL_TOKEN
fi

if [ "$(id -u)" -eq 0 ] && [ "${TRESEKO_ENGINE_DROPPED:-0}" != "1" ]; then
  export TRESEKO_ENGINE_DROPPED=1
  exec setpriv --reuid=10001 --regid=10001 --init-groups "$@"
fi

exec "$@"

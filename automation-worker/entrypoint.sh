#!/bin/sh
set -eu

# Do not run npm ci while the backend is restoring this persistent runtime.
while [ -f /worker/.treseko-update-rollback ]; do
  echo "Rollback del Worker en curso; esperando restauracion del runtime..."
  sleep 1
done

if [ -d /opt/treseko/worker-source ] && [ ! -f /worker/package.json ]; then
  cp -a /opt/treseko/worker-source/. /worker/
fi

if [ -f /worker/package-lock.json ] && { [ ! -d /worker/node_modules ] || [ ! -d /worker/node_modules/playwright ]; }; then
  echo "Instalando dependencias del Worker actualizadas..."
  (cd /worker && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CYPRESS_INSTALL_BINARY=0 PUPPETEER_SKIP_DOWNLOAD=1 npm ci)
fi

exec "$@"

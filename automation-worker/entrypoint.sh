#!/bin/sh
set -eu

# El entrypoint que Docker ejecuta vive en la imagen y ninguna actualizacion
# puede reescribirlo. Este archivo es a la vez el entrypoint de la imagen y el
# que el paquete instala en el volumen: si existen las dos copias, la de la
# imagen delega en la del volumen, de modo que toda correccion futura de este
# componente viaja dentro de la actualizacion. La condicion sobre $0 corta la
# recursion cuando la copia delegada vuelve a ejecutar este mismo archivo.
if [ "$0" != "/worker/entrypoint.sh" ] && [ -s /worker/entrypoint.sh ] \
  && [ "$(head -c 2 /worker/entrypoint.sh)" = "#!" ]; then
  exec /bin/sh /worker/entrypoint.sh "$@"
fi

# Do not run npm ci while the backend is restoring this persistent runtime.
while [ -f /worker/.treseko-update-rollback ]; do
  echo "Rollback del Worker en curso; esperando restauracion del runtime..."
  sleep 1
done

# backend/entrypoint.sh escribe este manifiesto en cada runtime que reemplaza,
# despues de verificar la firma y el checksum del paquete. Su presencia
# identifica un runtime instalado por la propia actualizacion de la
# instalacion, no un runtime divergente con la imagen.
payload_runtime_version() {
  runtime_dir="$1"
  manifest="$runtime_dir/.treseko-runtime-manifest.json"
  [ -f "$manifest" ] || return 1
  [ -r "$runtime_dir/VERSION" ] || return 1
  manifest_source="$(sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
  manifest_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
  [ "$manifest_source" = "legacy-payload" ] || return 1
  [ -n "$manifest_version" ] || return 1
  [ "$manifest_version" = "$(tr -d '[:space:]' < "$runtime_dir/VERSION")" ] || return 1
  printf '%s\n' "$manifest_version"
}

worker_runtime_updated=false
if [ -d /opt/treseko/worker-source ]; then
  image_version="$(node -p "require('/opt/treseko/worker-source/package.json').version")"
  source_version="$(tr -d '[:space:]' < /opt/treseko/worker-source/VERSION)"
  if [ "$source_version" != "$image_version" ]; then
    echo "Version metadata del Worker no coincide dentro de la imagen." >&2
    exit 1
  fi

  image_digest="$(cat /opt/treseko/worker-source/.treseko-content-digest 2>/dev/null || true)"
  computed_image_digest="$(/usr/local/bin/treseko-hash-component-tree /opt/treseko/worker-source)"
  if [ -z "$image_digest" ] || [ "$image_digest" != "$computed_image_digest" ]; then
    echo "El codigo del Worker dentro de la imagen no coincide con su digest." >&2
    exit 1
  fi

  runtime_digest="$(/usr/local/bin/treseko-hash-component-tree /worker)"
  if [ "$runtime_digest" != "$image_digest" ]; then
    installed_payload_version=""
    if [ "${TRESEKO_ATOMIC_RUNTIME_SYNC:-0}" != "1" ]; then
      installed_payload_version="$(payload_runtime_version /worker || true)"
    fi
    if [ -n "$installed_payload_version" ]; then
      # El updater de la instalacion acaba de instalar esta release en el
      # volumen: el runtime instalado manda y la semilla de la imagen solo
      # servira si el contenedor se recrea con una imagen nueva.
      echo "Runtime del Worker actualizado por el paquete de update ${installed_payload_version}; se conserva el codigo instalado."
      printf '%s\n' "$runtime_digest" > /worker/.treseko-content-digest
    else
      runtime_code_file="$(find /worker -type f \
        ! -path '/worker/.state/*' ! -path '/worker/node_modules/*' ! -path '/worker/logs/*' \
        ! -name '.runner-token' ! -name '.runner-token.pairing' ! -name '.worker-instance-id' \
        ! -name '.treseko-content-digest' ! -name '.treseko-update-*' \
        ! -name '.env' ! -name '.env.*' -print -quit)"
      if [ "${TRESEKO_ATOMIC_RUNTIME_SYNC:-0}" != "1" ] && [ -n "$runtime_code_file" ]; then
        echo "El runtime persistente del Worker no coincide con la imagen; requiere el coordinador atomico." >&2
        exit 1
      fi
      echo "Sincronizando Worker persistente por digest: ${runtime_digest} -> ${image_digest}"
      rsync -a --delete \
        --exclude='/node_modules/' --exclude='/logs/' \
        --exclude='/.runner-token' --exclude='/.runner-token.pairing' --exclude='/.worker-instance-id' \
        --exclude='/.state/' --exclude='/.cache/' --exclude='/.env' --exclude='/.env.*' \
        --exclude='/.treseko-content-digest' --exclude='/.treseko-update-*' \
        /opt/treseko/worker-source/ /worker/
      printf '%s\n' "$image_digest" > /worker/.treseko-content-digest
      runtime_digest="$(/usr/local/bin/treseko-hash-component-tree /worker)"
      if [ "$runtime_digest" != "$image_digest" ]; then
        echo "El runtime persistente del Worker no coincide con la imagen despues de sincronizar." >&2
        exit 1
      fi
      worker_runtime_updated=true
    fi
  else
    printf '%s\n' "$image_digest" > /worker/.treseko-content-digest
  fi

  # Si el paquete trajo un package-lock distinto al de la imagen, el runtime
  # persistente necesita una instalacion limpia de dependencias.
  if [ -f /opt/treseko/worker-source/package-lock.json ] && [ -f /worker/package-lock.json ] \
    && ! cmp -s /opt/treseko/worker-source/package-lock.json /worker/package-lock.json; then
    worker_runtime_updated=true
  fi
fi

if [ -f /worker/package-lock.json ] && { [ "$worker_runtime_updated" = true ] || [ ! -d /worker/node_modules ] || [ ! -d /worker/node_modules/playwright ]; }; then
  echo "Instalando dependencias del Worker actualizadas..."
  (cd /worker && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CYPRESS_INSTALL_BINARY=0 PUPPETEER_SKIP_DOWNLOAD=1 npm ci)
fi

exec "$@"

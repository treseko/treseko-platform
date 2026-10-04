#!/bin/sh
set -eu

# El entrypoint que Docker ejecuta vive en la imagen y ninguna actualizacion
# puede reescribirlo. Este archivo es a la vez el entrypoint de la imagen y el
# que el paquete instala en el volumen: si existen las dos copias, la de la
# imagen delega en la del volumen, de modo que toda correccion futura de este
# componente viaja dentro de la actualizacion. La condicion sobre $0 corta la
# recursion cuando la copia delegada vuelve a ejecutar este mismo archivo.
if [ "$0" != "/engine/entrypoint.sh" ] && [ -s /engine/entrypoint.sh ] \
  && [ "$(head -c 2 /engine/entrypoint.sh)" = "#!" ]; then
  exec /bin/sh /engine/entrypoint.sh "$@"
fi

# A backend rollback may race with an Engine restart triggered by an update.
# Hold startup until the backend has restored the persistent runtime files.
while [ -f /engine/.treseko-update-rollback ]; do
  echo "Rollback del Engine en curso; esperando restauracion del runtime..."
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

engine_runtime_updated=false
if [ -d /opt/treseko/engine-source ] && [ -w /engine ]; then
  image_version="$(node -p "require('/opt/treseko/engine-source/package.json').version")"
  source_version="$(tr -d '[:space:]' < /opt/treseko/engine-source/VERSION)"
  if [ "$source_version" != "$image_version" ]; then
    echo "Version metadata del Engine no coincide dentro de la imagen." >&2
    exit 1
  fi

  image_digest="$(cat /opt/treseko/engine-source/.treseko-content-digest 2>/dev/null || true)"
  computed_image_digest="$(/usr/local/bin/treseko-hash-component-tree /opt/treseko/engine-source)"
  if [ -z "$image_digest" ] || [ "$image_digest" != "$computed_image_digest" ]; then
    echo "El codigo del Engine dentro de la imagen no coincide con su digest." >&2
    exit 1
  fi

  runtime_digest="$(/usr/local/bin/treseko-hash-component-tree /engine)"
  if [ "$runtime_digest" != "$image_digest" ]; then
    installed_payload_version=""
    if [ "${TRESEKO_ATOMIC_RUNTIME_SYNC:-0}" != "1" ]; then
      installed_payload_version="$(payload_runtime_version /engine || true)"
    fi
    if [ -n "$installed_payload_version" ]; then
      # El updater de la instalacion acaba de instalar esta release en el
      # volumen: el runtime instalado manda y la semilla de la imagen solo
      # servira si el contenedor se recrea con una imagen nueva.
      echo "Runtime del Engine actualizado por el paquete de update ${installed_payload_version}; se conserva el codigo instalado."
      printf '%s\n' "$runtime_digest" > /engine/.treseko-content-digest
    else
      runtime_code_file="$(find /engine -type f \
        ! -path '/engine/node_modules/*' ! -path '/engine/logs/*' \
        ! -path '/engine/reports/*' ! -path '/engine/pending-deliveries/*' \
        ! -name '.maintenance' ! -name '.treseko-update-*' \
        ! -name '.treseko-content-digest' ! -name '.env' ! -name '.env.*' -print -quit)"
      if [ "${TRESEKO_ATOMIC_RUNTIME_SYNC:-0}" != "1" ] && [ -n "$runtime_code_file" ]; then
        echo "El runtime persistente del Engine no coincide con la imagen; requiere el coordinador atomico." >&2
        exit 1
      fi
      echo "Sincronizando Engine persistente por digest: ${runtime_digest} -> ${image_digest}"
      rsync -a --delete \
        --exclude='/node_modules/' --exclude='/logs/' --exclude='/reports/' \
        --exclude='/pending-deliveries/' --exclude='/.cache/' \
        --exclude='/.env' --exclude='/.env.*' \
        --exclude='/.treseko-content-digest' --exclude='/.treseko-update-*' \
        /opt/treseko/engine-source/ /engine/
      printf '%s\n' "$image_digest" > /engine/.treseko-content-digest
      runtime_digest="$(/usr/local/bin/treseko-hash-component-tree /engine)"
      if [ "$runtime_digest" != "$image_digest" ]; then
        echo "El runtime persistente del Engine no coincide con la imagen despues de sincronizar." >&2
        exit 1
      fi
      engine_runtime_updated=true
    fi
  else
    printf '%s\n' "$image_digest" > /engine/.treseko-content-digest
  fi

  # Si el paquete trajo un package-lock distinto al de la imagen, el runtime
  # persistente necesita una instalacion limpia de dependencias.
  if [ -f /opt/treseko/engine-source/package-lock.json ] && [ -f /engine/package-lock.json ] \
    && ! cmp -s /opt/treseko/engine-source/package-lock.json /engine/package-lock.json; then
    engine_runtime_updated=true
  fi
fi

# El runtime de Engine es persistente. Si una actualizacion reemplazo
# package.json/lock, sus modulos deben reinstalarse antes de iniciar Node.
if [ -f /engine/package-lock.json ] && { [ "$engine_runtime_updated" = true ] || [ ! -d /engine/node_modules ] || [ ! -d /engine/node_modules/express ]; }; then
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

#!/bin/sh
set -eu

FRONTEND_HTML_DIR="${TRESEKO_FRONTEND_HTML_DIR:-/usr/share/nginx/html}"
IMAGE_DIST_DIR="${TRESEKO_IMAGE_FRONTEND_DIST_DIR:-/opt/treseko/frontend-dist}"

read_bundle_version() {
  bundle_dir="$1"
  if [ -r "$bundle_dir/VERSION" ]; then
    tr -d '[:space:]' < "$bundle_dir/VERSION"
    return 0
  fi
  if [ -r "$bundle_dir/version.json" ]; then
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$bundle_dir/version.json" | head -n 1
  fi
}

# backend/entrypoint.sh escribe este manifiesto en cada runtime que reemplaza,
# despues de verificar la firma y el checksum del paquete. Su presencia
# identifica un bundle instalado por la propia actualizacion de la instalacion,
# no un bundle divergente con la imagen.
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

if [ -d "$IMAGE_DIST_DIR" ]; then
  image_version="$(read_bundle_version "$IMAGE_DIST_DIR")"
  installed_version="$(read_bundle_version "$FRONTEND_HTML_DIR")"

  image_digest="$(cat "$IMAGE_DIST_DIR/.treseko-content-digest" 2>/dev/null || true)"
  computed_image_digest="$(/usr/local/bin/treseko-hash-component-tree "$IMAGE_DIST_DIR")"
  if [ -z "$image_digest" ] || [ "$image_digest" != "$computed_image_digest" ]; then
    echo "El bundle frontend de la imagen no coincide con su digest." >&2
    exit 1
  fi

  installed_digest="$(/usr/local/bin/treseko-hash-component-tree "$FRONTEND_HTML_DIR")"
  if [ "$installed_digest" != "$image_digest" ]; then
    installed_payload_version=""
    if [ "${TRESEKO_ATOMIC_RUNTIME_SYNC:-0}" != "1" ]; then
      installed_payload_version="$(payload_runtime_version "$FRONTEND_HTML_DIR" || true)"
    fi
    if [ -n "$installed_payload_version" ]; then
      # El updater de la instalacion acaba de instalar este bundle en el
      # volumen: el contenido instalado manda frente a la semilla de la imagen.
      echo "Bundle frontend actualizado por el paquete de update ${installed_payload_version}; se conserva el contenido instalado."
      printf '%s\n' "$installed_digest" > "$FRONTEND_HTML_DIR/.treseko-content-digest"
    else
      if [ "${TRESEKO_ATOMIC_RUNTIME_SYNC:-0}" != "1" ]; then
        existing_bundle_file="$(find "$FRONTEND_HTML_DIR" -type f \
          ! -name '.maintenance' ! -name '.treseko-update-fence' \
          ! -name '.treseko-update-draining' ! -name '.treseko-update-restart' \
          ! -name '.treseko-content-digest' ! -name 'maintenance.html' -print -quit)"
        if [ -n "$installed_version" ] || [ -n "$existing_bundle_file" ]; then
          echo "El contenido frontend no coincide con la imagen; requiere el coordinador atomico." >&2
          exit 1
        fi
      fi

      echo "Sincronizando bundle frontend por digest${image_version:+ ($image_version)}."
      find "$FRONTEND_HTML_DIR" -mindepth 1 -maxdepth 1 \
        ! -name '.maintenance' \
        ! -name '.treseko-update-fence' \
        ! -name '.treseko-update-draining' \
        ! -name '.treseko-update-restart' \
        ! -name 'maintenance.html' \
        -exec rm -rf -- {} \;
      find "$IMAGE_DIST_DIR" -mindepth 1 -maxdepth 1 \
        ! -name '.maintenance' \
        ! -name '.treseko-update-fence' \
        ! -name '.treseko-update-draining' \
        ! -name '.treseko-update-restart' \
        ! -name 'maintenance.html' \
        -exec cp -a -- {} "$FRONTEND_HTML_DIR"/ \;
      installed_digest="$(/usr/local/bin/treseko-hash-component-tree "$FRONTEND_HTML_DIR")"
      if [ "$installed_digest" != "$image_digest" ]; then
        echo "El volumen frontend no coincide con el bundle candidato despues de sincronizar." >&2
        exit 1
      fi
    fi
  else
    echo "Bundle frontend verificado por digest${installed_version:+ ($installed_version)}."
  fi
fi

installed_version="$(read_bundle_version "$FRONTEND_HTML_DIR")"
metadata_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$FRONTEND_HTML_DIR/version.json" | head -n 1)"
if [ -r "$FRONTEND_HTML_DIR/VERSION" ] && [ -r "$FRONTEND_HTML_DIR/version.json" ] && [ "$installed_version" != "$metadata_version" ]; then
  echo "Frontend inconsistente: VERSION=$installed_version version.json=$metadata_version" >&2
  exit 1
fi

if [ ! -f "$FRONTEND_HTML_DIR/maintenance.html" ]; then
  cat > "$FRONTEND_HTML_DIR/maintenance.html" <<'HTML'
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="30" />
    <title>Treseko se esta actualizando</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f4f7fb;
        color: #101828;
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(560px, 100%);
        border: 1px solid #d9e2ef;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
        padding: 32px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 24px;
        font-weight: 800;
        letter-spacing: .01em;
      }
      .mark {
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        border-radius: 12px;
        background: #0d6efd;
        color: #fff;
        font-weight: 900;
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(26px, 5vw, 36px);
        line-height: 1.1;
      }
      p {
        margin: 0;
        color: #52667f;
        line-height: 1.55;
      }
      .status {
        margin-top: 24px;
        padding: 14px 16px;
        border-radius: 12px;
        background: #eef5ff;
        color: #0b4fb3;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="mark">T</span><span>Treseko</span></div>
      <h1>Estamos aplicando una actualizacion</h1>
      <p>Treseko esta terminando de reemplazar componentes y validar la base de datos. Esta pantalla se actualiza sola en unos segundos.</p>
      <div class="status">Vuelve a intentar en 30 segundos.</div>
    </main>
  </body>
</html>
HTML
fi

# El backend reemplaza el bundle en el volumen compartido y deja esta marca
# para que el frontend también reinicie. Se elimina antes de salir para que
# restart: unless-stopped lo levante una sola vez con el contenido nuevo.
watch_update_restart() {
  marker="$FRONTEND_HTML_DIR/.treseko-update-restart"
  while :; do
    if [ -f "$marker" ]; then
      rm -f "$marker"
      echo "Actualizacion lista; reiniciando frontend."
      kill -TERM "$nginx_pid" 2>/dev/null || true
      return 0
    fi
    sleep 2
  done
}

nginx -g 'daemon off;' &
nginx_pid="$!"
watch_update_restart &
watcher_pid="$!"

cleanup() {
  kill -TERM "$nginx_pid" "$watcher_pid" 2>/dev/null || true
  wait "$watcher_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM
wait "$nginx_pid"

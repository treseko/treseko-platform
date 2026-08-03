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

version_is_newer() {
  candidate="$1"
  installed="$2"
  [ -n "$candidate" ] || return 1
  [ "$candidate" != "$installed" ] || return 1
  [ "$(printf '%s\n%s\n' "$installed" "$candidate" | sort -V | tail -n 1)" = "$candidate" ]
}

if [ -d "$IMAGE_DIST_DIR" ]; then
  image_version="$(read_bundle_version "$IMAGE_DIST_DIR")"
  installed_version="$(read_bundle_version "$FRONTEND_HTML_DIR")"

  # El actualizador del backend escribe el volumen compartido directamente.
  # Una imagen anterior nunca debe sobrescribir esa actualización al reiniciar.
  if [ -z "$installed_version" ] || version_is_newer "$image_version" "$installed_version"; then
    echo "Sincronizando frontend inicial de la imagen${image_version:+ ($image_version)}."
    find "$FRONTEND_HTML_DIR" -mindepth 1 ! -name '.maintenance' ! -name 'maintenance.html' -exec rm -rf {} +
    cp -a "$IMAGE_DIST_DIR/." "$FRONTEND_HTML_DIR/"
  else
    echo "Conservando frontend instalado ($installed_version); la imagen contiene $image_version."
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

exec nginx -g 'daemon off;'

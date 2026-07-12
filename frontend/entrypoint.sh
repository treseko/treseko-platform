#!/bin/sh
set -eu

if [ -d /opt/treseko/frontend-dist ]; then
  rm -rf /usr/share/nginx/html/assets
  cp -a /opt/treseko/frontend-dist/. /usr/share/nginx/html/
fi

if [ ! -f /usr/share/nginx/html/maintenance.html ]; then
  cat > /usr/share/nginx/html/maintenance.html <<'HTML'
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

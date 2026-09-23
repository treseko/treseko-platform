# CLI Docker-only de instalación existente

Este wrapper ejecuta el módulo fijo `app.services.update_existing_installation`
en la imagen trusted. No usa Python, `awk` ni `sed` del host, no instala un
venv y no monta el workspace. La imagen, Docker CLI, socket y network se pasan
explícitamente y el launcher privado debe repetir exactamente esos valores.

El ejemplo es parametrizado y no runnable hasta sustituir la imagen y las
rutas por entradas existentes y verificadas:

```bash
scripts/update_existing_installation_docker.sh status \
  --launcher-config /var/lib/treseko-update/operator-launcher.json \
  --image sha256:REEMPLAZAR_CON_IMAGE_ID_INSPECCIONADO \
  --docker /usr/bin/docker \
  --socket /var/run/docker.sock \
  --network treseko-update \
  --config /var/lib/treseko-update/controller.json
```

El launcher tiene exactamente `type`, `docker`, `image`, `socket`, `network` y
`mounts`. Cada mount declara `source`, `target`, `mode` y `purpose`, con
`source == target`. Debe incluir `launcher`, `controller` readonly, `state` y
`cache` y `socket` explícitos; el socket es `rw`, `manifest` es readonly para `plan/prepare/apply/resume` y
`package` readonly únicamente para `prepare`. Configuración SSH, known_hosts y
claves necesarias se montan como entradas readonly separadas. No se aceptan
`/`, `/root`, `/home`, `/workspace`, aliases mutables ni mounts amplios.

El preflight se ejecuta dentro de la imagen trusted con network `none` y
filesystem readonly. Comprueba la vinculación del launcher, rutas, modos,
ownership, image digest y mounts antes de iniciar el CLI. La ejecución final
usa `/usr/local/bin/python`, `PYTHONDONTWRITEBYTECODE=1`, `DOCKER_HOST` explícito
y solo las acciones existentes `plan`, `prepare`, `apply`, `resume`, `status`.

Las plantillas systemd del host bridge continúan siendo parametrizadas. El
wrapper instalado no recibe argumentos: invoca internamente `--once --spool`
con configuración fija. No se deben ejecutar esos flags como argumentos
externos del wrapper ni considerar las plantillas listas hasta sustituir sus
placeholders y validar bindings/permisos.

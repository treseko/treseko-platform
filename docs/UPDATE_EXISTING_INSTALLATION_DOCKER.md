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

## Reemplazo transaccional del Compose completo

Para paquetes firmados con `deployment.mode=complete-source`, el controlador
requiere `atomic_compose` en su configuración privada:

```json
{
  "schema": 1,
  "project": "treseko",
  "project_root": "/opt/treseko",
  "env_file": "<project-root>/.env"
}
```

`project_root` debe ser la raíz del Compose actualmente instalado, propiedad de
root/operador y no modificable por grupo u otros. `env_file` debe estar dentro
de esa raíz, ser regular, privado y legible. El launcher Docker del controlador
monta la raíz de proyecto en solo lectura (`purpose: atomic-project`), el
estado del controlador en lectura/escritura y el socket Docker solo dentro del
helper de confianza. El instalador prepara el árbol firmado, valida el Compose
candidato sin detener servicios y conserva el proyecto previo para rollback.
Los volúmenes persistentes y el archivo de entorno quedan fuera del reemplazo
de código.

La ruta `complete-source` admite únicamente una instalación concentrada en un
host Docker local. Si la instalación está distribuida entre hosts, el plan se
rechaza; se necesita un adaptador transaccional propio para esa topología.

Para Premium coordinado, la transición desde 1.0.6 usa el instalador de helpers
que ya incluye esa versión. Preparar el mismo paquete firmado completo en el
cache/manifest privados de HelperInstallation y ejecutar
`scripts/bootstrap_update_helpers_docker.sh` con la imagen helper 1.0.6
inmutable y su configuración ya vinculada. El instalador verifica el paquete y
publica el backend helper 1.0.7 en su propio directorio versionado; no reinicia
los servicios Treseko ni aplica Compose. Verificar el receipt 1.0.7 y que
incluya `treseko-update-host-bridge`, junto con los mounts privados de
`atomic_compose`; luego aplicar el mismo paquete desde Configuración →
Actualizaciones. La app Premium 1.0.6 ya envía las transacciones coordinadas al
helper host.

La prueba Linux de bootstrap usa el código real de instalación de helpers
1.0.6, pero un prefijo efímero; no instala wrappers en el host ni simula una
sesión UI. La publicación requiere validar también Configuración →
Actualizaciones en una instancia Premium aislada. Este camino no cubre
instalaciones legacy sin coordinador: deben migrarse al coordinador o usar el
instalador Compose local con `--update` / `-Update`.

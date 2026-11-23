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
  --socket /run/docker.sock \
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
  "env_file": "/opt/treseko/compose.production.env",
  "owner_uid": 1000
}
```

`project_root` apunta a la raíz del Compose actualmente instalado y puede
pertenecer al usuario operador (`owner_uid`) o a root; sus permisos no deben
permitir escritura de grupo u otros. `env_file` puede estar fuera de esa raíz,
siempre que sea regular, privado, legible y esté montado en solo lectura como
`atomic-env`. `owner_uid` fija el UID del operador dueño de la instalación; no
se infiere desde el proceso del helper, que normalmente corre como root.

El directorio `directory` del controlador es también la raíz estable de estado
del instalador atómico. Debe ser un directorio dedicado, privado y montado en
lectura/escritura. No se deriva del staging temporal de cada actualización: así
el puntero de release, el journal y la recuperación sobreviven entre
transacciones. El launcher monta la raíz Compose en solo lectura
(`atomic-project`), el archivo de entorno en solo lectura cuando está fuera del
proyecto, el estado del controlador en lectura/escritura y el socket Docker
solo dentro del helper de confianza. El wrapper host del coordinador también
monta en solo lectura su `coordinated.override.yaml`: Docker registra ese
archivo en `com.docker.compose.project.config_files`, y el helper lo necesita
presente para reconstruir la configuración Compose activa. El instalador valida el Compose candidato
sin detener servicios y conserva el proyecto previo para rollback. Los
volúmenes persistentes y el archivo de entorno quedan fuera del reemplazo de
código.

La ruta `complete-source` admite únicamente una instalación concentrada en un
host Docker local. Si la instalación está distribuida entre hosts, el plan se
rechaza; se necesita un adaptador transaccional propio para esa topología.

Las instalaciones que utilizan un helper coordinado deben preparar y verificar
el helper compatible antes de aplicar un paquete `complete-source`. El bootstrap
instala el helper de forma versionada sin reiniciar los servicios Treseko ni
reemplazar el Compose. Después, Configuración → Actualizaciones aplica el
paquete completo. Las instalaciones legacy sin coordinador deben migrarse al
coordinador o usar el instalador Compose local con `--update` / `-Update`.

La prueba Linux de bootstrap usa el código real de instalación de helpers en un
prefijo efímero; no instala wrappers en el host ni simula una sesión UI. La
validación de publicación también requiere comprobar Configuración →
Actualizaciones en una instalación aislada.

## Migrar una instalación legacy a 1.0.8

El paquete completo incluye un migrador host-side y un adaptador que prepara
su entorno Python privado. En Linux y macOS se requiere Python 3.11+, `venv`,
Docker Compose local y acceso a PyPI para instalar las dependencias fijadas. El
script no modifica el Python global. En Windows solo se contempla WSL 2 con
Docker Desktop y la integración WSL habilitada; el adaptador registra la tarea
programada para iniciar el coordinador. No se cubre Docker nativo de Windows ni
el backend VMM/Hyper-V.

El usuario WSL seleccionado debe poder acceder al socket Docker configurado,
tener un bus `systemctl --user` funcional y linger habilitado. Pasa la ruta
canónica del socket; `/var/run` puede ser un enlace simbólico a `/run` y el
wrapper rechaza rutas de montaje con componentes simbólicos. En Linux suele
ser `/run/docker.sock`; en WSL puede variar según la integración de Docker
Desktop. En imágenes mínimas de Ubuntu WSL, instala una vez
`dbus-user-session` y reinicia la distribución si falta el bus; el adaptador
informa este requisito, pero no instala paquetes del sistema ni cambia linger
automáticamente.

La migración acepta únicamente el salto firmado 1.0.7 → 1.0.8 y una instalación
Compose local concentrada en un host. Antes de cambiar servicios comprueba la
firma, el checksum, el manifiesto interno y la identidad del proyecto. Después
usa el actualizador Compose transaccional y, al confirmar la versión, instala el
coordinador. No borra los volúmenes persistentes ni la configuración privada.
Si la actualización ya quedó confirmada y falla solo la instalación del
coordinador, se puede volver a ejecutar el comando con los mismos archivos.

El constructor produce `treseko-update-v1.0.8-single-file.tar` junto al OTA
`.tar.gz`. El bundle contiene el archivo OTA y su manifiesto firmado. Descarga
solo el bundle, extrae sus dos niveles en una carpeta temporal y ejecuta el
adaptador incluido pasando el bundle; no hace falta descargar ni indicar el
manifiesto por separado.

Linux/macOS:

```bash
bundle=/ruta/treseko-update-v1.0.8-single-file.tar
work="$(mktemp -d)"
tar -xf "$bundle" -C "$work"
mkdir "$work/release"
tar -xzf "$work/treseko-update-v1.0.8.tar.gz" -C "$work/release"
bash "$work/release/source-release/scripts/bootstrap_host_update_coordinator.sh" migrate \
  --install-root /ruta/a/treseko \
  --env-file /ruta/a/compose.production.env \
  --docker "$(command -v docker)" \
  --package "$bundle"
```

En macOS, reemplaza el wrapper por
`bootstrap_host_update_coordinator_macos.sh`. En Windows, extrae ambos niveles
con `tar.exe` y ejecuta el adaptador PowerShell incluido:

```powershell
$Bundle = 'C:\ruta\treseko-update-v1.0.8-single-file.tar'
$Work = Join-Path $env:TEMP 'treseko-update-1.0.8'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
tar.exe -xf $Bundle -C $Work
$Release = Join-Path $Work 'release'
New-Item -ItemType Directory -Force -Path $Release | Out-Null
tar.exe -xzf (Join-Path $Work 'treseko-update-v1.0.8.tar.gz') -C $Release
& (Join-Path $Release 'source-release/scripts/bootstrap_host_update_coordinator.ps1') migrate `
  -InstallRoot 'C:\ruta\a\treseko' `
  -EnvFile 'C:\ruta\a\compose.production.env' `
  -Package $Bundle
```

El adaptador valida la firma del manifiesto embebido y el checksum del OTA antes
de aplicar cambios. El parámetro opcional `--manifest` / `-Manifest` sigue
disponible para instalaciones que ya tienen ambos archivos. Descarga y extrae
el bundle únicamente desde un canal oficial de Treseko. La instalación legacy
1.0.7 sigue necesitando ejecutar este adaptador host-side: el botón de
actualización antiguo no inicia por sí solo la migración.

Si Treseko está instalado dentro del filesystem Linux de WSL, pasa rutas Linux
directas para `-InstallRoot` y `-EnvFile` (por ejemplo,
`/home/jose/treseko` y `/home/jose/treseko/compose.production.env`). El adaptador
las resuelve dentro de la distribución y no necesita acceder al árbol mediante
`\\wsl.localhost`. El bundle descargado puede seguir estando en una ruta Windows.

La inclusión en el paquete es necesaria, pero el soporte 1.0.7 solo debe
habilitarse después de validar una instalación y recuperación reales en cada
plataforma declarada. Las pruebas unitarias y los chequeos estáticos no son
prueba end-to-end.

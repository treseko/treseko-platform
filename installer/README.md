# Instalador gráfico de Treseko Community

El instalador gráfico coordina los instaladores CLI oficiales del paquete. No
duplica la lógica de Docker, secretos, migraciones ni creación del administrador.

## Ejecutar

Desde la raíz de `treseko-platform`:

El ejecutable requiere Python 3 y Tkinter. En Ubuntu minimal, instalá
`python3-tk` antes de abrirlo.

```bash
python3 installer/treseko_installer.py
```

En Windows PowerShell:

```powershell
py installer\treseko_installer.py
```

En Windows también podés abrir `installer/launch_installer.bat`. En Ubuntu o
macOS podés ejecutar `installer/launch_installer.sh`.

En Ubuntu, `installer/treseko-installer.desktop` sirve como acceso directo
del paquete. Para mostrarlo en el menú de aplicaciones, instalá el icono y el
`.desktop` en tu perfil:

```bash
mkdir -p ~/.local/share/icons/hicolor/512x512/apps ~/.local/share/applications
cp installer/treseko-installer.png ~/.local/share/icons/hicolor/512x512/apps/treseko-installer.png
cp installer/treseko-installer.desktop ~/.local/share/applications/
```

El launcher usa el icono PNG incluido en `installer/` cuando se ejecuta sobre
Linux; macOS y Windows conservan sus launchers existentes.

La distribución mínima de arranque incluye `installer/treseko-installer.png`,
por lo que el launcher y el acceso `.desktop` no dependen de que viaje también
`frontend/public/`. La ventana comprueba Docker, Compose v2, el motor Docker, el puerto elegido y
la integridad mínima del paquete antes de iniciar la instalación. Si se abre
sola desde `Descargas` y faltan los archivos principales, consulta el último
release estable oficial de GitHub, lo descarga por HTTPS, valida su estructura
y lo guarda en una caché versionada. Durante el proceso muestra la salida real
del instalador y permite abrir la aplicación al finalizar.

Al terminar el bootstrap, la GUI reconoce automáticamente una instalación
existente en los paquetes directos de `~/.cache/treseko/packages/` cuando
contiene `compose.production.env` y sus secretos locales válidos. También se
puede elegir manualmente otra carpeta con `Cambiar`. Cuando la instalación es
reconocida aparece el botón visible `Desinstalar Treseko`; la acción conserva
datos por defecto y la purga requiere la confirmación adicional habitual.

Si ese release también incluye una versión más nueva de la GUI, el bootstrap la
abre automáticamente y continúa desde ella. De esta forma, la interfaz y los
scripts de instalación pertenecen al mismo paquete. Un servicio nuevo, como un
worker, debe estar declarado en el Compose y/o en el script del release para
que pueda instalarse; la GUI no inventa servicios que no estén en el paquete.

## Empaquetado versionado

La versión se lee exclusivamente desde `VERSION`. El builder no copia el
repositorio completo: el ejecutable contiene la GUI Tkinter y
`treseko-installer.png`; la plataforma se obtiene después mediante el bootstrap
oficial de GitHub/cache. No se incluyen `.env`, secretos, datos, Docker images,
frontend compilado ni la plataforma completa.

Desde la raíz de `treseko-platform`:

```bash
# Ver el plan en cualquier sistema, incluido macOS (no genera binarios)
python3 installer/build_installer.py --target windows --plan
python3 installer/build_installer.py --target linux --plan
python3 installer/build_installer.py --target macos --plan

# En el runner nativo correspondiente, con el toolchain fijado
python3 -m pip install -r installer/requirements-build.txt
python3 installer/build_installer.py --target windows
APPIMAGETOOL=/ruta/appimagetool python3 installer/build_installer.py --target linux
# Solo en macOS nativo (Apple Silicon o Intel):
python3 installer/build_installer.py --target macos
```

Artefactos esperados en `dist/`:

| Target | Runner nativo | Artefacto |
|---|---|---|
| Windows x64 | `windows-2022` | `Treseko-Installer-v<VERSION>-windows-x64.exe` |
| Linux x64 | `ubuntu-24.04` | `Treseko-Installer-v<VERSION>-linux-x64.AppImage` |
| macOS arm64 | `macos-14` | `Treseko-Installer-v<VERSION>-macos-arm64.app` |
| macOS x64 | `macos-13` | `Treseko-Installer-v<VERSION>-macos-x64.app` |

En macOS, descargá el artefacto correspondiente a la arquitectura de tu Mac,
descomprimilo y abrí `Treseko-Installer-v<VERSION>-macos-<arch>.app` con doble
clic. El primer arranque puede mostrar una advertencia de Gatekeeper porque
el binario todavía no está firmado ni notarizado por Apple; la firma,
notarización y distribución pública quedan pendientes. Un `.app` es el bundle
ejecutable autocontenido que se abre directamente; un `.dmg` sería solamente
un disco de distribución opcional que todavía no se genera.

El builder valida archivos de entrada, formato de `VERSION`, nombre exacto,
tamaño mínimo y cabecera PE/ELF. En macOS valida `Contents/MacOS`, el
ejecutable, `Info.plist`, el identificador estable, las dos versiones y el
`.icns`. El metadata `VERSIONINFO` de Windows se
genera desde la misma versión; para versiones prerelease usa sus tres números
base en la estructura PE y conserva el sufijo en las cadenas visibles.

El workflow reproducible está en
`.github/workflows/build-installer.yml` y deja artefactos de Actions, no crea
tags ni publica releases. macOS no cross-compila: debe usarse ese workflow o
un runner nativo equivalente. La firma Authenticode/Apple/notarización y la
firma de AppImage quedan pendientes antes de distribuir binarios públicamente.

## Plataformas

- Windows: Docker Desktop + PowerShell.
- Ubuntu: Docker Engine/Compose + Bash.
- macOS Apple Silicon: Docker Desktop para Apple Silicon + Bash.

La primera versión gráfica instala el entorno Docker local. No instala Treseko
como servicios nativos de Windows ni como servicios nativos de macOS. La opción
de recrear el entorno elimina los volúmenes locales y requiere confirmación.

La instalación nueva exige que no exista todavía una configuración local
(`compose.production.env`). Para una actualización con datos existentes se debe
seguir usando el flujo de actualización documentado hasta que el instalador
gráfico incorpore migración y rollback específicos.

La GUI usa únicamente el repositorio público oficial
`treseko/treseko-platform`; no descarga código desde URLs configurables por el
usuario.

## Distribución futura

El runtime de la GUI no tiene dependencias Python externas; el toolchain de
build está separado y fijado en `requirements-build.txt`. Antes de distribuir
binarios deben agregarse firma de artefactos, checksum publicado, pruebas
reales en Windows y Ubuntu, y validación de imágenes Docker `arm64` cuando el
paquete se use en Apple Silicon.

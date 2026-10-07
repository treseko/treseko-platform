# Instalador gráfico de Treseko Community

## Estado del reemplazo nativo

El contrato compartido de releases está en `release_client.py` y el generador
del índice verificable en `build_release_index.py`. El índice
`treseko-installer-release.json` declara `schema`, `product_version`,
`installer_version` y los artefactos por plataforma, incluyendo nombre, tamaño
y SHA-256. Todavía no se publica mediante el workflow actual.

El release de producto previsto para validar el descubrimiento desde GitHub es
`treseko-community-v1.0.7`. Los clientes consultan `/releases/latest`; no tienen
`1.0.7` fijado en el código y mostrarán la versión estable que GitHub publique
como más reciente. La publicación de instaladores y del índice se hará junto a
ese release, después de cerrar las pruebas nativas pendientes.

Hay prototipos nativos SwiftUI para macOS y WPF para Windows en
`native/macos/` y `native/windows/`. El SwiftUI compila en macOS y el proyecto
WPF compila con el SDK .NET 8; eso valida compilación, no certifica todavía los
flujos completos en equipos Windows/macOS. El Linux GTK/libadwaita, el enlace
de Windows al empaquetado firmado y la publicación de assets/índice no están
implementados. El workflow `build-installer.yml` conserva el empaquetado GUI
anterior y no debe interpretarse como publicación de los clientes nativos.

No distribuir los prototipos como instaladores oficiales hasta completar esos
enlaces y la verificación nativa de instalación, actualización, rollback y
autoactualización. El instalador anterior sigue disponible durante esa etapa.

El instalador gráfico coordina los instaladores CLI oficiales del paquete. No
duplica la lógica de Docker, secretos, migraciones ni creación del administrador.

## Ejecutar

Desde la raíz de `treseko-platform`:

Los instaladores Windows y Linux se compilan con Qt for Python (PySide6) y no
usan Tkinter. macOS mantiene su aplicación nativa SwiftUI. Los artefactos
incluyen su runtime gráfico y no requieren instalar Python. Windows y Linux
comparten la interfaz Qt; macOS usa una interfaz SwiftUI nativa con un flujo
equivalente.

```bash
python3 -m pip install -r installer/requirements-build.txt
python3 installer/treseko_installer_qt.py
```

En Windows PowerShell:

```powershell
py -m pip install -r installer\requirements-build.txt
py installer\treseko_installer_qt.py
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

El launcher inicia la UI Qt compartida en Windows y Linux; macOS conserva su
aplicación SwiftUI.

La UI Qt presenta el destino (este equipo o un servidor Linux por SSH), los
componentes, el puerto, el ámbito de red y una confirmación antes de iniciar.
Consulta el release estable oficial, descarga el paquete y valida su versión;
cuando el índice de distribución está disponible, comprueba además tamaño y
SHA-256 del paquete. La instalación y actualización se delegan en los scripts
oficiales del release y se muestra su salida.

La opción remota instala un servidor Linux mediante SSH y usa la configuración
SSH del equipo cliente. En Windows se requiere Git Bash o WSL para ese modo.

## Empaquetado y nombres estables

La versión se lee exclusivamente desde `VERSION`. Windows y Linux empaquetan
la GUI PySide6 con PyInstaller; macOS genera una aplicación SwiftUI nativa. No
se incluyen `.env`, secretos, datos, Docker images, frontend compilado ni la
plataforma completa. Los nombres de los archivos no llevan versión porque cada
instalador consulta el release estable más reciente de GitHub; la versión sigue
incluida en los metadatos del binario y del bundle.

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
| Windows x64 | `windows-2022` | `Treseko-Windows-x64.exe` |
| Linux x64 | `ubuntu-24.04` | `Treseko-Linux-x64.AppImage` |
| macOS arm64 | `macos-14` | `Treseko-macOS-arm64.app` (`.zip` en GitHub) |

En macOS, descargá el artefacto correspondiente a la arquitectura de tu Mac,
descomprimilo y abrí `Treseko-macOS-<arch>.app` con doble
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
como servicios nativos de Windows ni como servicios nativos de macOS. Para una
actualización, la GUI delega en el script CLI del release destino, que aplica el
coordinador transaccional descrito en `docs/INSTALLATION.md`; la GUI no sustituye
esa lógica. La opción de recrear el entorno elimina los volúmenes locales y
requiere confirmación.

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

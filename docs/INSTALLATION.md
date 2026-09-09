# Instalar Treseko Community

Usá los instaladores incluidos. Generan compose.production.env y secretos
locales. El paquete también incluye ejemplos `.env.production.example`; no
contienen secretos reales.

## Requisitos

- Docker 24+ y Docker Compose v2.
- 2 CPU y 4 GB de RAM como base.
- Puerto libre, por defecto 9095.
- Almacenamiento para PostgreSQL, evidencias y backups.
- Host Linux para instalación remota por SSH.

## Instalador local

También se incluye un instalador gráfico multiplataforma. Abre una ventana,
comprueba Docker y Compose, valida el puerto, ejecuta la instalación mostrando
el progreso y permite abrir Treseko al finalizar:

```bash
python3 installer/treseko_installer.py
```

En Windows PowerShell:

```powershell
py installer\treseko_installer.py
```

El instalador gráfico requiere Python 3 y Tkinter; en Ubuntu minimal instalá
`python3-tk` antes de abrirlo.

Si se abre desde `Descargas` sin el paquete completo, consulta el último
release estable de `treseko/treseko-platform` en GitHub, descarga el núcleo por
HTTPS, valida sus archivos principales y continúa con la instalación. No
descarga código desde URLs configurables por el usuario.

Si el release incluye una versión más nueva del instalador gráfico, la versión
descargada reemplaza el proceso actual en el siguiente paso. Los servicios
nuevos deben estar declarados en Compose o en los scripts del release para que
formen parte de la instalación.

La interfaz usa el instalador Bash en Ubuntu/macOS y el instalador PowerShell
en Windows. En Apple Silicon se requiere Docker Desktop para Apple Silicon.
La modalidad gráfica actual instala el entorno Docker; no instala servicios
nativos de Windows o macOS.

```bash
scripts/install_local_treseko.sh --http-port 9095
```

En PowerShell:

```powershell
.\scripts\install_local_treseko.ps1 -HttpPort 9095
```

Con datos demo:

```bash
scripts/install_local_treseko.sh --with-demo
```

Genera secretos en .treseko-local/secrets, crea compose.production.env,
ejecuta migraciones, crea el usuario inicial y levanta frontend, backend y
Engine. El worker no se asigna automáticamente: requiere profile automation,
inicio del proceso y aprobación en Automatización → Workers.

### Actualizar una instalación existente

Usá `--update` (o `-Update` en PowerShell) desde el mismo paquete o desde una
release compatible. El archivo `compose.production.env`, los secretos y los
volúmenes existentes son la fuente de verdad: el script los reutiliza sin
reescribirlos ni ejecutar `seed_admin`. Solo construye imágenes, ejecuta el
migrador y vuelve a levantar los servicios.

```bash
scripts/install_local_treseko.sh --update
```

```powershell
.\scripts\install_local_treseko.ps1 -Update
```

La actualización falla si no existe `compose.production.env`. No combines
`--update` con `--with-demo`.

### Desinstalación conservadora

Para detener y quitar contenedores y redes sin perder la base de datos, las
evidencias, los backups ni los secretos locales:

```bash
scripts/install_local_treseko.sh --uninstall
```

```powershell
.\scripts\install_local_treseko.ps1 -Uninstall
```

Este flujo usa `docker compose down --remove-orphans`, sin `-v`, y conserva
`compose.production.env` y `.treseko-local/`.

### Eliminación total (destructiva)

Solo si querés borrar los volúmenes y la configuración local de este checkout,
usá ambas opciones explícitas. La confirmación adicional evita una purga no
interactiva accidental:

```bash
scripts/install_local_treseko.sh --uninstall --purge-data --confirm-purge
```

```powershell
.\scripts\install_local_treseko.ps1 -Uninstall -PurgeData -ConfirmPurge
```

La purga ejecuta `down -v --remove-orphans` y elimina únicamente
`compose.production.env` y `.treseko-local/` debajo de la raíz del repositorio.
No borres volúmenes manualmente sin un backup verificado.

El alias legado `--reset` también es destructivo y exige `--confirm-reset`; no
se acepta sin esa confirmación explícita.

## Instalador remoto

Este instalador no es recomendado para producción mientras transporte secretos
en argumentos de SSH. Usalo solo en entornos de prueba o aceptá el riesgo y
preferí la instalación manual con secretos por archivo. No expongas el comando
completo en historiales, auditorías ni diagnósticos del host.

```bash
scripts/install_remote_treseko.sh usuario@servidor --http-port 9095
```

```powershell
.\scripts\install_remote_treseko.ps1 usuario@servidor -HttpPort 9095
```

El destino debe ser Linux con SSH. Se generan secretos, se ejecutan migraciones
y se muestra URL, usuario inicial y contraseña temporal. Guardala y cambiala en
el primer login.

## Instalación manual

Creá compose.production.env y secretos fuera de Git:

```bash
umask 077
mkdir -p secrets
openssl rand -base64 48 > secrets/db-password
printf '%s\n' 'postgresql+asyncpg://treseko:REEMPLAZAR@db:5432/treseko' > secrets/database-url
openssl rand -base64 64 > secrets/secret-key
openssl rand -base64 64 > secrets/ai-credentials-master-key
openssl rand -base64 64 > secrets/ai-engine-internal-token
```

Reemplazá REEMPLAZAR por la misma contraseña de db-password. El entorno solo
contiene rutas:

```dotenv
APP_ENV=production
TRESEKO_HTTP_PORT=9095
TRESEKO_DB_PASSWORD_FILE=/ruta/secrets/db-password
TRESEKO_DATABASE_URL_FILE=/ruta/secrets/database-url
TRESEKO_SECRET_KEY_FILE=/ruta/secrets/secret-key
TRESEKO_AI_CREDENTIALS_MASTER_KEY_FILE=/ruta/secrets/ai-credentials-master-key
TRESEKO_AI_ENGINE_INTERNAL_TOKEN_FILE=/ruta/secrets/ai-engine-internal-token
DB_USER=treseko
DB_NAME=treseko
```

Validá y levantá:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm --entrypoint python backend /app/seed_admin.py
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

El seed de administrador puede solicitar la contraseña. No la expongas en logs.

## Profiles opcionales

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation up -d automation-worker
```

Community admite un solo worker. Agregar workers requiere la
capability/entitlement Premium. El profile `plugins` está declarado en el
Compose, pero este snapshot público no contiene el contexto de build de
`plugin-runner`; no lo habilites ni lo consideres operativo desde este paquete.

## Primer inicio

1. Iniciá sesión y cambiá la contraseña temporal.
2. Creá solución, proyecto y componente.
3. Vinculá y aprobá el worker si usarás automatización.
4. Ejecutá una prueba y verificá run y evidencia.

No ejecutes seed demo en producción. Ver también [Docker](DOCKER_GUIDE.md),
[Linux](LINUX_SETUP.md), [Arquitectura](ARCHITECTURE.md) y [RBAC](AUTH_RBAC_GUIDE.md).

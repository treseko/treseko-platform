# Instalar Treseko Community

Usá los scripts Bash o PowerShell incluidos. Generan `compose.production.env` y
secretos locales. Los instaladores gráficos están temporalmente fuera de esta
versión. El paquete también incluye ejemplos `.env.production.example`; no
contienen secretos reales.

## Requisitos

- Docker 24+ y Docker Compose v2.
- 2 CPU y 4 GB de RAM como base.
- Puerto libre, por defecto 9095.
- Almacenamiento para PostgreSQL, evidencias y backups.
- Host Linux para instalación remota por SSH.

## Ping opcional de instalación

El primer arranque no envía información de instalación por defecto. Si el
administrador activa `TRESEKO_ENABLE_INSTALLATION_PING=true` en
`compose.production.env`, el backend envía una sola vez el identificador
persistente de la instalación, la versión, la edición Community, el sistema
operativo y el runtime a `verify.treseko.com`. No incluye usuarios, proyectos,
casos, credenciales ni prompts. `TRESEKO_DISABLE_INSTALLATION_PING=true`
desactiva el envío incluso si también se activó. Esta opción es independiente
de la encuesta opcional que aparece durante el onboarding.

## Instalación local por script

En Linux y macOS ejecutá el script Bash. En Windows usá el script PowerShell.
Ambos instalan el entorno Docker Compose; no instalan servicios nativos del
sistema operativo. Los requisitos de Docker y Compose se indican arriba.

La aplicación principal consta de Frontend y Backend/API. PostgreSQL y Redis
son los servicios base de datos y coordinación. Los complementos Engine de IA y
Automation Worker se instalan y se inician en esta computadora; el proveedor de
IA se configura después. El Worker queda en espera hasta que se cree una
solución: configura `QA_ORGANIZACION_ID` en `compose.production.env`, reinicia
`automation-worker` y aprueba el pairing desde **Automatización → Workers**.
Community admite un worker. Durante la instalación también se prepara la
estructura de la base de datos. El Compose declara un perfil `plugins`, pero
esta instalación no lo inicia ni lo ofrece como componente.

En instalaciones nuevas, el acceso queda limitado a esta computadora por
defecto (`127.0.0.1`). El instalador permite habilitar el acceso desde la red
local; en ese modo, otros equipos usan la IP local del host y el puerto elegido.
No publiques el puerto directamente en Internet: usa una VPN o un proxy HTTPS
y configura el firewall. Las actualizaciones conservan el acceso de red
configurado en la instalación existente.

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

Usá `--update` (o `-Update` en PowerShell) desde el paquete de la release
destino. El archivo `compose.production.env` y los secretos existentes se
reutilizan sin reescribirlos ni ejecutar `seed_admin`. Bash y PowerShell usan
el mismo coordinador transaccional. Primero copia el árbol completo del paquete
destino a `.treseko-local/releases/<version>-<hash>` (excluye Git y la
configuración mutable local), registra hashes por archivo y comprueba que la
copia coincida con el candidato. Construye y valida las imágenes desde esa
copia; después detiene el proyecto completo, respalda
todos sus volúmenes con datos y etiqueta las imágenes anteriores con IDs
inmutables. Solo entonces inicia la migración. La versión nueva se mantiene
bajo una barrera HTTP que cubre SPA, API, WebSocket y recursos hasta que
Compose confirma salud y se verifican las versiones de Backend, Frontend,
Engine y los workers opcionales activos. Si falla una fase, restaura los
volúmenes y el Compose anterior antes de volver a abrir el servicio. Si el
proceso o el equipo se interrumpe, la próxima ejecución reconcilia el journal
antes de empezar otra actualización.

El archivo `.treseko-local/active-release.json` se reemplaza atómicamente solo
después de validar la release nueva mientras la barrera sigue cerrada. Si una
fase anterior falla, la release previa sigue activa. Los directorios versionados
y sus manifiestos se conservan para recuperación y auditoría.
El coordinador de actualización comprueba el manifiesto activo y rechaza una
release candidata anterior antes de modificar servicios o datos. Para avanzar,
usa el paquete de la versión destino.

Este modo prioriza consistencia sobre disponibilidad: el servicio local queda
fuera de línea durante la migración y la validación. Los snapshots de Docker y
las etiquetas de imágenes anteriores se conservan para recuperación; ocupan
espacio y no se eliminan con una actualización posterior. El flujo exige una
instalación Compose identificable, los cinco servicios base activos y una
versión destino cuyo Nginx de Frontend admita la barrera global; si no puede
demostrar esas condiciones, se detiene sin actualizar.

```bash
scripts/install_local_treseko.sh --update
```

```powershell
.\scripts\install_local_treseko.ps1 -Update
```

La actualización falla si no existe `compose.production.env`. No combines
`--update` con `--with-demo`.

La opción Configuración → Actualizaciones es una ruta distinta y
solo admite instalaciones con binding válido del coordinador de host; si falta,
la API rechaza la solicitud antes de crear una tarea y la interfaz indica usar
el instalador local del equipo host. No hay fallback de aplicación legacy
porque no ofrece la misma transacción atómica. La integración operativa del
coordinador de host para esa opción sigue pendiente y no debe confundirse con
la actualización local atómica.

Para actualizar Treseko 1.0.6 a 1.0.7 en una instalación Compose local, descargá
el paquete completo de la versión destino y ejecutá su instalador con
`--update` (o `-Update` en PowerShell). La actualización desde **Configuración →
Actualizaciones** solo aplica cuando el coordinador del host ya está instalado
y enlazado; el servicio de aplicación no tiene acceso al Compose del host para
reemplazarlo por sí mismo.

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
el primer login. El destino remoto predeterminado es `/opt/treseko-platform`; se
puede cambiar con `--remote-dir RUTA`. El instalador remoto es solo para
instalaciones nuevas: si la carpeta elegida no está vacía, se detiene sin
sobrescribir ni mezclar archivos. Para un host con `sudo` interactivo, configurá
acceso sudo no interactivo para el usuario SSH antes de ejecutar el script.

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
capability/entitlement Premium. El runner de complementos es opcional y se
inicia solo cuando la instalación lo necesita:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile plugins up -d plugin-runner
```

El runner queda aislado en una red privada y no recibe acceso a la base de
datos, Redis, secretos ni socket Docker.

## Primer inicio

1. Iniciá sesión y cambiá la contraseña temporal.
2. Creá solución, proyecto y componente.
3. Vinculá y aprobá el worker si usarás automatización.
4. Ejecutá una prueba y verificá run y evidencia.

No ejecutes seed demo en producción. Ver también [Docker](DOCKER_GUIDE.md),
[Linux](LINUX_SETUP.md), [Arquitectura](ARCHITECTURE.md) y [RBAC](AUTH_RBAC_GUIDE.md).

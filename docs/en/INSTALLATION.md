# Install Treseko Community

<!-- Language: en -->

Use the included installers. They generate `compose.production.env` and local
secrets. The package also includes `.env.production.example` templates; they
do not contain real secrets.

## Requirements

- Docker 24+ and Docker Compose v2.
- 2 CPUs and 4 GB of RAM as a baseline.
- A free port, `9095` by default.
- Storage for PostgreSQL, evidence and backups.
- A Linux host for remote installation over SSH.

## Local installer

A cross-platform graphical installer is also included. It opens a window,
checks Docker and Compose, validates the selected port, runs the installation
while showing progress, and can open Treseko when it finishes:

```bash
python3 installer/treseko_installer.py
```

On Windows PowerShell:

```powershell
py installer\treseko_installer.py
```

The graphical installer requires Python 3 and Tkinter; on minimal Ubuntu,
install `python3-tk` before opening it.

If it is opened from `Downloads` without the full package, it queries the
latest stable `treseko/treseko-platform` release on GitHub, downloads the core
over HTTPS, validates the required files, and continues the installation. It
does not download code from user-configurable URLs.

If the release includes a newer graphical installer, the downloaded version
replaces the current process at the next step. New services must be declared in
Compose or in the release scripts to become part of the installation.

The interface uses the Bash installer on Ubuntu/macOS and the PowerShell
installer on Windows. Apple Silicon requires Docker Desktop for Apple Silicon.
The current graphical mode installs the Docker environment; it does not install
native Windows or macOS services.

```bash
scripts/install_local_treseko.sh --http-port 9095
```

On PowerShell:

```powershell
.\scripts\install_local_treseko.ps1 -HttpPort 9095
```

With demo data:

```bash
scripts/install_local_treseko.sh --with-demo
```

The installer generates secrets in `.treseko-local/secrets`, creates
`compose.production.env`, runs migrations, creates the initial user and starts
the frontend, backend and Engine. The worker is not assigned automatically: it
requires the `automation` profile, process startup and approval in
**Automation → Workers**.

### Updating an existing installation

Use `--update` (or `-Update` in PowerShell) from the same package or a
compatible release. The existing `compose.production.env`, secrets and
volumes are the source of truth: the script reuses them without rewriting them
or running `seed_admin`. It only builds images, runs the migrator and starts
the services again.

```bash
scripts/install_local_treseko.sh --update
```

```powershell
.\scripts\install_local_treseko.ps1 -Update
```

The update fails if `compose.production.env` does not exist. Do not combine
`--update` with `--with-demo`.

### Conservative uninstall

To stop and remove containers and networks without losing the database,
evidence, backups or local secrets:

```bash
scripts/install_local_treseko.sh --uninstall
```

```powershell
.\scripts\install_local_treseko.ps1 -Uninstall
```

This flow uses `docker compose down --remove-orphans`, without `-v`, and keeps
`compose.production.env` and `.treseko-local/`.

### Full removal (destructive)

Only when you want to remove volumes and local configuration for this checkout,
use both explicit options. The additional confirmation prevents an accidental
non-interactive purge:

```bash
scripts/install_local_treseko.sh --uninstall --purge-data --confirm-purge
```

```powershell
.\scripts\install_local_treseko.ps1 -Uninstall -PurgeData -ConfirmPurge
```

The purge runs `down -v --remove-orphans` and removes only
`compose.production.env` and `.treseko-local/` below the repository root. Do
not remove volumes manually without a verified backup.

The legacy `--reset` alias is also destructive and requires
`--confirm-reset`; it is rejected without that explicit confirmation.

## Remote installer

This installer is not recommended for production while it transports secrets in
SSH arguments. Use it only in test environments, or accept the risk and prefer
manual installation with secrets supplied through files. Do not expose the full
command in shell histories, audits or host diagnostics.

```bash
scripts/install_remote_treseko.sh usuario@servidor --http-port 9095
```

```powershell
.\scripts\install_remote_treseko.ps1 usuario@servidor -HttpPort 9095
```

The destination must be Linux with SSH. Secrets are generated, migrations are
run, and the URL, initial user and temporary password are shown. Save it and
change it at the first login.

## Manual installation

Create `compose.production.env` and secrets outside Git:

```bash
umask 077
mkdir -p secrets
openssl rand -base64 48 > secrets/db-password
printf '%s\n' 'postgresql+asyncpg://treseko:REEMPLAZAR@db:5432/treseko' > secrets/database-url
openssl rand -base64 64 > secrets/secret-key
openssl rand -base64 64 > secrets/ai-credentials-master-key
openssl rand -base64 64 > secrets/ai-engine-internal-token
```

Replace `REEMPLAZAR` with the same password as `db-password`. The environment only
contains paths:

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

Validate and start:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm --entrypoint python backend /app/seed_admin.py
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

The administrator seed may request the password. Do not expose it in logs.

The legacy `--reset` alias is also destructive and requires
`--confirm-reset`; it is rejected without that explicit confirmation.

## Optional profiles

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation up -d automation-worker
```

Community supports one worker. Adding workers requires the Premium
capability/entitlement. The `plugins` profile is declared in Compose, but this
public snapshot does not contain the `plugin-runner` build context; do not
enable it or consider it operational from this package.

## First start

1. Sign in and change the temporary password.
2. Create a solution, project and component.
3. Pair and approve the worker if you will use automation.
4. Run a test and verify the run and evidence.

Do not run the demo seed in production. See also [Docker](DOCKER_GUIDE.md),
[Linux](LINUX_SETUP.md), [Architecture](ARCHITECTURE.md) and [RBAC](AUTH_RBAC_GUIDE.md).

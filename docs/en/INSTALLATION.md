# Install Treseko Community

<!-- Language: en -->

Use the included Bash or PowerShell scripts. They generate
`compose.production.env` and local secrets. Graphical desktop installers are
temporarily excluded from this release. The package also includes
`.env.production.example` templates; they do not contain real secrets.

## Requirements

- Docker 24+ and Docker Compose v2.
- 2 CPUs and 4 GB of RAM as a baseline.
- A free port, `9095` by default.
- Storage for PostgreSQL, evidence and backups.
- A Linux host for remote installation over SSH.

## Local installation with scripts

On Linux and macOS, use the Bash script. On Windows, use the PowerShell script.
Both install the Docker Compose environment; they do not install native
operating-system services. Docker and Compose requirements are listed above.

The main application consists of the Frontend and Backend/API. PostgreSQL and
Redis provide the base data and coordination services. The AI Engine and
Automation Worker add-ons are installed and started on this computer; the AI
provider is configured later. The Worker waits until a solution exists: set
`QA_ORGANIZACION_ID` in `compose.production.env`, restart `automation-worker`,
and approve pairing under **Automation → Workers**. Community supports one
worker. The database schema is prepared during installation. Compose declares a
`plugins` profile, but this installation neither starts it nor offers it as a
component.

New installations are limited to this computer by default (`127.0.0.1`). The
installer can enable access from the local network; in that mode, other devices
connect through the host's local IP address and selected port. Do not publish
the port directly to the Internet: use a VPN or HTTPS proxy and configure the
firewall. Updates preserve the network access configured for the existing
installation.

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

Use `--update` (or `-Update` in PowerShell) from the target release package.
The existing `compose.production.env` and secrets are reused without rewriting
them or running `seed_admin`. Bash and PowerShell use the same transactional
coordinator. It first copies the complete target package tree into
`.treseko-local/releases/<version>-<hash>` (excluding Git and mutable local
configuration), records per-file hashes and verifies the copy against the
candidate. It builds and validates images from that copy, then stops the whole
project, snapshots every data volume and tags the previous
images by immutable ID. Only then does it start the migration. The new release
remains behind an HTTP fence covering the SPA, API, WebSocket and assets until
Compose reports healthy and Backend, Frontend, Engine and active optional
workers pass version checks. If a phase fails, the previous volumes and
Compose model are restored before service is reopened. If the process or
machine is interrupted, the next run reconciles the journal before beginning
another update.

`.treseko-local/active-release.json` is atomically replaced only after the new
release passes validation while admission remains fenced. If an earlier phase
fails, the previous release remains active. Versioned directories and their
manifests are retained for recovery and audit.

This mode prioritizes consistency over availability: the local service is
offline during migration and validation. Docker snapshots and previous image
tags are retained for recovery; they consume disk space and are not removed by
later updates. The flow requires an identifiable Compose installation, all
five base services active, and a target Frontend Nginx that supports the
global fence. It stops without updating if it cannot prove these conditions.

```bash
scripts/install_local_treseko.sh --update
```

```powershell
.\scripts\install_local_treseko.ps1 -Update
```

The update fails if `compose.production.env` does not exist. Do not combine
`--update` with `--with-demo`.

**Settings → Updates** is a separate route and only accepts
installations with a valid host-coordinator binding; otherwise, the API rejects
the request before creating a task and the UI directs the user to run the local
installer on the host. There is no legacy application fallback because it does
not provide the same atomic transaction. Operational host-coordinator
integration for that option is still pending and must not be confused with the
atomic local update.

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
change it at the first login. The default remote destination is
`/opt/treseko-platform`; change it with `--remote-dir PATH`. Remote installation
is for new installations only: if the selected directory is not empty, it stops
without overwriting or merging files. For a host that requires an interactive
`sudo` password, configure non-interactive sudo access for the SSH user before
running the script.

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
capability/entitlement. The plugin runner is optional and starts only when
needed:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile plugins up -d plugin-runner
```

The runner stays on a private network with no database, Redis, secrets or Docker
socket access.

## First start

1. Sign in and change the temporary password.
2. Create a solution, project and component.
3. Pair and approve the worker if you will use automation.
4. Run a test and verify the run and evidence.

Do not run the demo seed in production. See also [Docker](DOCKER_GUIDE.md),
[Linux](LINUX_SETUP.md), [Architecture](ARCHITECTURE.md) and [RBAC](AUTH_RBAC_GUIDE.md).

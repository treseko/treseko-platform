# Run Treseko with Docker

<!-- Language: en -->

This guide accompanies a self-hosted installation with `docker-compose.prod.yml`.
Follow the steps in order: prepare secrets, validate the configuration,
initialize services and verify the first access. Keep secrets outside
the repository and reference them through protected files.

## Requirements

- Docker Engine with `docker compose` support.
- Shell access to the server.
- A free HTTP port, by default `9095`.
- An external directory for secrets, for example `/opt/treseko/secrets`.

Docker is the recommended path if the host is Windows, macOS, Ubuntu 20.04,
Debian 11 or an older Linux distribution. The supported bare-metal installer
requires Linux with systemd, nginx, PostgreSQL/Redis managed by the host and
Python 3.10 or newer.

## Prepare secrets

Create the secrets outside the Treseko directory:

```bash
sudo install -d -m 0700 /opt/treseko/secrets
sudo sh -c 'openssl rand -hex 32 > /opt/treseko/secrets/db-password'
sudo sh -c 'openssl rand -hex 48 > /opt/treseko/secrets/secret-key'
sudo sh -c 'printf "%s" "postgresql+asyncpg://treseko:$(cat /opt/treseko/secrets/db-password)@db:5432/treseko" > /opt/treseko/secrets/database-url'
sudo chmod 0600 /opt/treseko/secrets/db-password /opt/treseko/secrets/database-url /opt/treseko/secrets/secret-key
```

Do not keep passwords, `SECRET_KEY`, worker tokens or private licenses in
`compose.production.env`. That file should only contain configuration and paths to
secrets.

## Create `compose.production.env`

`compose.production.env` is a Compose configuration file, not a secret
box. It must store paths, ports and operational flags. Passwords,
tokens, `SECRET_KEY` and URLs with credentials live in separate files with
`0600` permissions, and Compose only receives the path through `*_FILE` variables.

Copy the example:

```bash
cp .env.production.example compose.production.env
```

Edit at least:

```env
TRESEKO_DB_PASSWORD_FILE=/opt/treseko/secrets/db-password
TRESEKO_DATABASE_URL_FILE=/opt/treseko/secrets/database-url
TRESEKO_SECRET_KEY_FILE=/opt/treseko/secrets/secret-key
TRESEKO_HTTP_PORT=9095
```

Correct example:

```env
TRESEKO_SECRET_KEY_FILE=/opt/treseko/secrets/secret-key
```

Incorrect example:

saving `SECRET_KEY` or any password directly inside
`compose.production.env`.

If port `9095` is busy, choose another free port and use that same value in
all the commands and URLs of this installation:

```env
TRESEKO_HTTP_PORT=PUERTO_ELEGIDO
```

Validate the configuration without printing secrets:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
```

## Build the images

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env build
```

## Initialize the base services

Start PostgreSQL and Redis:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
```

Run migrations:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
```

Create or ensure the first administrator:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm backend \
  seed-admin
```

The command prints a temporary password only once for
`admin@qa.local`. The first login forces a password change.
Internally the `seed-admin` mode of the entrypoint runs `/app/seed_admin.py`
after applying the migrations.

If an automation needs to define an initial password, use a
secret file with `0600` permissions:

```bash
sudo install -m 600 /dev/null /opt/treseko/secrets/initial-admin-password
sudoedit /opt/treseko/secrets/initial-admin-password
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm -T backend \
  seed-admin --password-stdin < /opt/treseko/secrets/initial-admin-password
```

## Start Treseko

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

Open:

- `http://localhost:9095` with the default configuration.
- `http://localhost:PUERTO_ELEGIDO` if `TRESEKO_HTTP_PORT` was changed.

Validate:

```bash
curl http://localhost:9095/api/health
curl http://localhost:9095/api/system/version
docker compose -f docker-compose.prod.yml --env-file compose.production.env ps
```

A clean Community installation does not create demo solutions or projects. After
the first access, create the first solution from the interface.

## Demo data for development

The production self-hosted product starts empty. For a
development environment or a controlled commercial demo, Treseko includes an optional seed that
creates a demo solution, two projects, builds, environments, cases, executions,
bugs, synthetic evidence and configured internal plugins without real
secrets.

Dev reset with Local Docker:

```bash
docker compose down -v
docker compose up -d db redis
cd backend
DATABASE_URL=postgresql+asyncpg://postgres:<db-password-dev>@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  alembic upgrade head
DATABASE_URL=postgresql+asyncpg://postgres:<db-password-dev>@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  python seed_admin.py
DATABASE_URL=postgresql+asyncpg://postgres:<db-password-dev>@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  python seed_demo_showcase.py --reset-demo
```

Dev reset with local PostgreSQL:

```bash
dropdb --if-exists treseko_db
createdb treseko_db
cd backend
DATABASE_URL=postgresql+asyncpg://postgres:treseko_dev@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  alembic upgrade head
DATABASE_URL=postgresql+asyncpg://postgres:treseko_dev@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  python seed_admin.py
DATABASE_URL=postgresql+asyncpg://postgres:treseko_dev@localhost:5432/treseko_db \
  SECRET_KEY=dev-secret-key-dev-secret-key-32chars \
  python seed_demo_showcase.py --reset-demo
```

`seed_demo_showcase.py` is idempotent for the `Inmser Demo Lab` solution. The
`--reset-demo` flag deletes only that solution and its associated data before
recreating it; it does not delete other clients or users. Do not use this seed for a
clean production installation.

## Recover the administrator password

There is no reset from the web. The recovery requires access to the
server:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm backend \
  python /app/reset_user_password.py --email admin@qa.local
```

The command generates a new temporary password, records an audit
`PASSWORD_RESET` and forces a change on the next login. Already issued JWT
sessions expire according to the configured duration.

For automated recovery, use `--password-file` or `--password-stdin`.
Files passed to `--password-file` must have `0600` or more restrictive
permissions.

## System updates

Treseko consults `updates.treseko.com` from `Settings > Updates`.
The production compose creates shared volumes to prepare updates:

- `treseko_update_data`: downloaded packages, extraction and `update-ready` flag.
- `treseko_backend_backups`: pre-update backups of code and database.
- `treseko_frontend_html`: static files served by nginx.
- `treseko_engine_runtime` and `treseko_worker_runtime`: updatable runtime for
  engine and worker.

Recommended flow:

1. The administrator looks for updates from the UI.
2. Treseko downloads the package, verifies SHA-256, generates backups and leaves
   `update-ready`.
3. Restart the services so that `entrypoint.sh` applies the package and runs
   Alembic:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

`TRESEKO_ENABLE_SELF_UPDATE_APPLY=true` should only be enabled when a validated
updates operational process exists for your installation. Without that flag, the UI
prepares the package but does not force an automatic restart.

## Optional automated worker

The `automation-worker` service is under the `automation` profile. A
clean installation does not start it by default.

Recommended flow:

1. Start the base application.
2. Log in as administrator.
3. Create or pair the worker from the automation screen.
4. Save the generated token in an operational secret outside the repo.
5. Start the worker with the `automation` profile:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation up -d automation-worker
```

## Alternative installation without Docker

For Linux servers with PostgreSQL, Redis and nginx managed by the
administrator, there is a basic installer:

```bash
sudo DATABASE_URL_FILE=/root/treseko-secrets/database-url \
  SECRET_KEY_FILE=/root/treseko-secrets/secret-key \
  scripts/install_treseko.sh
```

The script installs the backend in `/opt/treseko`, creates the
`treseko-backend` service, configures nginx, runs the initial migrations, ensures the
local admin and uses the same `entrypoint.sh` for prepared updates. It only accepts
`DATABASE_URL_FILE` and `SECRET_KEY_FILE`; it does not receive raw secrets via
environment variables.

Bare-metal compatibility validated for RC:

- Ubuntu 22.04+.
- Ubuntu 24.04+.
- Debian 12+.

Not supported for bare-metal:

- Ubuntu 20.04, because it ships Python 3.8.
- Debian 11 or earlier.
- Windows/macOS; use Docker.

## Production rules

- Do not enable `TRESEKO_ALLOW_DEV_*` variables.
- Do not keep secrets in `compose.production.env`.
- Do not add a `RUNNER_TOKEN` to the base production file.
- Do not copy private keys or sensitive material to the runtime.
- The production backend requires applied Alembic migrations.
- If Alembic fails due to schema drift, fix the migration or recreate the database
  before publishing; do not use `stamp head` as a silent fix.

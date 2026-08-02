# Install Treseko Community

<!-- Language: en -->

Use this guide to choose the installation method and verify that Treseko is
ready for the first login. For production, Docker Compose is
the recommended path.

## Requirements

- Docker 24+ and Docker Compose v2.
- 2 CPU and 4 GB of RAM as a base for a small installation.
- A domain or local IP to access the frontend.
- A strong `SECRET_KEY` of 64 characters or more.
- An own password for PostgreSQL.

## Quick installation with Docker

### Option A: test locally

To test Treseko on your own machine with Docker:

On Linux/macOS:

```bash
scripts/install_local_treseko.sh --http-port 9095
```

On Windows PowerShell:

```powershell
.\scripts\install_local_treseko.ps1 -HttpPort 9095
```

With demo data:

```bash
scripts/install_local_treseko.sh --with-demo
```

To recreate the local environment from scratch:

```bash
scripts/install_local_treseko.sh --reset --with-demo
```

The local installer:

- generates strong secrets in `.treseko-local/secrets`;
- creates `compose.production.env`;
- starts PostgreSQL, Redis, backend, engine and frontend;
- runs migrations;
- creates the initial user `admin@qa.local`;
- returns a temporary password for the first login.

### Option B: automatic installation over SSH

If you have a Linux server accessible via SSH, you can install Treseko from your machine without running each step manually.

From Linux:

```bash
scripts/install_remote_treseko.sh usuario@servidor --http-port 9095
```

From Windows PowerShell:

```powershell
.\scripts\install_remote_treseko.ps1 usuario@servidor -HttpPort 9095
```

The installer:

- uploads this repository to the server;
- installs Docker if missing and the server uses Ubuntu/Debian with `apt`;
- generates strong secrets for the database and backend;
- runs migrations;
- creates the initial user `admin@qa.local`;
- returns a temporary password for the first login.

When finished you will see something like:

```text
URL:
  http://servidor:9095

Initial user:
  admin@qa.local

Temporary password:
  ********
```

Save that password immediately. Treseko will ask you to change it on the first login.

> Note: Windows is used as a client machine to launch the SSH installation. The destination server must be Linux.

### Option C: manual installation with Docker

```bash
cp .env.production.example compose.production.env
```

Edit `compose.production.env` and complete the secret file paths:

```dotenv
APP_ENV=production
TRESEKO_HTTP_PORT=9095
TRESEKO_DB_PASSWORD_FILE=/ruta/segura/db-password
TRESEKO_DATABASE_URL_FILE=/ruta/segura/database-url
TRESEKO_SECRET_KEY_FILE=/ruta/segura/secret-key
DB_USER=treseko
DB_NAME=treseko
```

The files must contain:

- `db-password`: PostgreSQL password.
- `database-url`: `postgresql+asyncpg://treseko:<DB_PASSWORD>@db:5432/treseko`.
- `secret-key`: a strong random key of 64 characters or more.

Validate the configuration:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
```

Start the database and Redis:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
```

Run migrations:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
```

Create the first administrator:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm --entrypoint python backend /app/seed_admin.py
```

Start the application:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

Open Treseko from the browser on the port configured for the frontend.

## Clean installation

A clean production installation does not create solutions, projects, builds or demo
data. After the first login, create the first solution from the
interface.

## Demo data

Demo data is only for development or presentations:

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm --entrypoint python backend /app/seed_demo_showcase.py
```

Do not run the demo seed in a real production environment.

## Extended guides

- Detailed Docker: `docs/DOCKER_GUIDE.md`
- Linux bare-metal: `docs/LINUX_SETUP.md`
- Security: `SECURITY.md`
- Architecture: `docs/ARCHITECTURE.md`
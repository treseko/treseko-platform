# Docker guide

<!-- Language: en -->

Compose separates the frontend, backend, PostgreSQL, Redis, Engine and worker.
It also declares a plugin profile, but this public snapshot does not include the
`plugin-runner` context. It uses `compose.production.env` and file-based
secrets.

## File-based secrets

| Variable | Content |
|---|---|
| TRESEKO_DB_PASSWORD_FILE | PostgreSQL password. |
| TRESEKO_DATABASE_URL_FILE | `postgresql+asyncpg` URL. |
| TRESEKO_SECRET_KEY_FILE | Session/configuration key. |
| TRESEKO_AI_CREDENTIALS_MASTER_KEY_FILE | AI master key. |
| TRESEKO_AI_ENGINE_INTERNAL_TOKEN_FILE | Backend–Engine token. |

The installers create these paths. Manual installation is described in
[INSTALLATION.md](INSTALLATION.md). Do not use inline values or commit secrets.

## Services and profiles

Base services: `db`, `redis`, `migrator`, `backend`, `engine` and `frontend`.

| Profile | Service | Use |
|---|---|---|
| automation | automation-worker | Classic automation and declarative API automation. |
| plugins | plugin-runner declared in Compose | Not operational in this snapshot: the public package does not contain its build context. |

The worker must be registered and pairing approved in **Automation → Workers**.
Its token persists in `treseko_worker_runtime`.

## Start

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env config
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d db redis
docker compose -f docker-compose.prod.yml --env-file compose.production.env run --rm migrator
docker compose -f docker-compose.prod.yml --env-file compose.production.env up -d backend engine frontend
```

The frontend publishes `TRESEKO_HTTP_PORT`, `9095` by default.

## Unified worker

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation up -d automation-worker
```

The same worker processes `API_EXECUTION`, uses `treseko-api/declarative` and
`native-api-runtime.mjs`, and returns `native-fetch` and
`treseko.api-result/v1`. There is no separate API worker.

The API for external runners is independent:

```text
POST /external/executions/report
```

## Persistence and diagnostics

Back up volumes before `down -v`.

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env ps
docker compose -f docker-compose.prod.yml --env-file compose.production.env logs backend
docker compose -f docker-compose.prod.yml --env-file compose.production.env logs automation-worker
```

Review the migrator, backend and secret permissions before deleting data. The
`plugins` profile is declared in Compose, but cannot be built from this package
because the public `plugin-runner` context is missing; do not enable it as if it
were operational.

# Linux setup

<!-- Language: en -->

Covers self-hosted installation and a worker running outside the application
host. To begin, read [INSTALLATION.md](INSTALLATION.md).

## Dependencies

- Docker Engine and Docker Compose v2.
- Node.js if you will run the worker outside Docker.
- Python and Selenium if you will use its runtime.
- Private network between the backend, Engine, worker and systems under test.

```bash
docker --version
docker compose version
```

## Platform

```bash
scripts/install_local_treseko.sh --http-port 9095
```

The installer creates `compose.production.env` and secrets in
`.treseko-local/secrets`. Do not copy passwords into `.env`, Markdown or logs.

## Worker

```bash
docker compose -f docker-compose.prod.yml --env-file compose.production.env --profile automation up -d automation-worker
```

Outside Docker:

```bash
cd automation-worker
npm ci
npm start
```

Configure the backend, authorized organization and polling interval. The worker
keeps its token in `.runner-token`. At startup it displays `WK-xxxxxx` or an
equivalent pairing code; approve it in **Automation → Workers**. Without
approval it does not execute.

There is no separate API worker: the same one processes `API_EXECUTION`,
`treseko-api/declarative`, `native-fetch` and `treseko.api-result/v1`.
`POST /external/executions/report` is for external runners and does not replace
pairing or polling.

## Verification

1. Confirm the worker is visible and approved.
2. Run a classic case.
3. Run a declarative API case.
4. Verify the run, evidence and separate status.
5. Review logs if it remains pending.

Do not delete `.runner-token` to solve a failure: that starts another pairing.
Keep the runtime, browsers and worker outside the Internet whenever possible.

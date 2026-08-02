# Local development on Linux

<!-- Language: en -->

This guide is intended exclusively for those who contribute to the project or
need to run the components separately on Linux. To install
Treseko for normal or production use, use [Quick installation](INSTALLATION.md)
or [Docker guide](DOCKER_GUIDE.md). The examples assume Ubuntu or Debian.

> Development ports: backend `8000`, frontend Vite `5173` and AI Engine
> `3010`. A normal installation opens at `http://localhost:9095`; do not
> expose these development ports as public ports.

## System requirements

```bash
sudo apt update
sudo apt install -y \
  git curl build-essential \
  python3 python3-venv python3-pip \
  libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64
```

If your distro does not have `libasound2t64`, use:

```bash
sudo apt install -y libasound2
```

Install Node.js 18 or newer. With NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

## Prepare the local environments

Use a separate `venv` for Python and local `node_modules` per component:

- `backend/.venv`: FastAPI/backend dependencies.
- `automation-worker/.venv`: Selenium Python of the worker.
- `frontend/node_modules`: UI.
- `engine/node_modules`: AI Engine/Playwright.
- `automation-worker/node_modules`: multi-framework worker.

Do not share a global virtualenv. Avoid installing Python packages with `sudo pip`.

## Start the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Create or review `backend/.env`:

```env
DATABASE_URL=postgresql+asyncpg://treseko:<DB_PASSWORD>@localhost:5432/treseko_db
SECRET_KEY=<SECRET_KEY_DE_64_CARACTERES_O_MAS>
ENGINE_URL=http://localhost:3010
```

Initialize the local database:

```bash
python init_db.py
```

Start the backend:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend is available only for the local development environment. The
API guide published for integrations is in
[external automation](API_USAGE_GUIDE.md).

## Start the frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

Expected URL:

- `http://localhost:5173`

## Start the AI Engine

In another terminal:

```bash
cd engine
npm install
npx playwright install chromium
```

Create or review `engine/.env`:

```env
AI_API_ENDPOINT=http://localhost:1234/v1
AI_MODEL=google/gemma-4-e4b
ENGINE_PORT=3010
BACKEND_WS_URL=ws://localhost:8000/ws/engine-sync
```

Start it:

```bash
npm start
```

Health check:

```bash
curl http://localhost:3010/health
```

## Start an automation worker

In another terminal:

```bash
cd automation-worker
npm install
npm run install:browsers
```

For Selenium Python use a venv own to the worker:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install selenium
python -c "import selenium; print(selenium.__version__)"
```

Copy the configuration:

```bash
cp .env.example .env
```

Adjust `automation-worker/.env`:

```env
QA_API_BASE=http://localhost:8000
QA_RUNNER_NAME=Linux Multi-Framework Worker
QA_HEADLESS=true
QA_RUNNER_TAGS=linux,v1,playwright,puppeteer,cypress,selenium
QA_PYTHON_BIN=/ruta/al/proyecto/automation-worker/.venv/bin/python
```

If you are standing inside `automation-worker`, you can get the Python path with:

```bash
realpath .venv/bin/python
```

Start the worker:

```bash
npm start
```

The first time it will show a `WK-xxxxxx` code. Approve it from `Automation > Workers`. The real token stays in `automation-worker/.runner-token`.

## Use PostgreSQL and Redis with Docker

Optionally you can start infrastructure:

```bash
docker compose up -d
```

Then use in `backend/.env`:

```env
DATABASE_URL=postgresql+asyncpg://treseko:<DB_PASSWORD>@localhost:5432/treseko_db
SECRET_KEY=<SECRET_KEY_DE_64_CARACTERES_O_MAS>
ENGINE_URL=http://localhost:3010
```

## Startup order

1. `docker compose up -d` if you use PostgreSQL/Redis.
2. Development backend on port `8000`.
3. Development frontend on port `5173`.
4. AI Engine on port `3010`, if you will use AI.
5. Automation worker, if you will run automated tests.

## Quick checks

Development backend:

```bash
curl http://localhost:8000/health
```

Frontend:

```bash
curl http://localhost:5173
```

Engine:

```bash
curl http://localhost:3010/health
```

Worker:

- It must appear in `Automation > Workers`.
- It must report the frameworks `playwright, puppeteer, cypress, selenium`.
- If there is no token, it must show a `WK-xxxxxx` code.

## Troubleshooting on Linux

### Playwright/Cypress fail due to system libraries

Install Playwright dependencies:

```bash
cd automation-worker
npx playwright install-deps chromium
```

If you also use `engine`:

```bash
cd engine
npx playwright install-deps chromium
```

### Selenium does not find Python or the module

Check:

```bash
automation-worker/.venv/bin/python -c "import selenium; print(selenium.__version__)"
```

And review `QA_PYTHON_BIN`.

### Busy ports

```bash
ss -ltnp | grep -E ':8000|:5173|:3010'
```

### Reinstall the worker browsers

```bash
cd automation-worker
npm run install:browsers
```

### Reset the worker link

Only if you need to re-link:

```bash
rm -f automation-worker/.runner-token
```

Then run `npm start` and approve the new code in the UI.

## Why use virtual environments

It is advisable to use `venv` for all Python work because:

- It avoids mixing system dependencies with the project.
- It allows having different versions for backend and worker.
- It makes installations easier to reproduce.
- It avoids using `sudo pip`, which can break system packages.

You do not need `venv` for the frontend, engine or Node dependencies of the worker: each folder is already isolated by its own `node_modules`.
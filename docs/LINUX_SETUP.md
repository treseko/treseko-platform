# Guia Linux Para Desarrollo Local

Esta guia levanta todos los componentes en Linux usando entorno virtual Python para backend y Selenium del worker. Los ejemplos asumen Ubuntu/Debian.

## Requisitos Del Sistema

```bash
sudo apt update
sudo apt install -y \
  git curl build-essential \
  python3 python3-venv python3-pip \
  libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64
```

Si tu distro no tiene `libasound2t64`, usa:

```bash
sudo apt install -y libasound2
```

Instala Node.js 18 o superior. Con NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

## Estructura Recomendada

Usa un `venv` separado para Python y `node_modules` locales por componente:

- `backend/.venv`: dependencias FastAPI/backend.
- `automation-worker/.venv`: Selenium Python del worker.
- `frontend/node_modules`: UI.
- `engine/node_modules`: motor IA/Playwright.
- `automation-worker/node_modules`: worker multi-framework.

No compartas un virtualenv global. Evita instalar paquetes Python con `sudo pip`.

## Backend FastAPI

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Crea o revisa `backend/.env`:

```env
DATABASE_URL=postgresql+asyncpg://treseko:<DB_PASSWORD>@localhost:5432/treseko_db
SECRET_KEY=<SECRET_KEY_DE_64_CARACTERES_O_MAS>
ENGINE_URL=http://localhost:3010
```

Inicializa la base local:

```bash
python init_db.py
```

Inicia backend:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Docs:

- `http://localhost:8000/docs`
- `http://localhost:8000/redoc`

## Frontend Vite

En otra terminal:

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

URL esperada:

- `http://localhost:5173`

## Engine IA

En otra terminal:

```bash
cd engine
npm install
npx playwright install chromium
```

Crea o revisa `engine/.env`:

```env
AI_API_ENDPOINT=http://localhost:1234/v1
AI_MODEL=google/gemma-4-e4b
ENGINE_PORT=3010
BACKEND_WS_URL=ws://localhost:8000/ws/engine-sync
```

Inicia:

```bash
npm start
```

Healthcheck:

```bash
curl http://localhost:3010/health
```

## Automation Worker Multi-Framework

En otra terminal:

```bash
cd automation-worker
npm install
npm run install:browsers
```

Para Selenium Python usa un venv propio del worker:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install selenium
python -c "import selenium; print(selenium.__version__)"
```

Copia configuracion:

```bash
cp .env.example .env
```

Ajusta `automation-worker/.env`:

```env
QA_API_BASE=http://localhost:8000
QA_RUNNER_NAME=Linux Multi-Framework Worker
QA_HEADLESS=true
QA_RUNNER_TAGS=linux,v1,playwright,puppeteer,cypress,selenium
QA_PYTHON_BIN=/ruta/al/proyecto/automation-worker/.venv/bin/python
```

Si estas parado dentro de `automation-worker`, puedes obtener la ruta del Python con:

```bash
realpath .venv/bin/python
```

Inicia el worker:

```bash
npm start
```

La primera vez mostrara un código `WK-xxxxxx`. Apruebalo desde `Automatizacion > Workers`. El token real queda en `automation-worker/.runner-token`.

## PostgreSQL Y Redis Con Docker

Opcionalmente puedes levantar infraestructura:

```bash
docker compose up -d
```

Entonces usa en `backend/.env`:

```env
DATABASE_URL=postgresql+asyncpg://treseko:<DB_PASSWORD>@localhost:5432/treseko_db
SECRET_KEY=<SECRET_KEY_DE_64_CARACTERES_O_MAS>
ENGINE_URL=http://localhost:3010
```

## Orden De Arranque

1. `docker compose up -d` si usas PostgreSQL/Redis.
2. Backend en puerto `8000`.
3. Frontend en puerto `5173`.
4. Engine en puerto `3000`, si vas a usar IA.
5. Automation worker, si vas a ejecutar automatizadas.

## Verificaciones Rápidas

Backend:

```bash
curl http://localhost:8000/docs
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

- Debe aparecer en `Automatizacion > Workers`.
- Debe reportar frameworks `playwright, puppeteer, cypress, selenium`.
- Si no hay token, debe mostrar código `WK-xxxxxx`.

## Troubleshooting Linux

### Playwright/Cypress fallan por librerias del sistema

Instala dependencias de Playwright:

```bash
cd automation-worker
npx playwright install-deps chromium
```

Si tambien usas `engine`:

```bash
cd engine
npx playwright install-deps chromium
```

### Selenium no encuentra Python o módulo

Verifica:

```bash
automation-worker/.venv/bin/python -c "import selenium; print(selenium.__version__)"
```

Y revisa `QA_PYTHON_BIN`.

### Puertos ocupados

```bash
ss -ltnp | grep -E ':8000|:5173|:3000'
```

### Reinstalar navegadores del worker

```bash
cd automation-worker
npm run install:browsers
```

### Resetear vinculacion del worker

Solo si necesitas revincular:

```bash
rm -f automation-worker/.runner-token
```

Luego ejecuta `npm start` y aprueba el nuevo código en la UI.

## Por Que Usar Virtualenv

Conviene usar `venv` para todo lo Python porque:

- Evita mezclar dependencias del sistema con el proyecto.
- Permite tener versiones distintas para backend y worker.
- Facilita reproducir instalaciones.
- Evita usar `sudo pip`, que puede romper paquetes del sistema.

No hace falta `venv` para frontend, engine ni dependencias Node del worker: cada carpeta ya queda aislada por su propio `node_modules`.

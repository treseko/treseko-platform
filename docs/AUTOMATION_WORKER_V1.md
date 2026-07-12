# Worker dedicado de automatizacion V1

## Objetivo

Treseko conserva la fuente de verdad: casos, scripts, builds, datasets, versiones, evidencias e historial. El worker dedicado solo toma un job congelado, ejecuta el script con la herramienta indicada y devuelve el resultado.

## Flujo V1

1. En la web se inicia `Ejecucion automatizada`.
2. Backend crea `TestRun` con origen `AUTOMATIZADA_WORKER`, `EjecucionCaso` y snapshots congelados.
3. Backend crea un `AutomationJob` con script, framework, build, caso, ambiente, dataset y variables congeladas.
4. El worker consulta `/automation-jobs/next`, toma el job con `/claim`, ejecuta y reporta en `/result`.
5. Backend actualiza ejecucion, caso, run e historial.
6. Si el worker devuelve artifacts, backend los persiste como evidencias de automatizacion asociadas al snapshot correspondiente o al snapshot general de la ejecucion.

## Vincular un worker

El flujo principal usa pairing asistido. El worker arranca sin token definitivo, pide vinculacion al backend y muestra un código corto temporal. Un usuario con `automatizacion:edit` aprueba ese código desde `Automatizacion > Workers`.

```http
POST /automation-runners/pairing-requests
Content-Type: application/json

{
  "nombre": "Local Playwright Worker",
  "tipo": "LOCAL",
  "capabilities": {
    "frameworks": ["playwright"],
    "playwright_version": "1.60.0",
    "browsers": ["chromium"],
    "os": "windows",
    "tags": ["local", "v1"]
  },
  "ttl_minutes": 10
}
```

La respuesta devuelve `code` y un `pairing_token` interno para polling. El código se muestra en consola:

```text
Worker esperando vinculacion. Código: WK-482913.
```

La UI lista solicitudes pendientes:

```http
GET /automation-runners/pairing-requests/
Authorization: Bearer <qa_access_token>
```

Y aprueba:

```http
POST /automation-runners/pairing-requests/WK-482913/approve
Authorization: Bearer <qa_access_token>
```

Al aprobar, el worker recibe el `runner_token`, lo guarda localmente en `.runner-token` y la plataforma no lo muestra en UI. El endpoint legacy `POST /automation-runners/register` con token largo queda disponible temporalmente para compatibilidad.

## Ejecutar worker local

El worker vive en la carpeta raíz `automation-worker/`, separada de `engine/`.

```powershell
cd automation-worker
npm install
Copy-Item .env.example .env
```

Editar `automation-worker/.env`:

```env
QA_API_BASE=http://localhost:8000
QA_RUNNER_NAME=Local Playwright Worker
QA_ORGANIZACION_ID=uuid-de-la-solucion
QA_POLL_INTERVAL_MS=3000
QA_HEADLESS=true
```

En V1, `QA_ORGANIZACION_ID` define el alcance del worker. Es obligatorio para el flujo de vinculacion asistida y corresponde al UUID de la solucion/organizacion donde el worker va a ejecutar jobs. Un worker vinculado a una solucion no debe considerarse global para toda la instancia.

Modelo previsto: una version futura podra separar workers con alcance `INSTANCE` y workers con alcance `SOLUTION`. En la version actual solo esta documentado y soportado el alcance por solucion.

Treseko no reconoce workers por IP o puerto. El worker obtiene un token al aprobar el codigo de vinculacion y desde ese momento se comunica por pull con el backend: consulta jobs, envia heartbeat y reporta resultados. Las IPs locales, hostname, tags y capacidades son datos de diagnostico visibles para operacion, pero la identidad real es el token.

Ejecutar:

```powershell
npm start
```

El primer inicio muestra un código `WK-xxxxxx`. Apruebalo desde `Automatizacion > Workers`. Luego el worker guarda el token real en `automation-worker/.runner-token`.

## Forma del script V1

El script vive en el caso automatizado dentro de Treseko. Puede ser una funcion:

```js
async ({ page, variables, assert, log }) => {
  await page.goto(variables.base_url)
  log("Pagina abierta")
  assert.ok(await page.locator("body").count())
}
```

O un cuerpo simple:

```js
await page.goto(variables.base_url)
assert.ok(await page.locator("body").count())
```

El worker tambien reemplaza placeholders simples antes de ejecutar:

```js
await page.goto("{{base_url}}")
```

## Version de framework

En V1 se puede declarar una version requerida en el campo `framework` del caso con formato:

```text
playwright@1.44
```

Si se deja solo `playwright`, cualquier runner que soporte Playwright puede tomar el job. Si se indica una version, el runner debe declarar una capacidad compatible, por ejemplo:

```json
{
  "frameworks": ["playwright"],
  "versions": { "playwright": "1.44" }
}
```

## Estados

- `PENDING`: esperando runner compatible.
- `CLAIMED`: tomado por un runner.
- `RUNNING`: reservado para evolucion de logs en vivo.
- `PASSED`: prueba funcional paso.
- `FAILED`: prueba funcional fallo.
- `BLOCKED`: prueba bloqueada.
- `ERROR`: error de infraestructura o runner.
- `TIMEOUT`: ejecucion expirada.
- `CANCELLED`: cancelada.

## Evidencias y artifacts

El worker puede devolver artifacts en el resultado del job. El backend los persiste como attachments y los expone luego en `metadata_resultado.artifacts`.

Formato simplificado:

```json
{
  "status": "FAILED",
  "observations": "Playwright Test finalizo con errores.",
  "artifacts": [
    {
      "type": "screenshot",
      "filename": "failure.png",
      "content_type": "image/png",
      "base64": "...",
      "step_number": 2
    }
  ]
}
```

Reglas actuales:

- `step_number` intenta asociar la evidencia al snapshot del paso correspondiente.
- si no hay `step_number`, la evidencia queda asociada al snapshot general de automatizacion;
- el monitor de ejecucion automatizada muestra los artifacts reportados;
- historial y reportes pueden recuperar evidencias persistidas desde snapshots.

## Limitaciones V1

- No hay agenda horaria ni hooks.
- No hay streaming de logs en vivo.
- La evidencia por worker existe, pero falta una prueba integral documentada que cubra PASSED, FAILED, ERROR y TIMEOUT con artifacts reales.

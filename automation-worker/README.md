# Treseko Automation Worker

Worker dedicado para ejecutar pruebas automatizadas. La plataforma principal conserva casos, scripts, builds, datasets, evidencias e historial; este proceso solo toma jobs, ejecuta el framework indicado y reporta resultados por API.

## Requisitos

- Node.js 18 o superior.
- Python 3.10 o superior solo si vas a ejecutar Selenium Python.
- Backend Treseko iniciado, normalmente en `http://localhost:8000`.
- Acceso a la UI con permiso `automatizacion:edit` para aprobar el worker.

## Instalacion Rapida

```powershell
cd automation-worker
npm install
Copy-Item .env.example .env
```

`npm install` instala dependencias Node y descarga Chromium para Playwright por `postinstall`.

Despues instala o verifica los navegadores/binarios:

```powershell
npm run install:browsers
```

Para Selenium Python:

```powershell
python -m pip install selenium
python -c "import selenium; print(selenium.__version__)"
```

Selenium 4 usa Selenium Manager para resolver drivers cuando el navegador local esta disponible. Si tu Python no se ejecuta con `python`, configura `QA_PYTHON_BIN` en `.env`.

## Configuracion

Copia `.env.example` a `.env` y ajusta lo necesario:

```env
QA_API_BASE=http://localhost:8000
QA_RUNNER_NAME=Local Multi-Framework Worker
QA_ORGANIZACION_ID=uuid-de-la-solucion
QA_HEADLESS=true
QA_POLL_INTERVAL_MS=3000
QA_HEARTBEAT_INTERVAL_MS=10000
QA_REQUEST_TIMEOUT_MS=10000
QA_MAX_PARALLEL_JOBS=1
QA_RUNNER_TAGS=local,v1,playwright,puppeteer,cypress,selenium
QA_PYTHON_BIN=python
```

No pegues tokens manualmente salvo que uses el flujo legacy. El flujo normal crea un codigo corto y guarda el token definitivo en `.runner-token`.

### Alcance Del Worker

En esta version el worker se vincula a una solucion/organizacion concreta. Para eso debe tener configurado `QA_ORGANIZACION_ID` antes de iniciar el flujo de vinculacion. Ese valor es el UUID de la solucion que se ve en Treseko.

Mientras el worker este vinculado a esa solucion, solo debe tomar jobs pertenecientes a proyectos, componentes, builds y casos de esa misma solucion. Esto evita que una instancia con varias soluciones mezcle ejecuciones o evidencias entre clientes/equipos.

El modelo de worker global para toda la instancia queda previsto para una version futura con un campo de alcance explicito, por ejemplo `INSTANCE` o `SOLUTION`. Hasta que ese modelo exista, no asumas que un worker aprobado en una solucion funcionara automaticamente para todas.

### Identidad, IP Y Heartbeat

Treseko no identifica workers por IP ni por puerto. La identidad operativa del worker es el token que obtiene al aprobar el codigo corto de vinculacion. Despues de vincularse, el worker conserva ese token en `.runner-token` y lo usa para consultar jobs y enviar heartbeat al backend.

La comunicacion es tipo pull: el worker llama al backend, toma trabajos disponibles y reporta resultados. Por eso no hace falta abrir puertos entrantes hacia la maquina del worker. Esto funciona mejor con Docker, NAT, VPN, redes corporativas e IPs cambiantes.

Las IPs locales, hostname, sistema operativo, tags y capacidades se informan como diagnostico en `Automatizacion > Workers`, pero no deben usarse como fuente de identidad ni como requisito para ejecutar jobs.

## Vincular El Worker

1. Inicia backend y frontend.
2. Copia el UUID de la solucion donde quieres usarlo y ponlo en `QA_ORGANIZACION_ID`.
3. En la UI abre `Automatizacion > Workers`.
4. En esta carpeta ejecuta:

```powershell
npm start
```

5. La consola mostrara un codigo:

```text
Worker esperando vinculacion. Codigo: WK-482913.
```

6. Aprueba ese codigo desde `Automatizacion > Workers`.

Al aprobar, el worker guarda el token real en `automation-worker/.runner-token`. Ese archivo es local y no debe subirse a Git.

## Comandos

```powershell
npm start
```

Ejecuta el worker en modo continuo.

```powershell
npm run once
```

Toma un job si existe, lo ejecuta y termina. Sirve para pruebas puntuales.

```powershell
npm run install:browsers
```

Reinstala Chromium de Playwright y el binario de Cypress.

## Frameworks Soportados En V1

| Framework | Lenguaje V1 | Como se ejecuta | Datos inyectados |
|---|---|---|---|
| Playwright | JS/TS | Worker function o Playwright Test | `page`, `browser`, `variables`, `dataset`, `job`, `assert`, `log` |
| Puppeteer | JS/TS | Script Node temporal con `tsx` | `variables`, `dataset`, `job` como globals |
| Cypress | JS/TS | Spec temporal `job.cy.js/ts` | `Cypress.env()` con variables resueltas |
| Selenium | Python | Script Python temporal | `variables`, `dataset`, `job` como diccionarios |

Java, C#, Ruby y otros runtimes deben reportar por API externa o usar un worker especializado futuro.

## Ejemplos De Scripts

## Frameworks Y Lenguajes

La plataforma distingue dos niveles:

- Soporte oficial del framework: lenguajes que el framework permite.
- Soporte real del worker: lenguajes que un worker concreto anuncia y puede ejecutar.

Matriz oficial:

| Framework | Lenguajes oficiales |
| --- | --- |
| Playwright | JavaScript, TypeScript, Python, Java, C# (.NET) |
| Selenium | Java, Python, C# (.NET), JavaScript, TypeScript, Ruby |
| Cypress | JavaScript, TypeScript |
| Puppeteer | JavaScript, TypeScript |

Este worker local anuncia y ejecuta:

| Framework | Lenguajes en este worker |
| --- | --- |
| Playwright | JavaScript, TypeScript |
| Selenium | Python |
| Cypress | JavaScript, TypeScript |
| Puppeteer | JavaScript, TypeScript |

Java, C# y Ruby no se instalan en este worker Node por defecto. Para esos casos usa un worker especializado que anuncie sus capacidades.

### Contrato De Capabilities Para Workers Especializados

Un worker especializado debe registrarse o enviar heartbeat con `framework_languages`:

```json
{
  "frameworks": ["selenium"],
  "framework_languages": {
    "selenium": ["java", "csharp", "ruby"]
  },
  "versions": {
    "selenium": "4.x"
  },
  "tags": ["linux", "selenium-grid"]
}
```

El backend solo entrega jobs si coinciden `required_framework` y `required_language`. Si no hay match, el job queda `BLOCKED_BY_RUNNER`.

### Perfiles De Worker Especializado

El worker recomendado por defecto sigue siendo el actual. Si no se indica nada, el perfil efectivo es `default`:

```powershell
npm start
```

Equivale conceptualmente a:

```powershell
npm start -- --profile default
```

Perfil `default`:

- Playwright JavaScript/TypeScript.
- Puppeteer JavaScript/TypeScript.
- Cypress JavaScript/TypeScript.
- Selenium Python.

Para stacks corporativos o runtimes pesados conviene crear perfiles especializados. La idea de operacion es:

```powershell
npm run setup -- --profile playwright-python
npm start -- --profile playwright-python

npm run setup -- --profile selenium-java
npm start -- --profile selenium-java

npm run setup -- --profile selenium-csharp
npm start -- --profile selenium-csharp

npm run setup -- --profile selenium-ruby
npm start -- --profile selenium-ruby
```

Estos perfiles no deben instalarse automaticamente al seleccionar un lenguaje en la UI. La UI solo guarda el caso y pregunta al backend si hay un worker compatible. La instalacion se hace en la maquina donde correra el worker, porque puede requerir permisos, SDKs y variables del sistema.

Ejemplos de dependencias por perfil:

| Perfil | Dependencias esperadas | Capability anunciada |
| --- | --- | --- |
| `playwright-python` | Python, venv, `playwright`, browsers de Playwright | `playwright: ["python"]` |
| `playwright-java` | JDK, Maven/Gradle, Playwright Java | `playwright: ["java"]` |
| `playwright-csharp` | .NET SDK, Microsoft.Playwright | `playwright: ["csharp"]` |
| `selenium-java` | JDK, Maven/Gradle, Selenium Java, Chrome/driver | `selenium: ["java"]` |
| `selenium-csharp` | .NET SDK, Selenium WebDriver, Chrome/driver | `selenium: ["csharp"]` |
| `selenium-ruby` | Ruby, Bundler, `selenium-webdriver`, Chrome/driver | `selenium: ["ruby"]` |

Reglas de arranque recomendadas:

- Si el perfil no existe, el worker debe fallar con un mensaje claro.
- Si faltan dependencias obligatorias, el worker no debe tomar jobs de ese perfil.
- Si puede conectarse pero no ejecutar, debe reportar estado `DEGRADED` y mostrar el diagnostico en `Automatizacion > Workers`.
- Cada perfil debe anunciar solo lo que realmente puede ejecutar en esa maquina.
- Workers distintos pueden correr en maquinas distintas y registrarse contra el mismo backend.

Estructura sugerida para implementar perfiles:

```text
automation-worker/
  profiles/
    default.json
    playwright-python.json
    selenium-java.json
    selenium-csharp.json
    selenium-ruby.json
  src/
    profiles.mjs
    worker.mjs
```

Ejemplo de `profiles/selenium-java.json`:

```json
{
  "name": "Selenium Java Worker",
  "frameworks": ["selenium"],
  "framework_languages": {
    "selenium": ["java"]
  },
  "setup": {
    "requires": ["java", "maven", "chrome"]
  },
  "commands": {
    "run": "mvn test"
  }
}
```

El backend no necesita saber si Java se ejecuta con Maven, Gradle o un wrapper propio. Solo necesita que el worker anuncie `framework_languages` correctamente y reporte el resultado por `/automation-jobs/{id}/result`.

### Playwright Worker Function

```js
async ({ page, variables, assert, log }) => {
  await page.goto(variables.base_url)
  log("Pagina abierta")
  assert.ok(await page.locator("body").count())
}
```

### Playwright Test

```js
const { test, expect } = require('@playwright/test')

test('login visible', async ({ page }) => {
  await page.goto(variables.base_url)
  await expect(page.locator('body')).toBeVisible()
})
```

### Puppeteer

```js
const puppeteer = require('puppeteer')

const browser = await puppeteer.launch({ headless: process.env.QA_HEADLESS !== 'false' })
const page = await browser.newPage()
await page.goto(variables.base_url)
await page.waitForSelector('body')
await browser.close()
```

### Cypress

```js
describe('pagina principal', () => {
  it('carga body', () => {
    cy.visit(Cypress.env('base_url'))
    cy.get('body').should('be.visible')
  })
})
```

### Selenium Python

```python
from selenium import webdriver
from selenium.webdriver.common.by import By

options = webdriver.ChromeOptions()
if variables.get("QA_HEADLESS") == "true":
    options.add_argument("--headless=new")

driver = webdriver.Chrome(options=options)
driver.get(variables["base_url"])
assert driver.find_element(By.TAG_NAME, "body")
driver.quit()
```

## Variables Y Placeholders

El backend congela variables antes de crear el job. El worker recibe:

- Variables base del ambiente.
- Variables tecnicas del componente.
- Dataset seleccionado del ambiente.
- Datos especificos del caso.

Prioridad: los datos especificos del caso pisan al dataset, componente y ambiente. Si el caso define `url`, `base_url` o deja una URL suelta como contexto, el worker la expone como `variables.base_url`.

Tambien se reemplazan placeholders simples antes de ejecutar:

```js
await page.goto("{{base_url}}")
```

## Dry-Run

El dry-run se dispara desde `Anadir Pruebas > Script de Automatizacion > Dry-run con worker`.

- Ejecuta el script real con un worker compatible.
- No crea historial.
- No requiere build.
- No actualiza el resultado del caso.
- Sirve para validar que el script funciona antes de guardar o ejecutar formalmente.

Si no hay worker compatible, el job queda `BLOCKED_BY_RUNNER` y el monitor muestra el framework y lenguaje faltante.

## Debug Visual Y Evidencia Automatica

Para ver el navegador mientras se ejecuta una prueba:

- En dry-run activa `Ver navegador`.
- En ejecucion formal activa `Modo debug visual`.
- Tambien puedes dejar `QA_HEADLESS=false` en `.env` para que el worker local siempre abra navegador visible.

Importante: el navegador se abre en la maquina donde corre el worker. Si el worker esta en un servidor remoto, no se vera en la PC del usuario salvo que exista acceso remoto, VNC, escritorio remoto o una solucion futura de streaming.

Cuando un job falla, el worker intenta generar evidencia automatica:

| Framework | Evidencia V1 |
| --- | --- |
| Playwright worker function | Screenshot automatico de la pagina al fallar |
| Playwright Test | Screenshot on failure del runner |
| Cypress | Screenshot on failure |
| Puppeteer | Adjunta capturas guardadas en `QA_ARTIFACTS_DIR` |
| Selenium Python | Adjunta capturas guardadas en `QA_ARTIFACTS_DIR` |

Los artefactos se reportan al backend como `artifacts` en `/automation-jobs/{id}/result`. El backend los guarda como attachments y, en ejecuciones formales, los vincula al snapshot correspondiente o al primer snapshot fallido.

Helpers disponibles dentro de scripts:

### Puppeteer

```js
await captureScreenshot(page, 'fallo-login')
```

### Selenium Python

```python
capture_screenshot(driver, "fallo-login")
```

Videos y traces completos quedan fuera de V1. Para eso conviene una etapa posterior con Playwright Trace Viewer, videos de Cypress/Playwright o streaming remoto.

## Troubleshooting

### El worker no aparece en la UI

- Verifica `QA_API_BASE`.
- Confirma que el backend este iniciado.
- Borra `.runner-token` solo si queres forzar una nueva vinculacion.

### Job queda `BLOCKED_BY_RUNNER`

- El worker conectado no anuncia el framework y lenguaje requeridos.
- Revisa que `.env` tenga tags/capabilities actuales.
- Reinicia el worker despues de instalar dependencias.

### Cypress no ejecuta

Ejecuta:

```powershell
npm run install:browsers
```

Si sigue fallando, revisa el log del job en el monitor.

### Puppeteer no encuentra navegador

Reinstala dependencias:

```powershell
npm install
```

### Selenium falla por modulo faltante

```powershell
python -m pip install selenium
```

Si usas otro Python:

```env
QA_PYTHON_BIN=C:\ruta\a\python.exe
```

### Timeout

El backend envia `timeout_seconds`. Si el script tarda mas, el worker reporta `TIMEOUT`.

## Seguridad

- El worker no accede a la base de datos.
- Usa un token propio, revocable desde la plataforma.
- El codigo corto de vinculacion expira y no es el token definitivo.
- Los logs redactan patrones simples como `password=...` y `token=...`.
- V1 no ejecuta shell arbitrario; ejecuta scripts de automatizacion desde la plataforma en procesos temporales controlados por timeout.

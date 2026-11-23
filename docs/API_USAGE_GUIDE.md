# Guía de uso: ejecutar pruebas automatizadas desde un runner externo

Esta guía cubre un único flujo: enviar a Treseko los resultados de una
ejecución automatizada desde Playwright, Selenium, Cypress, Pytest u otro
pipeline CI/CD. Community permite reportar resultados con una cuota semanal
compartida con las demás ejecuciones automatizadas. Premium puede ampliar esa
cuota según los límites de la licencia instalada.

## 1. Generar la API key desde la plataforma

No generes la credencial por API. Iniciá sesión en Treseko y navegá a:

**Configuración → Preferencias → API keys de automatización externa**

Creá una clave para el runner, copiala una sola vez y guardala en el almacén de
secretos de tu CI. La clave representa al usuario que la creó, por lo que ese
usuario debe poder ejecutar pruebas y editar el proyecto involucrado.

## 2. Preparar la ejecución

El caso debe existir, estar activo y estar asignado a una build activa. El
runner necesita los códigos de solución, proyecto, componente, build y caso.
Podés verlos en la información de esos recursos dentro de Treseko.

## 3. Reportar el resultado

El runner envía un `POST` a:

```text
<URL_DE_TRESEKO>/external/executions/report
```

con la clave en el encabezado:

```http
Authorization: Bearer <API_KEY_DE_AUTOMATIZACION_EXTERNA>
Content-Type: application/json
```

El payload incluye el contexto de la build y uno o más casos con estado
`PASO`, `FALLO` o `BLOQUEADO`. Para reintentos seguros, enviá un
`external_run_id` estable y usá `overwrite` según quieras actualizar o rechazar
un resultado ya informado.

La API registra resultados: no ejecuta el script ni inicia un job. El pipeline
externo sigue ejecutando las pruebas y Treseko incorpora los resultados al
historial de la build. La cuota cuenta casos nuevos reportados dentro de una
ventana móvil de siete días y se comparte con las ejecuciones del Automation
Worker. En Community el límite predeterminado es **50 ejecuciones por semana**;
Premium usa el límite definido en su licencia. Un reintento que actualiza un
resultado ya existente no consume otra ejecución. Cada solicitud admite hasta
500 casos, aunque la cuota semanal puede ser menor.

Consultá la [API externa de automatización](EXTERNAL_AUTOMATION_API.md) para
ver el contrato completo, payloads, respuestas y un ejemplo en Python.

## Seguridad operativa

- No uses usuario y contraseña de Treseko en el runner.
- No expongas la API key en repositorios, capturas o registros de CI.
- Revocá la clave desde **Configuración → Preferencias → API keys de
  automatización externa** si se filtra, cambia el responsable o deja de usarse.

Una clave puede quedar temporalmente en estado **PAUSED** y luego volver a
**ACTIVE** sin generar una nueva. **REVOKED** es irreversible para esa clave.
Pausar o reactivar requiere permiso de edición de API keys y queda registrado
en auditoría; una clave pausada o revocada es rechazada al reportar resultados.

## Si necesitás que Treseko ejecute la prueba

Esta guía describe únicamente el reporte desde un runner externo. Para que la
plataforma ejecute una prueba API, usá **Ejecución automatizada** y un
Automation Worker que anuncie `treseko-api/declarative`. Ese flujo usa el
contrato congelado del caso y produce `treseko.api-result/v1`; no usa esta API
externa ni requiere instalar otro worker.

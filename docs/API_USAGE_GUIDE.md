# Guía de uso: ejecutar pruebas automatizadas desde un runner externo

Esta guía cubre un único flujo: enviar a Treseko los resultados de una
ejecución automatizada desde Playwright, Selenium, Cypress, Pytest u otro
pipeline CI/CD. Antes de integrarlo, confirmá que tu licencia incluya la API
externa Premium.

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
<URL_DE_TRESEKO>/api/external/executions/report
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

Consultá la [API externa de automatización](EXTERNAL_AUTOMATION_API.md) para
ver el contrato completo, payloads, respuestas y un ejemplo en Python.

## Seguridad operativa

- No uses usuario y contraseña de Treseko en el runner.
- No expongas la API key en repositorios, capturas o registros de CI.
- Revocá la clave desde **Configuración → Preferencias → API keys de
  automatización externa** si se filtra, cambia el responsable o deja de usarse.

# Guía funcional de MCP para Treseko

## 1. Propósito

MCP expone una superficie gobernada para consultar proyectos, builds, casos,
ejecuciones, resultados, bugs y calidad, además de importar casos mediante
preview, commit y rollback. No es una API administrativa general: permanece
deshabilitado por defecto, usa discovery-before-call, scopes separados y
aislamiento por organización/proyecto.

## 2. Endpoints y autenticación

| Función | Endpoint |
|---|---|
| Discovery | `GET /mcp/tools` |
| JSON-RPC 2.0 | `POST /mcp` |

La autenticación usa exclusivamente `X-MCP-API-Key`. No se debe enviar un JWT
del navegador ni incluir la API key en paquetes, casos, logs, prompts, commits
o reportes.

MCP requiere configuración explícita:

```text
TRESEKO_MCP_ENABLED=true
TRESEKO_MCP_TOOLS=<allowlist separada por comas>
TRESEKO_MCP_DEPLOYMENT_TOPOLOGY=single_process
```

Para múltiples workers o réplicas se requiere `shared_redis` y un Redis
compartido saludable. Si la configuración es ambigua, MCP falla cerrado.

## 3. Catálogo actual

| Herramienta | Uso | Scope | Operación |
|---|---|---|---|
| `treseko.project.get` | Metadatos no sensibles del proyecto | `mcp.projects.read` | Lectura |
| `treseko.builds.list` | Builds del proyecto y estado administrativo | `mcp.builds.read` | Lectura |
| `treseko.cases.list` | Lista casos autorizados | `mcp.cases.read` | Lectura |
| `treseko.cases.get` | Consulta caso y pasos autorizados | `mcp.cases.detail` | Lectura |
| `treseko.test-runs.list` | Lista ejecuciones autorizadas | `mcp.test-runs.list` | Lectura |
| `treseko.test-runs.get` | Consulta una ejecución autorizada | `mcp.test-runs.detail` | Lectura |
| `treseko.test-results.list` | Lista resultados de una ejecución | `mcp.test-results.list` | Lectura |
| `treseko.test-results.get` | Consulta un resultado autorizado | `mcp.test-results.detail` | Lectura |
| `treseko.bugs.list` | Lista bugs autorizados | `mcp.bugs.list` | Lectura |
| `treseko.bugs.get` | Consulta un bug autorizado | `mcp.bugs.detail` | Lectura |
| `treseko.quality.summary` | Agregados de calidad por build | `mcp.quality.summary` | Lectura |
| `treseko.evidence.list/get` | Metadatos y URLs de evidencias | `mcp.evidence.read` | Lectura |
| `treseko.environments.list/get` | Ambientes autorizados | `mcp.environments.read` | Lectura |
| `treseko.datasets.list/get` | Datasets autorizados | `mcp.environments.read` | Lectura |
| `treseko.cases.versions.list` | Versiones de un caso | `mcp.cases.versions` | Lectura |
| `treseko.quality.trends/compare` | Tendencias y comparación de builds | `mcp.quality.trends` | Lectura |
| `treseko.test-runs.create` | Crea una ejecución gobernada | `mcp.test-runs.write` | Mutación |
| `treseko.test-runs.execute` | Ejecuta una suite API autorizada | `mcp.test-runs.write` | Mutación |
| `treseko.test-runs.status` | Consulta estado de ejecución | `mcp.test-runs.lifecycle` | Lectura |
| `treseko.test-runs.cancel` | Cancela una ejecución | `mcp.test-runs.write` | Mutación |
| `treseko.cases.create/update/archive` | Gestiona un caso individual | `mcp.cases.write` | Mutación |
| `treseko.bugs.create-from-result/create-from-snapshot` | Crea bugs con evidencia | `mcp.bugs.write` | Mutación |
| `treseko.bugs.update/transition/close` | Gestiona bugs autorizados | `mcp.bugs.write` | Mutación |
| `treseko.cases.import.preview` | Valida un paquete sin persistirlo | `mcp.cases.import.preview` | Preview |
| `treseko.cases.import.commit` | Persiste una importación autorizada | `mcp.cases.import.commit` | Mutación |
| `treseko.cases.import.rollback` | Revierte un batch importado | `mcp.cases.import.rollback` | Mutación |

La lista efectiva depende del allowlist del entorno y de los scopes de la
credencial. Las mutaciones exigen además acceso `edit` en proyecto y
organización, confirmación literal e `idempotency_key`.

## 4. Discovery obligatorio

Antes de llamar cualquier herramienta, consultar discovery y comprobar:

- nombre exacto;
- `required_scope`;
- `operation` (`read`, `preview`, `commit` o `rollback`);
- `read_only`;
- `inputSchema` cerrado;
- ausencia de herramientas inesperadas.

Si discovery responde `404`, `MCP no está habilitado`, o no anuncia la
herramienta necesaria, detener el flujo. No llamar handlers internos como
sustituto.

## 5. Formato de llamadas

Todas las llamadas usan JSON-RPC 2.0:

```json
{
  "jsonrpc": "2.0",
  "id": "request-1",
  "method": "tools/call",
  "params": {
    "name": "treseko.cases.list",
    "arguments": {
      "project_id": "<PROJECT_UUID>",
      "limit": 25,
      "offset": 0
    }
  }
}
```

Los errores se devuelven dentro del sobre JSON-RPC. HTTP 200 con un objeto
JSON-RPC de error no significa que la operación haya sido exitosa.

## 6. Herramientas de lectura

Todas las herramientas exigen `project_id`, UUIDs válidos, schemas cerrados y
ownership del proyecto/organización. `limit` acepta 1–100 y `offset` 0–10000.

- `treseko.cases.list`: `project_id`, `limit`, `offset`.
- `treseko.cases.get`: `project_id`, `case_id`.
- `treseko.test-runs.list`: `project_id`, `limit`, `offset`.
- `treseko.test-runs.get`: `project_id`, `run_id`.
- `treseko.test-results.list`: `project_id`, `run_id`, `limit`, `offset`.
- `treseko.test-results.get`: `project_id`, `execution_id`.
- `treseko.bugs.list`: `project_id`, opcionalmente `build_id`, `estado`,
  `severidad`, `prioridad`, `limit`, `offset`.
- `treseko.bugs.get`: `project_id`, `bug_id`.
- `treseko.quality.summary`: `project_id`, `build_id`.

Los identificadores objetivo se comprueban contra el proyecto solicitado: un
run, resultado, bug o build de otro proyecto nunca se devuelve.

`treseko.cases.get` devuelve el detalle funcional utilizado para definir la
prueba: descripción, pre/postcondiciones, dataset, configuración API o
chatbot, etiquetas, framework, script almacenado y pasos con sus datos y
resultados esperados.

`treseko.test-results.get` devuelve el detalle de la ejecución: configuración
congelada, variables dinámicas, resultados API/chatbot, reporte de IA y
snapshots de cada paso con datos originales/resueltos, estado, comentarios,
errores y URL de evidencia. Los campos se acotan para evitar respuestas
ilimitadas, pero no se eliminan por ser evidencia técnica.

`treseko.test-results.list` mantiene un resumen para soportar paginación y
evitar cargar toda la evidencia de una ejecución.

Los bugs sólo exponen identificación, clasificación, textos acotados y
referencias seguras a build/caso/run/componente. El resumen de calidad devuelve
conteos de casos asignados, runs/resultados y bugs por estado/severidad.

La protección es selectiva: se mantienen los datos funcionales y la evidencia
de la prueba, pero cualquier campo identificado como password, secret, token,
API key, autorización, cookie o credencial se devuelve como `[REDACTED]`.
También se redactan bearer tokens dentro de texto libre. Los límites de tamaño
siguen aplicando; no constituyen una eliminación del contenido funcional.

## 7. Importación de casos

El importador usa el perfil `treseko/tcases-v1` y el formato
`treseko.test-cases-package/v1`. El ZIP contiene `manifest.json`, `cases.json`,
`suites.json` y `versions.json`, con checksums SHA-256. No incluir secretos,
API keys, passwords, bearer tokens, connection strings ni credenciales.

`formato_prueba` y `tipo_prueba` son dimensiones independientes. MCP admite:

- formatos `CLASICA` y `API`;
- modalidades `MANUAL`, `AUTOMATIZADA` y `AUTOMATIZADA_AI`.

`PERFORMANCE` y `CONVERSACIONAL` se rechazan mientras no exista un executor
MCP compatible. Los scripts Playwright/Selenium/Cypress/Puppeteer se almacenan
como definición revisable; el importador no los ejecuta. Se rechaza shell
inseguro y secretos.

### Preview

`treseko.cases.import.preview` recibe `project_id`, `profile_id`,
`content_base64` y opcionalmente `file_name`, `component_id` y `build_id`.
Valida sin crear suites, casos ni batches persistentes. Conservar el
`preview_token` sólo en almacenamiento temporal seguro; nunca imprimirlo.

### Commit

`treseko.cases.import.commit` requiere scopes de commit, el paquete exacto,
el token y hash del preview, una clave de idempotencia y la confirmación exacta
`APPLY_CASE_IMPORT`. Ante timeout, consultar con la misma clave antes de
reintentar. Verificar batch, totales, asignación y ausencia de secretos.

### Rollback

`treseko.cases.import.rollback` requiere batch, receipt, token de rollback,
clave de idempotencia y `ROLLBACK_CASE_IMPORT`. Nunca borrar casos directamente
en PostgreSQL. Si falta el token o secreto de firma, fallar cerrado.

## 8. API keys, scopes y RBAC

Un usuario sólo puede generar o gestionar una API key MCP mediante el endpoint
oficial si tiene `configuracion.api_keys:edit`. No existe un sistema paralelo
de credenciales. La key debe recibir únicamente los scopes necesarios:

| Necesidad | Scopes mínimos |
|---|---|
| Consultar casos | `mcp.cases.read`, opcionalmente `mcp.cases.detail` |
| Consultar ejecuciones | `mcp.test-runs.list`, opcionalmente `mcp.test-runs.detail` |
| Consultar resultados | `mcp.test-results.list`, opcionalmente `mcp.test-results.detail` |
| Consultar bugs | `mcp.bugs.list`, opcionalmente `mcp.bugs.detail` |
| Calidad por build | `mcp.quality.summary` |
| Preview | scope de lectura requerido + `mcp.cases.import.preview` |
| Commit | scopes anteriores + `mcp.cases.import.commit` |
| Rollback | `mcp.cases.import.rollback` |

El router comprueba RBAC, organización, proyecto y scope en cada llamada.
Revocar las credenciales temporales al terminar. No enviar la API key por chat.

## 9. Límites y seguridad

- rate limit de 30 llamadas por minuto;
- solicitudes normales limitadas a 64 KiB;
- respuestas limitadas a 256 KiB;
- Redis compartido obligatorio con múltiples workers;
- deny-by-default y discovery-before-call;
- auditoría saneada y acotada;
- sin shell, filesystem, secretos, base de datos, red privada ni ejecución
  arbitraria;
- errores internos, credenciales y tokens nunca se devuelven al cliente.

## 10. Capacidades aún no expuestas

No existen herramientas MCP para crear proyectos, componentes o builds, ni para
ejecutar pruebas conversacionales o de performance. La ejecución MCP real queda
limitada a suites API compatibles con el executor existente. No se ejecutan
scripts arbitrarios recibidos por MCP.

## 10.1 Superficie extendida de lectura

La integración también puede habilitar, mediante discovery y scopes dedicados:

- `treseko.evidence.list` y `treseko.evidence.get`: sólo metadatos, hash y URL
  de adjuntos asociados a snapshots; nunca blobs ni contenido binario.
- `treseko.environments.list/get` y `treseko.datasets.list/get`: datos de
  inventario pertenecientes al proyecto; variables con nombres sensibles se
  devuelven como `[REDACTED]`.
- `treseko.cases.versions.list`: versiones persistidas del mismo `master_id`,
  conservando `format` (`formato_prueba`) y `test_type` (`tipo_prueba`).
- `treseko.quality.trends` y `treseko.quality.compare`: conteos acotados de
  `TestRun`/`EjecucionCaso` persistidos, sin métricas inventadas.

Las mutaciones de runs, casos y bugs publicadas exigen confirmación,
idempotencia durable, ownership de recursos y permisos `edit`. Si el formato o
executor no está soportado, la herramienta rechaza la operación; no simula
ejecuciones clásicas, conversacionales ni de performance.

## 11. Fuentes de implementación

- Catálogo y schemas: `backend/app/services/mcp_governance.py`.
- Serialización y handlers: `backend/app/services/mcp_tools.py`.
- Autenticación, límites y ownership: `backend/app/api/routers/mcp.py`.
- Preview, commit, rollback e idempotencia:
  `backend/app/services/mcp_import.py`.
- Contrato de paquetes: `backend/app/services/case_portability_parser.py`.
- Gobernanza: `docs/MCP_GOVERNANCE.md`.
- Operación JSON-RPC: `docs/MCP_OPERATIONS.md`.

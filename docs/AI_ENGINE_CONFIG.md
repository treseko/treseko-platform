# Configuracion del Motor IA

Fecha de revision: 2026-07-22.

Esta guia separa los parametros que se pueden editar desde la pantalla `Configuracion > Pruebas con IA` de las variables de entorno que requieren reiniciar backend o engine. No usar documentos historicos de `docs/archive/` como fuente de verdad para esta configuracion.

> **Seguridad de credenciales en produccion:** las API keys se guardan en el
> vault cifrado y requieren `AI_CREDENTIALS_MASTER_KEY_FILE`. La clave maestra
> vive como secreto de despliegue, nunca en la base ni en respuestas HTTP.

El Motor IA completo esta incluido en Community. La diferencia entre planes es
la cuota semanal: Community dispone de 10 ejecuciones IA y 20 generaciones de
casos; los planes Premium aumentan esos limites.

Los dry-runs validan la configuración y el comportamiento esperado del motor.
No consumen la cuota de ejecuciones IA, no quedan bloqueados cuando esa cuota
se agota y no crean una ejecución, evidencia ni registro trazable en el core
del proyecto.

## Configuracion editable desde UI

Estos valores se persisten mediante `GET/PUT /ai-engine/config` y se aplican a ejecuciones IA nuevas.

| Parametro | Default | Uso | Requiere reinicio |
| --- | ---: | --- | --- |
| `provider` | `openai-compatible` | Tipo de proveedor LLM mostrado por la UI. | No |
| `provider_label` | `null` | Nombre legible del runtime/proveedor seleccionado, por ejemplo LM Studio. | No |
| `llm_endpoint` | `http://127.0.0.1:1234/v1` | Endpoint compatible con OpenAI chat completions usado por el engine. | No |
| `model` | `google/gemma-4-e4b` | Modelo enviado al proveedor LLM. | No |
| `temperature` | `0.1` | Temperatura base para respuestas del modelo. | No |
| `headless` | `true` | Ejecuta el navegador sin ventana visible. | No |
| `viewport_width` | `1920` | Ancho del viewport Playwright. | No |
| `viewport_height` | `1080` | Alto del viewport Playwright. | No |
| `timeout_seconds` | `900` | Timeout global de ejecucion observado por backend. | No |
| `max_parallel_ai_runs` | `1` | Maximo de casos IA lanzados en paralelo desde frontend. | No |
| `token_cost_prompt_per_1k` | `0` | Costo de tokens prompt por 1K. Tiene prioridad si prompt/respuesta son mayores a cero. | No |
| `token_cost_completion_per_1k` | `0` | Costo de tokens respuesta por 1K. Tiene prioridad si prompt/respuesta son mayores a cero. | No |
| `token_cost_per_1k` | `0.01` | Costo total por 1K tokens cuando no se separa prompt/respuesta. | No |
| `model_capabilities` | `{}` | Capacidades por modelo: vision, razonamiento, tools, JSON mode y contexto. `vision=true` habilita la auditoria visual y el envio de capturas solo para ese modelo. | No |
| `model_catalog` | `[]` | Catalogo detectado o preset de modelos disponibles para el proveedor seleccionado. | No |
| `auto_scan_enabled` | `false` | Indica si se uso auto-scan para poblar el catalogo. | No |
| `last_model_scan_at` | `null` | Fecha del ultimo auto-scan de modelos. | No |
| `last_model_scan_status` | `null` | Resultado del ultimo auto-scan: `ok`, `empty` o `error`. | No |
| `active_workflow_id` | `null` | Compatibilidad legacy para ejecucion IA. Los usos nuevos se resuelven por proposito. | No |

`max_steps` se conserva como fallback interno y compatibilidad legacy cuando no hay pasos congelados del caso, pero no se expone como control editable en la UI principal. El flujo normal se define por los pasos del caso y por el workflow activo.

Configuracion recomendada para pruebas web desktop:

```text
viewport_width=1920
viewport_height=1080
headless=true
temperature=0.1
max_parallel_ai_runs=1
timeout_seconds=900
```

Para una orientacion vertical, usar `viewport_width=1080` y `viewport_height=1920`.

## Auto-scan de modelos

La pantalla ofrece `POST /ai-engine/models/scan` para completar el catalogo de modelos sin guardar automaticamente la configuracion:

- LM Studio y proveedores OpenAI-compatible: `GET {llm_endpoint}/models`.
- Ollama: `GET {llm_endpoint}/api/tags`.
- OpenAI, Google Gemini y Anthropic: catalogo preset local, sin consultar secretos ni API remotas.

Las capacidades `vision`, `reasoning`, `tools`, `json_mode`, `context_window` y `notes` son metadata operativa para ayudar a elegir modelo. Cuando la capacidad activa `vision` es `true`, el engine adjunta evidencia visual al auditor final y puede resolver una discrepancia de texto/DOM si la captura citada lo demuestra. Si es `false` o desconocida, el engine no envia imagenes al proveedor y conserva la evaluacion determinista.

La etiqueta inicial de salud del motor no se muestra en configuracion porque estos valores son locales de la aplicación. La verificación del engine/LLM queda como accion explícita de diagnóstico.

## Vault Y Perfiles De Proveedor

Las API keys ya no se editan en la configuracion general. Se crean mediante
`/ai-provider-credentials/`, se cifran con
`AI_CREDENTIALS_MASTER_KEY_FILE` y nunca vuelven a mostrarse. Las instalaciones
productivas tambien comparten `AI_ENGINE_INTERNAL_TOKEN_FILE` exclusivamente
entre backend y Engine para proteger health checks y operaciones internas.

Un perfil `/ai-provider-profiles/` une proveedor, adapter, endpoint, modelo y
referencia de credencial. `POST /ai-provider-profiles/{id}/test` realiza una
peticion minima real y solo entonces marca el perfil `tested`. Los fallbacks se
guardan en el workflow, en orden, y solo se usan para fallos transitorios.

`POST /ai-provider-credentials/migrate-legacy` cifra las claves antiguas y
elimina sus copias de `AppSetting`. Debe ejecutarse antes de volver a guardar
una configuracion que aun contenga claves legacy.

## Workflows por uso

Treseko mantiene tres selecciones independientes:

- `story_generation`: generación de historias desde requisitos.
- `test_case_generation`: generación de casos desde historias y criterios.
- `test_execution`: ejecución de pruebas.

Cada selección abre su propio workflow para editar, validar, publicar y
versionar. Cambiar un uso no reemplaza los otros. Las ejecuciones conservan el
propósito, el identificador y la versión publicada en su snapshot auditable.

## Configuracion por workflow y nodo

Estos valores pertenecen al workflow activo, no a la configuracion global.

| Campo | Uso |
| --- | --- |
| `workflow_definition` | Snapshot de workflow enviado al engine en cada ejecucion. |
| `nodes` / `edges` | Grafo de agentes, condiciones y transiciones. |
| `timeout_sec` | Límite por nodo. En los workflows nuevos de generación de historias y casos es 300 s, alineado con el timeout predeterminado de perfiles; se puede subir hasta 7.200 s. El tiempo efectivo también queda limitado por el timeout configurado del perfil y por el timeout global de la solicitud. |
| `model_override` | Modelo especifico para un nodo, si aplica. |
| `temperature_override` | Temperatura especifica para un nodo, si aplica. |
| `retry_policy` | Política de reintentos del nodo. |
| `config_json` | Configuracion avanzada del nodo, incluyendo custom agents. |

Cada ejecucion nueva congela el workflow usado en `ai_report.workflow_snapshot`. Editar el workflow despues de iniciar una prueba no modifica esa ejecucion ya iniciada.

## Variables de entorno

Estas variables se editan en `.env` y no deben exponerse como controles editables en la UI. Algunas son sensibles o afectan seguridad operaciónal.

### Backend

| Variable | Default local | Uso | Requiere reinicio |
| --- | --- | --- | --- |
| `ENGINE_URL` | `http://engine:3010` en Docker; `http://localhost:3010` en modo nativo explícito | URL HTTP del Engine para disparar `/run-task`. El modo Docker usa el DNS interno de Compose. | Si |
| `AI_CREDENTIALS_MASTER_KEY_FILE` | obligatorio | Archivo secreto usado solo para cifrar credenciales IA. | Si |
| `AI_ENGINE_INTERNAL_TOKEN_FILE` | obligatorio | Token interno compartido con el Engine. | Si |
| `AI_ENGINE_CALLBACK_TOKEN` | vacio | Token opcional para validar callbacks del engine al backend. | Si |
| `QA_TEST_TRACE_ENABLED` | `false` | Activa trazas completas de requests/responses locales. Puede incluir datos sensibles. | Si |

### Engine

| Variable | Default local | Uso | Requiere reinicio |
| --- | --- | --- | --- |
| `ENGINE_PORT` | `3010` en `engine/.env` | Puerto HTTP del engine Express. | Si |
| `QA_TEST_TRACE_DIR` | `Engine/logs/test-trace` | Carpeta local de trazas del Engine; permite aislar evidencia de QA fuera del checkout. La traza puede conservar contenido sensible aunque redacte secretos. | Si |
| `ENGINE_CORS_ORIGIN` | `*` | Origenes permitidos para HTTP/WebSocket del engine. En despliegues dedicados usar una lista separada por comas. | Si |
| `BACKEND_WS_URL` | `ws://localhost:8000/ws/engine-sync` | WebSocket backend para progreso en tiempo real. | Si |
| `ENGINE_LOCAL_EVIDENCE_ENABLED` | `false` | Activa generacion local de reportes HTML y screenshots en `reports/`. En produccion normalmente debe quedar apagado porque la evidencia se envia al backend. | Si |
| `ENGINE_LOG_DIR` | `logs` | Carpeta local para logs operativos del engine. | Si |
| `ENGINE_REPORTS_DIR` | `reports` | Carpeta local usada solo si `ENGINE_LOCAL_EVIDENCE_ENABLED=true`. | Si |
| `AI_API_ENDPOINT` | `http://127.0.0.1:1234/v1` | Fallback de endpoint LLM si no llega por payload. | Si |
| `AI_MODEL` | `google/gemma-4-e4b` | Fallback de modelo si no llega por payload. | Si |
| `AI_MAX_CONTEXT` | `16384` | Contexto maximo esperado por el cliente IA. | Si |
| `AI_TEMPERATURE` | `0.1` | Fallback de temperatura si no llega por payload. | Si |
| `AI_DISABLE_THINKING` | `false` | Política explícita de la instancia: solicita desactivar razonamiento mediante el adaptador compatible. Usar solo con proveedores que acepten esa opción; no verifica capacidades ni cambia el proveedor configurado. | Si |
| `AI_MAX_RETRIES` | `5` | Reintentos de request LLM ante respuestas invalidas/errores recuperables. | Si |
| `AI_RETRY_TEMPERATURE` | `0.3` | Temperatura usada en reintentos. | Si |
| `AI_TOKEN_COST_PER_1K` | `0.01` | Fallback de costo total por 1K tokens. | Si |
| `AI_PROMPT_TOKEN_COST_PER_1K` | `0` | Fallback de costo prompt por 1K tokens. | Si |
| `AI_COMPLETION_TOKEN_COST_PER_1K` | `0` | Fallback de costo respuesta por 1K tokens. | Si |
| `WEBHOOK_AGENT_ALLOWLIST` | vacio | Hosts permitidos para `webhook_agent` si el nodo no define allowlist. | Si |
| `WEBHOOK_AGENT_ALLOW_PRIVATE_NETWORKS` | `false` | Permite redes privadas para webhooks. Usar solo en entornos controlados. | Si |
| `AI_SCRIPT_AGENT_ENABLED` | `false` | Habilita `script_agent`. Debe permanecer apagado por defecto. | Si |

## Parametros que no deben editarse desde UI

No exponer en pantalla de configuracion general:

- puertos (`ENGINE_PORT`);
- URLs internas de backend/engine (`ENGINE_URL`, `BACKEND_WS_URL`);
- tokens o secretos (`AI_ENGINE_CALLBACK_TOKEN`);
- feature flags peligrosas (`AI_SCRIPT_AGENT_ENABLED`);
- trazas completas (`QA_TEST_TRACE_ENABLED`);
- allowlists globales de seguridad (`WEBHOOK_AGENT_ALLOWLIST`, `WEBHOOK_AGENT_ALLOW_PRIVATE_NETWORKS`).

Estos valores pertenecen a despliegue/operación y requieren reinicio para evitar una falsa sensacion de aplicación inmediata.

### Topología estándar local

El modo estándar es **Todo Docker**: frontend, backend, Redis, PostgreSQL y
Engine se ejecutan dentro del mismo proyecto Compose. El backend debe resolver
`http://engine:3010`; nunca debe usar `localhost:3010` dentro del contenedor.
Backend y Engine reciben el mismo archivo Docker Secret para
`AI_ENGINE_INTERNAL_TOKEN_FILE`.

The internal MCP credential resolver uses the backend's plain HTTP listener at
`http://backend:8000` in Compose. This channel is permitted only when
`MCP_RUNTIME_RESOLVER_ALLOW_INSECURE_HTTP=true` is explicitly set, and every
request is authenticated with `x-engine-internal-token`; do not enable this
flag for a resolver reachable outside the authenticated private Compose
network. HTTPS remains mandatory unless this explicit, documented exception is
configured. Resolver DNS results must be literal IP addresses and all special
or reserved IPv4/IPv6 ranges are rejected before the token is sent.

Para iniciar y validar el stack desde el repositorio:

```bash
scripts/run_treseko_docker.sh
scripts/check_treseko_docker_runtime.sh
```

El frontend operativo queda publicado en el puerto configurado por
`TRESEKO_HTTP_PORT` (por defecto `9095`). `scripts/run_backend_local.sh` queda
reservado para el modo nativo explícito y no debe mezclarse con el stack Docker.

### Pruebas de capacidades del proveedor

La prueba del perfil distingue disponibilidad de capacidad estructurada:
una respuesta no vacía confirma disponibilidad; `structured_json` solo se
confirma si la sonda devuelve el JSON solicitado `{"ok":true}`. Esto no
certifica que el modelo cumpla todos los esquemas de historias, casos o
acciones: cada workflow conserva su validación de contrato y revisión.
La visión requiere superar las dos sondas de imágenes; una respuesta
inconcluyente conserva `vision_status=unknown`.

### Reparación de propuestas de historias

Si el modelo incumple el contrato, el reintento conserva las instrucciones del usuario, el alcance y las reglas de la solicitud original. La reparación no confirma una propuesta por sí sola: mantiene la validación y revisión posterior. La aceptación automática de supuestos se limita a supuestos completos con riesgo explícito LOW; MEDIUM, valores desconocidos o campos incompletos no se aceptan mediante ese mecanismo.

### Contrato de salida de autoría

El análisis, la generación y la revisión de historias y casos solicitan únicamente su esquema de salida. El cliente usa un modo explícito `schema`, incluido en las reparaciones y la extracción de fuentes, para evitar añadir una segunda plantilla genérica de agente con `decision` vacío. Los agentes de ejecución conservan su contrato de contexto compartido. Este modo es interno; no requiere una opción nueva en la configuración de usuario.

Una respuesta HTTP200 o un indicador SUCCESS del modelo no aprueba una propuesta. Continúan la validación estructural, la comprobación de referencias y la revisión de contenido. Una respuesta incompleta se rechaza; corregir el contrato de la solicitud no demuestra que cualquier modelo pueda generar casos válidos.

Cada propuesta de caso debe conservar el `local_id` emitido por el autor: texto no vacío de hasta 80 caracteres. Si falta o es inválido, el Engine solicita una reparación y rechaza la respuesta si sigue incumpliendo el contrato, antes de la revisión semántica. No se inventan identificadores para completar respuestas del modelo.

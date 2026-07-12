# Configuracion del Motor IA

Fecha de revision: 2026-06-29.

Esta guia separa los parametros que se pueden editar desde la pantalla `Configuracion > Pruebas con IA` de las variables de entorno que requieren reiniciar backend o engine. No usar documentos historicos de `docs/archive/` como fuente de verdad para esta configuracion.

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
| `model_capabilities` | `{}` | Capacidades informativas por modelo: vision, razonamiento, tools, JSON mode y contexto. | No |
| `model_catalog` | `[]` | Catalogo detectado o preset de modelos disponibles para el proveedor seleccionado. | No |
| `auto_scan_enabled` | `false` | Indica si se uso auto-scan para poblar el catalogo. | No |
| `last_model_scan_at` | `null` | Fecha del ultimo auto-scan de modelos. | No |
| `last_model_scan_status` | `null` | Resultado del ultimo auto-scan: `ok`, `empty` o `error`. | No |
| `active_workflow_id` | `null` | Workflow activo global del Motor IA. Se gestiona desde el builder. | No |

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

Las capacidades `vision`, `reasoning`, `tools`, `json_mode`, `context_window` y `notes` son metadata operativa para ayudar a elegir modelo. El engine sigue usando `llm_endpoint`, `model` y `temperature`; las capacidades no cambian la ejecucion en esta fase.

La etiqueta inicial de salud del motor no se muestra en configuracion porque estos valores son locales de la aplicación. La verificación del engine/LLM queda como accion explícita de diagnóstico.

## Configuracion por workflow y nodo

Estos valores pertenecen al workflow activo, no a la configuracion global.

| Campo | Uso |
| --- | --- |
| `workflow_definition` | Snapshot de workflow enviado al engine en cada ejecucion. |
| `nodes` / `edges` | Grafo de agentes, condiciones y transiciones. |
| `timeout_sec` | Timeout por nodo del workflow. |
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
| `ENGINE_URL` | `http://localhost:3010` | URL HTTP del engine para disparar `/run-task`. | Si |
| `AI_ENGINE_CALLBACK_TOKEN` | vacio | Token opcional para validar callbacks del engine al backend. | Si |
| `QA_TEST_TRACE_ENABLED` | `false` | Activa trazas completas de requests/responses locales. Puede incluir datos sensibles. | Si |

### Engine

| Variable | Default local | Uso | Requiere reinicio |
| --- | --- | --- | --- |
| `ENGINE_PORT` | `3010` en `engine/.env` | Puerto HTTP del engine Express. | Si |
| `ENGINE_CORS_ORIGIN` | `*` | Origenes permitidos para HTTP/WebSocket del engine. En despliegues dedicados usar una lista separada por comas. | Si |
| `BACKEND_WS_URL` | `ws://localhost:8000/ws/engine-sync` | WebSocket backend para progreso en tiempo real. | Si |
| `ENGINE_LOCAL_EVIDENCE_ENABLED` | `false` | Activa generacion local de reportes HTML y screenshots en `reports/`. En produccion normalmente debe quedar apagado porque la evidencia se envia al backend. | Si |
| `ENGINE_LOG_DIR` | `logs` | Carpeta local para logs operativos del engine. | Si |
| `ENGINE_REPORTS_DIR` | `reports` | Carpeta local usada solo si `ENGINE_LOCAL_EVIDENCE_ENABLED=true`. | Si |
| `AI_API_ENDPOINT` | `http://127.0.0.1:1234/v1` | Fallback de endpoint LLM si no llega por payload. | Si |
| `AI_MODEL` | `google/gemma-4-e4b` | Fallback de modelo si no llega por payload. | Si |
| `AI_MAX_CONTEXT` | `16384` | Contexto maximo esperado por el cliente IA. | Si |
| `AI_TEMPERATURE` | `0.1` | Fallback de temperatura si no llega por payload. | Si |
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

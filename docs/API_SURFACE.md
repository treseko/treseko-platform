# Superficie API pública

Esta página enumera los grupos de endpoints de la instalación Community. La
documentación de una ruta no implica que esté habilitada para todos los roles o
ediciones: el backend aplica autenticación, capability, scope, feature gate y
estado del recurso.

## IA y workflows

- `/ai-provider-credentials/` y `/ai-provider-profiles/`: credenciales
  protegidas, perfiles, activación, prueba de proveedor y migración de legacy.
- `/workflow-runtime-manifest`, `/workflow-preflight-v2` y
  `/workflow-preflight-v3`: catálogo de runtime y validación previa.
- `/ai-workflows/`, `/ai-workflows/{id}/validate`, duplicación, archivado,
  restore, import/export y versiones con activate/rollback.
- `/ai-universal-agents/`, presets, variantes, versiones y paquetes universales.

## Casos y ejecución API

- `/dynamic-variables/catalog`: catálogo Postman/Treseko de variables dinámicas.
- `/api-tests/validate`, `/api-tests/dry-run` y `/api-tests/{case_id}`:
  validación y previsualización sin crear una ejecución persistida.
- `/api-tests/{case_id}/execute` y `/api-tests/executions/{id}`: ejecución
  declarativa y consulta de evidencia.
- `/api-tests/executions/{id}/manual-evaluation`: evaluación humana de un
  resultado API.
- `/external/executions/report`: reporte desde un runner externo; no inicia
  jobs internos.

## Workers y automatización

- `/automation-runners/`: registro, pairing, aprobación/rechazo, heartbeat,
  revocación y capacidades del worker.
- `/automation-jobs/`: cola, claim, resultado, dry-run, leases y reconciliación
  de intentos.
- Los workers inactivos no cuentan para el límite de workers de la edición.

## Organizaciones, proyectos y trazabilidad

- `/organizaciones/` y `/organizaciones/{id}/miembros/`: organizaciones,
  activación y membresías con RBAC.
- `/generaciones-historias/` y `/generaciones-casos/`: generar, reanalizar,
  supuestos, planificación y aplicación transaccional de propuestas IA.
- `/wiki/`: documentación del proyecto, edición, historial y borrado auditado.
- `/schedules/`: programación de ejecuciones cuando la capacidad está activa.

## Configuración y operación

- `/system-monitor/summary`: estado resumido de componentes, workers, jobs y
  señales operativas.
- `/notification-stakeholders/`: destinatarios y suscripciones por proyecto.
- `/infraestructura/dispositivos/`, `/nodos/`, `/activos/` y `/endpoints/`:
  inventario autorizado y sus relaciones.
- `/mcp/tools` y `/mcp`: discovery y JSON-RPC gobernado; consultar
  [MCP](MCP_GUIDE.md) antes de llamar cualquier herramienta.

## Informes compartidos

Los informes compartidos tienen endpoints autenticados para crear, consultar
historial, estado y revocar; las rutas públicas entregan HTML, Markdown, CSV,
PDF y miniaturas desde un snapshot. Un enlace expirado o revocado no expone su
contenido anterior.

## Reglas comunes

- No usar un endpoint interno para reemplazar el flujo UI/API documentado.
- No enviar secretos, JWT de navegador o credenciales inline en payloads.
- Verificar la respuesta HTTP y el objeto de error: un `200` con JSON-RPC error
  no es éxito.
- Consultar la guía específica antes de crear datos en un entorno compartido.

## Guías relacionadas

[API declarativa](API_TESTING_GUIDE.md), [Worker](AUTOMATION_WORKER_V1.md),
[Motor IA](AI_ENGINE_CONFIG.md), [MCP](MCP_GUIDE.md),
[Reportes](REPORTING_GUIDE.md), [Trazabilidad](TRACEABILITY.md),
[Configuración](SETTINGS_GUIDE.md) y [RBAC](RBAC_CAPABILITY_MATRIX.md).

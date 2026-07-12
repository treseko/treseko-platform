# Integraciones, Plugins y RBAC

Fecha: 2026-06-29

## Concepto

Una integracion conecta Treseko con un sistema externo: Redmine, Jira, GitHub Issues, GitLab, Slack, Teams, Azure DevOps o CI/CD.

Un plugin extiende Treseko con una capacidad nueva: importadores, exportadores, widgets, motores de metricas o generadores IA.

Regla operativa:

- Si conecta con un sistema externo, es una integracion.
- Si agrega capacidades nuevas al producto, es un plugin.
- Un plugin puede usar integraciones, pero una integracion no implica plugin.

## Alcance V1

Esta pasada no implementa bug tracker completo, marketplace, instalacion dinamica de plugins ni ejecucion de codigo de terceros.

Queda preparado:

- Namespaces de RBAC para integraciones y plugins.
- Registry estatico V1 de providers planificados.
- Compatibilidad con `redmine` legacy.
- Tablas base para PostgreSQL/SQLite mediante Alembic.
- Documentacion para V2/V3.

## Namespaces

Integraciones core:

```text
integraciones.catalogo
integraciones.ver_estado
integraciones.test_conexion
integraciones.configurar
integraciones.secretos
integraciones.webhooks
integraciones.auditoria
```

Integraciones por provider:

```text
integraciones.provider.<provider_id>.<accion>
```

Ejemplos registrados:

```text
integraciones.provider.redmine.ver
integraciones.provider.redmine.configurar
integraciones.provider.redmine.reportar
integraciones.provider.jira.reportar
integraciones.provider.github_issues.vincular
```

Plugins core:

```text
plugins.catalogo
plugins.instalar
plugins.desinstalar
plugins.habilitar
plugins.configurar
plugins.gestionar_secretos
plugins.auditoria
```

Plugins por provider:

```text
plugins.provider.<plugin_id>.<capability>
```

Ejemplos registrados:

```text
plugins.provider.junit_importer.importar_resultados
plugins.provider.excel_importer.importar_casos
plugins.provider.custom_dashboard.agregar_widget
plugins.provider.ai_case_generator.generar_casos
```

## Registry

Backend:

- `backend/app/services/integrations/registry.py`
- `backend/app/services/plugins/registry.py`

Funciones:

- `get_registered_integrations()`
- `get_registered_plugins()`
- `get_registered_capabilities()`
- `is_registered_capability(capability_id)`

Los manifests son estaticos en V1. En V2/V3 pueden pasar a DB o a manifests instalados.

## Compatibilidad Redmine legacy

No se elimina el modulo legacy `redmine`.

Alias efectivo:

```text
redmine:read
  -> integraciones.provider.redmine.ver

redmine:edit
  -> integraciones.provider.redmine.ver
  -> integraciones.provider.redmine.configurar
  -> integraciones.provider.redmine.test_conexion
  -> integraciones.provider.redmine.gestionar_secretos
  -> integraciones.provider.redmine.reportar
  -> integraciones.provider.redmine.vincular
```

Implementacion:

- Backend: `backend/app/rbac_compat.py`
- Frontend: `frontend/src/app/rbac/rbacCompat.ts`

## Persistencia

Tablas agregadas por Alembic:

- `integration_providers`
- `plugin_providers`
- `integration_instances`
- `integration_secrets`
- `external_issue_links`
- `webhook_events`

Reglas de secretos:

- No se exponen secretos al frontend.
- `integration_instances.config_json` no debe guardar tokens reales.
- `integration_instances.secrets_configured` solo indica presencia/configuracion.
- `integration_secrets.secret_value_encrypted` queda para valores cifrados. Si no hay cifrado operativo, no guardar tokens reales.

## V2/V3

V2:

- Bug tracker externo real.
- Redmine primero.
- Jira y GitHub Issues despues.
- Vinculacion snapshot -> issue.
- Deduplicacion real.
- Estado visible de reporte.

V3:

- Manifests instalables.
- Plugins habilitables/deshabilitables.
- Capabilities dinamicas instaladas.
- Pantallas/widgets extensibles.
- Sandbox y auditoria avanzada.

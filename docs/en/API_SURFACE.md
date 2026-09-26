# Public API surface

<!-- Language: en -->

This page lists the Community installation's endpoint groups. Documenting a
route does not mean every role or edition can use it: the backend applies
authentication, capability, scope, feature gates and resource state.

## AI and workflows

- `/ai-provider-credentials/` and `/ai-provider-profiles/`: protected
  credentials, profiles, activation, provider tests and legacy migration.
- `/workflow-runtime-manifest`, `/workflow-preflight-v2` and
  `/workflow-preflight-v3`: runtime catalog and pre-save validation.
- `/ai-workflows/`, validation, duplication, archive, restore, import/export
  and version activate/rollback endpoints.
- `/ai-universal-agents/`, presets, variants, versions and universal packages.

## Cases and API execution

- `/dynamic-variables/catalog`: Postman/Treseko dynamic-variable catalog.
- `/api-tests/validate`, `/api-tests/dry-run` and `/api-tests/{case_id}`:
  validation and preview without a persisted execution.
- `/api-tests/{case_id}/execute` and `/api-tests/executions/{id}`: declarative
  execution and evidence lookup.
- `/api-tests/executions/{id}/manual-evaluation`: human evaluation of an API
  result.
- `/external/executions/report`: reporting from an external runner; it does not
  start internal jobs.

## Workers and automation

- `/automation-runners/`: registration, pairing, approval/denial, heartbeat,
  revocation and worker capabilities.
- `/automation-jobs/`: queue, claim, result, dry-run, leases and attempt
  reconciliation.
- Inactive workers do not count toward the edition's worker limit.

## Organizations, projects and traceability

- `/organizaciones/` and `/organizaciones/{id}/miembros/`: organizations,
  activation and RBAC membership.
- `/generaciones-historias/` and `/generaciones-casos/`: generate, reanalyze,
  assumptions, planning and transactional application of AI proposals.
- `/wiki/`: project documentation, editing, history and audited deletion.
- `/schedules/`: scheduled executions when the capability is enabled.

## Configuration and operations

- `/system-monitor/summary`: summary status for components, workers, jobs and
  operational signals.
- `/notification-stakeholders/`: project recipients and subscriptions.
- `/infraestructura/dispositivos/`, `/nodos/`, `/activos/` and `/endpoints/`:
  authorized inventory and relationships.
- `/mcp/tools` and `/mcp`: governed discovery and JSON-RPC; read [MCP](MCP_GUIDE.md)
  before calling any tool.

## Shared reports

Shared reports have authenticated endpoints to create, inspect history/status
and revoke; public routes serve HTML, Markdown, CSV, PDF and thumbnails from a
snapshot. An expired or revoked link never exposes its previous content.

## Common rules

- Do not use an internal endpoint as a substitute for the documented UI/API
  flow.
- Do not send secrets, browser JWTs or inline credentials in payloads.
- Check both the HTTP response and error object: a `200` JSON-RPC error is not
  success.
- Read the specific guide before creating data in a shared environment.

## Related guides

[Declarative API](API_TESTING_GUIDE.md), [Worker](AUTOMATION_WORKER_V1.md),
[AI Engine](AI_ENGINE_CONFIG.md), [MCP](MCP_GUIDE.md),
[Reports](REPORTING_GUIDE.md), [Traceability](TRACEABILITY.md),
[Settings](SETTINGS_GUIDE.md) and [RBAC](RBAC_CAPABILITY_MATRIX.md).

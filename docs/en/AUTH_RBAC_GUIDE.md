# Access, users and permissions

<!-- Language: en -->

Treseko combines authentication, RBAC roles, capabilities, scope and edition.
The backend evaluates capability, level, organization/project and entitlement;
the nominal role alone does not authorize an action.

## Authentication and roles

Treseko supports email/password and, depending on configuration and edition,
Active Directory, LDAP or OIDC. Corporate identity does not decide the internal
role.

| Role | Use |
|---|---|
| ADMIN | Global administration. |
| QA_LEAD | Authorized projects, tests, executions and reports. |
| TESTER | Design and execution according to capabilities and scope. |
| VIEWER | Read-only access. |

Custom roles adjust modules and actions. Editor includes Reader access.

## Capability and scope

```text
identity → role/capability → level → organization/project → entitlement → action
```

Examples include `ejecutar.manual`, `ejecutar.automatizada`, `ejecutar.ia`, reports,
bugs, incidents, history, plugins, API keys and evidence sanitization. MCP
requires organization and project read access. Worker pairing and organization
do not replace job authorization.

## License and downgrade

Community has limits; Premium may enable granular RBAC, SSO, multiple workers,
snapshots, advanced reports, integrations, audit and historical metrics. When
Premium expires, data is not deleted: new writes or Premium functions are
restricted and historical reading may remain available. Reading does not imply
editing or regenerating.

In Settings you can create users and roles and review the audit. Inactivation
preserves traceability. Do not share passwords or API keys.

| Problem | Check |
|---|---|
| A module is missing | Role, capability, edition and scope. |
| Can view but not edit | Level and write permission. |
| Worker has no results | Pairing, organization, build, key and network. |
| MCP returns 403 | Capability and organization/project access. |
| Feature after downgrade | Entitlement and historical policy. |

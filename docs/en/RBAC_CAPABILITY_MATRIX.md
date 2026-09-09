# Capability matrix

<!-- Language: en -->

Capabilities are evaluated together with role, level, scope and license; they
are not edited manually as technical text.

| Area | Capabilities to review | Scope |
|---|---|---|
| Projects | Portfolio, components, builds, environments, datasets, stories | Organization/project. |
| Cases | Suites, cases, steps, attachments, scripts, traceability | Authorized project. |
| Execution | `ejecutar.manual`, `ejecutar.automatizada`, `ejecutar.ia` | Format and mode are independent. |
| Automation | Workers, jobs, validation, declarative API | Approved worker and valid scope. |
| Reports | Reading, export, snapshots, sharing, metrics | Some require Premium. |
| Bugs/incidents | Create, edit, assign, comment, attach, triage | Eligible evidence. |
| History | Runs, snapshots and historical audit | Downgrade may preserve read access. |
| AI | Profiles, credentials, workflows and review | Does not mean all formats can be executed. |
| Integrations | Provider, links, notifications | Project scope and capability. |
| Plugins | Catalog, install, enable, configure, portability | Runner and entitlement. |
| Configuration | Users, roles, license, updates, API keys | Restricted administration. |

Premium may enable granular RBAC, SSO, multiple workers, scheduler, advanced
external API, advanced reports/snapshots, enterprise bugs, integrations, audit,
historical metrics, branding and Premium updates.

## MCP

MCP is disabled by default, uses an API key separate from the JWT and exposes
only read tools enabled by an allowlist, with simultaneous organization and
project scope.

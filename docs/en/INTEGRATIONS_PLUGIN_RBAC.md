# Integrations, plugins and RBAC

<!-- Language: en -->

They depend on provider, capability, scope and entitlement. Their appearance
in the catalog does not mean they are enabled.

## Integrations

The catalog includes Redmine, Jira, GitHub Issues, GitLab, Azure DevOps, Slack,
Teams and CI/CD, with availability Community, Premium, legacy or planned
depending on the provider. Review the installation status.

Bug links are explicit: Treseko does not publish external issues automatically.
Review the summary and save the link or identifier. Use least-privilege
technical accounts and never paste tokens into cases or evidence.

## plugin-runner

The `plugins` profile is declared in Compose, but the current public snapshot
does not contain the `plugin-runner` build context. It is therefore not
operational and must not be started from this package. The existence of the
profile does not imply support for third-party plugins.

## Portability

Portability uses provider capabilities and profiles. Review
[CASE_PORTABILITY.md](CASE_PORTABILITY.md). Importers do not execute scripts as
free code; Postman preserves diagnostics and uses the supported declarative
runtime.

## MCP

MCP is not the external reporting API. It is disabled by default, uses
`X-MCP-API-Key` and does not accept browser JWTs. The current allowlist exposes
the read-only `treseko.project.get` and `treseko.builds.list` tools.

Each call requires capability, organization and project scope through
`project_id`, validation, limits, rate limiting and auditing. There is no shell,
filesystem, secrets, database or generic network access.

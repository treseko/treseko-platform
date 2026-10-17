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

The `plugins` profile adds the isolated Plugin Runner. In Community 1.0.7 it accepts only
the declarative `junit_xml.import_results` invocation; it does not execute
arbitrary code, WASM or third-party plugins. It has a dedicated network with no
DB, Redis, secrets or Docker socket access.

When enabling the profile manually, pass `TRESEKO_RELEASE_VERSION` with the
value from `VERSION` to `docker compose` so the image records the correct
release. The atomic updater sets this value when rebuilding active services.

## Portability

Portability uses provider capabilities and profiles. Review
[CASE_PORTABILITY.md](CASE_PORTABILITY.md). Importers do not execute scripts as
free code; Postman preserves diagnostics and uses the supported declarative
runtime.

## MCP

MCP is not the external reporting API. It is disabled by default, uses
`X-MCP-API-Key` and does not accept browser JWTs. The public surface combines
queries for projects, builds, cases, runs, results, bugs, quality, evidence,
environments, datasets, versions and trends with confirmed mutations and
governed imports when capability and scope allow them. Discover the effective
list at `/mcp/tools`; do not assume a static catalog.

Each call requires capability, organization and project scope through
`project_id`, validation, limits, rate limiting and auditing. There is no shell,
filesystem, secrets, database or generic network access.

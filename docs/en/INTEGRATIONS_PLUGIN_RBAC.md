# Integrations, plugins and RBAC

<!-- Language: en -->

They depend on provider, capability, scope and entitlement. Their appearance
in the catalog does not mean they are enabled.

## Integrations and catalog features

The catalog shows items registered and accessible in the installation; a
mention, historical row or planned provider does not mean a connector is ready
to configure. In this version, Email/SMTP is the native integration; its
management requires Premium. Bug Tracker, AI Engine, Case Portability and AI case generation are native features
that appear as catalog add-ons, not third-party connectors. The external
reporting API is a separate flow described in its [usage guide](API_USAGE_GUIDE.md).

Do not assume Jira, GitHub Issues, GitLab, Azure DevOps, Slack, Teams or Redmine
are connected just because the app contains fields or historical references for
them. Confirm availability in **Add-ons**; it depends on the registered
provider, edition and permissions. Bug links are explicit: Treseko does not
publish external issues automatically. Review the summary before saving a link
or identifier. Use least-privilege technical accounts and never paste tokens
into cases or evidence.

## plugin-runner

The `plugins` profile adds the isolated Plugin Runner. In Community 1.0.8 it
accepts the declarative `junit_xml.import_results` import; it does not execute
arbitrary code, WASM or third-party plugins. It has a dedicated network with no
DB, Redis, secrets or Docker socket access.

When enabling the profile manually, pass `TRESEKO_RELEASE_VERSION` with the
value from `VERSION` to `docker compose` so the image records the correct
version.

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

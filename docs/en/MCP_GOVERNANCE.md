# Governed MCP

<!-- Language: en -->

Treseko MCP is disabled by default. Enabling it requires
`TRESEKO_MCP_ENABLED=true`, an explicit tool allowlist, and a safe topology:
`TRESEKO_MCP_DEPLOYMENT_TOPOLOGY=single_process` for one process, or
`shared_redis` with `REDIS_URL` (or `TRESEKO_MCP_RATE_LIMIT_REDIS_URL`) for
multiple workers or replicas. Missing or ambiguous topology disables MCP.

Authentication uses only a revocable `X-MCP-API-Key`; browser JWTs are not
accepted. Project and organization membership are checked on every call.

The surface combines reads with governed write operations. The allowlist is
intersected with each tool's RBAC capability and declared scopes. The catalog has
no shell, filesystem, secrets,
database, private network, or arbitrary execution.

The limits are 30 calls per minute, 64 KiB per request, and 256 KiB per
response. Shared Redis is checked with a short timeout and safe caching; if it
is unavailable, every MCP route, including `initialize`, discovery, and
authentication, fails closed. Handlers return bounded, JSON-safe results;
strings, lists, depth, and bytes are truncated or rejected before the JSON-RPC
envelope is built.

Calls and rejections are audited with bounded, sanitized details. Prompts,
credentials, and complete results are not persisted. MCP is not exposed openly
to the Internet, and mutations require a dedicated capability, allowlist,
schema, and audit tests.

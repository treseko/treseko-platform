<!-- Language: en -->

# MCP operations

Enable MCP through Settings → MCP and the persisted `mcp.enabled` setting. Every request checks it again; database failures deny access until recovery. `TRESEKO_MCP_ENABLED` does not replace persisted activation. Declare `TRESEKO_MCP_DEPLOYMENT_TOPOLOGY=single_process` for one process; replicas/workers require `shared_redis` and healthy shared Redis. Ambiguous configurations fail closed.

Apply Alembic migrations through `20261015_0076` before starting the new version. It adds durable dispatch and workspace receipts without deleting data, and records onboarding as pending on new installations so creating data cannot skip it. Existing installations with data keep their historical completion state; the migration does not claim that they accepted the terms. The dispatcher starts with backend, retains pending work and marks interrupted runs without replaying HTTP. Back up real installations before migration.

In Docker the internal resolver uses `http://backend:8000/mcp/internal/runtime-credential`. Engine permits this private network only when the administrator explicitly declares `MCP_RUNTIME_RESOLVER_TRUSTED_PRIVATE_ORIGINS=http://backend:8000`; external MCP endpoints still reject private networks. Keep resolver secrets out of code/documents. DNS pinning preserves Host and TLS SNI and bounds response size.

Inspect the effective endpoint, tools and scopes in Settings. Credentials can be paused, resumed and revoked even when MCP is disabled. Paused is not revoked. Session/permission changes clear the one-time key from the interface. Never copy browser credentials into prompts.

Distinguish authentication/permission errors, invalid schemas, revision conflicts, response limits, interrupted runs and internal failures. Inspect audit logs and run status. Mutation retries retain arguments and key; never assume a timeout means rollback. See [MCP_GUIDE.md](MCP_GUIDE.md) for contracts.

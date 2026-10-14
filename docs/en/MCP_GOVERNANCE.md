<!-- Language: en -->

# MCP governance

Tools are discovered through effective scopes and RBAC. Reads require `read`; mutations require `edit` on the capability, organization and project, confirmation and an idempotent receipt. Model instructions never grant permissions.

New workspace functions have separate read/write scopes. Revisions prevent stale overwrites and transactions bind changes, receipts and audit. Results preserve evidence, redact secrets and fail explicitly when limits are exceeded. MCP annotations describe operations; they do not replace authorization.

See [MCP guide](MCP_GUIDE.md) and [MCP operations](MCP_OPERATIONS.md).

# Governed MCP

<!-- Language: en -->

Treseko includes a governed MCP (Model Context Protocol) surface so an
authorized assistant can query QA context and perform explicitly confirmed
case, run, bug and import operations. It is disabled by default and never
grants access to the shell, filesystem, secrets, database or private network.

## Status and scope

The catalog exposes these read tools:

- `treseko.project.get` and `treseko.builds.list`.
- `treseko.cases.list/get` and `treseko.cases.versions.list`.
- `treseko.test-runs.list/get/status` and test-result list/get.
- `treseko.bugs.list/get` and `treseko.quality.summary`.
- `treseko.evidence.list/get`, environments and datasets list/get.
- `treseko.quality.trends/compare`.

All tools require `project_id` and enforce the user's access to the
organization and project. The governed mutation and import tools are also
discoverable when the identity has the required scopes: create/execute/cancel
test runs, create/update/archive cases, create/update/transition/close bugs,
and preview/commit/rollback case imports. Mutations require the literal
confirmation and durable `idempotency_key` defined by their input schema.
Conversational and performance execution are not exposed through MCP.

## 1. Enable MCP

Configure these variables in the backend environment:

```text
TRESEKO_MCP_ENABLED=true
TRESEKO_MCP_TOOLS=treseko.project.get,treseko.builds.list
```

Restart the backend after changing the configuration. If
`TRESEKO_MCP_ENABLED` is not set to `true`, `/mcp` and `/mcp/tools` report that
MCP is not enabled.

## 2. Create the credential

MCP uses a dedicated credential (`X-MCP-API-Key`), separate from the browser
session and the API key used to report external executions. The creation and
governance of this credential depend on the edition and instance configuration;
do not reuse a key for `/external/executions/report`.

The technical identity needs read capability and simultaneous scope over the
organization and `project_id`. If your installation's interface does not offer
MCP credential management, ask the administrator to create it through the
instance's operational mechanism; do not replace it with a browser JWT.

Store the key in the MCP client's secret store. Do not include it in
repositories, screenshots, prompts, versioned `.env` files or logs.

## 3. Discover tools

Discovery: `GET https://TU_TRESEKO/mcp/tools` with the
`X-MCP-API-Key: <MCP_API_KEY>` header.

You can also use JSON-RPC over `POST /mcp`:

```bash
# Discovery and JSON-RPC call
curl -sS https://TU_TRESEKO/mcp/tools \
  -H "X-MCP-API-Key: ${TRESEKO_MCP_API_KEY}"

curl -sS https://TU_TRESEKO/mcp \
  -H 'Content-Type: application/json' \
  -H "X-MCP-API-Key: ${TRESEKO_MCP_API_KEY}" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -sS https://TU_TRESEKO/mcp \
  -H 'Content-Type: application/json' \
  -H "X-MCP-API-Key: ${TRESEKO_MCP_API_KEY}" \
  --data '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"treseko.project.get",
      "arguments":{"project_id":"00000000-0000-0000-0000-000000000000"}
    }
  }'
```

The response only includes tools enabled by the allowlist and permitted by the
technical user's RBAC.

## 4. Call a tool

Replace the example UUID with a project to which the technical identity has
access. To list builds, change `name` to `treseko.builds.list`.

## Security and limits

- Authentication uses only `X-MCP-API-Key`; browser JWTs are not accepted.
- MCP remains disabled by default.
- The allowlist cannot enable unknown or forbidden tools.
- The allowlist cannot enable unknown or forbidden tools; there is no shell,
  filesystem, secrets, database or generic network access.
- Only tool invocations that execute successfully are audited with the actor,
  tool, sanitized arguments, `success` status and `correlation_id`. Authentication,
  RBAC, validation, allowlist or limit rejections happen before that record is
  created.
- The limit is 30 calls per minute.
- Each request accepts up to 64 KiB and each response up to 256 KiB.
- Set `TRESEKO_MCP_DEPLOYMENT_TOPOLOGY=single_process` for one process, or
  `shared_redis` together with `REDIS_URL` (or
  `TRESEKO_MCP_RATE_LIMIT_REDIS_URL`) for multiple workers/replicas. A missing,
  invalid, or ambiguous topology disables MCP.
- The backend checks shared Redis with a short timeout and safe caching. If
  Redis is unavailable, every MCP route (including initialize, discovery, and
  authentication) fails closed until health is restored.
- Each handler returns a bounded, JSON-safe result per tool. Strings, lists,
  depth, and bytes are truncated or rejected before the JSON-RPC envelope is
  constructed.
- The complete result is not stored in the audit log; the response is delivered
  to the MCP client and the record keeps the `success` status.
- Revoking the API key or disabling MCP blocks subsequent calls.

## Common problems

The responses in this table are literal messages emitted by the current
backend and are preserved to make troubleshooting easier.

| Response | Likely cause |
|---|---|
| `404 MCP no está habilitado` | `TRESEKO_MCP_ENABLED=true` is missing or the backend was not restarted. |
| `401 Credencial MCP inválida` | The key is missing, revoked or does not correspond to a valid user. |
| `403` for capability or project | The user lacks read permission for the tool, organization or project. |
| `404 Herramienta MCP no autorizada` | The tool is not in `TRESEKO_MCP_TOOLS` or does not exist in the catalog. |
| `429` | The call limit was exceeded. |

For an external integration, first verify `/mcp/tools`, run a read-only call
against a test project and review the audit log.

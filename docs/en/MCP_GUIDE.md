# Governed MCP

<!-- Language: en -->

Treseko includes a read-only MCP (Model Context Protocol) endpoint so an
authorized assistant can query QA context from an installation. It is disabled
by default and does not grant access to the shell, filesystem, secrets,
database or private network.

## Status and scope

The initial implementation exposes these tools:

- `treseko.project.get`: reads non-sensitive project metadata.
- `treseko.builds.list`: lists builds for a project.

Both tools require `project_id` and enforce the user's access to the
organization and project. Mutations and arbitrary execution are outside this
contract.

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

```text
GET https://TU_TRESEKO/mcp/tools
X-MCP-API-Key: <MCP_API_KEY>
```

You can also use JSON-RPC over `POST /mcp`:

```bash
curl -sS https://TU_TRESEKO/mcp \
  -H 'Content-Type: application/json' \
  -H "X-MCP-API-Key: ${TRESEKO_MCP_API_KEY}" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The response only includes tools enabled by the allowlist and permitted by the
technical user's RBAC.

## 4. Call a tool

```bash
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

Replace the example UUID with a project to which the technical identity has
access. To list builds, change `name` to `treseko.builds.list`.

## Security and limits

- Authentication uses only `X-MCP-API-Key`; browser JWTs are not accepted.
- MCP remains disabled by default.
- The allowlist cannot enable unknown or forbidden tools.
- The initial allowlist includes only `treseko.project.get` and
  `treseko.builds.list`; there is no shell, filesystem, secrets, database or
  generic network access.
- Only tool invocations that execute successfully are audited with the actor,
  tool, sanitized arguments, `success` status and `correlation_id`. Authentication,
  RBAC, validation, allowlist or limit rejections happen before that record is
  created.
- The limit is 30 calls per minute.
- Each request accepts up to 64 KiB and each response up to 256 KiB.
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

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
organization and project. Mutations and arbitrary code execution are outside
this contract.

## 1. Enable MCP

Configure these variables in the backend environment:

```text
TRESEKO_MCP_ENABLED=true
TRESEKO_MCP_TOOLS=treseko.project.get,treseko.builds.list
```

Restart the backend after changing the configuration. If
`TRESEKO_MCP_ENABLED` is not set to `true`, `/mcp` and `/mcp/tools` report that
MCP is disabled.

## 2. Create the credential

MCP uses an API key separate from the browser session. Create it from
**Settings → Preferences → External automation API keys**. The key is linked
to the user who created it, so that user must have read access to the project
and its organization.

Store the key in the MCP client's secret store. Do not put it in a repository,
screenshots, prompts, versioned `.env` files or logs.

## 3. Discover tools

```text
GET https://YOUR_TRESEKO/mcp/tools
X-MCP-API-Key: <MCP_API_KEY>
```

You can also use JSON-RPC over `POST /mcp`:

```bash
curl -sS https://YOUR_TRESEKO/mcp \
  -H 'Content-Type: application/json' \
  -H "X-MCP-API-Key: ${TRESEKO_MCP_API_KEY}" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The response only includes tools enabled by the allowlist and permitted by the
technical user's RBAC permissions.

## 4. Call a tool

```bash
curl -sS https://YOUR_TRESEKO/mcp \
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

Replace the example UUID with a project that the technical identity can read.
To list builds, change `name` to `treseko.builds.list`.

## Security and limits

- Authentication uses only `X-MCP-API-Key`; browser JWTs are not accepted.
- MCP remains disabled by default.
- The allowlist cannot enable unknown or forbidden tools.
- The rate limit is 30 calls per minute.
- Each request is limited to 64 KiB and each response to 256 KiB.
- Successful calls are audited with the actor, tool, sanitized arguments,
  result and `correlation_id`.
- Revoking the API key or disabling MCP blocks subsequent calls.

## Common problems

| Response | Likely cause |
|---|---|
| `404 MCP no está habilitado` | `TRESEKO_MCP_ENABLED=true` is missing or the backend was not restarted. |
| `401 Credencial MCP inválida` | The key is missing, revoked or does not belong to a valid user. |
| `403` for capability or project | The user lacks read permission for the tool, organization or project. |
| `404 Herramienta MCP no autorizada` | The tool is not in `TRESEKO_MCP_TOOLS` or does not exist in the catalog. |
| `429` | The call rate limit was exceeded. |

For an external integration, first verify `/mcp/tools`, run a read-only call
against a test project, and inspect the audit log.

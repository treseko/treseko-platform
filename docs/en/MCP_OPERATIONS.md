# MCP operations

<!-- Language: en -->

`POST /mcp` is a JSON-RPC 2.0 endpoint. `GET /mcp/tools` is the discovery
endpoint. MCP errors remain inside JSON-RPC envelopes; internal details,
credentials, and handler/database exceptions never reach clients. Notifications
receive HTTP 204 with no JSON-RPC response.

The discovery response is the source of truth for the enabled catalog. Read
operations and governed mutations use the same JSON-RPC transport; mutations
require the schema's explicit confirmation and a durable `idempotency_key`.
Import tools expose `preview`, `commit` and `rollback` as separate operations.

The process-local limiter is bounded and lock-protected. It is allowed only
when `TRESEKO_MCP_DEPLOYMENT_TOPOLOGY=single_process` is explicit. A shared
Redis limiter is required for workers or replicas. Redis admission health uses a
short timeout and safe cache; an unavailable limiter disables every MCP route,
including initialize, discovery, and authentication.

Handlers have a bounded result contract: JSON-safe strings, lists, depth, and
bytes are limited per tool before the response envelope is built. Oversized or
unsafe results are rejected instead of materializing an unbounded envelope.

"""Bounded MCP request/result materialization helpers."""
from __future__ import annotations

import json
from typing import Any

if False:  # pragma: no cover - type checker only
    from .mcp_governance import McpTool


class McpResultTooLarge(ValueError):
    """The bounded tool-result contract cannot represent a safe result."""


def request_limit_for_tool(tool: Any) -> int:
    """Return the admission cap for a resolved tool, never an unbounded cap."""
    if tool.handler_key.startswith("cases.import."):
        return 12_000_000 + 16 * 1024
    if tool.handler_key in {"wiki.create", "wiki.update"}:
        return 4 * 1024 * 1024
    return 64 * 1024


def bound_tool_result(tool: Any, value: Any) -> dict[str, Any]:
    """Materialize only a bounded, JSON-safe representation of a handler result."""
    from .mcp_redaction import redact
    bounded = redact(value)
    if not isinstance(bounded, dict):
        bounded = {"value": bounded}
    try:
        encoded = json.dumps(bounded, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise McpResultTooLarge("handler result is not JSON-safe") from exc
    if len(encoded) > tool.max_result_bytes:
        raise McpResultTooLarge("result exceeds limit; reduce the page size or request a single item")
    return bounded

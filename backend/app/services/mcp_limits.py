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
    if tool.operation in {"preview", "commit", "rollback"}:
        return 12_000_000 + 16 * 1024
    return 64 * 1024


def bound_tool_result(tool: Any, value: Any) -> dict[str, Any]:
    """Materialize only a bounded, JSON-safe representation of a handler result."""
    truncated = False

    def visit(item: Any, depth: int = 0) -> Any:
        nonlocal truncated
        if depth > 5:
            truncated = True
            return "[max-depth]"
        if item is None or isinstance(item, (bool, int, float)):
            return item
        if isinstance(item, str):
            if len(item) > tool.max_string_chars:
                truncated = True
                return item[: tool.max_string_chars]
            return item
        if isinstance(item, dict):
            result = {}
            for index, (key, child) in enumerate(item.items()):
                if index >= 64:
                    truncated = True
                    break
                if not isinstance(key, str):
                    raise McpResultTooLarge("handler result has a non-string key")
                result[key[:128]] = visit(child, depth + 1)
            return result
        if isinstance(item, (list, tuple)):
            if len(item) > 1000:
                truncated = True
            return [visit(child, depth + 1) for child in item[:1000]]
        raise McpResultTooLarge("handler result is not JSON-safe")

    bounded = visit(value)
    if not isinstance(bounded, dict):
        bounded = {"value": bounded}
    if truncated:
        bounded["truncated"] = True
    try:
        encoded = json.dumps(bounded, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise McpResultTooLarge("handler result is not JSON-safe") from exc
    if len(encoded) > tool.max_result_bytes:
        raise McpResultTooLarge("handler result exceeds tool limit")
    return bounded

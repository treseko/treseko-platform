"""Small, deny-by-default governance layer for the Treseko MCP endpoint.

The module deliberately contains no shell, filesystem, secret or arbitrary HTTP
adapters.  The catalog is the security boundary: a tool must be declared here
and explicitly enabled by configuration before it can be called.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID


MCP_MAX_REQUEST_BYTES = 64 * 1024
MCP_MAX_RESPONSE_BYTES = 256 * 1024
MCP_RATE_LIMIT = 30
MCP_RATE_WINDOW_SECONDS = 60
MCP_DEFAULT_TOOLS = ("treseko.project.get", "treseko.builds.list")
MCP_FORBIDDEN_NAMES = {"shell", "filesystem", "fs", "secrets", "database", "network"}


@dataclass(frozen=True)
class McpTool:
    name: str
    description: str
    version: str = "1.0"
    capability: str = "proyectos.portfolio"
    read_only: bool = True

    @property
    def input_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "required": ["project_id"],
            "additionalProperties": False,
            "properties": {"project_id": {"type": "string", "format": "uuid"}},
        }


TOOL_CATALOG: dict[str, McpTool] = {
    "treseko.project.get": McpTool(
        name="treseko.project.get",
        description="Consulta los metadatos no sensibles de un proyecto permitido.",
    ),
    "treseko.builds.list": McpTool(
        name="treseko.builds.list",
        description="Consulta las builds de un proyecto permitido, incluidas las históricas.",
    ),
}


def mcp_enabled() -> bool:
    return os.getenv("TRESEKO_MCP_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


def enabled_tool_names() -> set[str]:
    configured = os.getenv("TRESEKO_MCP_TOOLS", "").strip()
    if not configured:
        return set()
    names = {item.strip() for item in configured.split(",") if item.strip()}
    return names & set(TOOL_CATALOG)


def public_tools() -> list[dict[str, Any]]:
    enabled = enabled_tool_names()
    return [
        {"name": tool.name, "description": tool.description, "version": tool.version,
         "capability": tool.capability, "read_only": tool.read_only,
         "inputSchema": tool.input_schema}
        for name, tool in TOOL_CATALOG.items() if name in enabled
    ]


def resolve_tool(name: str) -> McpTool | None:
    normalized = str(name or "").strip()
    if normalized.lower() in MCP_FORBIDDEN_NAMES or normalized not in TOOL_CATALOG:
        return None
    if normalized not in enabled_tool_names():
        return None
    return TOOL_CATALOG[normalized]


def validate_tool_arguments(tool: McpTool, arguments: Any) -> dict[str, Any]:
    """Validate the small typed boundary before accessing any argument.

    MCP clients are untrusted; malformed JSON must be rejected as a client
    error, never allowed to turn into an internal AttributeError/500.
    """
    if not isinstance(arguments, dict):
        raise ValueError("arguments debe ser un objeto JSON")
    unexpected = set(arguments) - {"project_id"}
    if unexpected:
        raise ValueError("arguments contiene campos no permitidos")
    project_id = arguments.get("project_id")
    if not isinstance(project_id, str) or not project_id.strip():
        raise ValueError("project_id es obligatorio")
    try:
        normalized_project_id = str(UUID(project_id.strip()))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("project_id debe ser UUID") from None
    return {"project_id": normalized_project_id}


def sanitize_arguments(value: Any, *, depth: int = 0) -> Any:
    """Bound and redact audit arguments; never persist a prompt or secret."""
    secret_tokens = ("token", "secret", "password", "api_key", "authorization", "cookie")
    if depth > 4:
        return "[max-depth]"
    if isinstance(value, dict):
        result = {}
        for key, item in list(value.items())[:32]:
            key_text = str(key)[:80]
            result[key_text] = "[redacted]" if any(token in key_text.lower() for token in secret_tokens) else sanitize_arguments(item, depth=depth + 1)
        return result
    if isinstance(value, list):
        return [sanitize_arguments(item, depth=depth + 1) for item in value[:32]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value if not isinstance(value, str) else value[:500]
    return str(value)[:200]


class McpRateLimiter:
    def __init__(self, limit: int = MCP_RATE_LIMIT, window_seconds: int = MCP_RATE_WINDOW_SECONDS):
        self.limit = limit
        self.window_seconds = window_seconds
        self._calls: dict[str, list[float]] = {}

    def allow(self, identity: str) -> bool:
        now = time.monotonic()
        calls = [stamp for stamp in self._calls.get(identity, []) if now - stamp < self.window_seconds]
        if len(calls) >= self.limit:
            self._calls[identity] = calls
            return False
        calls.append(now)
        self._calls[identity] = calls
        return True


rate_limiter = McpRateLimiter()

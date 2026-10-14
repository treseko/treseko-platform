"""MCP catalog authorization and bounded request stream handling."""
import math
from fastapi import Request
from .. import auth
from .mcp_governance import public_tools, SCOPE_TO_TOOLS


async def _read_bounded_body(request: Request, limit: int) -> tuple[bytes, bool]:
    """Read at most limit+1 bytes; never buffer an oversized/chunked body."""
    if not hasattr(request, "stream"):  # lightweight test doubles only
        body = await request.body()
        return body, len(body) > limit
    body = bytearray()
    async for chunk in request.stream():
        if not chunk:
            continue
        remaining = limit + 1 - len(body)
        body.extend(chunk[:remaining])
        if len(body) > limit:
            return bytes(body), True
    return bytes(body), False


def _tool_required_access_level(tool: dict) -> str:
    return "edit" if tool["operation"] in {"commit", "rollback"} else "read"


def _authorized_tools(user) -> list[dict]:
    """Expose only tools the technical identity may actually invoke.

    The environment allowlist is necessary but not sufficient: discovery must
    not disclose a tool whose declared capability the identity lacks.
    """
    return [
        tool
        for tool in public_tools(getattr(user, "mcp_scopes", None))
        if auth.has_capability_permission(user, tool["capability"], _tool_required_access_level(tool))
    ]


def _configuration_tools(user) -> list[dict]:
    """Expose RBAC-authorized tools to the configuration UI.

    The UI is selecting scopes for a new credential, so it must not be
    filtered by the scopes of an existing technical credential.
    """
    return [
        tool
        for tool in public_tools()
        if auth.has_capability_permission(user, tool["capability"], _tool_required_access_level(tool))
    ]


def _scope_catalog(user) -> list[dict]:
    """Return browser-safe scope metadata without exposing credentials."""
    enabled_tools = {tool["name"]: tool for tool in public_tools()}
    catalog = []
    for scope, tool_names in SCOPE_TO_TOOLS.items():
        tools = [enabled_tools[name] for name in sorted(tool_names) if name in enabled_tools]
        if not tools:
            continue
        required_levels = []
        for tool in tools:
            required_levels.append(_tool_required_access_level(tool))
        required = "edit" if "edit" in required_levels else "read"
        level = required if all(auth.has_capability_permission(user, tool["capability"], required) for tool in tools) else "none"
        catalog.append({
            "scope": scope,
            "user_level": level,
            "selectable": level != "none",
            "tools": [{
                "name": tool["name"],
                "capability": tool["capability"],
                "required_level": _tool_required_access_level(tool),
                "operation": tool["operation"],
            } for tool in tools],
        })
    return catalog



def _is_notification(message: dict) -> bool:
    return "id" not in message and message.get("jsonrpc") == "2.0" and isinstance(message.get("method"), str)


def _classify_request_id(message: dict):
    if "id" not in message:
        return None, True
    request_id = message["id"]
    if request_id is None:
        return None, True
    if isinstance(request_id, bool) or not isinstance(request_id, (str, int, float)):
        return None, False
    if isinstance(request_id, float) and not math.isfinite(request_id):
        return None, False
    return request_id, True

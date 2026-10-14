"""MCP web exploration tools delegated to the private Playwright Engine."""
from __future__ import annotations

import httpx

from ..repositories.repository_context import ENGINE_URL, engine_internal_headers
from .mcp_errors import mcp_web_operation_error


async def _call(operation: str, user, project, args):
    payload = {"owner_id": str(user.id), "project_id": str(project.id), **args}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=3.0)) as client:
            response = await client.post(
                f"{ENGINE_URL.rstrip('/')}/internal/mcp/browser/{operation}",
                json=payload,
                headers=engine_internal_headers(),
            )
    except httpx.HTTPError as exc:
        raise RuntimeError("El navegador MCP no está disponible") from exc
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError("El navegador MCP devolvió una respuesta no válida") from exc
    if response.status_code >= 400:
        classified = mcp_web_operation_error(response.status_code)
        if classified:
            raise classified
        raise RuntimeError("MCP browser operation failed")
    return data


async def open_web_session(db, user, project, args):
    del db
    return await _call("open", user, project, {"url": args["url"]})


async def inspect_web_session(db, user, project, args):
    del db
    return await _call("inspect", user, project, {"browser_id": args["browser_id"]})


async def act_web_session(db, user, project, args):
    del db
    return await _call("act", user, project, args)


async def close_web_session(db, user, project, args):
    del db
    return await _call("close", user, project, {"browser_id": args["browser_id"]})


HANDLERS = {
    "web.open": open_web_session,
    "web.inspect": inspect_web_session,
    "web.act": act_web_session,
    "web.close": close_web_session,
}

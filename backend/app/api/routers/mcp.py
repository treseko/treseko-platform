from __future__ import annotations

import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from ... import access_control, auth, crud, models
from ...services.audit_context import audit_request_context
from ...services.mcp_governance import (
    MCP_MAX_REQUEST_BYTES, MCP_MAX_RESPONSE_BYTES,
    mcp_enabled, public_tools, rate_limiter, resolve_tool, sanitize_arguments,
    validate_tool_arguments,
)
from ...main_context import AsyncSessionLocal


router = APIRouter(prefix="/mcp", tags=["MCP governed"])


def _error(code: str, message: str, correlation_id: str, *, retryable: bool = False):
    return {"error": {"error_code": code, "message": message, "correlation_id": correlation_id, "retryable": retryable, "details": {}}}


def _authorized_tools(user) -> list[dict]:
    """Expose only tools the technical identity may actually invoke.

    The environment allowlist is necessary but not sufficient: discovery must
    not disclose a tool whose declared capability the identity lacks.
    """
    return [
        tool
        for tool in public_tools()
        if auth.has_capability_permission(user, tool["capability"], "read")
    ]


async def _technical_user(request: Request):
    """MCP never accepts a browser JWT: only a separately presented API key."""
    if not mcp_enabled():
        raise HTTPException(status_code=404, detail="MCP no está habilitado")
    raw_key = request.headers.get("x-mcp-api-key", "").strip()
    if not raw_key or len(raw_key) > 128:
        raise HTTPException(status_code=401, detail="Credencial MCP inválida")
    async with AsyncSessionLocal() as db:
        user = await crud.get_user_by_api_key(db, raw_key)
    if not user:
        raise HTTPException(status_code=401, detail="Credencial MCP inválida")
    return user


async def _require_mcp_project_scope(db, user, project_uuid: UUID):
    """Enforce both RBAC edges of the MCP tenant boundary."""
    project = await access_control.require_project_access(db, user, project_uuid, "read")
    await access_control.require_organization_access(db, user, project.organizacion_id, "read")
    return project


@router.get("/tools")
async def discover_tools(request: Request):
    correlation_id = getattr(request.state, "correlation_id", "")
    if not mcp_enabled():
        raise HTTPException(status_code=404, detail="MCP no está habilitado")
    user = await _technical_user(request)
    return {"protocol_version": "2025-03-26", "tools": _authorized_tools(user), "correlation_id": correlation_id}


@router.post("")
async def mcp_json_rpc(request: Request):
    correlation_id = getattr(request.state, "correlation_id", "")
    if not mcp_enabled():
        raise HTTPException(status_code=404, detail="MCP no está habilitado")
    user = await _technical_user(request)
    body = await request.body()
    if len(body) > MCP_MAX_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail="Solicitud MCP demasiado grande")
    try:
        message = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="JSON MCP inválido")
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        raise HTTPException(status_code=400, detail="Solicitud JSON-RPC MCP inválida")
    method = message.get("method")
    request_id = message.get("id")
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"protocolVersion": "2025-03-26", "serverInfo": {"name": "treseko-mcp", "version": "1.0.2"}, "capabilities": {"tools": {}}}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": _authorized_tools(user)}}
    if method != "tools/call":
        raise HTTPException(status_code=404, detail="Método MCP no permitido")
    params = message.get("params") or {}
    if not isinstance(params, dict):
        raise HTTPException(status_code=422, detail="params MCP debe ser un objeto JSON")
    tool_name = params.get("name")
    tool = resolve_tool(tool_name)
    if not tool:
        raise HTTPException(status_code=404, detail="Herramienta MCP no autorizada")
    if not auth.has_capability_permission(user, tool.capability, "read"):
        raise HTTPException(status_code=403, detail="El usuario no tiene la capability requerida por la herramienta MCP")
    identity = str(user.id)
    if not rate_limiter.allow(identity):
        raise HTTPException(status_code=429, detail="Límite de solicitudes MCP excedido")
    try:
        arguments = validate_tool_arguments(tool, params.get("arguments") or {})
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    project_id = arguments.get("project_id")
    try:
        project_uuid = UUID(str(project_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="project_id debe ser UUID")
    async with AsyncSessionLocal() as db:
        project = await _require_mcp_project_scope(db, user, project_uuid)
        if tool.name == "treseko.project.get":
            result = {"id": str(project.id), "name": project.nombre, "organization_id": str(project.organizacion_id)}
        else:
            builds = (await db.execute(select(models.Build).filter(models.Build.proyecto_id == project_uuid).order_by(models.Build.nombre))).scalars().all()
            result = {"project_id": str(project_uuid), "items": [{"id": str(build.id), "name": build.nombre, "estado": build.estado, "activo": build.activo} for build in builds]}
        encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
        if len(encoded) > MCP_MAX_RESPONSE_BYTES:
            raise HTTPException(status_code=413, detail="Respuesta MCP demasiado grande")
        context = audit_request_context(request)
        await crud.create_audit_log(db, usuario_id=user.id, accion="MCP_TOOL_CALL", recurso=tool.name,
                                    detalles={"tool": tool.name, "version": tool.version, "arguments": sanitize_arguments(arguments), "result": "success", "correlation_id": correlation_id},
                                    ip_address=context["ip_address"], origen=context["origen"], correlation_id=correlation_id)
    return {"jsonrpc": "2.0", "id": request_id, "result": {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}}

from __future__ import annotations

import json
import logging
import os
import re
import secrets
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import access_control, auth, crud, models
from ...main_context import AsyncSessionLocal, get_db
from ...services.audit_context import audit_request_context
from ...services.mcp_governance import (
    MCP_MAX_REQUEST_BYTES,
    MCP_MAX_PREVIEW_REQUEST_BYTES,
    MCP_MAX_RESPONSE_BYTES,
    McpResultTooLarge,
    bound_tool_result,
    mcp_enabled,
    public_tools,
    rate_limiter,
    resolve_tool,
    request_limit_for_tool,
    sanitize_arguments,
    tool_allowed_by_scopes,
    validate_tool_arguments,
    SCOPE_TO_TOOLS,
    MCP_ENABLED_SETTING_KEY,
    HANDLERS,
    set_configured_mcp_enabled,
)
from ...services.mcp_errors import domain_rejection, invalid_tool_arguments
from ...services.mcp_validation import InvalidToolArguments
from ...services.mcp_guidance import INSTRUCTIONS
from ...services.mcp_discovery import _tool_required_access_level, _authorized_tools, _configuration_tools, _scope_catalog, _read_bounded_body, _is_notification, _classify_request_id
from ...services.mcp_unit_of_work import mutation_session
from ...services.mcp_idempotency import fingerprint as idempotency_fingerprint
from ...services.mcp_idempotency import reserve as reserve_idempotency, reserve_workspace
from ...version import PRODUCT_VERSION
from ...services.ai_credential_crypto import decrypt_ai_credential
from ...services.error_contract import current_correlation_id

router = APIRouter(prefix="/mcp", tags=["MCP governed"])
logger = logging.getLogger(__name__)


async def _ensure_persisted_mcp_activation() -> None:
    """Refresh persisted activation before each operational MCP request."""
    try:
        async with AsyncSessionLocal() as db:
            setting = await db.get(models.AppSetting, MCP_ENABLED_SETTING_KEY)
            raw_enabled = (setting.value or {}).get("enabled", False) if setting else False
            enabled = raw_enabled if isinstance(raw_enabled, bool) else False
            set_configured_mcp_enabled(enabled)
    except Exception:  # noqa: BLE001 - admission fails closed
        set_configured_mcp_enabled(False)


def _engine_internal_token() -> str:
    token = (os.getenv("AI_ENGINE_INTERNAL_TOKEN") or "").strip()
    token_file = (os.getenv("AI_ENGINE_INTERNAL_TOKEN_FILE") or "").strip()
    if not token and token_file:
        try:
            from pathlib import Path
            token = Path(token_file).read_text(encoding="utf-8").strip()
        except OSError:
            token = ""
    return token


@router.post("/internal/runtime-credential")
async def resolve_engine_runtime_credential(
    payload: dict,
    x_engine_internal_token: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Resolve an opaque vault reference for the private Engine boundary.

    The secret is returned only to an authenticated Engine request. It is not
    accepted in workflow JSON, persisted snapshots, traces, or client routes.
    """
    await _ensure_persisted_mcp_activation()
    if not mcp_enabled():
        raise HTTPException(status_code=404, detail="MCP no está habilitado")
    expected = _engine_internal_token()
    if not expected or not x_engine_internal_token or not secrets.compare_digest(x_engine_internal_token, expected):
        raise HTTPException(status_code=401, detail="Token interno inválido")
    reference = str((payload or {}).get("reference") or "").strip()
    if not re.fullmatch(r"vault:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", reference):
        raise HTTPException(status_code=400, detail="Referencia de credencial inválida")
    raw_id = reference.removeprefix("vault:")
    try:
        credential_id = UUID(raw_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Referencia de credencial inválida") from exc
    credential = await db.get(models.AiProviderCredential, credential_id)
    if not credential or not bool(getattr(credential, "active", False)) or str(getattr(credential, "provider", "")) != "mcp":
        raise HTTPException(status_code=404, detail="Credencial MCP no disponible")
    try:
        secret = decrypt_ai_credential(str(getattr(credential, "secret_value_encrypted", "")), str(getattr(credential, "key_id", "")))
    except (RuntimeError, ValueError):
        raise HTTPException(status_code=503, detail="Credencial MCP no disponible")
    return {"secret": secret, "correlation_id": current_correlation_id()}


def _rpc_error(request_id, code: int, message: str):
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _rpc_response(request_id, notification: bool, payload: dict):
    if notification:
        return Response(status_code=202)
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) <= MCP_MAX_RESPONSE_BYTES:
        return payload
    fallback = _rpc_error(None, -32603, "Internal error")
    if len(json.dumps(fallback, separators=(",", ":")).encode("utf-8")) <= MCP_MAX_RESPONSE_BYTES:
        return fallback
    return Response(status_code=202)


def _rpc_internal_error(request_id, notification: bool):
    return _rpc_response(request_id, notification, _rpc_error(request_id, -32603, "Internal error"))


@router.get("/configuration")
async def get_mcp_configuration(
    request: Request,
    current_user: models.Usuario = Depends(auth.check_capability("mcp.usar", "read")),  # noqa: B008
    db: AsyncSession = Depends(get_db),
):
    """Return browser-safe MCP metadata; MCP clients still use the API key path."""
    setting = await db.get(models.AppSetting, MCP_ENABLED_SETTING_KEY)
    raw_enabled = (setting.value or {}).get("enabled", False) if setting else False
    enabled = raw_enabled if isinstance(raw_enabled, bool) else False
    set_configured_mcp_enabled(enabled)
    tools = public_tools()
    scope_catalog = _scope_catalog(current_user)
    return {
        "enabled": enabled,
        "status": "available" if mcp_enabled() else "disabled",
        "endpoint": "/api/mcp",
        "protocol_version": "2025-03-26",
        "authentication": {"header": "X-MCP-API-Key", "browser_session": True},
        "tools": tools,
        "scope_catalog": scope_catalog,
        "effective_capabilities": {
            capability: auth.get_capability_permission(current_user, capability)
            for capability in {tool["capability"] for tool in _configuration_tools(current_user)}
        },
        "correlation_id": getattr(request.state, "correlation_id", ""),
    }


@router.put("/configuration")
async def update_mcp_configuration(
    payload: dict,
    current_user: models.Usuario = Depends(auth.check_capability("mcp.usar", "edit")),  # noqa: B008
    db: AsyncSession = Depends(get_db),
):
    """Persist MCP activation; deployment flags do not grant activation."""
    if not isinstance(payload, dict) or not isinstance(payload.get("enabled"), bool):
        raise HTTPException(status_code=400, detail="enabled debe ser booleano")
    enabled = bool(payload["enabled"])
    setting = await db.get(models.AppSetting, MCP_ENABLED_SETTING_KEY)
    if setting is None:
        db.add(models.AppSetting(key=MCP_ENABLED_SETTING_KEY, value={"enabled": enabled}))
    else:
        setting.value = {"enabled": enabled}
    await db.commit()
    set_configured_mcp_enabled(enabled)
    return {"enabled": enabled, "status": "available" if mcp_enabled() else "disabled"}


async def _audit_mcp_event(request, user, *, tool=None, status: str, reason: str, arguments=None):
    """Audit MCP activity without key, prompt, or result.

    Preview is deliberately side-effect free, including its audit path. Its
    sanitized event is emitted to the application audit logger instead of the
    database; operators can route this non-persistent stream to their audit
    collector without making preview part of the domain transaction.
    """
    details = {
        "tool": getattr(tool, "name", None),
        "version": getattr(tool, "version", None),
        "key_prefix": getattr(user, "mcp_key_prefix", None),
        "status": status, "reason": str(reason)[:200],
        "arguments": sanitize_arguments(arguments or {}),
        "correlation_id": getattr(request.state, "correlation_id", ""),
    }
    if getattr(tool, "operation", None) == "preview":
        logger.info("mcp_preview_audit %s", details)
        return
    try:
        async with AsyncSessionLocal() as db:
            context = audit_request_context(request)
            await crud.create_audit_log(
                db, usuario_id=getattr(user, "id", None), accion="MCP_REQUEST",
                recurso=getattr(tool, "name", "mcp"),
                detalles=details, ip_address=context["ip_address"], origen=context["origen"],
                correlation_id=getattr(request.state, "correlation_id", ""),
            )
    except Exception:  # noqa: BLE001, S110 - audit must not alter request flow
        pass


async def _authenticate_with_safe_failure(request: Request, unexpected_response):
    """Authenticate without leaking unexpected errors; preserve known HTTP errors."""
    try:
        return await _technical_user(request), None
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - authentication details must not escape
        await _audit_mcp_event(request, None, status="error", reason="authentication_failure")
        return None, unexpected_response


async def _authenticate_for_rpc(request: Request, request_id, notification: bool):
    """Authenticate for JSON-RPC while auditing unexpected failures safely."""
    return await _authenticate_with_safe_failure(request, _rpc_internal_error(request_id, notification))


async def _technical_user(request: Request):
    """MCP never accepts a browser JWT: only a separately presented API key."""
    await _ensure_persisted_mcp_activation()
    if not mcp_enabled():
        raise HTTPException(status_code=404, detail="MCP no está habilitado")
    raw_key = request.headers.get("x-mcp-api-key", "").strip()
    if not raw_key or len(raw_key) > 128:
        await _audit_mcp_event(request, None, status="rejected", reason="invalid_credential")
        raise HTTPException(status_code=401, detail="Credencial MCP inválida")
    async with AsyncSessionLocal() as db:
        user = await crud.get_user_by_mcp_api_key(db, raw_key)
    if not user:
        await _audit_mcp_event(request, None, status="rejected", reason="invalid_credential")
        raise HTTPException(status_code=401, detail="Credencial MCP inválida")
    if auth.get_capability_permission(user, "mcp.usar") not in {"read", "edit"}:
        await _audit_mcp_event(request, user, status="rejected", reason="mcp_permission_denied")
        raise HTTPException(status_code=403, detail="El usuario no tiene permiso para usar MCP")
    return user


async def _require_mcp_project_scope(db, user, project_uuid: UUID, access_level: str = "read"):
    """Enforce both RBAC edges of the MCP tenant boundary."""
    project = await access_control.require_project_access(db, user, project_uuid, access_level)
    await access_control.require_organization_access(db, user, project.organizacion_id, access_level)
    return project


@router.get("/tools")
async def discover_tools(request: Request):
    await _ensure_persisted_mcp_activation()
    origin = getattr(request, "headers", {}).get("origin")
    if origin:
        allowed_origins = {value.strip() for value in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if value.strip()}
        if origin not in allowed_origins:
            raise HTTPException(status_code=403, detail="Origin MCP no permitido")
    correlation_id = getattr(request.state, "correlation_id", "")
    if not mcp_enabled():
        raise HTTPException(status_code=404, detail="MCP no está habilitado")
    user, auth_error = await _authenticate_with_safe_failure(
        request, HTTPException(status_code=500, detail="Internal server error")
    )
    if auth_error is not None:
        raise auth_error
    tools = _authorized_tools(user)
    await _audit_mcp_event(request, user, status="success", reason="tools_discovery")
    return {"protocol_version": "2025-03-26", "tools": tools, "correlation_id": correlation_id}


@router.post("")
async def mcp_json_rpc(request: Request):
    await _ensure_persisted_mcp_activation()
    origin = getattr(request, "headers", {}).get("origin")
    if origin:
        allowed_origins = {value.strip() for value in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if value.strip()}
        if origin not in allowed_origins:
            raise HTTPException(status_code=403, detail="Origin MCP no permitido")
    correlation_id = getattr(request.state, "correlation_id", "")
    if not mcp_enabled():
        raise HTTPException(status_code=404, detail="MCP no está habilitado")

    body, body_too_large = await _read_bounded_body(request, MCP_MAX_PREVIEW_REQUEST_BYTES)
    request_id = None
    notification = False
    authenticated_user = None
    user = None
    try:
        message = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        message = None
    if isinstance(message, dict):
        request_id, valid_id = _classify_request_id(message)
        notification = _is_notification(message)
    else:
        valid_id = True
    tool = None
    if not body_too_large and isinstance(message, dict):
        tool_name = ((message.get("params") or {}).get("name")
                     if message.get("method") == "tools/call" and isinstance(message.get("params"), dict)
                     else None)
        tool = resolve_tool(tool_name) if tool_name else None
        request_limit = request_limit_for_tool(tool) if tool else MCP_MAX_REQUEST_BYTES
        body_too_large = len(body) > request_limit
    if body_too_large:
        # Authenticate before auditing this rejection; do not include body data.
        authenticated_user, auth_error = await _authenticate_for_rpc(request, request_id, notification)
        if auth_error is not None:
            return auth_error
        await _audit_mcp_event(request, authenticated_user, tool=tool, status="rejected", reason="request_too_large")
        return _rpc_response(request_id, notification, _rpc_error(request_id, -32603, "Internal error"))
    if message is None:
        authenticated_user, auth_error = await _authenticate_for_rpc(request, None, False)
        if auth_error is not None:
            return auth_error
        await _audit_mcp_event(request, authenticated_user, status="rejected", reason="parse_error")
        return _rpc_response(None, False, _rpc_error(None, -32700, "Parse error"))

    if not isinstance(message, dict):
        authenticated_user, auth_error = await _authenticate_for_rpc(request, None, False)
        if auth_error is not None:
            return auth_error
        await _audit_mcp_event(request, authenticated_user, status="rejected", reason="invalid_request")
        return _rpc_response(None, False, _rpc_error(None, -32600, "Invalid Request"))
    if not valid_id:
        user, auth_error = await _authenticate_for_rpc(request, None, False)
        if auth_error is not None:
            return auth_error
        await _audit_mcp_event(request, user, status="rejected", reason="invalid_request")
        return _rpc_response(None, False, _rpc_error(None, -32600, "Invalid Request"))
    if message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
        user, auth_error = await _authenticate_for_rpc(request, request_id, notification)
        if auth_error is not None:
            return auth_error
        await _audit_mcp_event(request, user, status="rejected", reason="invalid_request")
        return _rpc_response(request_id, notification, _rpc_error(request_id, -32600, "Invalid Request"))

    if authenticated_user is None:
        user, auth_error = await _authenticate_for_rpc(request, request_id, notification)
        if auth_error is not None:
            return auth_error
    else:
        user = authenticated_user
    assert user is not None
    method = message["method"]
    if method in {"initialize", "tools/list", "resources/list", "resources/read", "ping"} and not rate_limiter.allow(str(user.id)):
        await _audit_mcp_event(request, user, status="rate_limited", reason="rate_limit")
        return _rpc_response(request_id, notification, _rpc_error(request_id, -32603, "Rate limit exceeded; retry after the current 60-second window."))
    try:
        if method == "initialize":
            result = {"protocolVersion": "2025-03-26", "serverInfo": {"name": "treseko-mcp", "version": PRODUCT_VERSION}, "capabilities": {"tools": {}, "resources": {}}, "instructions": INSTRUCTIONS}
        elif method == "resources/list":
            from ...services.mcp_guidance import GUIDE_URI
            result = {"resources": [{"uri": GUIDE_URI, "name": "Treseko MCP guidance", "description": "Authorized catalog, workflows, limits and retry rules", "mimeType": "application/json"}]}
        elif method == "resources/read":
            from ...services.mcp_guidance import GUIDE_URI, guide
            if not isinstance(message.get("params"), dict) or message["params"].get("uri") != GUIDE_URI:
                return _rpc_response(request_id, notification, _rpc_error(request_id, -32602, "Unknown resource"))
            result = {"contents": [{"uri": GUIDE_URI, "mimeType": "application/json", "text": json.dumps(guide(_authorized_tools(user)), ensure_ascii=False)}]}
        elif method == "ping":
            result = {}
        elif method == "notifications/initialized" and notification:
            return Response(status_code=202)
        elif method == "tools/list":
            result = {"tools": _authorized_tools(user)}
            await _audit_mcp_event(request, user, status="success", reason="tools_list")
        elif method == "tools/call":
            params = message.get("params")
            if not isinstance(params, dict):
                await _audit_mcp_event(request, user, status="rejected", reason="invalid_params")
                response = _rpc_error(request_id, -32602, "Invalid params")
                return _rpc_response(request_id, notification, response)
            tool = resolve_tool(params.get("name"))
            if not tool:
                await _audit_mcp_event(request, user, status="rejected", reason="unknown_or_disabled_tool", arguments=params)
                response = _rpc_error(request_id, -32602, "Invalid params")
                return _rpc_response(request_id, notification, response)
            if not tool_allowed_by_scopes(tool.name, getattr(user, "mcp_scopes", None)):
                await _audit_mcp_event(request, user, tool=tool, status="rejected", reason="insufficient_scope", arguments=params.get("arguments"))
                response = _rpc_error(request_id, -32603, "Internal error")
                return _rpc_response(request_id, notification, response)
            if notification and tool.operation in {"commit", "rollback"}:
                await _audit_mcp_event(request, user, tool=tool, status="rejected", reason="mutation_requires_request_id")
                return Response(status_code=202)
            required_level = _tool_required_access_level({"operation": tool.operation})
            if not auth.has_capability_permission(user, tool.capability, required_level):
                await _audit_mcp_event(request, user, tool=tool, status="rejected", reason="insufficient_rbac", arguments=params.get("arguments"))
                response = _rpc_error(request_id, -32603, "Internal error")
                return _rpc_response(request_id, notification, response)
            if not rate_limiter.allow(str(user.id)):
                await _audit_mcp_event(request, user, tool=tool, status="rate_limited", reason="rate_limit")
                response = _rpc_error(request_id, -32603, "Rate limit exceeded; retry after the current 60-second window.")
                return _rpc_response(request_id, notification, response)
            try:
                arguments = validate_tool_arguments(tool, params.get("arguments"))
            except InvalidToolArguments as exc:
                await _audit_mcp_event(request, user, tool=tool, status="rejected", reason="invalid_arguments", arguments=params.get("arguments"))
                response = invalid_tool_arguments(request_id, exc)
                return _rpc_response(request_id, notification, response)
            except ValueError:
                await _audit_mcp_event(request, user, tool=tool, status="rejected", reason="invalid_arguments", arguments=params.get("arguments"))
                response = _rpc_error(request_id, -32602, "Invalid params")
                return _rpc_response(request_id, notification, response)
            bounded_response = None
            try:
                project_uuid = UUID(arguments["project_id"]) if "project_id" in arguments else None
                session_context = AsyncSessionLocal() if tool.read_only or tool.operation == "preview" else mutation_session(AsyncSessionLocal)
                async with session_context as db:
                    from ...services.mcp_workspace import context as workspace_context
                    from ...services.mcp_workspace_contracts import SPECS
                    if tool.handler_key in SPECS:
                        project = await workspace_context(db, user, tool, arguments)
                    elif tool.read_only or tool.operation == "preview":
                        project = await _require_mcp_project_scope(db, user, project_uuid)
                    else:
                        project = await _require_mcp_project_scope(db, user, project_uuid, "edit")
                    handler = HANDLERS.get(tool.handler_key)
                    if not callable(handler):
                        raise RuntimeError("handler unavailable")  # noqa: TRY004
                    if tool.handler_key == "cases.get":
                        target_case = await db.scalar(select(models.CasoPrueba).filter(
                            models.CasoPrueba.id == UUID(arguments["case_id"]),
                            models.CasoPrueba.proyecto_id == project.id,
                        ))
                        if target_case is None:
                            raise LookupError("case not found")
                    if tool.handler_key == "test-runs.get":
                        target_run = await db.scalar(select(models.TestRun).filter(models.TestRun.id == UUID(arguments["run_id"]), models.TestRun.proyecto_id == project.id))
                        if target_run is None:
                            raise LookupError("run not found")
                    if tool.handler_key == "test-results.get":
                        target_execution = await db.scalar(select(models.EjecucionCaso).join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id).filter(models.EjecucionCaso.id == UUID(arguments["execution_id"]), models.TestRun.proyecto_id == project.id))
                        if target_execution is None:
                            raise LookupError("result not found")
                    if tool.handler_key == "test-results.list":
                        target_run = await db.scalar(select(models.TestRun).filter(models.TestRun.id == UUID(arguments["run_id"]), models.TestRun.proyecto_id == project.id))
                        if target_run is None:
                            raise LookupError("run not found")
                    if tool.handler_key in {"bugs.list", "quality.summary"} and arguments.get("build_id"):
                        target_build = await db.scalar(select(models.Build).filter(models.Build.id == UUID(arguments["build_id"]), models.Build.proyecto_id == project.id))
                        if target_build is None:
                            raise LookupError("build not found")
                    if tool.handler_key == "bugs.get":
                        target_bug = await db.scalar(select(models.BugIssue).filter(models.BugIssue.id == UUID(arguments["bug_id"]), models.BugIssue.proyecto_id == project.id))
                        if target_bug is None:
                            raise LookupError("bug not found")
                    reservation = None
                    cached_result = None
                    # Import commit/rollback already reserve their durable key
                    # inside the domain transaction; all other keyed mutations
                    # are wrapped here before invoking the handler.
                    if (not tool.read_only and arguments.get("idempotency_key")
                            and tool.handler_key not in {"cases.import.commit", "cases.import.rollback"}):
                        key = str(arguments["idempotency_key"]).strip()
                        fingerprint = idempotency_fingerprint(tool.name, project.id, arguments, user.id)
                        if tool.handler_key in SPECS:
                            namespace = ("organization:" if tool.handler_key == "projects.create" else "project:") + str(project.id)
                            reservation, cached_result = await reserve_workspace(db, namespace, key, fingerprint)
                        else:
                            reservation, cached_result = await reserve_idempotency(db, project.id, key, fingerprint)
                    if cached_result is not None:
                        bounded_result = cached_result
                        result = cached_result
                    else:
                        result = await handler(db, user, project, arguments) if (
                        tool.handler_key in SPECS or tool.operation in {"preview", "commit", "rollback"} or tool.handler_key.startswith(("cases.", "components.", "suites.", "test-runs.", "test-results.", "bugs.", "quality.", "evidence.", "environments.", "datasets.", "builds.", "web."))
                        ) else await handler(db, user, project)
                        bounded_result = bound_tool_result(tool, result)
                        if reservation is not None:
                            reservation.status = "COMPLETED"
                            reservation.result_json = dict(bounded_result)
                            await db.commit()
                    response = {"jsonrpc": "2.0", "id": request_id, "result": {"content": [{"type": "text", "text": json.dumps(bounded_result, ensure_ascii=False, separators=(",", ":"))}]}}
                    bounded_response = _rpc_response(request_id, notification, response)
                    if not notification and bounded_response != response:
                        raise McpResultTooLarge("response exceeds transport limit")
                    else:
                        if tool.operation == "preview":
                            await _audit_mcp_event(request, user, tool=tool, status="success", reason="preview_complete", arguments=arguments)
                        else:
                            context = audit_request_context(request)
                            await crud.create_audit_log(db, usuario_id=user.id, accion="MCP_TOOL_CALL", recurso=tool.name, detalles={"tool": tool.name, "version": tool.version, "key_prefix": getattr(user, "mcp_key_prefix", None), "arguments": sanitize_arguments(arguments), "status": "success", "correlation_id": correlation_id}, ip_address=context["ip_address"], origen=context["origen"], correlation_id=correlation_id)
            except (McpResultTooLarge, ValueError, TypeError, LookupError) as exc:
                bounded_response = None
                await _audit_mcp_event(request, user, tool=tool, status="rejected", reason="invalid_arguments")
                response = domain_rejection(request_id, exc)
            except Exception:  # noqa: BLE001 - never expose handler/database details
                bounded_response = None
                await _audit_mcp_event(request, user, tool=tool, status="error", reason="internal_error")
                response = _rpc_error(request_id, -32603, "Internal error")
            return bounded_response if bounded_response is not None else _rpc_response(request_id, notification, response)
        else:
            await _audit_mcp_event(request, user, status="rejected", reason="unsupported_method")
            response = _rpc_error(request_id, -32601, "Method not found")
            return _rpc_response(request_id, notification, response)
        response = {"jsonrpc": "2.0", "id": request_id, "result": result}
        return _rpc_response(request_id, notification, response)
    except Exception:  # noqa: BLE001 - protocol boundary must not leak internals
        await _audit_mcp_event(request, user, status="error", reason="internal_error")
        return _rpc_internal_error(request_id, notification)

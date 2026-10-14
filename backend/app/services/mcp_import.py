"""Governed, non-persistent MCP case-import preview."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import time
import asyncio
import json
import re
import secrets
from typing import Any
from uuid import UUID

from sqlalchemy import select
from .. import access_control, models
from . import case_portability
from .mcp_idempotency import reserve as _reserve_durable

MAX_PACKAGE_BYTES = 8 * 1024 * 1024
MAX_PREVIEW_ITEMS = 500
COMMIT_TIMEOUT_SECONDS = 30
MAX_AUTOMATION_SCRIPT_BYTES = 512 * 1024
ALLOWED_AUTOMATION_FRAMEWORKS = {"playwright", "selenium", "cypress", "puppeteer"}
_FORBIDDEN_CONFIG_FIELD = re.compile(
    r"(?:credential|password|passwd|secret|token|api[_-]?key|authorization|script|parallel)", re.I
)
_SCRIPT_SECRET = re.compile(
    # Names and selectors are legitimate; reject nonempty credential literals.
    # This is an import guard, not a complete analysis of executable JavaScript.
    r"(?:[\w$]*(?:password|passwd|secret|token|credential|authorization|api[_-]?key)[\w$]*"
    r"[\"']?\s*[:=]\s*[\"'][^\"']+[\"']|"
    r"[\"']Bearer\s+[^\"']+[\"']|"
    r"(?:locator|getByLabel|getByPlaceholder)\([^\n;]*?(?:password|passwd)"
    r"[^\n;]*?\)\s*\.fill\(\s*[\"'][^\"']+[\"']|"
    r"\.fill\(\s*[\"'][^\"']*(?:password|passwd)[^\"']*[\"']\s*,"
    r"\s*[\"'][^\"']+[\"'])", re.I
)
_SCRIPT_SHELL = re.compile(
    r"(?:\brm\s+-[A-Za-z]*r[A-Za-z]*f\b|\b(?:curl|wget|nc|netcat)\b|"
    r"\b(?:sh|bash|zsh|fish|powershell|cmd)\s+-c\b|\b(?:child_process|exec|spawn)\s*\(|"
    r"\$\(|`[^`]*`)", re.I
)


def _uuid(value: Any, name: str) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value).strip())
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError(f"{name} debe ser UUID") from exc


def _decode_package(value: Any) -> bytes:
    if not isinstance(value, str) or not value:
        raise ValueError("content_base64 es obligatorio")
    try:
        data = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("content_base64 no es válido") from exc
    if not data or len(data) > MAX_PACKAGE_BYTES:
        raise ValueError("paquete fuera de límites")
    return data


def package_sha256(content_base64: str) -> str:
    return hashlib.sha256(_decode_package(content_base64)).hexdigest()


def _token_key() -> bytes:
    secret = (os.getenv("TRESEKO_MCP_IMPORT_PREVIEW_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("MCP preview signing secret is not configured")
    return secret.encode()


def import_fingerprint(project_id, arguments: dict[str, Any], package_hash: str, actor_id=None) -> str:
    """Fingerprint every input that can alter the import mutation."""
    payload = {
        "project_id": str(project_id),
        "profile_id": arguments.get("profile_id"),
        "content_sha256": package_hash,
        "file_name": arguments.get("file_name"),
        "component_id": arguments.get("component_id"),
        "build_id": arguments.get("build_id"),
        "selected_external_ids": arguments.get("selected_external_ids"),
        "confirmation": arguments.get("confirmation"),
        "package_sha256": arguments.get("package_sha256"),
        "actor_id": str(actor_id) if actor_id is not None else None,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def make_preview_token(project_id, arguments: dict[str, Any]) -> str:
    """Bind preview approval to the exact package and target edges."""
    digest = package_sha256(arguments["content_base64"])
    binding = "|".join((str(project_id), str(arguments.get("profile_id", "")), digest,
                        str(arguments.get("component_id") or ""), str(arguments.get("build_id") or "")))
    issued = str(int(time.time()))
    signature = hmac.new(_token_key(), f"{issued}|{binding}".encode(), hashlib.sha256).hexdigest()
    return f"{issued}.{signature}"


def _valid_preview_token(project_id, arguments: dict[str, Any], token: str) -> bool:
    try:
        issued_text, signature = str(token).split(".", 1)
        issued = int(issued_text)
    except (ValueError, TypeError):
        return False
    if issued > int(time.time()) or int(time.time()) - issued > 600:
        return False
    digest = package_sha256(arguments["content_base64"])
    binding = "|".join((str(project_id), str(arguments.get("profile_id", "")), digest, str(arguments.get("component_id") or ""), str(arguments.get("build_id") or "")))
    expected_signature = hmac.new(_token_key(), f"{issued}|{binding}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected_signature)


def make_rollback_token(project_id, batch_id, commit_receipt: str) -> str:
    return hmac.new(_token_key(), f"{project_id}|{batch_id}|{commit_receipt}".encode(), hashlib.sha256).hexdigest()


def valid_rollback_token(project_id, batch_id, commit_receipt: str, token: str) -> bool:
    return hmac.compare_digest(make_rollback_token(project_id, batch_id, commit_receipt), str(token or ""))


def _validate_ai_package(package: dict[str, Any]) -> None:
    """Reject capabilities that an AI-originated MCP import cannot grant."""

    def walk(value: Any, path: str = "", api_key_context: bool = False) -> None:
        if isinstance(value, dict):
            current_api_key = api_key_context or str(value.get("type") or "").lower() == "api_key"
            for key, child in value.items():
                name = str(key)
                if current_api_key and name.lower() in {"value", "header", "query"} and str(child or "").strip():
                    raise ValueError("MCP importación bloqueada: credencial API key no permitida")
                if _FORBIDDEN_CONFIG_FIELD.search(name):
                    if name.lower() == "parallelism" and child == 1:
                        continue
                    raise ValueError(f"MCP importación IA bloqueada: campo no permitido ({name})")
                if name.lower() == "url" and isinstance(child, str) and re.match(r"^[a-z][a-z0-9+.-]*://", child, re.I):
                    raise ValueError("MCP importación IA bloqueada: URL absoluta no permitida")
                walk(child, f"{path}.{name}", current_api_key)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{path}[{index}]", api_key_context)

    for item in package.get("cases", []):
        if isinstance(item, dict):
            if item.get("formato_prueba") == "CONVERSACIONAL":
                raise ValueError("MCP importación: formato CONVERSACIONAL fuera de alcance")
            if item.get("formato_prueba") == "PERFORMANCE":
                raise ValueError("MCP importación: formato PERFORMANCE fuera de alcance; no existe executor seguro")
            script = item.get("script_automatizado")
            if script is not None:
                if not isinstance(script, str):
                    raise ValueError("MCP importación IA bloqueada: script_automatizado debe ser texto")
                if len(script.encode("utf-8")) > MAX_AUTOMATION_SCRIPT_BYTES:
                    raise ValueError("MCP importación IA bloqueada: script_automatizado supera 512 KB")
                if _SCRIPT_SECRET.search(script):
                    raise ValueError("MCP importación IA bloqueada: el script contiene credenciales o secretos")
                if _SCRIPT_SHELL.search(script):
                    raise ValueError("MCP importación IA bloqueada: contenido shell no permitido en el script")
            framework = item.get("framework")
            if framework is not None:
                if not isinstance(framework, str):
                    raise ValueError("MCP importación IA bloqueada: framework debe ser texto")
                framework_name = framework.strip().lower().split(":", 1)[0].split("@", 1)[0]
                if framework_name not in ALLOWED_AUTOMATION_FRAMEWORKS:
                    raise ValueError(f"MCP importación IA bloqueada: framework no permitido ({framework})")
            guarded = {"configuracion_api": item.get("configuracion_api")}
            walk(guarded)


def _redact_case_config(value: Any, *, api_key_context: bool = False) -> Any:
    from .mcp_redaction import redact
    return redact(value)


def _validate_ai_package_data(profile_id: str, data: bytes) -> None:
    try:
        _validate_ai_package(case_portability.parse_import(profile_id, data))
    except case_portability.PortabilityError:
        # Compatibility adapters may delegate malformed payload handling to the
        # domain parser; valid packages still receive MCP-specific validation.
        return


def _safe_case_item(item: dict[str, Any]) -> dict[str, Any]:
    """Expose governed definition metadata without secrets or executable text."""
    safe: dict[str, Any] = {"external_id": str(item.get("external_id", "")),
                              "outcome": str(item.get("outcome", ""))}
    if "formato_prueba" not in item and "tipo_prueba" not in item:
        return safe
    safe.update({"tipo_prueba": str(item.get("tipo_prueba", "MANUAL")),
                 "formato_prueba": str(item.get("formato_prueba", "CLASICA"))})
    if safe["formato_prueba"] == "CLASICA":
        safe["pasos"] = [{key: step.get(key) for key in ("numero_paso", "accion", "datos", "resultado_esperado")}
                         for step in (item.get("pasos") or []) if isinstance(step, dict)]
    elif safe["formato_prueba"] == "API":
        safe["configuracion_api"] = _redact_case_config(item.get("configuracion_api") if isinstance(item.get("configuracion_api"), dict) else {})
    elif safe["formato_prueba"] == "CONVERSACIONAL":
        safe["configuracion_chatbot"] = item.get("configuracion_chatbot") if isinstance(item.get("configuracion_chatbot"), dict) else {}
    return safe


def _safe_result(result: dict[str, Any]) -> dict[str, Any]:
    """Return metadata only; package/content never crosses the MCP boundary."""
    items = []
    for item in (result.get("items") or []):
        if isinstance(item, dict):
            items.append(_safe_case_item(item))
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    diagnostics = result.get("diagnostics") if isinstance(result.get("diagnostics"), dict) else {}
    return {
        "source_tool": str(result.get("source_tool", "")),
        "source_version": str(result.get("source_version", "")),
        "file_sha256": str(result.get("file_sha256", "")),
        "summary": {str(k): value for k, value in list(summary.items()) if isinstance(value, (str, int, float, bool)) or value is None},
        "diagnostics": {str(k): value for k, value in list(diagnostics.items()) if isinstance(value, (str, int, float, bool)) or value is None},
        "items": items,
        "truncated": False,
    }


async def preview_import(db, user, project, arguments: dict[str, Any]) -> dict[str, Any]:
    """Authorize target edges, then delegate parsing/preview to case_portability."""
    component_id = _uuid(arguments.get("component_id"), "component_id")
    build_id = _uuid(arguments.get("build_id"), "build_id")
    if component_id is not None:
        component = await access_control.require_component_access(db, user, component_id, "read")
        if component.proyecto_id != project.id:
            raise ValueError("El componente destino no pertenece al proyecto")
    if build_id is not None:
        build = await access_control.require_build_access(db, user, build_id, "read")
        if build.proyecto_id != project.id or build.componente_id != component_id:
            raise ValueError("La build destino no pertenece al componente seleccionado")

    profile_id = arguments.get("profile_id")
    file_name = arguments.get("file_name")
    if not isinstance(profile_id, str) or not profile_id.strip():
        raise ValueError("profile_id es obligatorio")
    case_portability.validate_file_extension(profile_id, file_name)
    data = _decode_package(arguments.get("content_base64"))
    _validate_ai_package_data(profile_id, data)
    result = await case_portability.preview_import(db, project.id, profile_id, data)
    safe = _safe_result(result)
    safe["preview_token"] = make_preview_token(project.id, arguments)
    safe["package_sha256"] = package_sha256(arguments["content_base64"])
    return safe


async def preview_import_handler(db, user, project, arguments):
    return await preview_import(db, user, project, arguments)


async def _reserve_idempotency(db, project_id, key: str, fingerprint: str):
    """Compatibility seam for import tests and the shared durable primitive."""
    return await _reserve_durable(db, project_id, key, fingerprint)


async def commit_import(db, user, project, arguments: dict[str, Any]) -> dict[str, Any]:
    """Commit only an explicitly confirmed, unchanged governed preview."""
    if arguments.get("confirmation") != "APPLY_CASE_IMPORT":
        raise ValueError("Se requiere confirmación explícita")
    if not arguments.get("idempotency_key"):
        raise ValueError("idempotency_key es obligatorio")
    if str(arguments.get("project_id")) != str(project.id):
        raise ValueError("El proyecto no coincide con la vista previa")
    actual_hash = package_sha256(arguments.get("content_base64"))
    if not hmac.compare_digest(actual_hash, str(arguments.get("package_sha256") or "")):
        raise ValueError("El hash del paquete no coincide")
    if not _valid_preview_token(project.id, arguments, str(arguments.get("preview_token") or "")):
        raise ValueError("El preview_token es inválido o está vencido")
    data = _decode_package(arguments["content_base64"])
    _validate_ai_package_data(arguments["profile_id"], data)
    component_id = _uuid(arguments.get("component_id"), "component_id")
    build_id = _uuid(arguments.get("build_id"), "build_id")
    if component_id is None:
        raise ValueError("component_id es obligatorio")
    component = await access_control.require_component_access(db, user, component_id, "edit")
    if component.proyecto_id != project.id:
        raise ValueError("El componente destino no pertenece al proyecto")
    if build_id is not None:
        build = await access_control.require_build_access(db, user, build_id, "edit")
        if build.proyecto_id != project.id or build.componente_id != component_id:
            raise ValueError("La build destino no pertenece al componente seleccionado")
        if not access_control.is_build_active(build):
            raise ValueError("La build destino está inactiva")
    key = str(arguments["idempotency_key"])
    fingerprint = import_fingerprint(project.id, arguments, actual_hash, user.id)
    reservation = None
    cached = None
    if hasattr(db, "begin_nested"):
        reservation, cached = await _reserve_idempotency(db, project.id, key, fingerprint)
    if cached is not None:
        return cached
    try:
        batch = await asyncio.wait_for(case_portability.commit_import(
            db, project.id, arguments["profile_id"], data, arguments.get("file_name"),
            user.id, arguments.get("selected_external_ids"), component_id, build_id,
            commit_transaction=False,
        ), timeout=COMMIT_TIMEOUT_SECONDS)
    except asyncio.TimeoutError as exc:
        if reservation is not None and hasattr(db, "rollback"):
            await db.rollback()
        raise ValueError("La importación excedió el tiempo límite") from exc
    except Exception:
        if reservation is not None and hasattr(db, "rollback"):
            await db.rollback()
        raise
    receipt = secrets.token_urlsafe(32)
    result = {"batch_id": str(batch.id), "status": str(batch.status),
              "commit_receipt": receipt,
              "rollback_token": make_rollback_token(project.id, batch.id, receipt),
              "operation": "treseko.cases.import.commit",
              "component_id": str(component_id), "build_id": str(build_id) if build_id else None,
              "summary": _safe_result({"summary": batch.summary_json}).get("summary", {})}
    if reservation is not None:
        reservation.status = "COMPLETED"
        reservation.result_json = dict(result)
        await db.commit()
    return result


async def commit_import_handler(db, user, project, arguments):
    return await commit_import(db, user, project, arguments)


async def rollback_import(db, user, project, arguments: dict[str, Any]) -> dict[str, Any]:
    if arguments.get("confirmation") != "ROLLBACK_CASE_IMPORT":
        raise ValueError("Se requiere confirmación explícita")
    batch_id = _uuid(arguments.get("batch_id"), "batch_id")
    if str(arguments.get("project_id")) != str(project.id):
        raise ValueError("El proyecto no coincide con el recibo")
    receipt = str(arguments.get("commit_receipt") or "")
    try:
        token_valid = valid_rollback_token(project.id, batch_id, receipt, arguments.get("rollback_token"))
    except RuntimeError as exc:
        raise ValueError("durable MCP commit receipt requerido") from exc
    if not receipt or len(receipt) > 128 or not token_valid:
        raise ValueError("rollback_token o commit_receipt inválido")
    batch = await db.get(models.CaseImportBatch, batch_id)
    if not batch or str(batch.proyecto_id) != str(project.id):
        raise ValueError("recibo MCP no encontrado")
    reservations = await db.execute(select(models.McpImportIdempotency).where(
        models.McpImportIdempotency.proyecto_id == project.id,
        models.McpImportIdempotency.status == "COMPLETED"))
    durable = next((row for row in reservations.scalars().all() if isinstance(row.result_json, dict) and row.result_json.get("batch_id") == str(batch.id)), None)
    if not durable or durable.result_json.get("commit_receipt") != receipt or durable.result_json.get("operation") != "treseko.cases.import.commit":
        raise ValueError("durable MCP commit receipt requerido")
    component_id = durable.result_json.get("component_id")
    build_id = durable.result_json.get("build_id")
    if component_id:
        component = await access_control.require_component_access(db, user, _uuid(component_id, "component_id"), "edit")
        if str(component.proyecto_id) != str(project.id):
            raise ValueError("componente fuera del proyecto")
    if build_id:
        build = await access_control.require_build_access(db, user, _uuid(build_id, "build_id"), "edit")
        if str(build.proyecto_id) != str(project.id) or str(build.componente_id) != str(component_id):
            raise ValueError("build fuera del componente")
    key = str(arguments["idempotency_key"])
    fingerprint = hashlib.sha256(f"rollback|{project.id}|{batch.id}|{receipt}".encode()).hexdigest()
    reservation, cached = await _reserve_idempotency(db, project.id, key, fingerprint)
    if cached is not None:
        return cached
    # Idempotency keys serialize retries, but different keys need a durable
    # target lock so only one transaction can delete this batch's rows.
    locked_batch = (await db.execute(
        select(models.CaseImportBatch)
        .where(
            models.CaseImportBatch.id == batch_id,
            models.CaseImportBatch.proyecto_id == project.id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if not locked_batch:
        await db.rollback()
        raise ValueError("recibo MCP no encontrado")
    try:
        batch = await case_portability.rollback_batch(db, locked_batch, user.id, commit_transaction=False)
        result = {"batch_id": str(batch.id), "status": str(batch.status), "rolled_back": True}
        reservation.status = "COMPLETED"
        reservation.result_json = result
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return result


async def rollback_import_handler(db, user, project, arguments):
    return await rollback_import(db, user, project, arguments)

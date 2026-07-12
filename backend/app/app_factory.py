import json
import logging
import logging.config
import os
import sys
from importlib import import_module
from typing import Any

from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.requests import ClientDisconnect

from . import main_context as _context
from .api.router import api_router
from .main_context import AsyncSessionLocal, app, crud, engine, initialize_database, notification_event_service
from .services.error_sanitizer import sanitize_external_error
from .services.installation_telemetry import send_installation_ping_once


def _configure_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.config.dictConfig({
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "format": "%(asctime)s %(levelname)s [%(name)s] %(message)s",
            },
        },
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "formatter": "default",
                "stream": sys.stdout,
            },
        },
        "root": {
            "handlers": ["stdout"],
            "level": level,
        },
    })


_configure_logging()
logger = logging.getLogger(__name__)

LEGACY_ROUTE_MODULE_NAMES = [
    "app.api.routers.legacy_main_part_01",
    "app.api.routers.legacy_main_part_02",
    "app.api.routers.legacy_main_part_03",
    "app.api.routers.legacy_main_part_04",
    "app.api.routers.legacy_main_part_05",
    "app.api.routers.legacy_main_part_06",
    "app.api.routers.legacy_main_part_07",
    "app.api.routers.legacy_main_part_08",
    "app.api.routers.legacy_main_part_09",
    "app.api.routers.legacy_main_part_10",
    "app.api.routers.legacy_main_part_11",
    "app.api.routers.legacy_main_part_12",
]

PRIVATE_EXPORTS = {
    "_shared_report_response",
    "_snapshot_report_type",
    "_snapshot_url",
    "_shared_report_bundle_response",
    "_report_public_url",
    "_flatten_report_cases",
    "_report_badge_class",
    "_render_report_evidence",
    "_render_report_distribution",
    "_render_report_trend",
    "_render_report_cases",
    "_render_report_failed_steps",
    "_render_report_bugs",
    "_report_type_from_payload",
    "_report_common_css",
    "_report_context_html",
    "_render_executive_issues",
    "_render_bug_severity_summary",
    "_render_development_failures",
    "_render_bug_tracking",
    "_render_development_actions",
    "_shared_report_html",
    "_md",
    "_markdown_evidence",
    "_shared_report_markdown",
}

exported_route_symbols = {}
_configured = False


DEFAULT_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}
HTTPS_SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}
TEXTUAL_BODY_CONTENT_TYPES = (
    "application/json",
    "application/merge-patch+json",
    "application/x-www-form-urlencoded",
    "text/",
)
FORBIDDEN_INPUT_CONTROL_CHARS = {
    "\x00": "NUL",
}


def _log_project_schema_inspection_failure(exc: Exception) -> None:
    logger.warning("No se pudo inspeccionar proyectos: %s", sanitize_external_error(exc))


def _contains_forbidden_input_control_char(value: str | bytes) -> str | None:
    if isinstance(value, bytes):
        for char, label in FORBIDDEN_INPUT_CONTROL_CHARS.items():
            if char.encode("utf-8") in value:
                return label
        return None
    for char, label in FORBIDDEN_INPUT_CONTROL_CHARS.items():
        if char in value:
            return label
    return None


def _is_textual_request_body(content_type: str | None) -> bool:
    if not content_type:
        return False
    normalized = content_type.split(";", 1)[0].strip().lower()
    return any(
        normalized == candidate or normalized.startswith(candidate)
        for candidate in TEXTUAL_BODY_CONTENT_TYPES
    )


def _is_json_request_body(content_type: str | None) -> bool:
    if not content_type:
        return False
    normalized = content_type.split(";", 1)[0].strip().lower()
    return normalized == "application/json" or normalized.endswith("+json")


def _find_forbidden_input_control_char(value: Any) -> str | None:
    if isinstance(value, str):
        return _contains_forbidden_input_control_char(value)
    if isinstance(value, list):
        for item in value:
            found = _find_forbidden_input_control_char(item)
            if found:
                return found
        return None
    if isinstance(value, dict):
        for key, item in value.items():
            found = _find_forbidden_input_control_char(key)
            if found:
                return found
            found = _find_forbidden_input_control_char(item)
            if found:
                return found
    return None


def _find_forbidden_query_control_char(query_params) -> str | None:
    for key, value in query_params.multi_items():
        found = _find_forbidden_input_control_char(key)
        if found:
            return found
        found = _find_forbidden_input_control_char(value)
        if found:
            return found
    return None


async def startup_initialize_database():
    await initialize_database()
    async with AsyncSessionLocal() as db:
        await crud.ensure_default_ai_workflow(db)
        await crud.ensure_default_ai_agent_presets(db)
        await notification_event_service.ensure_notification_seeds(db)
        await send_installation_ping_once(db)

    try:
        async with engine.connect() as conn:
            if conn.dialect.name != "sqlite":
                logger.debug("Compatibilidad legacy de proyectos omitida para %s; PostgreSQL usa Alembic.", conn.dialect.name)
                return
            result = await conn.execute(text("PRAGMA table_info(proyectos)"))
            columns = [col[1] for col in result.fetchall()]
            if "estado" not in columns:
                await conn.execute(text("ALTER TABLE proyectos ADD COLUMN estado VARCHAR(50) DEFAULT 'Activo' NOT NULL"))
            if "imagen_url" not in columns:
                await conn.execute(text("ALTER TABLE proyectos ADD COLUMN imagen_url VARCHAR(500)"))
            await conn.execute(
                text("UPDATE proyectos SET estado = CASE WHEN activo THEN 'Activo' ELSE 'En Pausa' END WHERE estado IS NULL OR estado = ''")
            )
            await conn.commit()
            logger.debug("Columnas en tabla proyectos: %s", columns)
    except Exception as exc:
        _log_project_schema_inspection_failure(exc)


@app.middleware("http")
async def reject_forbidden_control_chars(request, call_next):
    control_char = _contains_forbidden_input_control_char(str(request.url.query))
    if not control_char:
        control_char = _find_forbidden_query_control_char(request.query_params)
    if control_char:
        return JSONResponse(
            status_code=422,
            content={"detail": f"Request invalido: query contiene caracter de control no permitido ({control_char})"},
        )

    if request.method.upper() in {"POST", "PUT", "PATCH", "DELETE"} and _is_textual_request_body(request.headers.get("content-type")):
        try:
            body = await request.body()
        except ClientDisconnect:
            return JSONResponse(
                status_code=499,
                content={"detail": "Cliente desconectado antes de completar la solicitud."},
            )
        control_char = _contains_forbidden_input_control_char(body)
        if not control_char and _is_json_request_body(request.headers.get("content-type")) and body:
            try:
                control_char = _find_forbidden_input_control_char(json.loads(body))
            except json.JSONDecodeError:
                control_char = None
        if control_char:
            return JSONResponse(
                status_code=422,
                content={"detail": f"Request invalido: body contiene caracter de control no permitido ({control_char})"},
            )

    return await call_next(request)


@app.middleware("http")
async def add_default_security_headers(request, call_next):
    response = await call_next(request)
    for name, value in DEFAULT_SECURITY_HEADERS.items():
        if name not in response.headers:
            response.headers[name] = value
    if getattr(request.url, "scheme", "").lower() == "https":
        for name, value in HTTPS_SECURITY_HEADERS.items():
            if name not in response.headers:
                response.headers[name] = value
    return response


@app.middleware("http")
async def reject_invalid_pagination(request, call_next):
    for name, minimum, maximum in (("skip", 0, None), ("limit", 1, 500)):
        raw_value = request.query_params.get(name)
        if raw_value is None:
            continue
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            return JSONResponse(
                status_code=422,
                content={"detail": f"Query parameter '{name}' debe ser numerico"},
            )
        if value < minimum or (maximum is not None and value > maximum):
            suffix = f" y menor o igual a {maximum}" if maximum is not None else ""
            return JSONResponse(
                status_code=422,
                content={"detail": f"Query parameter '{name}' debe ser mayor o igual a {minimum}{suffix}"},
            )
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception):
    logger.exception("Unhandled backend exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Error interno del servidor. Intenta nuevamente o contacta al administrador."},
    )


@app.exception_handler(ClientDisconnect)
async def client_disconnect_exception_handler(request, exc: ClientDisconnect):
    logger.info("Cliente desconectado durante %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=499,
        content={"detail": "Cliente desconectado antes de completar la solicitud."},
    )


def _should_export(name: str) -> bool:
    return not name.startswith("_") or name in PRIVATE_EXPORTS


def _register_legacy_routes():
    loaded_modules = []
    for module_name in LEGACY_ROUTE_MODULE_NAMES:
        module = import_module(module_name)
        loaded_modules.append(module)
        for name, value in vars(module).items():
            if _should_export(name):
                exported_route_symbols[name] = value
        vars(_context).update(exported_route_symbols)
        for loaded in loaded_modules:
            vars(loaded).update(exported_route_symbols)


def _mount_router_flat(router):
    explicit_exports = getattr(router, "export_symbols", {})
    exported_route_symbols.update(explicit_exports)
    for route in router.routes:
        nested_router = getattr(route, "original_router", None)
        if nested_router is not None:
            _mount_router_flat(nested_router)
        else:
            app.router.routes.append(route)
            endpoint = getattr(route, "endpoint", None)
            name = getattr(route, "name", None)
            if name and endpoint is not None:
                exported_route_symbols[name] = endpoint
    exported_route_symbols.update(explicit_exports)


def create_app():
    global _configured
    if not _configured:
        app.on_event("startup")(startup_initialize_database)
        _mount_router_flat(api_router)
        _register_legacy_routes()
        _configured = True
    return app

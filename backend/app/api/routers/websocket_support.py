import asyncio
import json
import logging
import os
import secrets

from fastapi import APIRouter
import jwt
from jwt import InvalidTokenError as JWTError
from starlette.websockets import WebSocketState
from ...services.error_contract import CORRELATION_ID_RE, current_correlation_id, set_correlation_id

from ...main_context import *
from ... import access_control, auth
from ...services.error_sanitizer import sanitize_external_error
from ...services.realtime_events import realtime_event_bus
from ...services.ai_dry_run_stream import ai_dry_run_stream


router = APIRouter(tags=["websocket_sync"])
logger = logging.getLogger(__name__)

MAX_ENGINE_WS_MESSAGE_LENGTH = 17 * 1024 * 1024
MAX_ENGINE_WS_EVENT_TYPE_LENGTH = 80
MAX_ENGINE_WS_TEXT_FIELD_LENGTH = 4_000
MAX_ENGINE_WS_METADATA_TEXT_LENGTH = 1_000
MAX_ENGINE_WS_METADATA_ITEMS = 25
MAX_WS_QUERY_TOKEN_LENGTH = 2048
MAX_WS_AUTH_MESSAGE_LENGTH = 4096
MAX_WS_CALLBACK_TOKEN_LENGTH = 256
ALLOWED_ENGINE_WS_EVENT_TYPES = {
    "STREAM_DOM_LOG",
    "STEP_RESULT",
    "RUN_STATUS",
    "ENGINE_STATUS",
    "ENGINE_LOG",
    "AGENT_LOG",
    "PROGRESS",
    "ERROR",
    "WARNING",
    "EXECUTION_FINISHED",
}
ALLOWED_AI_DRY_RUN_EVENT_TYPES = {
    "STREAM_DOM_LOG",
    "STEP_RESULT",
    "RUN_STATUS",
    "ENGINE_STATUS",
    "ENGINE_LOG",
    "AGENT_LOG",
    "PROGRESS",
    "ERROR",
    "WARNING",
    "EXECUTION_FINISHED",
    "DRY_RUN_RESULT",
}
SAFE_ENGINE_WS_BROADCAST_FIELDS = {
    "type",
    "event",
    "level",
    "source",
    "agent",
    "step",
    "step_number",
    "numero_paso",
    "text",
    "message",
    "detail",
    "log",
    "status",
    "attempt",
    "confidence",
    "consensus",
    "human_review_required",
    "duration_seconds",
    "error_message",
    "error_code",
    "correlation_id",
    "ai_report_summary",
    "report_pending",
}

# --- WEBSOCKET SYNC ---

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, group_id: str):
        if websocket.application_state == WebSocketState.CONNECTING:
            await websocket.accept()
        if group_id not in self.active_connections:
            self.active_connections[group_id] = []
        self.active_connections[group_id].append(websocket)

    def disconnect(self, websocket: WebSocket, group_id: str):
        if group_id in self.active_connections and websocket in self.active_connections[group_id]:
            self.active_connections[group_id].remove(websocket)
            if not self.active_connections[group_id]:
                del self.active_connections[group_id]

    async def broadcast(self, message: dict, group_id: str):
        if group_id in self.active_connections:
            for connection in self.active_connections[group_id]:
                await connection.send_json(message)

manager = ConnectionManager()


def _normalize_ws_token(value: Optional[str], *, max_length: int = MAX_WS_QUERY_TOKEN_LENGTH) -> str | None:
    token = (value or "").strip()
    if (
        not token
        or len(token) > max_length
        or any(char.isspace() for char in token)
        or "\x00" in token
    ):
        return None
    return token


async def _get_websocket_user_from_token(token_value: Optional[str], db: AsyncSession):
    token = _normalize_ws_token(token_value)
    if not token:
        return None
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        if payload.get("type") != "access":
            return None
        email: str | None = payload.get("sub")
        if not email:
            return None
    except JWTError:
        return None
    return await crud.get_user_by_email(db, email=email)


async def _authenticate_websocket_user(websocket: WebSocket, db: AsyncSession):
    if websocket.query_params.get("token"):
        await websocket.close(code=1008)
        return None
    if websocket.application_state == WebSocketState.CONNECTING:
        await websocket.accept()
    try:
        raw_message = await asyncio.wait_for(websocket.receive_text(), timeout=10)
    except Exception:
        await websocket.close(code=1008)
        return None
    if len(raw_message) > MAX_WS_AUTH_MESSAGE_LENGTH:
        await websocket.close(code=1009)
        return None
    try:
        message = json.loads(raw_message)
    except json.JSONDecodeError:
        await websocket.close(code=1008)
        return None
    if not isinstance(message, dict) or message.get("type") != "auth":
        await websocket.close(code=1008)
        return None
    return await _get_websocket_user_from_token(message.get("token"), db)


async def _get_execution_context(db: AsyncSession, ejecucion_id: UUID):
    result = await db.execute(
        select(
            models.TestRun.proyecto_id,
            models.TestRun.build_id,
            models.Build.componente_id,
            models.EjecucionCaso.test_run_id,
            models.EjecucionCaso.caso_id,
        )
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    return result.first()


async def _get_snapshot_execution_context(db: AsyncSession, snapshot_id: UUID):
    result = await db.execute(
        select(
            models.TestRun.proyecto_id,
            models.TestRun.build_id,
            models.Build.componente_id,
            models.EjecucionCaso.id.label("ejecucion_caso_id"),
            models.EjecucionCaso.caso_id,
            models.EjecucionCaso.test_run_id,
        )
        .join(models.SnapshotPaso, models.SnapshotPaso.ejecucion_caso_id == models.EjecucionCaso.id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
        .filter(models.SnapshotPaso.id == snapshot_id)
    )
    return result.first()


def _can_view_execution_stream(user: models.Usuario) -> bool:
    return (
        auth.has_capability_permission(user, "motor_ia.logs", "read")
        or auth.has_capability_permission(user, "motor_ia.ver", "read")
        or auth.has_capability_permission(user, "ejecutar.ia", "read")
        or auth.has_module_permission(user, "motor_ia", "read")
    )


def _can_publish_engine_stream(user: models.Usuario) -> bool:
    return (
        auth.has_capability_permission(user, "ejecutar.ia", "edit")
        or auth.has_capability_permission(user, "motor_ia.ver", "edit")
        or auth.has_module_permission(user, "motor_ia", "edit")
    )


def _get_engine_ws_payload(websocket: WebSocket, ejecucion_id: UUID):
    token = _normalize_ws_token(websocket.query_params.get("engine_token"))
    if not token:
        return None
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
    except JWTError:
        return None
    if payload.get("type") != "engine_ws":
        return None
    if payload.get("scope") != "ai-engine-ws":
        return None
    if payload.get("execution_id") != str(ejecucion_id):
        return None
    return payload


def _has_valid_shared_engine_token(websocket: WebSocket) -> bool:
    configured = _normalize_ws_token(os.getenv("AI_ENGINE_CALLBACK_TOKEN"), max_length=MAX_WS_CALLBACK_TOKEN_LENGTH)
    provided = _normalize_ws_token(websocket.query_params.get("callback_token"), max_length=MAX_WS_CALLBACK_TOKEN_LENGTH)
    return bool(configured and provided and secrets.compare_digest(configured, provided))


def _websocket_correlation_id(websocket: WebSocket) -> str:
    headers = getattr(websocket, "headers", {}) or {}
    query_params = getattr(websocket, "query_params", {}) or {}
    candidate = str(headers.get("x-correlation-id") or query_params.get("correlation_id") or "").strip()
    return candidate if CORRELATION_ID_RE.fullmatch(candidate) else current_correlation_id()


async def _send_engine_error(websocket: WebSocket, message: str, *, error_code: str = "WEBSOCKET_ERROR"):
    correlation_id = _websocket_correlation_id(websocket)
    await websocket.send_json({
        "type": "ERROR",
        "message": message,
        "error": {"error_code": error_code, "message": message, "correlation_id": correlation_id, "retryable": False, "details": {}},
        "correlation_id": correlation_id,
    })


async def _read_engine_event(websocket: WebSocket) -> dict | None:
    data = await websocket.receive_text()
    if len(data) > MAX_ENGINE_WS_MESSAGE_LENGTH:
        await _send_engine_error(websocket, "Mensaje WebSocket demasiado grande.")
        await websocket.close(code=1009)
        return None
    try:
        event = json.loads(data)
    except json.JSONDecodeError:
        await _send_engine_error(websocket, "Mensaje WebSocket invalido.")
        return {}
    if not isinstance(event, dict):
        await _send_engine_error(websocket, "El evento WebSocket debe ser un objeto JSON.")
        return {}
    event_type = event.get("type")
    if not isinstance(event_type, str) or not event_type or len(event_type) > MAX_ENGINE_WS_EVENT_TYPE_LENGTH:
        await _send_engine_error(websocket, "Tipo de evento WebSocket invalido.")
        return {}
    return event


def _bounded_optional_text(value: object, *, max_length: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    return value[:max_length]


def _sanitize_ws_text(value: object, *, max_length: int = MAX_ENGINE_WS_TEXT_FIELD_LENGTH) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    cleaned = value.replace("\x00", "")
    cleaned = "".join(char if char in "\n\r\t" or ord(char) >= 32 else " " for char in cleaned)
    return cleaned[:max_length]


def _sanitize_ws_metadata(value: object, *, depth: int = 0) -> object:
    if depth > 2:
        return None
    if isinstance(value, dict):
        sanitized: dict[str, object] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= MAX_ENGINE_WS_METADATA_ITEMS:
                break
            if not isinstance(key, str):
                continue
            safe_key = _sanitize_ws_text(key, max_length=80)
            if not safe_key:
                continue
            sanitized[safe_key] = _sanitize_ws_metadata(item, depth=depth + 1)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_ws_metadata(item, depth=depth + 1) for item in value[:MAX_ENGINE_WS_METADATA_ITEMS]]
    if isinstance(value, str):
        return _sanitize_ws_text(value, max_length=MAX_ENGINE_WS_METADATA_TEXT_LENGTH)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return _sanitize_ws_text(value, max_length=MAX_ENGINE_WS_METADATA_TEXT_LENGTH)


def _sanitize_engine_broadcast_event(event: dict) -> dict | None:
    event_type = event.get("type")
    if event_type not in ALLOWED_ENGINE_WS_EVENT_TYPES:
        return None

    sanitized: dict[str, object] = {}
    for field in SAFE_ENGINE_WS_BROADCAST_FIELDS:
        if field not in event:
            continue
        value = event[field]
        if field in {"text", "message", "detail", "log", "source", "agent", "level", "status", "event", "error_code", "correlation_id"}:
            sanitized_value = _sanitize_ws_text(value)
            if sanitized_value is not None:
                sanitized[field] = sanitized_value
        elif field in {"step", "step_number", "numero_paso", "attempt"}:
            sanitized[field] = _sanitize_ws_metadata(value)
        elif field in {"confidence", "consensus", "human_review_required"}:
            sanitized[field] = _sanitize_ws_metadata(value) if isinstance(value, (int, float, bool, str)) or value is None else None
        elif field in {"duration_seconds", "error_message", "ai_report_summary"}:
            sanitized[field] = _sanitize_ws_metadata(value)
        else:
            sanitized[field] = value

    if "metadata" in event:
        sanitized["metadata"] = _sanitize_ws_metadata(event["metadata"])
    if "metrics" in event:
        sanitized["metrics"] = _sanitize_ws_metadata(event["metrics"])

    sanitized["type"] = event_type
    candidate_correlation_id = str(event.get("correlation_id") or "").strip()
    sanitized["correlation_id"] = candidate_correlation_id if CORRELATION_ID_RE.fullmatch(candidate_correlation_id) else current_correlation_id()
    return sanitized


def _sanitize_ai_dry_run_event(event: dict) -> dict | None:
    event_type = event.get("type")
    if event_type not in ALLOWED_AI_DRY_RUN_EVENT_TYPES:
        return None
    safe: dict[str, object] = {"type": event_type}
    candidate_correlation_id = str(event.get("correlation_id") or "").strip()
    safe["correlation_id"] = candidate_correlation_id if CORRELATION_ID_RE.fullmatch(candidate_correlation_id) else current_correlation_id()
    if isinstance(event.get("error_code"), str):
        safe["error_code"] = _sanitize_ws_text(event["error_code"], max_length=120)
    for field in ("step", "step_number", "attempt", "status", "agent", "level", "source", "message", "text", "error_message", "observations", "reason", "failure_category", "action_summary", "action_executed", "url", "duration_seconds", "confidence", "ai_report_summary"):
        if field in event:
            safe[field] = _sanitize_ws_metadata(event[field]) if field in {"step", "step_number", "attempt", "duration_seconds", "confidence", "ai_report_summary"} else _sanitize_ws_text(event[field])
    if isinstance(event.get("screenshot"), str) and len(event["screenshot"]) <= MAX_ENGINE_WS_MESSAGE_LENGTH:
        safe["screenshot"] = event["screenshot"]
    if event_type == "DRY_RUN_RESULT":
        for field in ("status", "observations", "error_message", "metadata", "ai_report", "steps", "final_screenshot_base64"):
            if field in event:
                safe[field] = _sanitize_ws_metadata(event[field]) if field != "final_screenshot_base64" else event[field]
    return safe



__all__ = [name for name in globals() if not name.startswith('__')]

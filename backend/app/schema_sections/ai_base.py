from __future__ import annotations

import json
import re
from urllib.parse import urlsplit
from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator

from .auth import validate_preference_json_payload

from ..models import (
    AiReviewStatus,
    AutomationJobStatus,
    Criticidad,
    EstadoCaso,
    EstadoResultado,
    EstadoRun,
    ExecutionMode,
    Prioridad,
    Rol,
    TipoPrueba,
)

MAX_AI_STRING_LENGTH = 200
MAX_AI_PROVIDER_LENGTH = 80
MAX_AI_ENDPOINT_LENGTH = 500
MAX_AI_MODEL_LENGTH = 160
MAX_AI_PROMPT_TEMPLATE_LENGTH = 50_000
MAX_AI_CHANGELOG_LENGTH = 4_000
MAX_AI_DESCRIPTION_LENGTH = 2_000
MAX_AI_JSON_BYTES = 64 * 1024
MAX_AI_CONFIG_JSON_BYTES = 128 * 1024
MAX_AI_IMPORT_JSON_BYTES = 512 * 1024
MAX_AI_RESULT_JSON_BYTES = 256 * 1024
MAX_AI_LOG_LENGTH = 120_000
MAX_AI_ERROR_LENGTH = 8_000
MAX_AI_SCREENSHOT_BASE64_LENGTH = 16 * 1024 * 1024
MAX_AI_WORKFLOW_NODES = 100
MAX_AI_WORKFLOW_EDGES = 300
MAX_AI_WORKFLOW_IMPORT_ROWS = 500
MAX_AI_MODEL_CATALOG_ITEMS = 500
MAX_AI_AGENT_WORKFLOW_ITEMS = 200
MAX_AI_DRY_RUN_STEPS = 200
AI_WORKFLOW_PURPOSES = {"test_execution", "story_generation", "test_case_generation"}
MAX_AI_RESULT_STEPS = 500



def validate_ai_json_payload(value: Optional[Dict[str, Any]], *, max_bytes: int = MAX_AI_JSON_BYTES) -> Optional[Dict[str, Any]]:
    return validate_preference_json_payload(
        value,
        max_bytes=max_bytes,
        label="La configuracion de IA",
    )


def validate_ai_json_list(value: Optional[List[Dict[str, Any]]], *, max_items: int, max_bytes: int, label: str) -> Optional[List[Dict[str, Any]]]:
    if value is None:
        return value
    if len(value) > max_items:
        raise ValueError(f"{label} contiene demasiados elementos")
    validate_preference_json_payload(
        {"items": value},
        max_bytes=max_bytes,
        label=label,
    )
    return value


def _ai_result_payload_size(value: Dict[str, Any]) -> int:
    return len(json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":")).encode("utf-8"))


def _validate_ai_result_json_value(
    value: Any,
    *,
    depth: int = 0,
    label: str = "El resultado de IA",
) -> None:
    if depth > 20:
        raise ValueError(f"{label} excede la profundidad permitida")
    if value is None or isinstance(value, (bool, int, float)):
        return
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError(f"{label} contiene caracteres invalidos")
        if len(value) > MAX_AI_LOG_LENGTH:
            raise ValueError(f"{label} contiene un texto demasiado largo")
        return
    if isinstance(value, list):
        if len(value) > 5_000:
            raise ValueError(f"{label} contiene demasiados elementos")
        for item in value:
            _validate_ai_result_json_value(item, depth=depth + 1, label=label)
        return
    if isinstance(value, dict):
        if len(value) > 1_000:
            raise ValueError(f"{label} contiene demasiadas claves")
        for key, item in value.items():
            if not isinstance(key, str) or not key or len(key) > MAX_AI_STRING_LENGTH or "\x00" in key:
                raise ValueError(f"{label} contiene una clave invalida")
            _validate_ai_result_json_value(item, depth=depth + 1, label=label)
        return
    raise ValueError(f"{label} contiene un valor no soportado")


def validate_ai_result_json_payload(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if value is None:
        return value
    if not isinstance(value, dict):
        raise ValueError("El resultado de IA debe ser un objeto")
    _validate_ai_result_json_value(value)
    if _ai_result_payload_size(value) > MAX_AI_RESULT_JSON_BYTES:
        raise ValueError("El resultado de IA excede el tamano maximo permitido")
    return value


AI_ENGINE_STATUS_ALIASES = {
    "PASSED": EstadoResultado.PASO,
    "PASS": EstadoResultado.PASO,
    "SUCCESS": EstadoResultado.PASO,
    "SUCCEEDED": EstadoResultado.PASO,
    "OK": EstadoResultado.PASO,
    "FAILED": EstadoResultado.FALLO,
    "FAIL": EstadoResultado.FALLO,
    "ERROR": EstadoResultado.FALLO,
    "BLOCKED": EstadoResultado.BLOQUEADO,
    "SKIPPED": EstadoResultado.BLOQUEADO,
    "RUNNING": EstadoResultado.EJECUTANDO_AI,
    "IN_PROGRESS": EstadoResultado.EJECUTANDO_AI,
    "PENDING": EstadoResultado.SIN_CORRER,
}


def normalize_ai_engine_status(value: Any) -> Any:
    if isinstance(value, EstadoResultado):
        return value
    normalized = str(value or "").strip().upper()
    return AI_ENGINE_STATUS_ALIASES.get(normalized, value)


def normalize_ai_duration_seconds(value: Any) -> int:
    if value is None or value == "":
        return 0
    try:
        return max(0, int(round(float(value))))
    except (TypeError, ValueError):
        return 0


AI_PROVIDER_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$", re.IGNORECASE)
AI_PROVIDER_API_KEY_FIELDS = {"api_key", "updated_at", "label"}
AI_PROVIDER_ADAPTERS = {"openai-responses", "anthropic-messages", "gemini", "azure-openai", "openai-compatible"}
AI_CAPABILITY_STATES = {"tested", "reported", "unsupported", "unknown"}


def validate_ai_provider_endpoint(value: str) -> str:
    endpoint = str(value or "").strip().rstrip("/")
    try:
        parsed = urlsplit(endpoint)
    except ValueError as exc:
        raise ValueError("El endpoint IA es invalido") from exc
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("El endpoint IA no puede contener credenciales, query ni fragment")
    hostname = (parsed.hostname or "").lower()
    local = hostname in {"localhost", "127.0.0.1", "::1"}
    # Local providers may run on another machine in the same private/Tailscale
    # network (for example LM Studio on Windows). Keep HTTP restricted to
    # non-public address ranges; public providers still require HTTPS.
    private_http = bool(re.match(r"^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d)\.|100\.1\d\d\.)", hostname))
    if parsed.scheme != "https" and not (parsed.scheme == "http" and (local or private_http)):
        raise ValueError("El endpoint IA debe usar HTTPS; HTTP se permite solo en loopback local")
    if not parsed.hostname:
        raise ValueError("El endpoint IA debe incluir un host")
    return endpoint

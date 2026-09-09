"""Validation shared by the API Automation Worker callback contract."""

from __future__ import annotations

import json
from typing import Any


MAX_AUTOMATION_API_RESULT_ITEM_BYTES = 4 * 1024 * 1024
MAX_AUTOMATION_API_RESULTS_BYTES = 16 * 1024 * 1024
MAX_AUTOMATION_API_RESULT_STRING_LENGTH = 2 * 1024 * 1024
MAX_AUTOMATION_API_STATE_UPDATES_BYTES = 512 * 1024


def _validate_shape(item: Any, depth: int = 0) -> None:
    if depth > 12:
        raise ValueError("El resultado de un caso API excede la profundidad permitida")
    if isinstance(item, str):
        if len(item) > MAX_AUTOMATION_API_RESULT_STRING_LENGTH:
            raise ValueError("El resultado de un caso API contiene un texto demasiado largo")
    elif isinstance(item, dict):
        if len(item) > 500:
            raise ValueError("El resultado de un caso API contiene demasiadas propiedades")
        for key, child in item.items():
            if len(str(key)) > 120:
                raise ValueError("El resultado de un caso API contiene una clave demasiado larga")
            _validate_shape(child, depth + 1)
    elif isinstance(item, list):
        if len(item) > 2000:
            raise ValueError("El resultado de un caso API contiene demasiados elementos")
        for child in item:
            _validate_shape(child, depth + 1)


def validate_api_worker_result(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("schema_version") != "treseko.api-result/v1":
        raise ValueError("Cada resultado API debe usar treseko.api-result/v1")
    status = str(value.get("status") or "").upper()
    if status not in {"PASSED", "PASSED_WITH_WARNINGS", "FAILED", "BLOCKED", "TIMEOUT", "ERROR"}:
        raise ValueError("El estado del resultado API no es compatible")
    _validate_shape(value)
    if len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8")) > MAX_AUTOMATION_API_RESULT_ITEM_BYTES:
        raise ValueError(f"El resultado de un caso API supera {MAX_AUTOMATION_API_RESULT_ITEM_BYTES} bytes")
    return value


def _contains_redaction_marker(value: Any) -> bool:
    if isinstance(value, dict):
        return any(_contains_redaction_marker(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_redaction_marker(item) for item in value)
    return value in {"[REDACTED]", "[redacted]"}


def validate_api_worker_state_updates(value: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) - {"shared_variables", "persistent_variables"}:
        raise ValueError("state_updates API debe contener solo shared_variables y persistent_variables")
    _validate_shape(value)
    for scope in ("shared_variables", "persistent_variables"):
        updates = value.get(scope) or {}
        if not isinstance(updates, dict):
            raise ValueError(f"state_updates.{scope} debe ser un objeto")
        if any(not str(key).startswith("api.") for key in updates):
            raise ValueError("El estado API solo admite variables con prefijo api.")
        if _contains_redaction_marker(updates):
            raise ValueError("state_updates API no puede contener valores redactados")
    if len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8")) > MAX_AUTOMATION_API_STATE_UPDATES_BYTES:
        raise ValueError("Las actualizaciones de estado API superan el límite permitido")
    return value

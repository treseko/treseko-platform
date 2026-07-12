from __future__ import annotations

from typing import Any

from .error_sanitizer import sanitize_external_error


SNAPSHOT_VISIBLE_TEXT_FIELDS = {
    "accion_congelada",
    "datos_congelados",
    "datos_resueltos",
    "resultado_esperado_congelado",
    "comentarios",
    "error_log",
}


def sanitize_execution_snapshot_item(item: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(item)
    for field in SNAPSHOT_VISIBLE_TEXT_FIELDS:
        value = sanitized.get(field)
        if isinstance(value, str) and value.strip():
            sanitized[field] = sanitize_external_error(value, max_len=2000)
    return sanitized

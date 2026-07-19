from __future__ import annotations

from typing import Any


SNAPSHOT_VISIBLE_TEXT_FIELDS = {
    "accion_congelada",
    "datos_congelados",
    "datos_resueltos",
    "resultado_esperado_congelado",
    "comentarios",
    "error_log",
}
MAX_SNAPSHOT_VISIBLE_TEXT_LENGTH = 4000


def _clean_snapshot_text(value: str) -> str:
    text = str(value or "").replace("\x00", "").strip()
    if len(text) > MAX_SNAPSHOT_VISIBLE_TEXT_LENGTH:
        return f"{text[:MAX_SNAPSHOT_VISIBLE_TEXT_LENGTH].rstrip()}..."
    return text


def sanitize_execution_snapshot_item(item: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(item)
    for field in SNAPSHOT_VISIBLE_TEXT_FIELDS:
        value = sanitized.get(field)
        if isinstance(value, str) and value.strip():
            sanitized[field] = _clean_snapshot_text(value)
    return sanitized

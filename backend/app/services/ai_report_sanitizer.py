from __future__ import annotations

import json
from typing import Any

from .error_sanitizer import sanitize_external_error

MAX_AI_REPORT_BYTES = 96 * 1024
MAX_AI_REPORT_LIST_ITEMS = 40
MAX_AI_REPORT_DEPTH = 6
MAX_AI_REPORT_STRING_LENGTH = 2000
REDACTED_AI_SECRET = "[redacted]"
TRUNCATED_AI_VALUE = "[truncated]"
SENSITIVE_KEY_MARKERS = {
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "credential",
    "credentials",
    "password",
    "secret",
    "token",
}
HEAVY_KEY_MARKERS = {
    "base64",
    "blob",
    "dom",
    "html",
    "image",
    "raw",
    "screenshot",
    "source",
    "trace",
    "video",
}


def _is_sensitive_key(key: Any) -> bool:
    normalized = str(key or "").lower().replace("-", "_").replace(" ", "_")
    return any(marker in normalized for marker in SENSITIVE_KEY_MARKERS)


def _is_heavy_key(key: Any) -> bool:
    normalized = str(key or "").lower().replace("-", "_").replace(" ", "_")
    return any(marker in normalized for marker in HEAVY_KEY_MARKERS)


def _json_size(value: Any) -> int:
    try:
        return len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))
    except (TypeError, ValueError):
        return MAX_AI_REPORT_BYTES + 1


def _sanitize_ai_report_payload(value: Any, *, key: Any = None, depth: int = 0) -> Any:
    if _is_sensitive_key(key):
        return REDACTED_AI_SECRET
    if _is_heavy_key(key):
        return TRUNCATED_AI_VALUE
    if depth > MAX_AI_REPORT_DEPTH:
        return TRUNCATED_AI_VALUE
    if isinstance(value, dict):
        return {
            item_key: _sanitize_ai_report_payload(item, key=item_key, depth=depth + 1)
            for item_key, item in value.items()
        }
    if isinstance(value, list):
        items = value[:MAX_AI_REPORT_LIST_ITEMS]
        sanitized = [_sanitize_ai_report_payload(item, depth=depth + 1) for item in items]
        if len(value) > MAX_AI_REPORT_LIST_ITEMS:
            sanitized.append({"truncated_items": len(value) - MAX_AI_REPORT_LIST_ITEMS})
        return sanitized
    if isinstance(value, str):
        return sanitize_external_error(value, max_len=MAX_AI_REPORT_STRING_LENGTH)
    return value


def sanitize_ai_report_payload(value: Any) -> Any:
    sanitized = _sanitize_ai_report_payload(value)
    if _json_size(sanitized) <= MAX_AI_REPORT_BYTES:
        return sanitized
    if isinstance(sanitized, dict):
        compact = {
            key: sanitized.get(key)
            for key in (
                "status",
                "reason",
                "confidence",
                "consensus",
                "failure_category",
                "human_review_required",
                "error_code",
                "metrics",
                "summary",
            )
            if key in sanitized
        }
        compact["truncated"] = True
        return compact
    return TRUNCATED_AI_VALUE

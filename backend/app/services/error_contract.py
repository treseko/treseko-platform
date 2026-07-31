"""Public, non-sensitive error responses and request correlation helpers."""

import re
import uuid
from contextvars import ContextVar
from typing import Any

from .error_sanitizer import sanitize_external_error


CORRELATION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
_correlation_id: ContextVar[str | None] = ContextVar("treseko_correlation_id", default=None)


def correlation_id_from_headers(headers: Any) -> str:
    """Accept a short opaque ID, otherwise generate one locally."""
    candidate = str(headers.get("x-correlation-id") or headers.get("x-request-id") or "").strip()
    if CORRELATION_ID_RE.fullmatch(candidate):
        return candidate
    return str(uuid.uuid4())


def set_correlation_id(value: str) -> None:
    _correlation_id.set(value)


def current_correlation_id(fallback: str | None = None) -> str:
    return _correlation_id.get() or fallback or str(uuid.uuid4())


def correlation_headers(value: str | None = None) -> dict[str, str]:
    correlation_id = value if value and CORRELATION_ID_RE.fullmatch(value) else current_correlation_id()
    return {"X-Correlation-ID": correlation_id}


def error_code_for_status(status_code: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        408: "REQUEST_TIMEOUT",
        409: "CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
        422: "VALIDATION_ERROR",
        429: "RATE_LIMITED",
        499: "CLIENT_DISCONNECTED",
        502: "UPSTREAM_UNAVAILABLE",
        503: "SERVICE_UNAVAILABLE",
        504: "UPSTREAM_TIMEOUT",
    }.get(status_code, "INTERNAL_SERVER_ERROR" if status_code >= 500 else "REQUEST_ERROR")


def retryable_for_status(status_code: int) -> bool:
    return status_code in {408, 425, 429, 499, 502, 503, 504} or status_code >= 500


def public_error(
    *,
    status_code: int,
    correlation_id: str,
    message: Any,
    error_code: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_correlation_id = correlation_id if CORRELATION_ID_RE.fullmatch(str(correlation_id or "")) else current_correlation_id()
    safe_message = sanitize_external_error(message)

    def sanitize_detail(value: Any, depth: int = 0) -> Any:
        if depth > 3:
            return "[truncated]"
        if isinstance(value, dict):
            return {
                str(key)[:80]: "[redacted]" if re.search(r"token|secret|password|credential|authorization|cookie|api[_-]?key", str(key), re.I)
                else sanitize_detail(item, depth + 1)
                for key, item in list(value.items())[:30]
            }
        if isinstance(value, list):
            return [sanitize_detail(item, depth + 1) for item in value[:30]]
        if isinstance(value, str):
            return sanitize_external_error(value, max_len=280)
        if value is None or isinstance(value, (bool, int, float)):
            return value
        return sanitize_external_error(value, max_len=280)
    return {
        "error": {
            "error_code": error_code or error_code_for_status(status_code),
            "message": safe_message,
            "correlation_id": safe_correlation_id,
            "retryable": retryable_for_status(status_code),
            "details": sanitize_detail(details or {}),
        },
        # Kept deliberately for existing frontend/API consumers during V1.0.1.
        "detail": safe_message,
    }

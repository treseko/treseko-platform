import json
import os
import re
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


TRACE_HEADER_SKIP = "x-test-trace-skip"
TRACE_DIR = Path(__file__).resolve().parents[2] / "logs" / "test-trace"
MAX_TRACE_BODY_BYTES = 64 * 1024
MAX_TRACE_TEXT_CHARS = 64 * 1024
SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "password",
    "passwd",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "x-api-key",
    "x-qa-api-key",
    "x-runner-token",
    "x-pairing-token",
    "private-token",
    "private_token",
    "registration_token",
    "runner_token",
    "pairing_token",
}
SENSITIVE_STRING_RE = re.compile(
    r"(?i)\b("
    r"authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|password|passwd|secret|token|"
    r"x[_-]?qa[_-]?api[_-]?key|x[_-]?runner[_-]?token|x[_-]?pairing[_-]?token|private[_-]?token"
    r")(\s*[:=]\s*)([^&\s,;\"']+)"
)
AUTHORIZATION_HEADER_RE = re.compile(r"(?i)\b(authorization\s*:\s*)(?:(?:bearer|basic|digest)\s+)?[^\r\n,;\"']+")
SECRET_HEADER_RE = re.compile(r"(?i)\b(set-cookie|cookie|x-api-key|private-token)\s*:\s*[^\r\n,]+")
SENSITIVE_QUERY_RE = re.compile(
    r"(?i)([?&])("
    r"authorization|access_token|refresh_token|api_key|apikey|password|secret|token|"
    r"asset_token|x_qa_api_key|x_runner_token|x_pairing_token|private_token|registration_token|runner_token|pairing_token"
    r")=([^&#\s]+)"
)


def _runtime_environment() -> str:
    return (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or os.getenv("ENV") or "development").strip().lower()


def _is_production_environment() -> bool:
    return _runtime_environment() in {"prod", "production"}


def trace_enabled() -> bool:
    if _is_production_environment():
        return False
    return os.getenv("QA_TEST_TRACE_ENABLED", "").lower() in {"1", "true", "yes", "on"}


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return {"binary": True, "bytes": len(value)}
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    return str(value)


def _is_sensitive_key(key: str) -> bool:
    normalized = key.strip().lower().replace("-", "_")
    return normalized in SENSITIVE_KEYS or any(fragment in normalized for fragment in ("password", "secret", "token", "api_key", "apikey"))


def _redact_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        redacted = {}
        for key, item in value.items():
            key_text = str(key)
            redacted[key_text] = "[REDACTED]" if _is_sensitive_key(key_text) else _redact_sensitive(item)
        return redacted
    if isinstance(value, list):
        return [_redact_sensitive(item) for item in value]
    if isinstance(value, str):
        scrubbed = SENSITIVE_QUERY_RE.sub(r"\1\2=[REDACTED]", value)
        scrubbed = AUTHORIZATION_HEADER_RE.sub(r"\1[REDACTED]", scrubbed)
        scrubbed = SECRET_HEADER_RE.sub(lambda match: f"{match.group(1)}: [REDACTED]", scrubbed)
        return SENSITIVE_STRING_RE.sub(r"\1\2[REDACTED]", scrubbed)
    return value


def write_trace(source: str, event: str, payload: dict[str, Any]) -> None:
    if not trace_enabled():
        return
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "event": event,
        **payload,
    }
    path = TRACE_DIR / f"{source}-{day}.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(_redact_sensitive(_json_safe(entry)), ensure_ascii=False) + "\n")


def _content_type(headers: dict[str, str]) -> str:
    return headers.get("content-type", headers.get("Content-Type", ""))


def _body_value(body: bytes, headers: dict[str, str]) -> Any:
    if not body:
        return None
    content_type = _content_type(headers).lower()
    text_types = ("json", "text", "xml", "form", "javascript", "html")
    if any(item in content_type for item in text_types):
        truncated = len(body) > MAX_TRACE_BODY_BYTES
        body_to_decode = body[:MAX_TRACE_BODY_BYTES] if truncated else body
        text = body_to_decode.decode("utf-8", errors="replace")
        if len(text) > MAX_TRACE_TEXT_CHARS:
            text = text[:MAX_TRACE_TEXT_CHARS]
            truncated = True
        if "json" in content_type:
            try:
                parsed = json.loads(text)
                if truncated and isinstance(parsed, dict):
                    return {**parsed, "_trace_truncated": True}
                return parsed
            except json.JSONDecodeError:
                pass
        return {"text": text, "bytes": len(body), "truncated": truncated} if truncated else text
    return {
        "binary": True,
        "bytes": len(body),
        "content_type": content_type,
        "truncated": len(body) > MAX_TRACE_BODY_BYTES,
    }


class TestTraceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not trace_enabled() or request.headers.get(TRACE_HEADER_SKIP) == "1":
            return await call_next(request)

        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        started = perf_counter()
        request_body = await request.body()
        request_headers = dict(request.headers)

        async def receive():
            return {"type": "http.request", "body": request_body, "more_body": False}

        traced_request = Request(request.scope, receive)
        client_ip = request.client.host if request.client else "unknown"
        write_trace("backend", "http_request", {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "url": str(request.url),
            "query": dict(request.query_params),
            "headers": request_headers,
            "client_ip": client_ip,
            "body": _body_value(request_body, request_headers),
        })

        try:
            response = await call_next(traced_request)
            response_body = b""
            async for chunk in response.body_iterator:
                response_body += chunk

            duration_ms = round((perf_counter() - started) * 1000, 2)
            response_headers = dict(response.headers)
            write_trace("backend", "http_response", {
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "url": str(request.url),
                "status": response.status_code,
                "headers": response_headers,
                "body": _body_value(request_body, request_headers),
                "response_body": _body_value(response_body, response_headers),
                "duration_ms": duration_ms,
            })

            return Response(
                content=response_body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
                background=response.background,
            )
        except Exception as exc:
            duration_ms = round((perf_counter() - started) * 1000, 2)
            write_trace("backend", "error", {
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "url": str(request.url),
                "headers": request_headers,
                "body": _body_value(request_body, request_headers),
                "duration_ms": duration_ms,
                "error": {
                    "type": type(exc).__name__,
                    "message": str(exc),
                    "stack": traceback.format_exc(),
                },
            })
            raise

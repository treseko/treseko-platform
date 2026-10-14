"""Credential redaction for MCP without shortening business data or evidence."""
from __future__ import annotations

import json
import re
from typing import Any

_SECRET_KEY = re.compile(r"^(?:password|passwd|secret|token|api[-_]?key|authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|credential|private[-_]?key|client[-_]?secret|access[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?id)$", re.I)
_BEARER = re.compile(r"(\bBearer\s+)[^\s,;\"']+", re.I)
_ASSIGNMENT = re.compile(r"(\b(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)", re.I)


def _reference(value):
    return isinstance(value, str) and re.fullmatch(r"\{\{[A-Za-z_][A-Za-z0-9_.]*\}\}", value.strip()) is not None


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        result = {key: "[REDACTED]" if isinstance(key, str) and _SECRET_KEY.fullmatch(key) and not _reference(item) else redact(item) for key, item in value.items()}
        # Native header rows encode their sensitive key as data, not a dict key.
        if isinstance(value.get("name"), str) and _SECRET_KEY.fullmatch(value["name"]) and "value" in value and not _reference(value["value"]):
            result["value"] = "[REDACTED]"
        return result
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    if isinstance(value, str):
        # Text content may itself carry a JSON object. Redact structurally to
        # preserve its validity and metrics such as token_count.
        if value.lstrip().startswith(("{", "[")):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, (dict, list)):
                    return json.dumps(redact(parsed), ensure_ascii=False, separators=(",", ":"))
            except (ValueError, RecursionError):
                pass
        return _ASSIGNMENT.sub(r"\1[REDACTED]", _BEARER.sub(r"\1[REDACTED]", value))
    return value

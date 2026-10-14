"""Redact historical format evidence without dropping turns or requests."""
from __future__ import annotations

import re
from typing import Any
from .ai_report_sanitizer import SAFE_SENSITIVE_METADATA_KEYS

SENSITIVE = re.compile(r"password|secret|token|authorization|cookie|api.?key|credential", re.I)


def _sensitive(key: str) -> bool:
    return key.lower() not in SAFE_SENSITIVE_METADATA_KEYS and bool(SENSITIVE.search(key))


def redact_history_evidence(value: Any) -> Any:
    secrets: set[str] = set()

    def collect(item: Any, key: str = ""):
        if isinstance(item, dict):
            header = str(item.get("key") or item.get("name") or "")
            for name, child in item.items():
                collect(child, header if name == "value" and SENSITIVE.search(header) else str(name))
        elif isinstance(item, list):
            for child in item:
                collect(child, key)
        elif _sensitive(key) and isinstance(item, str) and len(item) >= 4:
            secrets.add(item)
            if key.lower() in {"authorization", "proxy-authorization"} and " " in item:
                secrets.add(item.split(" ", 1)[1])

    def redact(item: Any, key: str = ""):
        if isinstance(item, dict):
            header = str(item.get("key") or item.get("name") or "")
            return {name: redact(child, header if name == "value" and SENSITIVE.search(header) else str(name)) for name, child in item.items()}
        if isinstance(item, list):
            return [redact(child, key) for child in item]
        if _sensitive(key) and item is not None:
            return "[REDACTED]"
        if isinstance(item, str):
            for secret in sorted(secrets, key=len, reverse=True):
                item = item.replace(secret, "[REDACTED]")
            return re.sub(r"(?i)(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+", r"\1=[REDACTED]", item)
        return item

    collect(value)
    return redact(value)

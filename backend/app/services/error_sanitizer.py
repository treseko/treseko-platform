import re
from typing import Any


def sanitize_external_error(value: Any, max_len: int = 280) -> str:
    text = str(value or "").replace("\x00", "").strip()
    if not text:
        return "Error externo no especificado"
    text = re.sub(
        r"(?i)\b(authorization)\s*:\s*(bearer|basic|digest)\s+[^\s,;]+",
        r"\1: \2 [redacted]",
        text,
    )
    text = re.sub(
        r"(?i)\b(cookie|set-cookie|x-api-key|private-token)\s*[:=]\s*[^\r\n,;]+",
        r"\1=[redacted]",
        text,
    )
    text = re.sub(r"(?i)(token|api[_-]?key|password|secret|client_secret|refresh_token|access_token)\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", text)
    text = re.sub(r"(?i)\b(user(?:name)?|login)\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", text)
    text = re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", "[ip-redacted]", text)
    text = re.sub(r"(?i)\bhost(?:name)?\s*[:=]\s*[^\s,;]+", "host=[redacted]", text)
    text = re.sub(r"(?i)(https?://)([^/\s:]+)(:\d+)?", r"\1[host-redacted]\3", text)
    if len(text) > max_len:
        return f"{text[:max_len].rstrip()}..."
    return text

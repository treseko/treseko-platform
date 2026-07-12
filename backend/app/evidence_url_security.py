from typing import Any
from urllib.parse import parse_qs, urlparse


SENSITIVE_EVIDENCE_QUERY_KEYS = {
    "authorization",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "password",
    "secret",
    "token",
    "asset_token",
    "x_qa_api_key",
    "x_runner_token",
    "x_pairing_token",
    "registration_token",
    "runner_token",
    "pairing_token",
}


def _has_unsafe_query(parsed) -> bool:
    try:
        query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=50)
    except ValueError:
        return True
    normalized_keys = {str(key).strip().lower() for key in query}
    return any(key in SENSITIVE_EVIDENCE_QUERY_KEYS for key in normalized_keys)


def sanitize_evidence_url(value: Any) -> str | None:
    text = str(value or "").strip().replace("\x00", "")
    if not text:
        return None
    if any(char.isspace() for char in text):
        return None
    parsed = urlparse(text)
    if _has_unsafe_query(parsed):
        return None
    if parsed.scheme:
        if parsed.scheme.lower() in {"http", "https"} and parsed.netloc and not parsed.username and not parsed.password:
            return text
        return None
    if text.startswith("/static/") or text.startswith("/api/static/"):
        return text
    return None

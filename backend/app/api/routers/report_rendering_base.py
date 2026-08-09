import os
import re
import csv
import io
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

from ...evidence_url_security import sanitize_evidence_url
from ...main_context import *
from ...services.error_sanitizer import sanitize_external_error


__all__ = [
    "_report_public_url",
    "_flatten_report_cases",
    "_report_badge_class",
    "_render_report_evidence",
    "_render_report_distribution",
    "_render_report_trend",
    "_render_report_cases",
    "_render_report_failed_steps",
    "_render_report_bugs",
    "_report_type_from_payload",
    "_report_common_css",
    "_report_context_html",
    "_render_executive_issues",
    "_render_bug_severity_summary",
    "_render_development_failures",
    "_render_bug_tracking",
    "_render_development_actions",
    "_shared_report_html",
    "_shared_report_csv",
    "_md",
    "_markdown_evidence",
    "_shared_report_markdown",
    "_report_link_url",
]



def _report_public_url(request: Request, value: Optional[str]):
    safe_value = sanitize_evidence_url(value)
    if not safe_value:
        return None
    if safe_value.startswith(("http://", "https://")):
        return safe_value
    return f"{str(request.base_url).rstrip('/')}/{safe_value.lstrip('/')}"


def _report_link_url(value: Any) -> Optional[str]:
    text = str(value or "").strip().replace("\x00", "")
    if not text or any(char.isspace() for char in text) or any(char in text for char in "<>\"'"):
        return None
    parsed = urlparse(text)
    if parsed.scheme:
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
            return None
        if parsed.username or parsed.password:
            return None
        return text
    if text.startswith("/") and not text.startswith("//"):
        return text
    return None

def _flatten_report_cases(nodes: list):
    cases = []
    for node in nodes or []:
        cases.extend(node.get("casos") or [])
        cases.extend(_flatten_report_cases(node.get("children") or []))
    return cases

def _report_badge_class(value: str):
    return {"PASO": "ok", "FALLO": "fail", "BLOQUEADO": "blocked"}.get(str(value or "").upper(), "muted")

def _report_text(value: Any, *, fallback: str = "", max_len: int = 1200) -> str:
    if value is None or str(value).strip() == "":
        return fallback
    return sanitize_external_error(value, max_len=max_len)

def _report_html(value: Any, *, fallback: str = "", max_len: int = 1200) -> str:
    return html.escape(_report_text(value, fallback=fallback, max_len=max_len))

def _report_multiline_html(value: Any, *, fallback: str = "", max_len: int = 1200) -> str:
    text = _report_text(value, fallback=fallback, max_len=max_len)
    if not text:
        return ""
    return "<br/>".join(html.escape(line) for line in text.splitlines())

def _report_steps_html(value: Any, *, fallback: str = "N/D", max_len: int = 2000) -> str:
    text = _report_text(value, fallback="", max_len=max_len)
    if not text:
        return html.escape(fallback)
    text = re.sub(r"\s+", " ", text).strip()
    matches = list(re.finditer(r"(?:(?<=^)|(?<=\s))\d+\.\s+(?!\d)", text))
    steps = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        steps.append(text[start:end].strip())
    if len(steps) <= 1:
        lines = [line.strip() for line in _report_text(value, fallback="", max_len=max_len).splitlines() if line.strip()]
        steps = lines if len(lines) > 1 else steps
    if len(steps) <= 1:
        return f"<div class='report-pre'>{_report_multiline_html(value, fallback=fallback, max_len=max_len)}</div>"
    items = []
    for step in steps:
        cleaned = re.sub(r"^\d+\.\s*", "", step).strip()
        cleaned = re.sub(r"\s+(Datos:|Esperado:|Observacion:|Observación:)", r"<br/><strong>\1</strong>", html.escape(cleaned))
        items.append(f"<li>{cleaned}</li>")
    return f"<ol class='bug-steps'>{''.join(items)}</ol>"

REPORT_RENDER_CLOSED_BUG_STATUSES = {"CERRADO", "RESUELTO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE", "CLOSED", "DONE", "RESOLVED"}

def _report_render_bug_is_active(bug: dict) -> bool:
    return str((bug or {}).get("estado") or "").upper() not in REPORT_RENDER_CLOSED_BUG_STATUSES

def _report_frontend_base_url(request: Request) -> str:
    # Never trust the browser Origin header to build links. An attacker can
    # control it and turn a generated bug link into an external redirect.
    for configured_origin in (os.getenv("FRONTEND_PUBLIC_URL"), os.getenv("NOTIFICATIONS_PUBLIC_BASE_URL")):
        parsed = urlparse((configured_origin or "").strip().rstrip("/"))
        if parsed.scheme.lower() in {"http", "https"} and parsed.netloc:
            return configured_origin.strip().rstrip("/")
    host = request.url.hostname or "localhost"
    if host in {"localhost", "127.0.0.1", "0.0.0.0"}:
        # In local development the API and Vite can use different ports. A
        # relative link lets the browser preserve the origin where the app is
        # actually open instead of guessing a stale/default Vite port.
        return ""
    return str(request.base_url).rstrip("/")

def _report_bug_tracker_url(request: Request, bug: dict) -> Optional[str]:
    bug_id = (bug or {}).get("id")
    if not bug_id:
        return None
    path = f"/?{urlencode({'tab': 'bugs', 'bug_id': str(bug_id)})}"
    base_url = _report_frontend_base_url(request)
    return f"{base_url}{path}" if base_url else path


__all__ = ["_report_public_url","_report_link_url","_flatten_report_cases","_report_badge_class","_report_text","_report_html","_report_multiline_html","_report_steps_html","_report_render_bug_is_active","_report_frontend_base_url","_report_bug_tracker_url"]

from html import escape
import re
from string import Template
from typing import Any


DOTTED_PLACEHOLDER_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\}")
UNSAFE_HTML_PATTERN = re.compile(
    r"(?is)<\s*(script|iframe|object|embed|form|input|button|meta|link|base)\b[^>]*>.*?<\s*/\s*\1\s*>|"
    r"<\s*(script|iframe|object|embed|form|input|button|meta|link|base)\b[^>]*/?\s*>"
)
UNSAFE_HTML_ATTRIBUTE_PATTERN = re.compile(
    r"""(?is)\s(?:on[a-z0-9_-]+|formaction|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)|"""
    r"""\s(?:href|src)\s*=\s*(?:"\s*(?:javascript|data):[^"]*"|'\s*(?:javascript|data):[^']*'|(?:javascript|data):[^\s>]+)"""
)


def _flatten_context(context: dict[str, Any] | None, prefix: str = "") -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in (context or {}).items():
        full_key = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            result.update(_flatten_context(value, full_key))
        else:
            result[full_key] = "" if value is None else str(value)
    return result


def _replace_dotted_placeholders(template: str, flat: dict[str, str]) -> str:
    return DOTTED_PLACEHOLDER_RE.sub(lambda match: flat.get(match.group(1), match.group(0)), template)


def render_text_template(template: str | None, context: dict[str, Any] | None) -> str:
    flat = _flatten_context(context)
    prepared = _replace_dotted_placeholders(template or "", flat)
    return Template(prepared).safe_substitute(flat)


def render_html_template(template: str | None, context: dict[str, Any] | None) -> str:
    flat = {key: escape(value) for key, value in _flatten_context(context).items()}
    prepared = _replace_dotted_placeholders(template or "", flat)
    rendered = Template(prepared).safe_substitute(flat)
    rendered = UNSAFE_HTML_PATTERN.sub("", rendered)
    return UNSAFE_HTML_ATTRIBUTE_PATTERN.sub("", rendered)

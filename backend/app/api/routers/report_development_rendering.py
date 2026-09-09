"""Presentation helpers for the exception-focused development report.

The report data service owns classification.  This module only adapts its
versioned result (and old snapshots) to the HTML/CSV renderers.  In
particular, it never rewrites evidence or the identifiers stored in a
snapshot; technical identifiers are omitted only from human-facing context.
"""

from __future__ import annotations

import json
from uuid import UUID
from typing import Any, Iterable

from ...services.development_report import development_report_sections


DEVELOPMENT_CATEGORIES = (
    "new_bugs",
    "historical_bugs",
    "corrected_bugs",
    "unclassified_bugs",
    "failures_without_bug",
)


def _as_list(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _bug_key(item: dict, fallback: str = "") -> str:
    # IDs are used only to deduplicate in memory and are never rendered.
    return str(item.get("id") or item.get("codigo") or item.get("bug_code") or fallback)


def _unique(items: Iterable[dict], *, seen: set[str] | None = None) -> list[dict]:
    result = []
    used = seen if seen is not None else set()
    for index, item in enumerate(items):
        key = _bug_key(item, f"anonymous:{index}")
        if key in used:
            continue
        used.add(key)
        result.append(item)
    return result


def development_sections_for_rendering(payload: dict) -> dict[str, list[dict]]:
    """Return the five stable presentation categories for any snapshot age."""
    values = {
        key: _as_list(development_report_sections(payload).get(key))
        for key in DEVELOPMENT_CATEGORIES
    }

    # Ensure pending categories are disjoint. Corrections are a result balance
    # and are intentionally independent of pending-category membership.
    seen: set[str] = set()
    return {
        # Corrections are a result balance and may legitimately refer to a
        # bug that is also listed as new or historical.
        "corrected_bugs": _unique(values["corrected_bugs"]),
        "new_bugs": _unique(values["new_bugs"], seen=seen),
        "historical_bugs": _unique(values["historical_bugs"], seen=seen),
        "unclassified_bugs": _unique(values["unclassified_bugs"], seen=seen),
        "failures_without_bug": values["failures_without_bug"],
    }


def development_category_bugs(payload: dict) -> dict[str, list[dict]]:
    """Alias kept small and explicit for callers in HTML and CSV renderers."""
    return development_sections_for_rendering(payload)


def development_unique_bugs(*groups: Iterable[dict]) -> list[dict]:
    """Deduplicate technical fichas without changing category membership."""
    seen: set[str] = set()
    result: list[dict] = []
    for group in groups:
        result.extend(_unique(group, seen=seen))
    return result


def development_section_enabled(payload: dict, section: str) -> bool:
    """Read both the coordinated flat flag and the existing nested setting."""
    settings = payload.get("report_settings") if isinstance(payload.get("report_settings"), dict) else {}
    development = settings.get("development") if isinstance(settings.get("development"), dict) else {}
    if isinstance(development.get(section), bool):
        return development[section]
    sections = development.get("sections") if isinstance(development.get("sections"), dict) else {}
    return sections.get(section) is not False


def development_bug_code(bug: dict) -> str:
    return str(bug.get("codigo") or bug.get("bug_code") or "BUG no registrado")


def development_case_code(bug: dict) -> str:
    return str(bug.get("case_code") or bug.get("case_codigo") or "TC no registrado")


def development_build_name(bug: dict, *, corrected: bool = False) -> str:
    if corrected:
        value = bug.get("current_build_verification") or bug.get("build_corregido")
    else:
        value = bug.get("origin_build_name") or bug.get("build_detectado") or bug.get("build_name") or bug.get("build_code")
    if isinstance(value, dict):
        value = value.get("build_name") or value.get("name") or value.get("label")
    text = str(value or "").strip()
    try:
        UUID(text)
    except (ValueError, AttributeError):
        return text or "No registrado"
    return "No registrado"


def development_current_build_verification(bug: dict) -> str:
    value = bug.get("current_build_verification")
    if isinstance(value, dict):
        if value.get("build_name") or value.get("name"):
            return str(value.get("build_name") or value.get("name"))
        if value.get("verified") is True:
            return "Verificada"
        if value.get("verified") is False:
            return "No verificada"
        value = value.get("status") or value.get("result") or value.get("label")
    return str(value or "Pendiente de verificar")


def development_responsible_name(bug: dict) -> str:
    value = (
        bug.get("responsible_display")
        or bug.get("responsable_display")
        or bug.get("responsable")
        or bug.get("assignee_name")
    )
    text = str(value or "").strip()
    try:
        UUID(text)
    except (ValueError, AttributeError):
        return text or "No registrado"
    return "No registrado"


_CONTEXT_INTERNAL_ID_KEYS = {
    "build_id", "caso_id", "case_id", "component_id", "componente_id",
    "dataset_id", "ejecucion_id", "environment_id", "entorno_id",
    "execution_id", "project_id", "proyecto_id", "report_id", "run_id",
    "session_id", "snapshot_id", "test_run_id", "bug_id",
}
_HTTP_EVIDENCE_KEYS = {
    "request", "response", "request_body", "response_body",
    "request_headers", "response_headers",
}


def context_json_without_internal_ids(value: Any) -> str:
    """Serialize contextual JSON after dropping only known internal ID keys."""
    def clean(item: Any) -> Any:
        if isinstance(item, dict):
            cleaned = {}
            for key, child in item.items():
                normalized = str(key).strip().lower().replace("-", "_")
                if normalized in _HTTP_EVIDENCE_KEYS:
                    cleaned[key] = child
                elif normalized not in _CONTEXT_INTERNAL_ID_KEYS:
                    cleaned[key] = clean(child)
            return cleaned
        if isinstance(item, list):
            return [clean(child) for child in item]
        if isinstance(item, tuple):
            return [clean(child) for child in item]
        return item

    try:
        return json.dumps(clean(value), ensure_ascii=False, indent=2, default=str)
    except (TypeError, ValueError):
        return str(value or "")


__all__ = [
    "DEVELOPMENT_CATEGORIES",
    "development_sections_for_rendering",
    "development_category_bugs",
    "development_unique_bugs",
    "development_section_enabled",
    "development_bug_code",
    "development_case_code",
    "development_build_name",
    "development_current_build_verification",
    "development_responsible_name",
    "context_json_without_internal_ids",
]

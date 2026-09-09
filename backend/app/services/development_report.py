"""Pure classification of the exception-focused development report.

The service works on a payload already frozen by the repository.  It only
copies and classifies dictionaries; it never edits the supplied snapshot,
reconstructs evidence, or uses a case/title as a bug identity.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

SECTION_NAMES = (
    "new_bugs",
    "historical_bugs",
    "corrected_bugs",
    "unclassified_bugs",
    "failures_without_bug",
)


OPEN_BUG_STATES = {
    "ABIERTO",
    "TRIAGE",
    "ASIGNADO",
    "EN_PROGRESO",
    "LISTO_PARA_RETEST",
    "EN_RETEST",
    "REABIERTO",
    "BLOQUEADO",
}
CLOSED_BUG_STATES = {
    "CERRADO",
    "RESUELTO",
    "DUPLICADO",
    "NO_REPRODUCIBLE",
    "NO_CORRESPONDE",
    "CLOSED",
    "DONE",
    "RESOLVED",
}
CORRECTED_BUG_STATES = {"RESUELTO", "CERRADO"}


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    return [deepcopy(item) for item in value if isinstance(item, dict)]


def _first_value(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return None


def _text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def _iso_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = _text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _metadata(item: dict[str, Any]) -> dict[str, Any]:
    return _as_dict(item.get("metadata_json") or item.get("metadata"))


def _execution_context(item: dict[str, Any]) -> dict[str, Any]:
    api_context = _as_dict(item.get("api_context"))
    return _as_dict(
        item.get("execution_snapshot")
        or api_context.get("execution_snapshot")
        or _as_dict(_metadata(item).get("execution_snapshot"))
    )


def _build_context(item: dict[str, Any]) -> dict[str, Any]:
    metadata = _metadata(item)
    execution = _execution_context(item)
    api_context = _as_dict(item.get("api_context"))
    return _as_dict(
        item.get("build_metadata")
        or execution.get("build_metadata")
        or _as_dict(api_context.get("build_metadata"))
        or _as_dict(metadata.get("build_metadata"))
    )


def _with_readable_context(item: dict[str, Any]) -> dict[str, Any]:
    """Preserve nested API context while filling only missing display labels."""
    result = deepcopy(item)
    metadata = _metadata(result)
    execution = _execution_context(result)
    build = _build_context(result)
    if not result.get("origin_build_name"):
        result["origin_build_name"] = _first_value(
            result.get("build_name"),
            result.get("build_detectado"),
            execution.get("build_name"),
            build.get("build_name"),
            build.get("name"),
            metadata.get("build_name"),
        )
    if not result.get("environment_name"):
        result["environment_name"] = _first_value(
            result.get("ambiente_nombre"),
            execution.get("environment_name"),
            execution.get("ambiente_nombre"),
            metadata.get("environment_name"),
        )
    if not result.get("dataset_name"):
        result["dataset_name"] = _first_value(
            execution.get("dataset_name"),
            metadata.get("dataset_name"),
        )
    if not result.get("responsable"):
        result["responsable"] = _first_value(
            result.get("responsible_display"),
            result.get("responsable"),
            metadata.get("responsible_display"),
            metadata.get("responsable"),
            metadata.get("assignee_name"),
        )
    return result


def _current_build_id(payload: dict[str, Any]) -> str:
    metadata = _as_dict(payload.get("metadata"))
    metrics = _as_dict(payload.get("metrics"))
    return _text(_first_value(metadata.get("snapshot_created_for_build"), metrics.get("build_id")))


def _origin_build_id(item: dict[str, Any]) -> str:
    metadata = _metadata(item)
    execution = _execution_context(item)
    build = _build_context(item)
    return _text(_first_value(
        item.get("build_id"),
        item.get("origin_build_id"),
        execution.get("build_id"),
        build.get("build_id"),
        metadata.get("build_id"),
    ))


def _resolved_build_id(item: dict[str, Any]) -> str:
    metadata = _metadata(item)
    return _text(_first_value(
        item.get("resolved_build_id"),
        item.get("build_corregido_id"),
        item.get("resolution_build_id"),
        metadata.get("resolved_build_id"),
        metadata.get("resolution_build_id"),
    ))


def _bug_status(item: dict[str, Any]) -> str:
    return _text(item.get("estado") or item.get("status")).upper()


def _is_open(item: dict[str, Any]) -> bool:
    status = _bug_status(item)
    if status in CLOSED_BUG_STATES:
        return False
    return bool(status) and status not in {"SIN_ESTADO", "UNKNOWN", "N/D"}


def _occurrences(item: dict[str, Any]) -> list[dict[str, Any]]:
    metadata = _metadata(item)
    return [
        occurrence
        for occurrence in (
            item.get("linked_execution_occurrences")
            or metadata.get("linked_execution_occurrences")
            or item.get("occurrences")
            or []
        )
        if isinstance(occurrence, dict)
    ]


def _was_reproduced_in_current_build(item: dict[str, Any], current_build_id: str) -> bool:
    if not current_build_id:
        return False
    return any(
        _text(occurrence.get("build_id")) == current_build_id
        and _text(occurrence.get("ejecucion_id") or occurrence.get("execution_id"))
        and _text(occurrence.get("status")).upper() in {"FALLO", "FALL0", "BLOQUEADO", "FAILED", "BLOCKED"}
        for occurrence in _occurrences(item)
    )


def _history_entries(payload: dict[str, Any]) -> list[dict[str, Any]]:
    metrics = _as_dict(payload.get("metrics"))
    entries = metrics.get("historico_versions")
    return [item for item in entries if isinstance(item, dict)] if isinstance(entries, list) else []


def _build_relation(
    payload: dict[str, Any],
    origin_id: str,
    current_id: str,
    bug: dict[str, Any] | None = None,
) -> str:
    """Return older, later, or unknown without deriving age from UUIDs."""
    if not current_id or not origin_id or origin_id == current_id:
        return "current" if origin_id and origin_id == current_id else "unknown"
    history = _history_entries(payload)
    current_entry = next((item for item in history if _text(item.get("build_id")) == current_id), None)
    origin_entry = next((item for item in history if _text(item.get("build_id")) == origin_id), None)
    current_metadata = _as_dict(payload.get("metadata"))
    if current_entry is None:
        current_entry = current_metadata
    bug = bug or {}
    origin_entry = origin_entry or {}
    current_date = _iso_datetime(_first_value(
        current_entry.get("fecha"), current_entry.get("created_at"), current_entry.get("build_created_at"),
        current_metadata.get("build_created_at"),
    ))
    origin_date = _iso_datetime(_first_value(
        origin_entry.get("fecha"), origin_entry.get("created_at"), origin_entry.get("build_created_at"),
        bug.get("origin_build_created_at"), bug.get("origin_build_started_at"),
    ))
    if current_date and origin_date and origin_date != current_date:
        return "later" if origin_date > current_date else "older"
    # Do not infer chronology from list position when the snapshot lacks
    # comparable dates.  A UUID or an incidental response order is not age
    # evidence; an open bug stays honestly unclassified instead.
    return "unknown"


def _verification_label(item: dict[str, Any], current_build_id: str, relation: str) -> str:
    if relation == "later":
        return "Fuera de alcance: build posterior a la seleccionada"
    if relation == "current":
        return "Detectado en esta versión"
    if relation != "older":
        return "No verificado en la build actual"
    return (
        "Reproducido en la build actual"
        if _was_reproduced_in_current_build(item, current_build_id)
        else "Pendiente de verificar en la build actual"
    )


def _classify_fallback(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    development = _as_dict(payload.get("development"))
    source = development.get("bugs") if isinstance(development.get("bugs"), list) else None
    if not source:
        source = payload.get("bugs")
    bugs = [_with_readable_context(item) for item in _as_items(source)]
    current_id = _current_build_id(payload)
    sections = {name: [] for name in SECTION_NAMES}
    for bug in bugs:
        origin_id = _origin_build_id(bug)
        relation = _build_relation(payload, origin_id, current_id, bug)
        bug["reproduced_current_build"] = _was_reproduced_in_current_build(bug, current_id)
        bug["current_build_verification"] = _verification_label(bug, current_id, relation)

        corrected = bool(
            _bug_status(bug) in CORRECTED_BUG_STATES
            and current_id
            and _resolved_build_id(bug) == current_id
        )
        if relation == "current":
            # A bug found and resolved in this build remains a new bug. The
            # correction section is a result balance and may overlap it.
            bug["classification"] = "new"
            sections["new_bugs"].append(deepcopy(bug))
        elif relation == "older" and _is_open(bug):
            bug["classification"] = "historical"
            sections["historical_bugs"].append(deepcopy(bug))
        elif relation == "older" and not _is_open(bug):
            # Historical closed records are not current development work.
            # A verified correction is the sole exception and is reported
            # below as a result balance.
            pass
        elif relation == "later":
            # A later-build bug is outside the selected build's scope.
            pass
        elif _is_open(bug):
            bug["classification"] = "unknown"
            bug["classification_note"] = "No hay evidencia suficiente para ubicar el origen respecto de la build seleccionada."
            sections["unclassified_bugs"].append(deepcopy(bug))

        if corrected and relation != "later":
            corrected_bug = deepcopy(bug)
            corrected_bug["current_build_verification"] = "Corrección verificada en esta versión"
            sections["corrected_bugs"].append(corrected_bug)

    failures = development.get("failures_without_bug")
    if not isinstance(failures, list):
        failures = payload.get("failures_and_blockers")
    if not isinstance(failures, list):
        failures = development.get("failures")
    sections["failures_without_bug"] = [
        deepcopy(item)
        for item in _as_items(failures)
        if _failure_without_bug(item)
    ]
    return sections


def _failure_without_bug(item: dict[str, Any]) -> bool:
    flags = _as_dict(item.get("flags"))
    if flags.get("sin_bug_asociado") is True or item.get("sin_bug_asociado") is True:
        return True
    linked = item.get("bug") or item.get("bugs") or item.get("bug_id")
    if isinstance(linked, list):
        return not any(isinstance(value, dict) and (value.get("id") or value.get("codigo")) for value in linked)
    return not bool(linked)


def development_report_sections(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Return stable development categories without mutating ``payload``."""
    source = payload if isinstance(payload, dict) else {}
    fallback = _classify_fallback(source)
    development = _as_dict(source.get("development"))
    result: dict[str, list[dict[str, Any]]] = {}
    for name in SECTION_NAMES:
        persisted = development.get(name) if name in development else source.get(name)
        result[name] = _as_items(persisted) if isinstance(persisted, list) else fallback[name]
    return result


def development_sections_for_payload(
    metadata: dict[str, Any],
    metrics: dict[str, Any],
    bugs: list[dict[str, Any]],
    development_bugs: list[dict[str, Any]],
    failures: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Build the persisted section arrays without mutating report inputs."""
    return development_report_sections({
        "metadata": metadata,
        "metrics": metrics,
        "bugs": bugs,
        "development": {"bugs": development_bugs},
        "failures_and_blockers": failures,
    })


__all__ = ["development_report_sections"]

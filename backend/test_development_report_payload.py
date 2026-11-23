from __future__ import annotations

import asyncio
import copy
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.repositories import report_bug_loading
from app.services.development_report import development_report_sections


def _bug(code: str, build_id: str | None, status: str = "ABIERTO", **extra):
    return {"id": code, "codigo": code, "build_id": build_id, "estado": status, **extra}


def test_development_sections_keep_current_results_and_exclude_old_closed_and_later():
    payload = {
        "metadata": {"snapshot_created_for_build": "build-current"},
        "metrics": {
            "historico_versions": [
                {"build_id": "build-current", "fecha": "2026-09-05T10:00:00+00:00"},
                {"build_id": "build-old", "fecha": "2026-09-04T10:00:00"},
                {"build_id": "build-later", "fecha": "2026-09-06T10:00:00Z"},
            ]
        },
        "development": {
            "bugs": [
                _bug("new-open", "build-current"),
                _bug("new-fixed", "build-current", "RESUELTO", resolved_build_id="build-current"),
                _bug(
                    "old-reproduced", "build-old", linked_execution_occurrences=[
                        {"build_id": "build-current", "ejecucion_id": "execution-1", "status": "FALLO"},
                    ],
                ),
                _bug("old-pending", "build-old"),
                _bug("old-closed", "build-old", "CERRADO"),
                _bug("later-open", "build-later"),
                _bug("unknown-open", None),
            ]
        },
        "failures_and_blockers": [{"id": "failure-1", "flags": {"sin_bug_asociado": True}}],
    }

    sections = development_report_sections(payload)
    codes = lambda name: {item.get("codigo") or item.get("id") for item in sections[name]}

    assert codes("new_bugs") == {"new-open", "new-fixed"}
    assert codes("historical_bugs") == {"old-reproduced", "old-pending"}
    assert codes("corrected_bugs") == {"new-fixed"}
    assert next(item for item in sections["new_bugs"] if item["codigo"] == "new-fixed")["current_build_verification"] == "Detectado en esta versión"
    assert next(item for item in sections["corrected_bugs"] if item["codigo"] == "new-fixed")["current_build_verification"] == "Corrección verificada en esta versión"
    assert codes("unclassified_bugs") == {"unknown-open"}
    assert codes("failures_without_bug") == {"failure-1"}
    all_reported = set().union(*(codes(name) for name in sections))
    assert "old-closed" not in all_reported
    assert "later-open" not in all_reported
    assert codes("new_bugs").isdisjoint(codes("historical_bugs"))
    assert next(item for item in sections["historical_bugs"] if item["codigo"] == "old-reproduced")["current_build_verification"] == "Reproducido en la build actual"
    assert next(item for item in sections["historical_bugs"] if item["codigo"] == "old-pending")["current_build_verification"] == "Pendiente de verificar en la build actual"


def test_development_sections_use_origin_date_beyond_history_window_and_normalize_dates():
    payload = {
        "metadata": {
            "snapshot_created_for_build": "build-current",
            "build_created_at": "2026-09-05T10:00:00+00:00",
        },
        "metrics": {"historico_versions": [{"build_id": "build-current", "fecha": datetime(2026, 9, 5, 10)}]},
        "development": {
            "bugs": [
                _bug("old-outside-window", "build-old", origin_build_created_at="2026-09-04T10:00:00"),
                _bug("later-outside-window", "build-later", origin_build_created_at="2026-09-06T10:00:00+00:00"),
            ]
        },
    }

    sections = development_report_sections(payload)
    assert {item["codigo"] for item in sections["historical_bugs"]} == {"old-outside-window"}
    assert all(item["codigo"] != "later-outside-window" for items in sections.values() for item in items)


def test_development_sections_preserve_persisted_arrays_without_mutating_snapshot():
    payload = {
        "metadata": {"snapshot_created_for_build": "build-current"},
        "development": {
            "new_bugs": [{"codigo": "persisted-new", "detalle": {"v": 1}}],
            "historical_bugs": [],
            "corrected_bugs": [{"codigo": "persisted-correction"}],
            "unclassified_bugs": [],
            "failures_without_bug": [{"codigo": "persisted-failure"}],
            "bugs": [{"codigo": "fallback-only", "build_id": "build-current", "estado": "ABIERTO"}],
        },
        "bugs": [{"codigo": "must-not-be-used", "build_id": "build-current", "estado": "ABIERTO"}],
    }
    original = copy.deepcopy(payload)

    sections = development_report_sections(payload)

    assert sections["new_bugs"] == [{"codigo": "persisted-new", "detalle": {"v": 1}}]
    assert sections["corrected_bugs"] == [{"codigo": "persisted-correction"}]
    assert sections["failures_without_bug"] == [{"codigo": "persisted-failure"}]
    assert payload == original


def test_list_all_project_bugs_reads_every_page_of_fifty(monkeypatch):
    items = [SimpleNamespace(id=f"bug-{index}") for index in range(101)]
    calls = []

    async def fake_list(_db, _project_id, **filters):
        calls.append((filters["skip"], filters["limit"]))
        start = filters["skip"]
        return {"items": items[start : start + filters["limit"]], "total": len(items)}

    monkeypatch.setattr(report_bug_loading, "list_project_bugs", fake_list)
    loaded = asyncio.run(report_bug_loading.list_all_project_bugs(object(), "project"))

    assert len(loaded) == 101
    assert calls == [(0, 50), (50, 50), (100, 50)]


class _BatchResult:
    def __init__(self, values=(), rows=()):
        self._values = list(values)
        self._rows = list(rows)

    def scalars(self):
        return SimpleNamespace(all=lambda: self._values)

    def all(self):
        return self._rows


class _BatchDb:
    async def execute(self, statement):
        sql = str(statement)
        if "usuarios" in sql:
            return _BatchResult(values=[SimpleNamespace(id="user-1", display_name="Ana QA", nombre_completo=None, email="ana@example.test")])
        if "entorno_datasets" in sql:
            return _BatchResult(rows=[("dataset-1", "Dataset Dev", "Staging")])
        return _BatchResult(rows=[("environment-1", "Staging")])


def test_batch_labels_freeze_assignee_dataset_environment_and_build_dates():
    build = SimpleNamespace(
        nombre="Build 42", codigo="B42",
        fecha_creacion=datetime(2026, 9, 4, 10, tzinfo=timezone.utc),
        fecha_inicio=None, fecha_fin=None,
    )
    bug = SimpleNamespace(
        id="bug-1", asignado_a="user-1", dataset_id="dataset-1", entorno_id="environment-1",
        build=build, resolved_build=None,
    )
    snapshot = {"id": "bug-1", "build_id": "build-42", "dataset_name": None}

    labels = asyncio.run(report_bug_loading.load_and_freeze_development_bug_labels(
        _BatchDb(), [snapshot], [bug], "project-1",
    ))

    assert labels[0]["origin_build_name"] == "Build 42"
    assert labels[0]["responsable"] == "Ana QA"
    assert labels[0]["dataset_name"] == "Dataset Dev"
    assert labels[0]["environment_name"] == "Staging"
    assert labels[0]["origin_build_created_at"].startswith("2026-09-04T10:00:00")
    assert snapshot == {"id": "bug-1", "build_id": "build-42", "dataset_name": None}

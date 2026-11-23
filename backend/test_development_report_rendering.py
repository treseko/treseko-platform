from __future__ import annotations

import importlib
import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

try:
    importlib.import_module("app.services.development_report")
except ModuleNotFoundError as exc:
    if exc.name != "app.services.development_report":
        raise
    service_stub = types.ModuleType("app.services.development_report")
    service_stub.development_report_sections = lambda _payload: {}
    sys.modules[service_stub.__name__] = service_stub

from app.api.routers import report_rendering  # noqa: E402
from app.api.routers import report_development_rendering  # noqa: E402
from app.api.routers import report_rendering_metrics  # noqa: E402
from app.api.routers import report_rendering_html  # noqa: E402


class FakeUrl:
    path = "/s/report-token"

    def __str__(self):
        return "https://qa.example.test/s/report-token"


class FakeRequest:
    url = FakeUrl()
    base_url = "https://qa.example.test/"

    def url_for(self, route_name: str, **params):
        return f"{self.base_url}{route_name}/{params.get('token', 'token')}"


def _snapshot(payload):
    return SimpleNamespace(
        title="Informe de desarrollo",
        description="Snapshot QA",
        token="report-token",
        created_at="2026-09-05T12:00:00+00:00",
        metrics_hash="hash",
        payload=payload,
    )


def _payload(*, flags=None):
    flags = flags or {
        "summary": True,
        "failures": True,
        "bugs": True,
        "bug_tracking": True,
        "bug_details": True,
        "corrected_bugs": True,
        "regressions": True,
        "actions": False,
    }
    return {
        "metadata": {"report_type": "development", "build": "Build actual"},
        "report_settings": {"development": {"sections": flags}},
        "metrics": {
            "build_id": "build-current-id",
            "build_name": "Build actual",
            "total_casos_asignados": 6,
            "total_ejecutados": 4,
            "stats": {"pasados": 1, "fallados": 1, "bloqueados": 1, "pendientes": 3},
            "bug_metrics": {},
            "por_suite_tree": [{"casos": [{"codigo": "TC-PASS", "estado": "PASO"}]}],
        },
        "qa_summary": {"decision": "APROBADA_CON_OBSERVACIONES", "risk": "Medio", "recommend_release": False},
        "development": {"cases": [], "failures": [], "regressions": {"persistent_bugs": []}},
        "failures_and_blockers": [],
    }


def _category_payload():
    new_bug = {
        "id": "new-id",
        "codigo": "BUG-NEW",
        "titulo": "Falla nueva",
        "case_code": "TC-NEW",
        "estado": "RESUELTO",
        "severidad": "ALTA",
        "origin_build_name": "Build actual",
        "current_build_verification": "Verificada en Build actual",
    }
    historical_bug = {
        "id": "historical-id",
        "codigo": "BUG-HIST",
        "titulo": "Falla histórica",
        "case_code": "TC-HIST",
        "estado": "ABIERTO",
        "severidad": "MEDIA",
        "origin_build_name": "Build anterior",
        "current_build_verification": "Pendiente de verificar",
    }
    corrected_bug = {**new_bug, "current_build_verification": "Verificada en Build actual"}
    unclassified_bug = {
        "id": "unknown-id",
        "codigo": "BUG-UNKNOWN",
        "titulo": "Falla sin clasificación",
        "case_code": "TC-UNKNOWN",
        "estado": "ABIERTO",
        "origin_build_name": None,
    }
    return {
        "new_bugs": [new_bug],
        "historical_bugs": [historical_bug],
        "corrected_bugs": [corrected_bug],
        "unclassified_bugs": [unclassified_bug],
        "failures_without_bug": [{
            "case_code": "TC-ORPHAN",
            "case_title": "Falla sin bug",
            "estado": "FALLO",
            "expected": "Resultado esperado",
            "obtained": "Resultado obtenido",
            "recommendation": "Reproducir y asociar bug",
        }],
    }


def test_development_html_uses_categories_without_regression_duplicate(monkeypatch):
    monkeypatch.setattr(report_development_rendering, "development_report_sections", lambda _payload: _category_payload())
    rendered = report_rendering._shared_report_html(_snapshot(_payload()), FakeRequest())

    assert "Pruebas asignadas" in rendered
    assert "Pruebas ejecutadas" in rendered
    assert "Decisión QA" in rendered
    assert "Aprobada con observaciones" in rendered
    assert "Bugs nuevos detectados" in rendered
    assert "Históricos pendientes y reincidencias" in rendered
    assert "Correcciones verificadas" in rendered
    assert "Regresiones y reincidencias" not in rendered
    assert "BUG-NEW" in rendered and "BUG-HIST" in rendered and "BUG-UNKNOWN" in rendered
    assert rendered.count("<h3>BUG-NEW") == 1
    assert "Excepciones sin bug abierto" in rendered
    assert "TC-PASS" not in rendered


def test_executive_html_keeps_quality_summary_without_operational_bug_fiches():
    payload = _payload()
    payload["metadata"]["report_type"] = "executive"
    payload["report_settings"] = {
        "executive": {
            "sections": {
                "summary": True,
                "kpis": True,
                "risks": True,
                "trend": True,
                "findings": True,
            }
        }
    }
    payload["bugs"] = [{
        "codigo": "BUG-EXEC-1",
        "titulo": "Detalle operativo que no debe publicarse al ejecutivo",
        "estado": "ABIERTO",
        "severidad": "ALTA",
        "descripcion": "Descripción técnica interna",
    }]

    rendered = report_rendering._shared_report_html(_snapshot(payload), FakeRequest())

    assert "Riesgos principales" in rendered
    assert "ALTA" in rendered
    assert "Incidentes relevantes para reproducir" not in rendered
    assert "Detalle operativo que no debe publicarse al ejecutivo" not in rendered
    assert "Descripción técnica interna" not in rendered


def test_development_flags_do_not_leak_disabled_bug_category_into_details(monkeypatch):
    monkeypatch.setattr(report_development_rendering, "development_report_sections", lambda _payload: _category_payload())
    flags = {
        "summary": True,
        "failures": False,
        "bugs": False,
        "bug_tracking": True,
        "bug_details": True,
        "corrected_bugs": False,
        "regressions": True,
        "actions": False,
    }
    rendered = report_rendering._shared_report_html(_snapshot(_payload(flags=flags)), FakeRequest())

    assert "BUG-NEW" not in rendered
    assert "BUG-UNKNOWN" not in rendered
    assert "BUG-HIST" in rendered
    assert "Correcciones verificadas" not in rendered
    assert "Regresiones y reincidencias" not in rendered


def test_development_failures_and_bug_details_are_collapsed_by_default(monkeypatch):
    categories = _category_payload()
    categories["failures_without_bug"] = [
        {
            "case_code": f"TC-ORPHAN-{index}",
            "case_title": "Falla sin bug",
            "estado": "FALLO",
            "expected": "Resultado esperado",
            "obtained": "Resultado obtenido",
        }
        for index in range(570)
    ]
    monkeypatch.setattr(report_development_rendering, "development_report_sections", lambda _payload: categories)

    failures = report_rendering_metrics._render_development_failures(
        FakeRequest(), _payload(), only_without_bug=True, categories=categories
    )
    details = report_rendering_metrics._render_development_bug_details(
        FakeRequest(), categories["new_bugs"]
    )

    assert "Excepciones sin bug abierto: 570" in failures
    assert "Pendientes de investigar por QA" in failures
    assert "<details><summary>Ver detalle de 570 excepciones</summary>" in failures
    assert "class='report-table-wrap'" in failures
    assert "class='report-failures-table'" in failures
    assert "overflow-wrap:anywhere" in report_rendering_metrics._report_common_css()
    assert " open" not in failures
    assert "<details open><summary>Ver fichas técnicas (1)</summary>" in details
    assert "Fichas técnicas disponibles: 1" in details


def test_development_csv_has_scope_without_case_inventory(monkeypatch):
    monkeypatch.setattr(report_development_rendering, "development_report_sections", lambda _payload: _category_payload())
    rendered = report_rendering._shared_report_csv(_snapshot(_payload()))

    assert "Bugs nuevos" in rendered
    assert "Históricos pendientes" in rendered
    assert "Correcciones verificadas" in rendered
    assert "TC-PASS" not in rendered
    assert "execution_id" not in rendered
    assert "run_id" not in rendered
    assert "new-id" not in rendered


def test_reproduction_context_omits_internal_ids_but_keeps_environment_url():
    bug = {
        "codigo": "BUG-CONTEXT",
        "case_code": "TC-CONTEXT",
        "case_snapshot": {"code": "TC-CONTEXT", "title": "Caso"},
        "execution_snapshot": {
            "build_id": "build-uuid",
            "execution_id": "execution-uuid",
            "run_id": "run-uuid",
            "environment_id": "environment-uuid",
            "environment_name": "QA",
            "environment_url": "https://chat.example.test",
            "dataset_id": "dataset-uuid",
            "dataset_name": "Fixture",
        },
    }
    rendered = report_rendering_metrics._render_common_bug_context(bug)

    assert "https://chat.example.test" in rendered
    assert "execution-uuid" not in rendered
    assert "run-uuid" not in rendered
    assert "environment-uuid" not in rendered
    assert "ID del ambiente" not in rendered
    assert "Ejecución" not in rendered
    assert "Run" not in rendered


def test_reproduction_context_separates_platform_version_from_origin_build():
    bug = {
        "case_code": "TC-025",
        "version_app": "V1.0.0",
        "platform_version": "1.0.3",
    }

    rendered = report_rendering_metrics._render_common_bug_context(bug)

    assert "Build de origen" in rendered
    assert "V1.0.0" in rendered
    assert "Versión de Treseko" in rendered
    assert "1.0.3" in rendered
    assert "Versión de la aplicación" not in rendered


def test_legacy_snapshot_gets_platform_version_without_mutating_payload():
    payload = {
        "metadata": {"app_version": "1.0.3"},
        "bugs": [{"codigo": "BUG-1", "version_app": "V1.0.0"}],
        "development": {"bugs": [{"codigo": "BUG-1", "version_app": "V1.0.0"}]},
    }

    report_rendering_html._annotate_report_platform_version(payload, "1.0.3")

    assert payload["bugs"][0]["platform_version"] == "1.0.3"
    assert payload["development"]["bugs"][0]["platform_version"] == "1.0.3"


def test_missing_qa_evaluation_is_explicit_and_not_rejected():
    rendered = report_rendering_metrics._render_qa_decision({})

    assert "Sin evaluación registrada" in rendered
    assert "Pendiente de evaluación QA." in rendered
    assert "No hay un dictamen QA persistido" in rendered

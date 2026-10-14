"""Regression matrix for the minimum-intervention analysis gate.

The test intentionally avoids a real LLM: model output is non-deterministic.
It verifies the backend decisions that turn an analysis into a visible question,
automatic low-risk assumption, or controlled rejection.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from app import schemas  # noqa: E402,F401
from app.rbac_catalog import ALL_CAPABILITIES  # noqa: E402,F401
from app.api.routers import traceability  # noqa: E402,F401
from app.repositories.story_generation import (  # noqa: E402
    _analysis_readiness,
    _auto_accept_low_risk_assumptions,
    _filter_planned_stories,
    _outline_candidates,
)
from app.schema_sections.traceability import RequisitoCreate
from app.repositories.generation_guards import check_assumptions


def _analysis(kind: str, number: int) -> dict:
    assumption = {"id": f"ASSUMP-{number:03d}", "text": "Aplicar una convención documentada", "risk": "LOW"}
    if kind == "ready":
        return {"readiness": "READY", "questions": [], "proposed_assumptions": []}
    if kind == "low_risk":
        return {"readiness": "NEEDS_CLARIFICATION", "questions": [], "proposed_assumptions": [assumption]}
    if kind == "question":
        return {"readiness": "NEEDS_CLARIFICATION", "questions": ["¿Qué mensaje debe ver el usuario ante un rechazo?"], "proposed_assumptions": [assumption]}
    if kind == "high_risk":
        return {"readiness": "NEEDS_CLARIFICATION", "questions": [], "proposed_assumptions": [{**assumption, "risk": "HIGH"}]}
    if kind == "blocked_with_action":
        return {"readiness": "BLOCKED", "questions": ["¿La operación requiere doble aprobación?"], "proposed_assumptions": []}
    return {"readiness": "BLOCKED", "questions": [], "proposed_assumptions": []}


SCENARIOS = (
    [("ready", "Consultar resultados de pruebas")] * 10
    + [("low_risk", "Exportar un reporte de calidad")] * 10
    + [("question", "Gestionar acceso de usuarios")] * 10
    + [("high_risk", "Aprobar cambios de producción")] * 10
    + [("blocked_with_action", "Eliminar datos de auditoría")] * 5
    + [("blocked_invalid", "Procesar una operación ambigua")] * 5
)


@pytest.mark.parametrize("number,scenario", list(enumerate(SCENARIOS, start=1)))
def test_fifty_requirements_follow_the_question_gate(number, scenario):
    kind, title = scenario
    requirement = RequisitoCreate(proyecto_id="00000000-0000-0000-0000-000000000001", titulo=f"REQ-{number:03d} {title}")
    assert requirement.titulo.startswith(f"REQ-{number:03d}")

    analysis = _analysis(kind, number)
    if kind == "blocked_invalid":
        with pytest.raises(ValueError, match="sin una decisión accionable"):
            _analysis_readiness(analysis)
        return

    readiness = _analysis_readiness(analysis)
    run = SimpleNamespace(analysis_json=analysis, accepted_assumption_ids=[])
    final_readiness = _auto_accept_low_risk_assumptions(run, readiness)

    if kind == "ready":
        assert final_readiness == "READY"
    elif kind == "low_risk":
        assert final_readiness == "READY"
        assert run.accepted_assumption_ids == [f"ASSUMP-{number:03d}"]
    elif kind == "question":
        assert final_readiness == "NEEDS_CLARIFICATION"
        assert run.analysis_json["questions"]
    elif kind == "high_risk":
        assert final_readiness == "NEEDS_CLARIFICATION"
        assert run.accepted_assumption_ids == []
    else:
        assert final_readiness == "BLOCKED"
        assert run.analysis_json["questions"]


def test_ready_with_questions_is_normalized_to_needs_clarification():
    analysis = {
        "readiness": "READY",
        "questions": ["¿Cuál es el tiempo máximo aceptable para exportar el reporte?"],
        "proposed_assumptions": [],
    }

    assert _analysis_readiness(analysis) == "NEEDS_CLARIFICATION"
    assert analysis["readiness"] == "NEEDS_CLARIFICATION"


def test_existing_intent_is_filtered_before_expensive_draft_generation():
    run = SimpleNamespace(analysis_json={
        "story_outline": [
            {"title": "Iniciar sesión segura", "story_type": "USER_STORY", "reason": "Acceso con credenciales válidas"},
            {"title": "Gestionar expiración de sesión", "story_type": "USER_STORY", "reason": "Cerrar sesiones vencidas"},
        ],
    })

    plan = _outline_candidates(run, 5)
    planned, excluded = _filter_planned_stories(plan, {
        "PLAN-001": [{"id": "story-1", "codigo": "US-006", "titulo": "Inicio de sesión seguro", "kind": "AI_INTENT", "confidence": "HIGH"}],
    })

    assert [item["title"] for item in planned] == ["Gestionar expiración de sesión"]
    assert excluded[0]["title"] == "Iniciar sesión segura"
    assert excluded[0]["similar_stories"][0]["codigo"] == "US-006"


@pytest.mark.parametrize("assumptions", [
    [{"id": "A-1", "text": "Requires review", "risk": "MEDIUM"}],
    [{"id": "A-1", "text": "Requires review", "risk": "UNKNOWN"}],
    [{"id": "A-1", "text": "Requires review"}],
    [{"id": "A-1", "text": "", "risk": "LOW"}],
    [{"text": "Missing identity", "risk": "LOW"}],
    [{"id": "A-1", "text": "Valid default", "risk": "LOW"}, {"risk": "LOW"}],
    [{"id": "A-1", "text": "Valid", "risk": "LOW"}, {"id": "A-1", "text": "Other", "risk": "LOW"}],
    [{"id": " ", "text": "Valid", "risk": "LOW"}],
    [{"id": 42, "text": "Valid", "risk": "LOW"}],
    [{"id": "A-1", "text": {"invalid": "value"}, "risk": "LOW"}],
    [],
])
def test_only_complete_explicit_low_risk_assumptions_can_be_accepted_automatically(assumptions):
    analysis = {"readiness": "NEEDS_CLARIFICATION", "questions": [], "proposed_assumptions": assumptions}
    run = SimpleNamespace(analysis_json=analysis, accepted_assumption_ids=[])
    assert _auto_accept_low_risk_assumptions(run, "NEEDS_CLARIFICATION") == "NEEDS_CLARIFICATION"
    assert run.accepted_assumption_ids == []
    assert run.analysis_json["readiness"] == "NEEDS_CLARIFICATION"
    assert "auto_accepted_assumptions" not in run.analysis_json


@pytest.mark.parametrize("risk", ["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN", None])
def test_ready_label_cannot_skip_assumption_policy(risk):
    analysis = {"readiness": "READY", "questions": [], "proposed_assumptions": [
        {"id": "A-1", "text": "Review this behavior", "risk": risk}]}
    readiness = _analysis_readiness(analysis)
    assert readiness == "NEEDS_CLARIFICATION"
    run = SimpleNamespace(analysis_json=analysis, accepted_assumption_ids=[])
    assert _auto_accept_low_risk_assumptions(run, readiness) == ("READY" if risk == "LOW" else "NEEDS_CLARIFICATION")
    assert run.accepted_assumption_ids == (["A-1"] if risk == "LOW" else [])


@pytest.mark.parametrize("risk", ["MEDIUM", "HIGH", "CRITICAL", "UNKNOWN", None])
def test_timeout_cannot_confirm_non_low_risk_assumptions(risk):
    analysis = {"questions": [], "proposed_assumptions": [{"id": "A-1", "text": "Review this behavior", "risk": risk}]}
    with pytest.raises(ValueError, match="continuación automática"):
        check_assumptions(analysis, ["A-1"], "AUTO_TIMEOUT")
    assert check_assumptions(analysis, ["A-1"], "MANUAL") == ["A-1"]


@pytest.mark.parametrize("patch,accepted", [
    ({"questions": ["Confirm the expected outcome"]}, ["A-1"]),
    ({"proposed_assumptions": [{"id": "A-1", "text": "", "risk": "LOW"}]}, ["A-1"]),
    ({"proposed_assumptions": [{"id": "A-1", "text": "Valid", "risk": "LOW"}, {"id": "A-2", "text": "Needs review", "risk": "HIGH"}]}, ["A-1"]),
    ({"proposed_assumptions": [{"id": "A-1", "text": "Valid", "risk": "LOW"}, {"id": "A-1", "text": "Other", "risk": "LOW"}]}, ["A-1"]),
    ({"proposed_assumptions": []}, []),
    ({"proposed_assumptions": [{"id": None, "text": "Valid", "risk": "LOW"}]}, ["None"]),
    ({"proposed_assumptions": [{"id": " ", "text": "Valid", "risk": "LOW"}]}, [" "]),
    ({"proposed_assumptions": [{"id": "A-1", "text": {"invalid": "value"}, "risk": "LOW"}]}, ["A-1"]),
])
def test_timeout_requires_complete_low_risk_review_without_questions(patch, accepted):
    analysis = {"questions": [], "proposed_assumptions": [{"id": "A-1", "text": "Valid", "risk": "LOW"}], **patch}
    with pytest.raises(ValueError, match="continuación automática"):
        check_assumptions(analysis, accepted, "AUTO_TIMEOUT")


def test_timeout_preserves_explicit_low_risk_path():
    analysis = {"questions": [], "proposed_assumptions": [{"id": "A-1", "text": "Valid", "risk": "LOW"}]}
    assert check_assumptions(analysis, ["A-1"], "AUTO_TIMEOUT") == ["A-1"]

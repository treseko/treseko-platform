"""Regression matrix for the minimum-intervention analysis gate.

The test intentionally avoids a real LLM: model output is non-deterministic.
It verifies the backend decisions that turn an analysis into a visible question,
automatic low-risk assumption, or controlled rejection.
"""
from __future__ import annotations

import asyncio
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
    _canonicalize_explicit_story_fields,
    _filter_planned_stories,
    _outline_candidates,
)
from app.repositories import story_generation
from app.repositories.story_generation_helpers import (
    _analysis_after_answered_question_update,
    _finalize_interrupted_story_generation,
    _preserve_reanalysis_after_error,
    _resolve_answered_analysis_questions,
)
from app.repositories.story_generation_review import remap_semantic_criterion_ids
from app.schema_sections.traceability import RequisitoCreate
from app.repositories.generation_guards import check_assumptions
from app.repositories.generation_guards import checked_answers
from app.repositories.story_authoring_rules import validate_proposal
from app.schema_sections.traceability import QuestionAnswer


def test_exact_duplicate_story_proposal_is_a_hard_generation_failure():
    proposal = {
        "title": "Comprar y emitir una gift card digital",
        "story_type": "USER_STORY",
        "actor": "cliente",
        "goal": "Comprar y emitir una gift card digital",
        "benefit": "Completar la compra",
        "acceptance_criteria": [],
        "quality": {},
    }
    prior = [{
        "title": "Comprar y emitir una gift card digital",
        "actor": "cliente",
        "goal": "Comprar y emitir una gift card digital",
    }]

    findings = validate_proposal(proposal, set(), prior)

    assert any(item["code"] == "STORY_DUPLICATE_NORMALIZED" for item in findings)
    assert proposal["quality"]["testability"] == "FAIL"


def test_answered_question_persists_explicit_scope_decision():
    analysis = {"questions": ["¿Qué pasa si la emisión falla?"], "proposed_assumptions": []}
    answers = checked_answers(analysis, [QuestionAnswer(
        question="¿Qué pasa si la emisión falla?", answer="Fuera de alcance.", scope_decision="OUT_OF_SCOPE",
    )])
    assert answers == [{
        "question": "¿Qué pasa si la emisión falla?", "answer": "Fuera de alcance.", "scope_decision": "OUT_OF_SCOPE",
    }]


def test_out_of_scope_decision_can_resolve_question_without_free_text():
    analysis = {"questions": ["¿Qué pasa si la emisión falla?"], "proposed_assumptions": []}
    answers = checked_answers(analysis, [QuestionAnswer(
        question="¿Qué pasa si la emisión falla?", scope_decision="OUT_OF_SCOPE",
    )])
    assert answers == [{
        "question": "¿Qué pasa si la emisión falla?", "answer": "", "scope_decision": "OUT_OF_SCOPE",
    }]


def test_in_scope_question_still_requires_answer():
    analysis = {"questions": ["¿Qué pasa si la emisión falla?"], "proposed_assumptions": []}
    with pytest.raises(ValueError, match="marcarse fuera del alcance"):
        checked_answers(analysis, [QuestionAnswer(question="¿Qué pasa si la emisión falla?")])


def test_story_criterion_id_remap_updates_source_coverage_links():
    semantic = {
        "grounding": [{"criterion_id": "AC-1"}],
        "findings": [{"criterion_id": "AC-1"}],
        "source_coverage": [{"fact_id": "SOURCE-FACT-001", "criterion_ids": ["AC-1", "AC-2"]}],
    }

    result = remap_semantic_criterion_ids(semantic, {"AC-1": "AC-PROP-001-01"})

    assert result["grounding"][0]["criterion_id"] == "AC-PROP-001-01"
    assert result["findings"][0]["criterion_id"] == "AC-PROP-001-01"
    assert result["source_coverage"][0]["criterion_ids"] == ["AC-PROP-001-01", "AC-2"]


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


def test_reanalysis_removes_only_exactly_answered_questions():
    question = "¿Qué mensaje debe mostrarse ante un rechazo?"
    analysis = {
        "readiness": "NEEDS_CLARIFICATION",
        "questions": [question, "¿Se requiere doble aprobación?"],
        "proposed_assumptions": [],
    }

    resolved = _resolve_answered_analysis_questions(
        analysis, [{"question": question, "answer": "Mostrar Pago rechazado."}]
    )

    assert resolved == 1
    assert analysis["questions"] == ["¿Se requiere doble aprobación?"]
    assert analysis["readiness"] == "NEEDS_CLARIFICATION"


def test_reanalysis_promotes_readiness_when_answered_question_was_only_blocker():
    question = "¿Qué mensaje debe mostrarse ante un rechazo?"
    analysis = {
        "readiness": "NEEDS_CLARIFICATION",
        "questions": [question],
        "proposed_assumptions": [],
    }

    _resolve_answered_analysis_questions(
        analysis, [{"question": question, "answer": "Mostrar Pago rechazado."}]
    )

    assert analysis["questions"] == []
    assert analysis["readiness"] == "READY"


def test_reanalysis_keeps_answered_question_pending_when_answer_is_empty():
    question = "¿Qué mensaje debe mostrarse ante un rechazo?"
    analysis = {"readiness": "NEEDS_CLARIFICATION", "questions": [question], "proposed_assumptions": []}

    resolved = _resolve_answered_analysis_questions(
        analysis, [{"question": question, "answer": "  "}]
    )

    assert resolved == 0
    assert analysis["questions"] == [question]
    assert analysis["readiness"] == "NEEDS_CLARIFICATION"


def test_failed_reanalysis_preserves_prior_analysis_and_resolves_exact_answers():
    question = "¿Se requiere notificación por correo?"
    previous = {
        "readiness": "NEEDS_CLARIFICATION",
        "questions": [question, "¿Se requiere aprobación manual?"],
        "proposed_assumptions": [{"id": "A-1", "text": "Review payment failure", "risk": "MEDIUM"}],
    }

    restored = _analysis_after_answered_question_update(
        previous, [{"question": question, "answer": "No, mostrar el estado en la orden."}]
    )

    assert restored is not previous
    assert restored["questions"] == ["¿Se requiere aprobación manual?"]
    assert restored["proposed_assumptions"] == previous["proposed_assumptions"]
    assert previous["questions"] == [question, "¿Se requiere aprobación manual?"]


def test_failed_reanalysis_without_previous_analysis_has_no_fallback():
    assert _analysis_after_answered_question_update({}, []) is None


def test_reanalysis_error_keeps_generation_retryable_with_answered_question_removed():
    question = "¿Se requiere notificación por correo?"
    run = SimpleNamespace(
        fuente_snapshot={"respuestas_usuario": [{"question": question, "answer": "No."}]},
        analysis_json={"readiness": "NEEDS_CLARIFICATION", "questions": [question],
                      "proposed_assumptions": [{"id": "A-1", "text": "Review failure behavior", "risk": "MEDIUM"}]},
        estimacion={"cantidad_recomendada": 2}, accepted_assumption_ids=[], estado="BLOQUEADA",
    )

    retained = _preserve_reanalysis_after_error(run, run.analysis_json, run.estimacion)

    assert retained is True
    assert run.estado == "ESPERANDO_SUPUESTOS"
    assert run.analysis_json["questions"] == []
    assert run.estimacion == {"cantidad_recomendada": 2, "readiness": "NEEDS_CLARIFICATION"}


def test_reanalysis_error_without_prior_analysis_remains_blocked():
    run = SimpleNamespace(fuente_snapshot={}, analysis_json={}, estimacion={}, estado="ESPERANDO_SUPUESTOS")
    assert _preserve_reanalysis_after_error(run, {}, {}) is False


def test_interrupted_story_batch_persists_partial_work_and_is_reviewable():
    class FakeDatabase:
        committed = False

        async def commit(self):
            self.committed = True

    run = SimpleNamespace(
        decisiones_json={"generation_progress": {"planned": 3, "current": 2}},
        propuestas=[], propuestas_originales_json=[], propuestas_finales_json=[],
        workflow_traces_json=[], warnings_json=[], estado="GENERANDO",
        error_detalle=None, sanitized_error=None,
    )
    candidate = {"local_id": "PROP-002", "rule_findings": []}
    db = FakeDatabase()

    asyncio.run(_finalize_interrupted_story_generation(
        db, run, [candidate], [{"position": 1, "message": "provider error"}], [], 3,
    ))

    assert db.committed is True
    assert run.estado == "LISTA_PARA_REVISION"
    assert run.propuestas == [candidate]
    assert candidate["similarity_check"]["status"] == "INTERRUPTED"
    assert run.decisiones_json["generation_progress"] == {
        "planned": 3, "current": 2, "requested": 3, "completed": 1,
        "failed": [{"position": 1, "message": "provider error"}],
        "status": "INTERRUPTED", "interrupted": True,
    }


def test_interrupted_story_batch_without_drafts_can_be_retried():
    class FakeDatabase:
        async def commit(self):
            pass

    run = SimpleNamespace(decisiones_json={}, propuestas=[], propuestas_originales_json=[],
                          propuestas_finales_json=[], workflow_traces_json=[], warnings_json=[],
                          estado="GENERANDO", error_detalle=None, sanitized_error=None)
    asyncio.run(_finalize_interrupted_story_generation(FakeDatabase(), run, [], [], [], 2))
    assert run.estado == "LISTA_PARA_GENERAR"
    assert run.decisiones_json["generation_progress"]["interrupted"] is True


def test_cancelled_generation_repository_persists_retryable_state(monkeypatch):
    class EmptyResults:
        def scalars(self):
            return self

        def all(self):
            return []

    class FakeDatabase:
        info = {}

        async def commit(self):
            pass

        async def refresh(self, _run):
            pass

        async def execute(self, _query):
            return EmptyResults()

    workflow = SimpleNamespace(id="workflow-1", version=2)
    run = SimpleNamespace(
        id="generation-1", requisito_id="requirement-1", proyecto_id="project-1",
        workflow_id="workflow-1", workflow_version=2, estado="LISTA_PARA_GENERAR",
        fuente_snapshot={"requisito": {"codigo": "REQ-001"}}, instrucciones="",
        analysis_json={"readiness": "READY", "questions": [], "proposed_assumptions": [],
                       "story_outline": [{"title": "Comprar gift card", "reason": "Permite completar una compra."}]},
        accepted_assumption_ids=[], decisiones_json={}, propuestas=[], propuestas_originales_json=[],
        propuestas_finales_json=[], workflow_traces_json=[], warnings_json=[],
        sanitized_error=None, error_detalle=None, estimacion={}, fecha_creacion=None, fecha_actualizacion=None,
    )

    async def return_workflow(*_args, **_kwargs):
        return workflow

    async def lock(_db, value, **_kwargs):
        return value

    async def no_source_change(*_args, **_kwargs):
        return None

    async def cancel_engine(*_args, **_kwargs):
        raise asyncio.CancelledError()

    monkeypatch.setattr(story_generation, "_story_generation_workflow", return_workflow)
    monkeypatch.setattr(story_generation, "lock_generation", lock)
    monkeypatch.setattr(story_generation, "require_current_sources", no_source_change)
    monkeypatch.setattr(story_generation, "_call_engine", cancel_engine)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(story_generation.generate_story_candidates(
            FakeDatabase(), run, SimpleNamespace(max_historias=1, question_answers=[]),
        ))

    assert run.estado == "LISTA_PARA_GENERAR"
    assert run.decisiones_json["generation_progress"]["status"] == "INTERRUPTED"
    assert "reintentar" in run.error_detalle


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


def test_explicit_user_story_groups_requirement_rules_as_one_story_plan():
    description = """## Especificación funcional
Como cliente autenticado quiero comprar una gift card digital para enviarla a un destinatario.

### Reglas de negocio
- El cliente elige uno de los valores permitidos: 25, 50 o 100 USD.
- El cliente proporciona un correo válido del destinatario y un mensaje opcional de hasta 200 caracteres.
- Antes de confirmar, se muestra el valor, correo destino y total a pagar.
- Solo se emite la gift card cuando el proveedor confirma el pago.
- Si el pago se rechaza o vence, no se emite la gift card.
"""
    run = SimpleNamespace(
        fuente_snapshot={"requisito": {"descripcion_markdown": description}},
        analysis_json={"story_outline": [
            {"title": "Comprar gift card", "reason": "Como cliente autenticado quiero comprar una gift card digital para enviarla a un destinatario."},
            {"title": "Elegir valor", "reason": "El cliente elige uno de los valores permitidos: 25, 50 o 100 USD."},
            {"title": "Proporcionar correo", "reason": "El cliente proporciona un correo válido del destinatario y un mensaje opcional de hasta 200 caracteres."},
        ]},
    )

    plan = _outline_candidates(run, 3)

    assert len(plan) == 1
    assert plan[0]["title"] == "Comprar una gift card digital"
    assert plan[0]["actor"] == "cliente autenticado"
    assert plan[0]["goal"] == "comprar una gift card digital"
    assert plan[0]["benefit"] == "enviarla a un destinatario"
    assert plan[0]["source_kind"] == "explicit_user_story"
    proposal = {"title": "Título inventado", "actor": "Sistema", "goal": "Acción distinta", "benefit": "Otro beneficio"}
    assert _canonicalize_explicit_story_fields(proposal, plan[0]) == {
        "title": "Comprar una gift card digital", "actor": "cliente autenticado",
        "goal": "comprar una gift card digital", "benefit": "enviarla a un destinatario",
    }


def test_explicit_user_story_does_not_merge_unrelated_or_unquoted_outline_items():
    run = SimpleNamespace(
        fuente_snapshot={"requisito": {"descripcion_markdown": "Como cliente quiero comprar un producto."}},
        analysis_json={"story_outline": [
            {"title": "Comprar producto", "reason": "Como cliente quiero comprar un producto."},
            {"title": "Administrar devoluciones", "reason": "El equipo de soporte administra devoluciones."},
        ]},
    )

    plan = _outline_candidates(run, 5)

    assert [item["title"] for item in plan] == ["Comprar producto", "Administrar devoluciones"]
    assert all(item.get("source_kind") != "explicit_user_story" for item in plan)


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

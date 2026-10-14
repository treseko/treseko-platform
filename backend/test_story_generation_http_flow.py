"""Hermetic HTTP lifecycle for governed AI story generation."""

from __future__ import annotations

from uuid import uuid4
import pytest

from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from app.api.routers import organizations as organizations_router
from app.repositories import story_generation
from test_api_project_http_flow import _create_admin, _login


async def _controlled_story_engine(_db, _workflow, phase, *_args, **_kwargs):
    if phase == "review":
        # Controlled transport fixture, not a real semantic-quality benchmark.
        context = _args[0]
        return {"propuestas": [{**proposal, "quality": {"semantic_review": {"version": 1, "verdict": "PASS", "origin": "controlled-test"}}} for proposal in context["propuestas"]], "workflow_traces": [], "runtime": {"provider": "controlled", "model": "test", "temperature": 0}}
    if phase == "analyze":
        return {
            "analysis": {
                "readiness": "READY", "questions": [], "proposed_assumptions": [],
                "recommended_story_count": 1,
                "story_outline": [{"title": "Consultar estado de pedido", "reason": "El cliente necesita visibilidad."}],
            },
            "estimacion": {"cantidad_recomendada": 1, "rango_min": 1, "rango_max": 1},
            "workflow_traces": [],
        }
    if phase == "generate":
        source_refs = [_args[0]["requisito"]["codigo"]]
        return {
            "propuestas": [{
                "local_id": "PROP-001", "story_type": "USER_STORY", "title": "Consultar estado de pedido",
                "actor": "cliente", "goal": "consultar su pedido", "benefit": "conocer su avance",
                "description": "Como cliente quiero consultar el estado de mi pedido.",
                "scope": ["Consultar el estado actual de un pedido existente."],
                "out_of_scope": ["Modificar o cancelar el pedido."],
                "dependencies": ["El pedido debe existir."],
                "risks": ["Un pedido sin estado visible requiere revisión funcional."],
                "source_refs": source_refs, "assumption_ids": [], "open_questions": [],
                "acceptance_criteria": [{
                    "local_id": "AC-001", "type": "FUNCTIONAL", "title": "Estado visible",
                    "given": "un pedido existente", "when": "el cliente lo consulta",
                    "then": ["se muestra el estado actual"], "observable_result": "Estado visible",
                    "source_refs": source_refs,
                }],
                "quality": {"testability": "PASS", "duplicate_risk": "LOW", "overlap_risk": "LOW"},
            }],
            "workflow_traces": [],
        }
    return {"comparisons": [], "workflow_traces": []}


def test_governed_story_generation_estimate_generate_review_and_apply_http_lifecycle(monkeypatch):
    monkeypatch.setattr(story_generation, "_call_engine", _controlled_story_engine)
    async def _allow_organization_creation(*_args, **_kwargs):
        return None
    monkeypatch.setattr(organizations_router, "enforce_limit", _allow_organization_creation)
    suffix = uuid4().hex
    email = f"story-generation-{suffix}@example.test"
    password = "StoryGenerationPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        organization = client.post("/organizaciones/", headers=headers, json={"nombre": f"Story Org {suffix}", "tipo": "Cliente"})
        assert organization.status_code == 200, organization.text
        project = client.post(
            "/proyectos/", headers=headers,
            json={"nombre": f"Story Project {suffix}", "organizacion_id": organization.json()["id"]},
        )
        assert project.status_code == 200, project.text
        project_id = project.json()["id"]
        requirement = client.post(
            "/requisitos/", headers=headers,
            json={"proyecto_id": project_id, "titulo": "Seguimiento de pedidos", "estado": "ACTIVO"},
        )
        assert requirement.status_code == 200, requirement.text
        requirement_id = requirement.json()["id"]

        estimated = client.post(
            f"/requisitos/{requirement_id}/generaciones-historias/estimar",
            headers=headers, json={"instrucciones": "Crear una historia verificable."},
        )
        assert estimated.status_code == 200, estimated.text
        generation_id = estimated.json()["id"]
        assert estimated.json()["estado"] == "ANALIZADA"
        read_generation = client.get(f"/generaciones-historias/{generation_id}", headers=headers)
        assert read_generation.status_code == 200, read_generation.text
        reanalyzed = client.post(
            f"/generaciones-historias/{generation_id}/reanalizar",
            headers=headers,
            json={"max_historias": 1, "question_answers": []},
        )
        assert reanalyzed.status_code == 200, reanalyzed.text
        assert reanalyzed.json()["estado"] == "ANALIZADA"
        assumptions = client.post(
            f"/generaciones-historias/{generation_id}/supuestos",
            headers=headers,
            json={"assumption_ids": [], "question_answers": [], "continuation_mode": "MANUAL"},
        )
        # An already ready analysis has no pending assumption decision.
        assert assumptions.status_code == 400, assumptions.text
        assert assumptions.json()["detail"] == "La generación no espera confirmación de supuestos."
        generated = client.post(
            f"/generaciones-historias/{generation_id}/generar",
            headers=headers, json={"max_historias": 1},
        )
        assert generated.status_code == 200, generated.text
        assert generated.json()["estado"] == "LISTA_PARA_REVISION"
        proposal = generated.json()["propuestas"][0]
        applied = client.post(
            f"/generaciones-historias/{generation_id}/aplicar",
            headers=headers,
            json={"historias": [{**proposal, "selected": True, "prioridad": "MEDIA"}]},
        )
        assert applied.status_code == 200, applied.text
        assert applied.json()["historias"][0]["titulo"] == "Consultar estado de pedido"
        stories = client.get(f"/proyectos/{project_id}/historias/", headers=headers)
        assert stories.status_code == 200, stories.text
        assert any(item["titulo"] == "Consultar estado de pedido" for item in stories.json())
        client.portal.call(engine.dispose)


@pytest.mark.parametrize("readiness", ["NEEDS_CLARIFICATION", "READY"])
def test_story_analysis_does_not_auto_accept_medium_risk_assumption_http(monkeypatch, readiness):
    async def medium_risk_engine(_db, _workflow, _phase, *_args, **_kwargs):
        return {"analysis": {"readiness": readiness, "questions": [],
                "proposed_assumptions": [{"id": "ASSUMP-MEDIUM", "text": "Confirmar la convención del proyecto", "risk": "MEDIUM"}]},
                "estimacion": {"cantidad_recomendada": 1, "rango_min": 1, "rango_max": 1}, "workflow_traces": []}

    async def allow_organization_creation(*_args, **_kwargs):
        return None

    monkeypatch.setattr(story_generation, "_call_engine", medium_risk_engine)
    monkeypatch.setattr(organizations_router, "enforce_limit", allow_organization_creation)
    suffix = uuid4().hex
    email = f"story-risk-{suffix}@example.test"
    password = "ControlledStoryRisk-2026!"
    _create_admin(email, password)
    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        organization = client.post("/organizaciones/", headers=headers, json={"nombre": f"Story Risk {suffix}", "tipo": "Cliente"})
        assert organization.status_code == 200, organization.text
        project = client.post("/proyectos/", headers=headers, json={"nombre": f"Risk Project {suffix}", "organizacion_id": organization.json()["id"]})
        assert project.status_code == 200, project.text
        requirement = client.post("/requisitos/", headers=headers, json={"proyecto_id": project.json()["id"], "titulo": "Alcance sujeto a confirmación", "estado": "ACTIVO"})
        assert requirement.status_code == 200, requirement.text
        response = client.post(f"/requisitos/{requirement.json()['id']}/generaciones-historias/estimar", headers=headers, json={})
        assert response.status_code == 200, response.text
        assert response.json()["estado"] == "ESPERANDO_SUPUESTOS"
        assert response.json()["accepted_assumption_ids"] == []
        automatic = client.post(f"/generaciones-historias/{response.json()['id']}/supuestos", headers=headers,
            json={"assumption_ids": ["ASSUMP-MEDIUM"], "question_answers": [], "continuation_mode": "AUTO_TIMEOUT"})
        assert automatic.status_code == 400, automatic.text
        assert "continuación automática" in automatic.json()["detail"]
        persisted = client.get(f"/generaciones-historias/{response.json()['id']}", headers=headers)
        assert persisted.status_code == 200, persisted.text
        assert persisted.json()["estado"] == "ESPERANDO_SUPUESTOS"
        assert persisted.json()["accepted_assumption_ids"] == []
        client.portal.call(engine.dispose)


def test_pending_story_questions_require_answers_before_continuing_http(monkeypatch):
    question = "¿Qué mensaje debe mostrarse ante un rechazo?"
    calls = []

    async def question_engine(_db, _workflow, phase, context, *_args, **_kwargs):
        calls.append(context)
        assert phase == "analyze"
        ready = bool(context.get("respuestas_usuario"))
        return {"analysis": {"readiness": "READY" if ready else "NEEDS_CLARIFICATION",
                "questions": [] if ready else [question], "proposed_assumptions": []},
                "estimacion": {"cantidad_recomendada": 1, "rango_min": 1, "rango_max": 1},
                "workflow_traces": []}

    async def allow_organization_creation(*_args, **_kwargs):
        return None

    monkeypatch.setattr(story_generation, "_call_engine", question_engine)
    monkeypatch.setattr(organizations_router, "enforce_limit", allow_organization_creation)
    suffix = uuid4().hex
    email, password = f"story-question-{suffix}@example.test", "ControlledStoryQuestion-2026!"
    _create_admin(email, password)
    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        organization = client.post("/organizaciones/", headers=headers,
            json={"nombre": f"Question Org {suffix}", "tipo": "Cliente"})
        assert organization.status_code == 200, organization.text
        project = client.post("/proyectos/", headers=headers,
            json={"nombre": f"Question Project {suffix}", "organizacion_id": organization.json()["id"]})
        assert project.status_code == 200, project.text
        requirement = client.post("/requisitos/", headers=headers,
            json={"proyecto_id": project.json()["id"], "titulo": "Acceso verificable", "estado": "ACTIVO"})
        assert requirement.status_code == 200, requirement.text
        estimated = client.post(f"/requisitos/{requirement.json()['id']}/generaciones-historias/estimar",
            headers=headers, json={})
        assert estimated.status_code == 200, estimated.text
        generation_id = estimated.json()["id"]
        assert estimated.json()["estado"] == "ESPERANDO_SUPUESTOS"
        unanswered = client.post(f"/generaciones-historias/{generation_id}/supuestos", headers=headers,
            json={"assumption_ids": [], "question_answers": [], "continuation_mode": "MANUAL"})
        assert unanswered.status_code == 400, unanswered.text
        assert unanswered.json()["detail"] == "Responde todas las preguntas pendientes antes de continuar."
        assert len(calls) == 1
        answers = [{"question": question, "answer": "El mensaje observado es Acceso rechazado."}]
        answered = client.post(f"/generaciones-historias/{generation_id}/supuestos", headers=headers,
            json={"assumption_ids": [], "question_answers": answers, "continuation_mode": "MANUAL"})
        assert answered.status_code == 200, answered.text
        assert answered.json()["estado"] == "ANALIZADA"
        assert len(calls) == 2 and calls[-1]["respuestas_usuario"] == answers
        persisted = client.get(f"/generaciones-historias/{generation_id}", headers=headers)
        assert persisted.status_code == 200, persisted.text
        assert persisted.json()["fuente_snapshot"]["respuestas_usuario"] == answers
        client.portal.call(engine.dispose)

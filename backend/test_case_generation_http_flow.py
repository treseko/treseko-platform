"""Hermetic HTTP lifecycle for governed AI case generation."""

from __future__ import annotations

from uuid import uuid4

import httpx

from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from app.api.routers import organizations as organizations_router
from app.repositories import case_generation
from app.services.edition import entitlement_service
from test_api_project_http_flow import _create_admin, _login


async def _ai_case_generation_enabled(*_args, **_kwargs) -> bool:
    return True


async def _controlled_case_engine(_db, _workflow, phase, context, _instructions, _max_cases=None):
    if phase == "review":
        # Controlled transport fixture, not a real semantic-quality benchmark.
        return ({"propuestas": [{**proposal, "quality": {"semantic_review": {"version": 1, "verdict": "PASS", "origin": "controlled-test"}}} for proposal in context["propuestas"]], "workflow_traces": [], "runtime": {"provider": "controlled", "model": "test", "temperature": 0}}, {"provider": "controlled", "model": "test", "temperature": 0})
    if phase == "analyze":
        return ({
            "analysis": {"readiness": "READY", "questions": [], "proposed_assumptions": []},
            "estimacion": {"cantidad_recomendada": 1},
            "scenarios": [{"local_id": "SCN-001", "title": "Consulta válida", "category": "POSITIVE"}],
            "workflow_traces": [],
        }, {"provider": "controlled", "model": "test", "temperature": 0})
    criterion_id = context["criterios"][0]["id"]
    return ({
        "propuestas": [{
            "local_id": "CASE-001", "title": "Consultar estado de pedido válido", "category": "POSITIVE",
            "test_type": "MANUAL", "priority": "MEDIA", "criticality": "MEDIA",
            "objective": "Validar la consulta del estado.", "preconditions": ["Existe un pedido."],
            "test_data": [{"pedido": "P-100"}],
            "steps": [{"number": 1, "action": "Consultar el pedido", "data": "P-100", "expected_result": "Se muestra el estado."}],
            "criterion_refs": [criterion_id], "source_refs": [context["historia"]["codigo"]],
            "assumption_ids": [], "automation": {"readiness": "MEDIUM", "reason": "Consulta estable."},
            "quality": {"testability": "PASS", "warnings": []},
        }],
        "warnings": [], "workflow_traces": [],
    }, {"provider": "controlled", "model": "test", "temperature": 0})


async def _controlled_blocked_case_engine(_db, _workflow, phase, context, _instructions, _max_cases=None):
    """Exercise the explicit-assumption branch before proposal generation."""
    if phase == "analyze":
        if "ASM-ORDER-001" in context.get("accepted_assumption_ids", []):
            return await _controlled_case_engine(_db, _workflow, phase, context, _instructions, _max_cases)
        return ({
            "analysis": {
                "readiness": "BLOCKED",
                "questions": [],
                "proposed_assumptions": [{"id": "ASM-ORDER-001", "title": "El pedido existe"}],
            },
            "estimacion": {"cantidad_recomendada": 1},
            "scenarios": [{"local_id": "SCN-001", "title": "Consulta válida", "category": "POSITIVE"}],
            "workflow_traces": [],
        }, {"provider": "controlled", "model": "test", "temperature": 0})
    return await _controlled_case_engine(_db, _workflow, phase, context, _instructions, _max_cases)


def test_governed_case_generation_estimate_plan_review_and_apply_http_lifecycle(monkeypatch):
    monkeypatch.setattr(entitlement_service, "is_feature_enabled", _ai_case_generation_enabled)
    monkeypatch.setattr(case_generation, "_call_engine", _controlled_case_engine)
    async def _allow_organization_creation(*_args, **_kwargs):
        return None
    monkeypatch.setattr(organizations_router, "enforce_limit", _allow_organization_creation)
    suffix = uuid4().hex
    email = f"case-generation-{suffix}@example.test"
    password = "CaseGenerationPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        organization = client.post("/organizaciones/", headers=headers, json={"nombre": f"Case Org {suffix}", "tipo": "Cliente"})
        assert organization.status_code == 200, organization.text
        project = client.post("/proyectos/", headers=headers, json={"nombre": f"Case Project {suffix}", "organizacion_id": organization.json()["id"]})
        assert project.status_code == 200, project.text
        project_id = project.json()["id"]
        component = client.post("/componentes/", headers=headers, json={"nombre": "Orders", "proyecto_id": project_id})
        assert component.status_code == 200, component.text
        component_id = component.json()["id"]
        suite = client.post("/suites/", headers=headers, json={"nombre": "Order status", "proyecto_id": project_id, "componente_id": component_id})
        assert suite.status_code == 200, suite.text
        suite_id = suite.json()["id"]
        requirement = client.post("/requisitos/", headers=headers, json={"proyecto_id": project_id, "titulo": "Seguimiento de pedidos", "estado": "ACTIVO"})
        assert requirement.status_code == 200, requirement.text
        story = client.post(
            "/historias/", headers=headers,
            json={
                "proyecto_id": project_id, "requisito_id": requirement.json()["id"], "titulo": "Consultar pedido",
                "acceptance_criteria": [{"local_id": "AC-ORDER-01", "title": "Estado consultable", "given": "un pedido", "when": "se consulta", "then": ["se muestra estado"]}],
            },
        )
        assert story.status_code == 200, story.text
        story_id = story.json()["id"]

        # A blocked analysis must be explicitly resolved before legacy
        # ``/planificar`` proposal generation is permitted.
        monkeypatch.setattr(case_generation, "_call_engine", _controlled_blocked_case_engine)
        blocked = client.post(
            f"/historias/{story_id}/generaciones-casos/estimar", headers=headers,
            json={"suite_id": suite_id, "componente_id": component_id, "focus_categories": ["POSITIVE"]},
        )
        assert blocked.status_code == 200, blocked.text
        generation_id = blocked.json()["id"]
        assert blocked.json()["estado"] == "BLOQUEADA"
        confirmed = client.post(
            f"/generaciones-casos/{generation_id}/supuestos", headers=headers,
            json={"assumption_ids": ["ASM-ORDER-001"], "question_answers": [], "continuation_mode": "MANUAL"},
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["estado"] == "LISTA_PARA_GENERAR"
        read_generation = client.get(f"/generaciones-casos/{generation_id}", headers=headers)
        assert read_generation.status_code == 200, read_generation.text
        planned = client.post(f"/generaciones-casos/{generation_id}/planificar", headers=headers, json={"max_casos": 1, "scenario_ids": ["SCN-001"]})
        assert planned.status_code == 200, planned.text
        assert planned.json()["estado"] == "LISTA_PARA_REVISION"
        applied = client.post(f"/generaciones-casos/{generation_id}/aplicar", headers=headers, json={"casos": [{**proposal, "selected": True} for proposal in planned.json()["propuestas"]]})
        assert applied.status_code == 200, applied.text
        assert applied.json()["casos"][0]["titulo"] == "Consultar estado de pedido válido"
        reapplied = client.post(f"/generaciones-casos/{generation_id}/aplicar", headers=headers, json={"casos": [{**proposal, "selected": True} for proposal in planned.json()["propuestas"]]})
        assert reapplied.status_code == 200, reapplied.text
        assert reapplied.json() == applied.json()
        assert client.get(f"/generaciones-casos/{generation_id}", headers=headers).json()["decisiones"]["coverage_matrix"]
        cases = client.get(f"/proyectos/{project_id}/casos/", headers=headers)
        assert cases.status_code == 200, cases.text
        assert any(item["titulo"] == "Consultar estado de pedido válido" for item in cases.json())

        # Keep the current ``/generar`` alias covered as well.
        monkeypatch.setattr(case_generation, "_call_engine", _controlled_case_engine)
        ready = client.post(
            f"/historias/{story_id}/generaciones-casos/estimar", headers=headers,
            json={"suite_id": suite_id, "componente_id": component_id, "focus_categories": ["POSITIVE"]},
        )
        assert ready.status_code == 200, ready.text
        generated = client.post(
            f"/generaciones-casos/{ready.json()['id']}/generar", headers=headers,
            json={"max_casos": 1, "scenario_ids": ["SCN-001"]},
        )
        assert generated.status_code == 200, generated.text

        # Empty timeout exception strings must not become empty HTTP errors.
        ready_timeout = client.post(
            f"/historias/{story_id}/generaciones-casos/estimar", headers=headers,
            json={"suite_id": suite_id, "componente_id": component_id, "focus_categories": ["POSITIVE"]},
        )
        assert ready_timeout.status_code == 200, ready_timeout.text

        async def timeout_engine(*_args, **_kwargs):
            raise httpx.ReadTimeout("")

        monkeypatch.setattr(case_generation, "_call_engine", timeout_engine)
        failed = client.post(
            f"/generaciones-casos/{ready_timeout.json()['id']}/generar", headers=headers,
            json={"max_casos": 1, "scenario_ids": ["SCN-001"]},
        )
        assert failed.status_code == 400, failed.text
        assert failed.json()["detail"].strip()
        saved = client.get(f"/generaciones-casos/{ready_timeout.json()['id']}", headers=headers)
        assert saved.json()["estado"] == "BLOQUEADA"
        assert saved.json()["error_detalle"].strip()
        failed_analysis = client.post(
            f"/historias/{story_id}/generaciones-casos/estimar", headers=headers,
            json={"suite_id": suite_id, "componente_id": component_id},
        )
        assert failed_analysis.status_code == 400, failed_analysis.text
        assert failed_analysis.json()["detail"].strip()
        client.portal.call(engine.dispose)

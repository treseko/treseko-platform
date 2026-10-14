from __future__ import annotations

import os
import sys
import uuid
import asyncio
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from app import schemas  # noqa: E402
from app.rbac_catalog import ALL_CAPABILITIES  # noqa: E402
from app.api.routers import traceability  # noqa: E402
from app.repositories.story_authoring_rules import find_title_similarities, validate_proposal  # noqa: E402
from app.repositories.case_generation import _duplicate_signals  # noqa: E402


def _invalid(factory, **kwargs):
    try:
        factory(**kwargs)
    except (ValidationError, ValueError):
        return
    raise AssertionError("se esperaba un error de validacion")


def test_traceability_payloads_validate_external_references_and_bounds():
    project_id = uuid.uuid4()
    requirement = schemas.RequisitoCreate(
        proyecto_id=project_id,
        titulo="Autenticacion",
        external_provider="Jira",
        external_reference="PROJ-12",
        external_url="https://jira.example.test/browse/PROJ-12",
    )
    story = schemas.HistoriaCreate(
        proyecto_id=project_id,
        requisito_id=uuid.uuid4(),
        titulo="Como usuario quiero iniciar sesion",
        criterios_aceptacion_markdown="- Credenciales validas",
    )

    assert requirement.prioridad == "MEDIA"
    assert story.estado == "BORRADOR"
    _invalid(schemas.RequisitoCreate, proyecto_id=project_id, titulo="x", external_url="javascript:alert(1)")
    _invalid(schemas.CasoHistoriasUpdate, historia_ids=[uuid.uuid4()] * 101)


def test_traceability_capabilities_and_routes_are_registered():
    expected = {
        "proyectos.requisitos",
        "proyectos.historias",
        "crear_pruebas.trazabilidad",
        "reportes.trazabilidad",
    }
    assert expected <= ALL_CAPABILITIES
    def route_paths(router):
        paths = set()
        for route in router.routes:
            path = getattr(route, "path", None)
            if path:
                paths.add(path)
            nested = getattr(route, "original_router", None)
            if nested is not None:
                paths.update(route_paths(nested))
        return paths

    paths = route_paths(traceability.router)
    assert "/requisitos/" in paths
    assert "/historias/" in paths
    assert "/casos/{master_id}/historias/" in paths
    assert "/casos/{master_id}/historias/{historia_id}/confirmar-revision" in paths
    assert "/proyectos/{proyecto_id}/trazabilidad/cobertura/" in paths
    assert "proyectos.historias.generar_casos_ia" in ALL_CAPABILITIES
    assert "/historias/{historia_id}/generaciones-casos/estimar" in paths
    assert "/generaciones-casos/{generation_id}/generar" in paths
    assert "/historias/{historia_id}/criterios-cobertura" in paths


def test_case_generation_contract_requires_observable_consecutive_steps_and_fail_decision():
    criterion_id = uuid.uuid4()
    proposal = {
        "local_id": "TCP-001", "title": "Acceso con credenciales válidas", "category": "POSITIVE",
        "objective": "Comprobar el acceso", "criterion_refs": [criterion_id],
        "steps": [{"number": 1, "action": "Ingresar credenciales de prueba", "expected_result": "Se muestra el panel principal"}],
        "quality": {"testability": "PASS"},
    }
    assert schemas.CasoGeneracionProposalInput(**proposal).criterion_refs == [criterion_id]
    _invalid(schemas.CasoGeneracionProposalInput, **{**proposal, "steps": [{"number": 2, "action": "Abrir", "expected_result": "Se muestra la pantalla"}]})
    _invalid(schemas.CasoGeneracionProposalInput, **{**proposal, "quality": {"testability": "FAIL"}})


def test_case_generation_requires_a_persisted_destination_before_analysis():
    request = schemas.CasoGeneracionEstimateRequest(
        suite_id=uuid.uuid4(),
        componente_id=uuid.uuid4(),
    )
    assert request.suite_id and request.componente_id
    _invalid(schemas.CasoGeneracionEstimateRequest, suite_id=uuid.uuid4())
    _invalid(schemas.CasoGeneracionEstimateRequest, componente_id=uuid.uuid4())


def test_case_generation_duplicate_signals_are_explainable_and_location_local():
    criterion_id = uuid.uuid4()
    proposal = schemas.CasoGeneracionProposalInput(
        local_id="TCP-010", title="Autenticación exitosa con credenciales válidas", category="POSITIVE",
        objective="Permitir el inicio de sesión", criterion_refs=[criterion_id],
        steps=[{"number": 1, "action": "Ingresar credenciales válidas", "expected_result": "Se muestra el panel principal"}],
    )
    signals = _duplicate_signals(proposal, [{
        "case_id": uuid.uuid4(), "master_id": uuid.uuid4(), "code": "TC-001",
        "title": "Autenticación exitosa con credenciales válidas", "objective": "Permitir el inicio de sesión",
        "steps": "Ingresar credenciales válidas Se muestra el panel principal", "criterion_refs": {str(criterion_id)},
    }])
    assert signals[0]["severity"] == "EXACT"
    assert "título normalizado idéntico" in signals[0]["reasons"]


def test_traceability_mutations_publish_project_events():
    published = []

    class EventBus:
        async def publish(self, project_id, event_type, **kwargs):
            published.append((project_id, event_type, kwargs))

    original_event_bus = traceability.realtime_event_bus
    traceability.realtime_event_bus = EventBus()
    try:
        item = SimpleNamespace(id=uuid.uuid4(), proyecto_id=uuid.uuid4(), codigo="REQ-001")
        user = SimpleNamespace(id=uuid.uuid4())
        asyncio.run(traceability._publish_traceability_change(item, user, "requirement", "created"))
    finally:
        traceability.realtime_event_bus = original_event_bus

    assert published == [
        (
            item.proyecto_id,
            "traceability.requirement.created",
            {"actor_id": user.id, "payload": {"requirement": {"id": str(item.id), "codigo": "REQ-001"}}},
        )
    ]


def test_negative_login_path_is_not_split_into_another_story():
    authentication = {
        "story_type": "USER_STORY", "title": "Iniciar sesión", "actor": "usuario registrado",
        "goal": "iniciar sesión", "benefit": "acceder a sus funciones",
        "acceptance_criteria": [{"title": "Credenciales inválidas", "given": "el usuario existe", "when": "ingresa una credencial inválida", "then": ["se rechaza el acceso"], "observable_result": "se muestra un error", "source_refs": ["REQ-002"]}],
    }
    split_failure = {
        "story_type": "TECHNICAL_STORY", "title": "Rechazo de credenciales inválidas", "actor": "sistema de autenticación",
        "goal": "rechazar credenciales inválidas", "benefit": "proteger el acceso",
        "acceptance_criteria": [{"title": "Rechazo", "given": "hay un intento", "when": "la credencial es inválida", "then": ["se deniega el acceso"], "observable_result": "el acceso es rechazado", "source_refs": ["REQ-002"]}],
    }
    findings = validate_proposal(split_failure, set(), [authentication])
    assert any(item["code"] == "STORY_NEGATIVE_FLOW_SPLIT" for item in findings)


def test_v2_story_contract_requires_scope_boundaries_while_v1_remains_compatible():
    proposal = {
        "story_type": "USER_STORY",
        "title": "Consultar pedido",
        "actor": "cliente",
        "goal": "consultar su pedido",
        "benefit": "conocer su estado",
        "acceptance_criteria": [],
    }
    legacy_findings = validate_proposal(dict(proposal), set(), [], require_v2_fields=False)
    strict_findings = validate_proposal(dict(proposal), set(), [], require_v2_fields=True)
    assert {item["code"] for item in legacy_findings} >= {"STORY_SCOPE_MISSING", "STORY_OUT_OF_SCOPE_MISSING"}
    assert all(item["severity"] == "WARN" for item in legacy_findings if item["code"].startswith("STORY_"))
    assert {item["code"] for item in strict_findings} >= {"STORY_SCOPE_MISSING", "STORY_OUT_OF_SCOPE_MISSING"}
    assert all(item["severity"] == "FAIL" for item in strict_findings if item["code"] in {"STORY_SCOPE_MISSING", "STORY_OUT_OF_SCOPE_MISSING"})


def test_critical_generation_finding_is_an_auditable_user_decision_not_a_schema_veto():
    proposal = {
        "local_id": "PROP-001",
        "story_type": "USER_STORY",
        "title": "Gestionar acceso técnico",
        "actor": "sistema de autenticación",
        "goal": "validar credenciales",
        "benefit": "proteger acceso",
        "quality": {"testability": "FAIL"},
        "quality_override_accepted": True,
        "quality_override_reason": "El QA Lead revisó el alcance y lo mantendrá como borrador técnico.",
    }

    accepted = schemas.HistoriaGeneracionApplyStory(**proposal)
    assert accepted.quality_override_accepted is True
    assert accepted.quality_override_reason.startswith("El QA Lead")

    _invalid(
        schemas.HistoriaGeneracionApplyStory,
        **{**proposal, "quality_override_reason": "   "},
    )


def test_title_similarity_is_fast_advisory_and_ignores_stop_words():
    existing = [
        {"id": uuid.uuid4(), "codigo": "US-021", "titulo": "Gestionar sesiones de usuario"},
        {"id": uuid.uuid4(), "codigo": "US-022", "titulo": "Autorizar acceso por roles"},
    ]

    matches = find_title_similarities("Gestión de sesiones para usuarios", existing)

    assert len(matches) == 1
    assert matches[0]["codigo"] == "US-021"
    assert matches[0]["kind"] == "SIMILAR"
    assert find_title_similarities("Exportar resultados de pruebas", existing) == []

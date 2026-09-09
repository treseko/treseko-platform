from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from app import crud  # noqa: F401
from app.repositories.report_bug_payloads import _bug_issue_snapshot_dict
from app.services.api_evidence_policy import public_test_data_evidence_enabled
from app.repositories.ai_execution_callbacks import _chatbot_storage_payload
from app.services.conversational_bug_context import build_conversational_context


def _case(fmt="CONVERSACIONAL"):
    return SimpleNamespace(
        id=uuid4(), codigo="TC-PUBLIC-001", titulo="Fixture público",
        suite_id=None, componente_id=None, formato_prueba=SimpleNamespace(value=fmt),
        descripcion="Caso sintético para replicar.", precondiciones="Servicio disponible.",
        postcondiciones="La evidencia permite repetir el escenario.",
    )


def _execution(case):
    return SimpleNamespace(
        id=uuid4(), version_ejecutada="1", execution_mode="MANUAL",
        estado_resultado="FALLO", duracion_segundos=1,
        fecha_ejecucion=datetime.now(timezone.utc), ai_failure_category=None,
        ai_confidence=None, ai_consensus=None, ai_human_review_required=False,
        ai_review_status=None, ai_review_note=None, chatbot_config_snapshot=None,
        chatbot_resultado=None,
    )


def _run(case):
    return SimpleNamespace(
        id=uuid4(), proyecto_id=uuid4(), build_id=None, entorno_id=None,
        dataset_id=None, nombre="Run público", entorno="Fixture QA",
        variables_resueltas={"public_token": "token-publico-123"},
        datasets_resueltos={str(case.id): []},
    )


def test_public_evidence_policy_is_format_independent_and_opt_in():
    environment = SimpleNamespace(configuracion_chatbot={"evidence_policy": {"public_test_data": True}})
    assert public_test_data_evidence_enabled(environment=environment, case=_case("CLASICA")) is True
    assert public_test_data_evidence_enabled(case=_case("CONVERSACIONAL")) is False


def test_execution_policy_wins_after_environment_changes():
    execution = SimpleNamespace(evidence_policy={"public_test_data": True})
    private_environment = SimpleNamespace(configuracion_api={"evidence_policy": {"public_test_data": False}})
    assert public_test_data_evidence_enabled(environment=private_environment, execution=execution) is True
    frozen_private_execution = SimpleNamespace(evidence_policy={"public_test_data": False})
    public_environment = SimpleNamespace(configuracion_api={"evidence_policy": {"public_test_data": True}})
    assert public_test_data_evidence_enabled(environment=public_environment, execution=frozen_private_execution) is False


def test_automated_chatbot_storage_redacts_without_public_test_data_opt_in():
    payload = {
        "request": {"headers": {"Authorization": "Bearer test-token"}},
        "response": {"message": "ok", "api_key": "test-secret"},
    }

    private = _chatbot_storage_payload(payload, sanitize_output=True)
    public = _chatbot_storage_payload(payload, sanitize_output=False)

    assert private["request"]["headers"]["Authorization"] == "[redacted]"
    assert private["response"]["api_key"] == "[redacted]"
    assert public == payload


def test_conversational_public_context_keeps_exact_values_and_default_redacts():
    case = _case()
    execution = _execution(case)
    run = _run(case)
    token = "token-publico-conversacional-123"
    config = {
        "evidence_policy": {"public_test_data": True},
        "connection": {"endpoint": "https://fixture.test", "headers": {"Authorization": f"Bearer {token}"}},
        "conversation": {"turns": [{"input": {"mode": "fixed", "text": f"usar {token}"}, "expected": {"must_include": ["ok"]}}]},
    }
    result = {"status": "FAILED", "turns": [{"message": "hola", "responseText": f"respuesta {token}", "status": "FAILED", "statusCode": 500}]}

    public_context = build_conversational_context(
        execution=execution, run=run, case=case, chatbot_config=config,
        chatbot_result=result, requested_turn=0, finding_type="HTTP_FAILURE",
    )
    assert public_context["evidence_policy"]["public_test_data"] is True
    assert token in public_context["case_snapshot"]["chatbot_config"]["connection"]["headers"]["Authorization"]
    assert token in public_context["conversation_turns"][0]["message"]
    assert token in public_context["conversation_turns"][0]["observed"]["responseText"]

    private_context = build_conversational_context(
        execution=execution, run=run, case=case,
        chatbot_config={"connection": {"headers": {"Authorization": f"Bearer {token}"}}},
        chatbot_result=result, requested_turn=0, finding_type="HTTP_FAILURE",
    )
    assert private_context["evidence_policy"]["public_test_data"] is False
    assert token not in str(private_context["case_snapshot"]["chatbot_config"])


def test_classic_public_bug_payload_keeps_execution_values_and_comments():
    class OptionalBug(SimpleNamespace):
        def __getattr__(self, name):
            return None

    token = "token-publico-clasico-123"
    bug = OptionalBug(
        id=uuid4(), codigo="BUG-CLASICO-1", titulo="Paso clásico falló",
        descripcion=f"El paso recibió {token}", precondiciones="Usuario fixture disponible",
        pasos_reproduccion="1. Ejecutar el caso", datos_prueba=f"Authorization: Bearer {token}",
        resultado_esperado="El flujo debe pasar", resultado_obtenido=f"Falló con token={token}",
        comportamiento_actual=None, url_afectada=None, navegador=None, dispositivo=None,
        sistema_operativo=None, ambiente_nombre="Fixture QA", version_app="1",
        logs_relevantes=f"token={token}", error_tecnico=None, notas_qa="observación pública",
        metadata_json={"format": "CLASICO", "evidence_policy": {"public_test_data": True}, "case_postconditions": "Fin correcto"},
        tipo_contexto="CLASICO", comments=[SimpleNamespace(id=uuid4(), comentario=f"revisar {token}", autor_id=None, created_at=None)],
        attachments=[], proyecto_id=uuid4(), componente_id=None, build_id=None, caso_id=None,
        test_run_id=None, ejecucion_id=None, snapshot_id=None, execution_mode="MANUAL",
        chatbot_turn_index=None, chatbot_finding_type=None, created_at=None, updated_at=None,
        reproducibilidad=None, frecuencia=None, criticidad="MEDIA", bloquea_release=False,
        bloquea_caso=False, numero_paso=1, case_code="TC-CLASICO-1", build_code="B1",
        estado="ABIERTO", severidad="MEDIA", prioridad="P2", origen="ejecucion_manual",
    )

    payload = _bug_issue_snapshot_dict(bug)
    assert payload["public_test_data"] is True
    assert token in payload["datos_prueba"]
    assert token in payload["comments"][0]["comentario"]


def test_public_classic_and_conversational_markdown_keeps_reproduction_values():
    class OptionalBug(SimpleNamespace):
        def __getattr__(self, name):
            return None

    token = "token-publico-reporte-123"
    classic_bug = OptionalBug(
        codigo="BUG-CLASICO-PUBLIC-1", titulo="Paso clásico reproducible",
        descripcion=f"El paso usa {token}", datos_prueba=f"token={token}",
        resultado_esperado="El paso debe pasar", resultado_obtenido=f"Falló con {token}",
        tipo_contexto="CLASICO",
        metadata_json={"format": "CLASICO", "evidence_policy": {"public_test_data": True}},
        attachments=[], external_links=[], comments=[], proyecto_id=uuid4(),
    )
    classic_markdown = crud.generate_bug_markdown(classic_bug)
    assert crud._escape_bug_export_markdown(token) in classic_markdown

    conversational_bug = OptionalBug(
        codigo="BUG-CHAT-PUBLIC-1", titulo="Turno reproducible", descripcion="Fixture conversacional",
        resultado_esperado="Debe responder ok", resultado_obtenido="Respondió error",
        tipo_contexto="CONVERSACIONAL", chatbot_turn_index=0, chatbot_finding_type="HTTP_FAILURE",
        metadata_json={"format": "CONVERSACIONAL", "evidence_policy": {"public_test_data": True}},
        conversational_context=SimpleNamespace(
            conversation_turns=[{
                "turn_number": 1, "status": "FAILED", "message": f"usar {token}",
                "expected": {"must_include": [token]}, "observed": {"responseText": f"respuesta {token}"},
            }], evaluation={}, technical_evidence={},
        ),
        attachments=[], external_links=[], comments=[], proyecto_id=uuid4(),
    )
    conversational_markdown = crud.generate_bug_markdown(conversational_bug)
    assert crud._escape_bug_export_markdown(token) in conversational_markdown

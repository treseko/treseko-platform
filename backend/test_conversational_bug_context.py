import os
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from app.schema_sections.bugs import BugIssueUpdate
from app.services.ai_report_sanitizer import sanitize_ai_report_payload
from app.services.conversational_bug_context import build_conversational_context
from app.repositories.bug_payload_validation import compute_conversational_bug_dedupe_hash


def test_chatbot_evidence_redacts_secrets_before_persistence_or_export():
    sanitized = sanitize_ai_report_payload({
        "turns": [{"message": "Mi dato es café", "responseText": "Guardado"}],
        "request_response": {"Authorization": "Bearer super-secret", "api_token": "super-secret"},
    })
    assert "super-secret" not in str(sanitized)
    assert sanitized["request_response"]["Authorization"] == "[redacted]"


def test_chatbot_finding_type_is_controlled():
    assert BugIssueUpdate(chatbot_finding_type="MEMORY_FAILURE").chatbot_finding_type == "MEMORY_FAILURE"
    with pytest.raises(ValueError):
        BugIssueUpdate(chatbot_finding_type="validation")


def test_conversational_bug_dedupe_accepts_numeric_case_version():
    dedupe_hash = compute_conversational_bug_dedupe_hash({
        "proyecto_id": "project-1",
        "case_master_id": "case-master-1",
        "case_version": 1,
        "chatbot_finding_type": "HTTP_FAILURE",
        "chatbot_turn_index": 0,
        "resultado_esperado": "HTTP 200",
        "resultado_obtenido": "HTTP 500",
    })

    assert len(dedupe_hash) == 64


def test_conversational_context_matches_legacy_one_based_observed_turns():
    class Case:
        id = "case-1"
        codigo = "TC-CHAT-001"
        titulo = "Memoria"
        suite_id = None
        componente_id = None
        descripcion = "Recordar un dato"
        precondiciones = "Chatbot disponible"
        postcondiciones = "La respuesta conserva el dato"

    class Execution:
        id = "execution-1"
        version_ejecutada = 1
        execution_mode = "MANUAL"
        estado_resultado = "FALLO"
        duracion_segundos = 1
        fecha_ejecucion = None
        ai_failure_category = None
        ai_confidence = None
        ai_consensus = None
        ai_human_review_required = False
        ai_review_status = None
        ai_review_note = None

    class Run:
        id = "run-1"
        proyecto_id = "project-1"
        build_id = None
        entorno_id = None
        dataset_id = None
        nombre = "Run"
        entorno = "QA"
        variables_resueltas = {}
        datasets_resueltos = {}

    context = build_conversational_context(
        execution=Execution(),
        run=Run(),
        case=Case(),
        chatbot_config={"conversation": {"turns": [{"order": 1, "input": {"text": "hola"}}, {"order": 2, "input": {"text": "¿qué dije?"}}]}},
        chatbot_result={"turns": [{"index": 1, "message": "hola", "responseText": "Hola", "latencyMs": 27, "statusCode": 200, "assertions": [{"passed": True, "rule": "must_include"}], "request": {"message": "hola"}, "response": {"text": "Hola"}}]},
        requested_turn=0,
        finding_type="INVALID_RESPONSE",
    )

    assert context["conversation_turns"][0]["technical_index"] == 0
    assert context["conversation_turns"][0]["status"] != "NOT_EXECUTED"
    assert context["conversation_turns"][1]["status"] == "NOT_EXECUTED"
    assert context["conversation_turns"][0]["latency_ms"] == 27
    assert context["conversation_turns"][0]["assertions"][0]["passed"] is True
    assert context["conversation_turns"][0]["request"]["message"] == "hola"

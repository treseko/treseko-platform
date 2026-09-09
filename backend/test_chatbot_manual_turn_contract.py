import pytest
from types import SimpleNamespace
from uuid import uuid4

from app import models, schemas
from app.api.routers import chatbot_manual_execution
from app.api.routers.chatbot_manual_execution import _configured_manual_message, _manual_evidence_payload, _require_manual_turn
from app.repositories.chatbot_execution import _resolve_chatbot_dynamic_inputs
from app.services.api_dynamic_variables import DynamicVariableContext
from app.services.chatbot_manual_evaluation import evaluate_manual_chatbot_turn, manual_result_suggestion
from app.services.chatbot_turns import configured_turn_index, executed_turn_index, find_executed_turn


def _config(*turns):
    return {"conversation": {"turns": list(turns)}}


def _fixed(text):
    return {"input": {"mode": "fixed", "text": text}}


def test_manual_contract_returns_next_fixed_message_in_order():
    config = _config(_fixed("hola"), _fixed("¿cómo estás?"))

    assert _configured_manual_message(config, 0) == "hola"
    assert _configured_manual_message(config, 1) == "¿cómo estás?"


def test_manual_contract_accepts_frozen_dynamic_template_after_context_resolution():
    frozen = _config(_fixed("hola {{$randomUUID}}"))
    dynamic = DynamicVariableContext("manual-dynamic")
    resolved = {"conversation": {"turns": [{"input": {"mode": "fixed", "text": dynamic.resolve_string("hola {{$randomUUID}}")}}]}}

    assert _configured_manual_message(frozen, 0) == "hola {{$randomUUID}}"
    assert _configured_manual_message(resolved, 0, dynamic) == _configured_manual_message(resolved, 0)


def test_manual_contract_rejects_missing_or_generated_turns():
    with pytest.raises(Exception) as completed:
        _configured_manual_message(_config(_fixed("hola")), 1)
    assert completed.value.status_code == 409

    with pytest.raises(Exception) as generated:
        _configured_manual_message(_config({"input": {"mode": "profile_generated", "instruction": "saludá"}}), 0)
    assert generated.value.status_code == 409


def test_chatbot_dynamic_values_resolve_inputs_without_changing_expectations():
    dynamic = DynamicVariableContext("chatbot-inputs")
    config = {
        "connection": {"endpoint": "http://chat.test/{{$randomUUID}}"},
        "conversation": {
            "turns": [{
                "input": {"mode": "fixed", "text": "Hola {{$randomFirstName}}"},
                "expected": {"semantic": "Debe incluir {{$randomFirstName}}"},
            }],
        },
    }

    resolved = _resolve_chatbot_dynamic_inputs(config, {}, dynamic)

    assert "{{$randomUUID}}" not in resolved["connection"]["endpoint"]
    assert "{{$randomFirstName}}" not in resolved["conversation"]["turns"][0]["input"]["text"]
    assert resolved["conversation"]["turns"][0]["expected"]["semantic"] == "Debe incluir {{$randomFirstName}}"


def test_manual_completion_requires_at_least_one_turn():
    with pytest.raises(Exception) as missing:
        _require_manual_turn({"turns": []})
    assert missing.value.status_code == 409

    _require_manual_turn({"turns": [{"message": "hola"}]})


def test_chatbot_turn_contract_maps_legacy_visible_index_to_zero_based():
    assert executed_turn_index({"index": 1, "message": "hola"}, 0) == 0
    assert executed_turn_index({"index": 2, "message": "ayuda"}, 1) == 1
    assert executed_turn_index({"technical_index": 0, "index": 1}, 7) == 0
    assert find_executed_turn([{"index": 1, "message": "hola"}], 0)["message"] == "hola"


def test_configured_order_is_visible_one_based_but_technical_zero_based():
    assert configured_turn_index({"order": 1}, 10) == 0
    assert configured_turn_index({"order": 3}, 10) == 2
    assert configured_turn_index({"technical_index": 4, "order": 1}, 0) == 4


def _turn(response_text="respuesta", status_code=200, response=None, response_json_valid=True):
    return {
        "message": "hola",
        "responseText": response_text,
        "response": response if response is not None else {"message": response_text},
        "statusCode": status_code,
        "response_json_valid": response_json_valid,
        "status": "PASSED",
    }


def test_manual_evaluation_marks_http_failure_and_suggests_failure():
    turn = evaluate_manual_chatbot_turn(_turn("error", 500), _config(_fixed("hola")), 0)

    assert turn["status"] == "FAILED"
    assert turn["failure_type"] == "HTTP_FAILURE"
    assert manual_result_suggestion({"turns": [turn]}) == ("FALLO", "HTTP_FAILURE")


def test_manual_evaluation_marks_expected_mismatch_for_http_200():
    config = _config({**_fixed("hola"), "expected": {"must_include": ["cafe"]}})
    turn = evaluate_manual_chatbot_turn(_turn("No puedo ayudarte"), config, 0)

    assert turn["status"] == "FAILED"
    assert turn["failure_type"] == "TURN_EXPECTATION_MISMATCH"
    assert turn["assertions"][0]["passed"] is False


def test_manual_evaluation_passes_matching_deterministic_expectation():
    config = _config({**_fixed("hola"), "expected": {"must_include": ["cafe"]}})
    turn = evaluate_manual_chatbot_turn(_turn("Te ayudo con cafe"), config, 0)

    assert turn["status"] == "PASSED"
    assert turn["failure_type"] is None
    assert manual_result_suggestion({"turns": [turn]}) == ("PASO", None)


@pytest.mark.parametrize("response_format", ["auto", "text"])
def test_manual_evaluation_accepts_extracted_plain_text_without_json(response_format):
    config = _config(_fixed("hola"))
    config["connection"] = {"response_mapping": {"response_format": response_format}}
    turn = _turn("respuesta del chatbot", response="", response_json_valid=False)

    evaluated = evaluate_manual_chatbot_turn(turn, config, 0)

    assert evaluated["status"] == "PASSED"
    assert evaluated["failure_type"] is None


def test_manual_evaluation_still_rejects_non_json_response_when_json_is_required():
    config = _config(_fixed("hola"))
    config["connection"] = {"response_mapping": {"response_format": "json"}}
    turn = _turn("respuesta del chatbot", response="", response_json_valid=False)

    evaluated = evaluate_manual_chatbot_turn(turn, config, 0)

    assert evaluated["status"] == "FAILED"
    assert evaluated["failure_type"] == "INVALID_RESPONSE"


def test_manual_evaluation_marks_no_response_as_blocked_suggestion():
    turn = evaluate_manual_chatbot_turn(_turn("", 0, None, False), _config(_fixed("hola")), 0)

    assert turn["failure_type"] == "NO_RESPONSE"
    assert manual_result_suggestion({"turns": [turn]}) == ("BLOQUEADO", "NO_RESPONSE")


def test_manual_evaluation_keeps_semantic_expectation_for_human_review():
    config = _config({**_fixed("hola"), "expected": {"semantic": "responder amablemente"}})
    turn = evaluate_manual_chatbot_turn(_turn("respuesta"), config, 0)

    assert turn["status"] == "PASSED"
    assert turn["automatic_evaluation"]["requires_human_review"] is True


def test_manual_evidence_is_sanitized_by_default_and_complete_only_with_opt_in():
    payload = {
        "request": {
            "headers": {"Authorization": "Bearer token-for-tests"},
            "body": {"api_key": "secret-for-tests", "message": "hola"},
        },
        "response": {"message": "respuesta", "access_token": "response-secret"},
    }

    safe = _manual_evidence_payload(payload, public_evidence=False)
    complete = _manual_evidence_payload(payload, public_evidence=True)

    assert safe["request"]["headers"]["Authorization"] == "[redacted]"
    assert safe["request"]["body"]["api_key"] == "[redacted]"
    assert safe["response"]["access_token"] == "[redacted]"
    assert complete == payload


@pytest.mark.asyncio
async def test_manual_turn_persists_sanitized_config_and_exchange_by_default(monkeypatch):
    case_id = uuid4()
    execution = SimpleNamespace(
        id=uuid4(), caso_id=case_id, estado_resultado=models.EstadoResultado.SIN_CORRER,
        chatbot_resultado={}, chatbot_config_snapshot={}, evidence_policy={},
        dynamic_seed="seed", dynamic_variables={},
    )
    run = SimpleNamespace(id=uuid4(), proyecto_id=uuid4(), build_id=None, entorno_id=None, dataset_id=None, entorno="QA")
    case = SimpleNamespace(
        id=case_id, codigo="TC-CHAT-001", formato_prueba=models.FormatoPrueba.CONVERSACIONAL,
        configuracion_chatbot={"connection": {"headers": {"Authorization": "Bearer config-secret"}}, "conversation": {"turns": [{"input": {"mode": "fixed", "text": "hola"}}]}},
    )
    context = {
        "config": case.configuracion_chatbot,
        "variables": {}, "dataset": [], "baseUrl": "https://chat.example",
        "environment": "QA", "missing_variables": [], "missing_profile_variables": [],
        "profile_sources": {}, "dynamic_seed": "seed", "dynamic_variables": {},
    }
    dynamic_context = DynamicVariableContext("seed")

    class FakeDb:
        async def commit(self):
            return None

    async def fake_access(*_args, **_kwargs):
        return execution, run

    async def fake_load(*_args, **_kwargs):
        return case, context, dynamic_context, case.configuracion_chatbot, None, False

    async def fake_send(**_kwargs):
        return {
            "response": {"message": "respuesta", "access_token": "response-secret"},
            "responseText": "respuesta", "statusCode": 200, "latencyMs": 1,
            "status": "PASSED", "response_json_valid": True,
            "request": {"headers": {"Authorization": "Bearer request-secret"}},
        }

    async def fake_event(**_kwargs):
        return None

    monkeypatch.setattr(chatbot_manual_execution, "_require_execution_access", fake_access)
    monkeypatch.setattr(chatbot_manual_execution, "_load_context", fake_load)
    monkeypatch.setattr(chatbot_manual_execution, "send_chatbot_turn", fake_send)
    monkeypatch.setattr(chatbot_manual_execution.notification_event_service, "emit_event", fake_event)

    response = await chatbot_manual_execution.send_chatbot_manual_turn(
        execution.id, schemas.ChatbotManualTurnRequest(message="hola"), FakeDb(), SimpleNamespace(id=uuid4())
    )

    assert execution.evidence_policy["public_test_data"] is False
    assert execution.chatbot_config_snapshot["config"]["connection"]["headers"]["Authorization"] == "[redacted]"
    persisted_turn = execution.chatbot_resultado["turns"][0]
    assert persisted_turn["response"]["access_token"] == "[redacted]"
    assert response["chatbot_resultado"] == execution.chatbot_resultado

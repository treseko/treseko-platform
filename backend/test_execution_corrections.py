from copy import deepcopy
from types import SimpleNamespace as NS
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app import models, schemas
from app.api.routers import chatbot_manual_execution as mod
from app.services.api_dynamic_variables import DynamicVariableContext
from app.services.chatbot_manual_context import freeze_manual_context, thaw_manual_context


def objects():
    config = {'connection': {'endpoint': 'https://chat-a.test/turn', 'headers': {'Authorization': 'Bearer fixture-secret'}},
              'conversation': {'turns': [{'input': {'mode': 'fixed', 'text': 'hola'}},
                                         {'input': {'mode': 'fixed', 'text': 'ayuda'}, 'expected': {'must_include': ['cafe']}}]}}
    case = NS(id=uuid4(), codigo='QA', formato_prueba=models.FormatoPrueba.CONVERSACIONAL, configuracion_chatbot=config)
    run = NS(id=uuid4(), proyecto_id=uuid4(), build_id=None, entorno_id=None, dataset_id=None, entorno='QA', dynamic_seed='qa')
    execution = NS(id=uuid4(), caso_id=case.id, dynamic_seed='qa', dynamic_variables={}, chatbot_config_snapshot={}, chatbot_resultado={},
                   evidence_policy={'public_test_data': False}, estado_resultado=models.EstadoResultado.SIN_CORRER)
    return case, run, execution


def test_private_context_preserves_connection_and_keeps_credentials_out_of_evidence():
    case, run, execution = objects()
    environment = NS(url='https://chat-a.test', variables={'tenant': 'original'}, configuracion_chatbot={'connection': {'allowed_hosts': ['chat-a.test']}})
    freeze_manual_context(execution, case, run, {'variables_resueltas': {'customer': 'original'}, 'dataset_resuelto': []}, environment)
    environment.url = 'https://changed.test'
    environment.configuracion_chatbot = {'connection': {'allowed_hosts': ['changed.test']}}
    case.configuracion_chatbot['connection']['endpoint'] = 'https://chat-b.test/turn'
    restored = thaw_manual_context(execution)
    assert restored['environment']['url'] == 'https://chat-a.test'
    assert restored['environment']['configuracion_chatbot']['connection']['allowed_hosts'] == ['chat-a.test']
    assert restored['context']['config']['connection']['endpoint'] == 'https://chat-a.test/turn'
    assert restored['context']['config']['connection']['headers']['Authorization'] == 'Bearer fixture-secret'
    assert execution.chatbot_config_snapshot['config']['connection']['headers']['Authorization'] == '[redacted]'
    assert 'fixture-secret' not in execution.chatbot_manual_context_secret
    assert 'chatbot_manual_context_secret' not in schemas.EjecucionCaso.model_fields


def test_legacy_redacted_context_never_uses_current_credentials():
    case, run, execution = objects()
    execution.chatbot_config_snapshot = {'config': {'connection': {'headers': {'Authorization': '[redacted]'}}}}
    with pytest.raises(HTTPException) as error:
        thaw_manual_context(execution)
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_loader_uses_private_snapshot_without_resolving_live_environment(monkeypatch):
    case, run, execution = objects()
    freeze_manual_context(execution, case, run, {})
    case.configuracion_chatbot['connection']['endpoint'] = 'https://changed.test'
    class Db:
        async def get(self, *args): return case
    async def forbidden(*args): raise AssertionError('A frozen run must not read current variables')
    monkeypatch.setattr(mod.crud, 'resolve_case_dataset', forbidden)
    _, context, _, template, _, _ = await mod._load_context(Db(), execution, run)
    assert context['config']['connection']['endpoint'] == template['connection']['endpoint'] == 'https://chat-a.test/turn'


class Db:
    def __init__(self): self.commits = 0
    async def commit(self): self.commits += 1
    async def execute(self, *args): return NS(scalar_one_or_none=lambda: None)


def patch_routes(monkeypatch, case, run, execution):
    context = {'config': deepcopy(case.configuracion_chatbot), 'variables': {}, 'dataset': []}
    async def access(*args, **kwargs): return execution, run
    async def load(*args, **kwargs): return case, context, DynamicVariableContext('qa'), context['config'], None, False
    async def event(**kwargs): pass
    monkeypatch.setattr(mod, '_require_execution_access', access)
    monkeypatch.setattr(mod, '_load_context', load)
    monkeypatch.setattr(mod.notification_event_service, 'emit_event', event)


@pytest.mark.asyncio
async def test_turn_metrics_separate_http_failure_and_assertion_failure_and_use_nearest_rank(monkeypatch):
    case, run, execution = objects()
    execution.chatbot_resultado = {'turns': [{'message': 'hola', 'responseText': 'ok', 'status': 'PASSED', 'statusCode': 200, 'latencyMs': 1}]}
    patch_routes(monkeypatch, case, run, execution)
    async def send(**kwargs):
        return {'responseText': 'respuesta incorrecta', 'response': {'message': 'respuesta incorrecta'}, 'statusCode': 200, 'latencyMs': 100, 'response_json_valid': True, 'request': {}}
    monkeypatch.setattr(mod, 'send_chatbot_turn', send)
    await mod.send_chatbot_manual_turn(execution.id, schemas.ChatbotManualTurnRequest(message='ayuda'), Db(), NS(id=uuid4()))
    assert execution.chatbot_resultado['turns'][-1]['status'] == 'FAILED'
    assert execution.chatbot_resultado['performance']['http_error_count'] == 0
    assert execution.chatbot_resultado['performance']['p95_latency_ms'] == 100


@pytest.mark.asyncio
@pytest.mark.parametrize('status,notes,expected', [('PASO', None, 409), ('FALLO', None, 400), ('BLOQUEADO', None, 400), ('FALLO', 'Respuesta incorrecta', 200), ('BLOQUEADO', 'Servicio no responde', 200)])
async def test_incomplete_conversation_requires_failure_or_block_and_reason(monkeypatch, status, notes, expected):
    case, run, execution = objects()
    execution.chatbot_resultado = {'turns': [{'message': 'hola', 'statusCode': 200}]}
    patch_routes(monkeypatch, case, run, execution)
    db = Db()
    if expected != 200:
        with pytest.raises(HTTPException) as error:
            await mod.complete_chatbot_manual_execution(execution.id, schemas.ChatbotManualCompleteRequest(status=status, notes=notes), db, NS(id=uuid4()))
        assert error.value.status_code == expected
        assert db.commits == 0
        assert execution.estado_resultado == models.EstadoResultado.SIN_CORRER
    else:
        result = await mod.complete_chatbot_manual_execution(execution.id, schemas.ChatbotManualCompleteRequest(status=status, notes=notes), db, NS(id=uuid4()))
        assert result['status'] == status and db.commits == 1


@pytest.mark.asyncio
async def test_complete_conversation_can_pass(monkeypatch):
    case, run, execution = objects()
    execution.chatbot_resultado = {'turns': [{'message': 'hola'}, {'message': 'ayuda'}]}
    patch_routes(monkeypatch, case, run, execution)
    result = await mod.complete_chatbot_manual_execution(execution.id, schemas.ChatbotManualCompleteRequest(status='PASO'), Db(), NS(id=uuid4()))
    assert result['status'] == 'PASO'

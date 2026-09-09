import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app import schemas
from app.api.routers import chatbot_connection
from app.services.chatbot_config import normalize_chatbot_config
from app.services import chatbot_http
from app.services.chatbot_http import send_chatbot_turn, validate_chatbot_destination


def _transport(handler):
    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_generic_http_accepts_plain_text_in_auto_mode():
    async def handler(request):
        assert request.method == "POST"
        assert json.loads(request.content)["message"] == "hola"
        return httpx.Response(200, text="respuesta del bot", headers={"content-type": "text/plain"})

    result = await send_chatbot_turn(
        config={"connection": {"adapter": "generic_http", "endpoint": "https://chat.example/chat"}},
        variables={}, message="hola", session_id=None, history=[], turn_index=1,
        transport=_transport(handler),
    )

    assert result["status"] == "PASSED"
    assert result["responseText"] == "respuesta del bot"
    assert result["response_type"] == "text"
    assert result["extraction_error"] is None


@pytest.mark.asyncio
async def test_json_response_reports_configured_extraction_error():
    async def handler(_request):
        return httpx.Response(200, json={"answer": "ok"})

    result = await send_chatbot_turn(
        config={"connection": {"endpoint": "https://chat.example/chat", "response_mapping": {"response_format": "json", "message_path": "$.data.message"}}},
        variables={}, message="hola", session_id=None, history=[], turn_index=1,
        transport=_transport(handler),
    )

    assert result["status"] == "FAILED"
    assert "message_path" in result["extraction_error"]
    assert result["responseText"] == ""


@pytest.mark.asyncio
async def test_openai_compatible_sends_messages_and_model_and_extracts_content():
    observed = {}

    async def handler(request):
        observed.update(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "hola desde compatible"}}]})

    result = await send_chatbot_turn(
        config={"connection": {"adapter": "openai_compatible", "endpoint": "https://chat.example/v1/chat/completions", "model": "local-model"}, "conversation": {"session_mode": "reuse"}},
        variables={}, message="hola", session_id="sesion-1", history=[{"role": "assistant", "content": "inicio"}], turn_index=1,
        transport=_transport(handler),
    )

    assert observed["model"] == "local-model"
    assert observed["messages"] == [
        {"role": "assistant", "content": "inicio"},
        {"role": "user", "content": "hola"},
    ]
    assert result["responseText"] == "hola desde compatible"
    assert result["status"] == "PASSED"


@pytest.mark.asyncio
async def test_session_mode_controls_reuse_between_turns():
    session_ids = []

    async def handler(request):
        session_ids.append(json.loads(request.content)["session_id"])
        return httpx.Response(200, json={"message": "ok"})

    config = {"connection": {"endpoint": "https://chat.example/chat"}, "conversation": {"session_mode": "new_each_turn"}}
    first = await send_chatbot_turn(config=config, variables={}, message="uno", session_id="same", history=[], turn_index=1, transport=_transport(handler))
    await send_chatbot_turn(config=config, variables={}, message="dos", session_id=first["session_id"], history=[], turn_index=2, transport=_transport(handler))
    assert len(session_ids) == 2
    assert session_ids[0] != session_ids[1]

    session_ids.clear()
    config["conversation"]["session_mode"] = "reuse"
    await send_chatbot_turn(config=config, variables={}, message="uno", session_id="same", history=[], turn_index=1, transport=_transport(handler))
    await send_chatbot_turn(config=config, variables={}, message="dos", session_id="same", history=[], turn_index=2, transport=_transport(handler))
    assert session_ids == ["same", "same"]


@pytest.mark.asyncio
async def test_response_limit_is_enforced_before_returning_preview(monkeypatch):
    monkeypatch.setattr(chatbot_http, "MAX_CHATBOT_RESPONSE_BYTES", 32)

    async def handler(_request):
        return httpx.Response(200, text="x" * 100, headers={"content-type": "text/plain"})

    result = await send_chatbot_turn(
        config={"connection": {"endpoint": "https://chat.example/chat", "response_mapping": {"response_format": "text"}}},
        variables={}, message="hola", session_id=None, history=[], turn_index=1,
        transport=_transport(handler),
    )

    assert result["response_truncated"] is True
    assert result["status"] == "FAILED"
    assert len(result["response"]) == 32


def test_private_chatbot_destination_is_rejected_by_environment_policy():
    environment = SimpleNamespace(url="https://chat.example", variables={}, configuracion_chatbot={})

    with pytest.raises(ValueError, match="allowlist"):
        validate_chatbot_destination(
            "http://127.0.0.1/chat",
            environment,
            {"connection": {"allowed_hosts": ["127.0.0.1"]}},
        )


def test_exact_private_ip_persisted_in_environment_is_allowed_for_self_hosted_chatbot():
    environment = SimpleNamespace(
        url="http://172.17.0.1:8091",
        variables={"ENV_KEY": "authoritative"},
        configuracion_chatbot={"connection": {"endpoint": "http://172.17.0.1:8091/chat"}},
    )

    validate_chatbot_destination(
        "http://172.17.0.1:8091/chat",
        environment,
        {"connection": {"endpoint": "http://172.17.0.1:8091/chat"}},
    )


@pytest.mark.asyncio
async def test_connection_preview_is_authenticated_scoped_and_does_not_persist(monkeypatch):
    project_id = uuid4()
    environment_id = uuid4()
    environment = SimpleNamespace(
        id=environment_id,
        proyecto_id=project_id,
        activo=True,
        url="https://chat.example",
        variables={"ENV_KEY": "authoritative"},
        configuracion_chatbot={"connection": {"endpoint": "https://chat.example/chat"}},
    )

    class FakeDb:
        commits = 0
        adds = 0

        async def get(self, model, identifier):
            return environment if identifier == environment_id else None

        async def commit(self):
            self.commits += 1

        def add(self, _value):
            self.adds += 1

    async def allow_project_access(*_args, **_kwargs):
        return project_id

    observed = {}

    async def fake_send(**kwargs):
        observed.update(kwargs)
        return {
            "status": "PASSED", "statusCode": 200, "latencyMs": 4,
            "responseText": "ok", "session_id": "session-1",
            "response_format": "auto", "response_type": "json",
            "request": {"headers": {"Authorization": "Bearer very-secret-token"}},
            "response": {"message": "ok", "token": "very-secret-token"},
            "response_headers": {"set-cookie": "very-secret-token"},
            "extraction_error": None, "response_truncated": False,
            "session_id_extracted": False,
        }

    monkeypatch.setattr(chatbot_connection.access_control, "require_project_access", allow_project_access)
    monkeypatch.setattr(chatbot_connection, "send_chatbot_turn", fake_send)
    db = FakeDb()
    payload = schemas.ChatbotConnectionTestRequest(
        entorno_id=environment_id,
        configuration={"connection": {"response_mapping": {"message_path": "$.message"}}},
        message="hola",
        variables={"ENV_KEY": "client-cannot-replace"},
    )

    response = await chatbot_connection.test_chatbot_connection(project_id, payload, db, SimpleNamespace())

    assert response["ok"] is True
    assert response["http_status"] == 200
    assert response["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert response["response"]["token"] == "[REDACTED]"
    assert response["response_headers"]["set-cookie"] == "[REDACTED]"
    assert response["session_detected"] is False
    assert observed["variables"]["ENV_KEY"] == "authoritative"
    assert db.commits == 0
    assert db.adds == 0


def test_connection_schema_accepts_config_aliases_without_changing_v2_normalization():
    payload = schemas.ChatbotConnectionTestRequest.model_validate({
        "entorno_id": str(uuid4()),
        "config": {"connection": {"adapter": "http"}},
        "message": "hola",
    })
    normalized = normalize_chatbot_config(payload.configuration)

    assert normalized["connection"]["adapter"] == "http"

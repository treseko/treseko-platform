from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import mcp_governance as gov
from app.services import mcp_tools


READ_TOOLS = {
    "treseko.test-runs.list": "mcp.test-runs.list",
    "treseko.test-runs.get": "mcp.test-runs.detail",
    "treseko.test-results.list": "mcp.test-results.list",
    "treseko.test-results.get": "mcp.test-results.detail",
}


def test_runs_and_results_are_closed_and_have_dedicated_scopes(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", ",".join(READ_TOOLS))
    tools = {item["name"]: item for item in gov.public_tools()}
    assert {item["required_scope"] for item in tools.values()} == set(READ_TOOLS.values())
    assert all(item["read_only"] and item["operation"] == "read" for item in tools.values())
    assert all(item["inputSchema"]["additionalProperties"] is False for item in tools.values())
    assert tools["treseko.test-results.list"]["inputSchema"]["required"] == ["project_id", "run_id"]


def test_run_and_result_arguments_are_bounded_and_uuid_checked(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", ",".join(READ_TOOLS))
    project_id = str(uuid4())
    run_list = gov.resolve_tool("treseko.test-runs.list")
    result_list = gov.resolve_tool("treseko.test-results.list")
    assert gov.validate_tool_arguments(run_list, {"project_id": project_id, "limit": 1, "offset": 0})["limit"] == 1
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(run_list, {"project_id": project_id, "limit": 101})
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(result_list, {"project_id": project_id, "run_id": "bad"})
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(result_list, {"project_id": project_id, "run_id": str(uuid4()), "extra": True})


def test_result_serializer_preserves_evidence_and_redacts_secrets():
    execution = SimpleNamespace(
        id=uuid4(), test_run_id=uuid4(), caso_id=uuid4(), version_ejecutada=2,
        estado_resultado="FALLO", execution_mode="AUTOMATIZADA", intento_numero=1,
        duracion_segundos=3, observaciones="x" * 5000,
        api_resultado={"status_code": 500, "password": "do-not-return", "logs": "hidden", "body": {"ok": False}},
        ai_report={"confidence": 40, "dynamic_variables": {"email": "qa@example.com", "secret": "hidden"}, "stack_trace": "hidden"},
        fecha_ejecucion=None,
    )
    out = mcp_tools._serialize_result(execution)
    assert len(out["observations"]) == 5000
    assert out["api_result"] == {"status_code": 500, "password": "[REDACTED]", "logs": "hidden", "body": {"ok": False}}
    assert out["ai_report"] == {"confidence": 40, "dynamic_variables": {"email": "qa@example.com", "secret": "[REDACTED]"}, "stack_trace": "hidden"}
    assert "snapshots" not in out and "dynamic_variables" not in out


def test_detailed_result_includes_execution_inputs_and_snapshots():
    execution = SimpleNamespace(
        id=uuid4(), test_run_id=uuid4(), caso_id=uuid4(), version_ejecutada=1,
        estado_resultado="PASÓ", execution_mode="AUTOMATIZADA", intento_numero=1,
        duracion_segundos=1, observaciones="ok", api_resultado={"request": {"email": "qa@example.com"}},
        ai_report={}, api_config_snapshot={"url": "/health", "token": "hidden"},
        chatbot_config_snapshot={}, chatbot_resultado={}, dynamic_variables={"email": "qa@example.com"},
        dynamic_seed="seed-1", fecha_ejecucion=None,
    )
    snapshot = SimpleNamespace(
        id=uuid4(), numero_paso=1, accion_congelada="Submit", datos_congelados="email=qa@example.com",
        datos_resueltos="email=qa@example.com", resultado_esperado_congelado="200",
        estado_paso="PASÓ", comentarios="body contains email", error_log="Bearer abc", evidencia_url="https://evidence/1",
    )
    out = mcp_tools._serialize_result(execution, snapshots=[snapshot], detail=True)
    assert out["api_config_snapshot"] == {"url": "/health", "token": "[REDACTED]"}
    assert out["dynamic_variables"] == {"email": "qa@example.com"}
    assert out["snapshots"][0]["resolved_data"] == "email=qa@example.com"
    assert out["snapshots"][0]["error_log"] == "Bearer [REDACTED]"


@pytest.mark.asyncio
async def test_run_handler_is_bounded_and_project_scoped():
    project_id = uuid4()
    rows = [SimpleNamespace(id=uuid4(), proyecto_id=project_id, build_id=None, nombre="run", entorno="qa",
                            origen="MANUAL", external_run_id=None, estado_run="CERRADO", fecha_creacion=None,
                            fecha_cierre=None) for _ in range(3)]

    class ScalarRows:
        def scalars(self):
            return self

        def all(self):
            return rows

    class DB:
        async def execute(self, statement):
            return ScalarRows()

        async def scalar(self, statement):
            return None

    listed = await mcp_tools.list_project_runs(DB(), None, SimpleNamespace(id=project_id), {"limit": 2, "offset": 0})
    assert len(listed["items"]) == 2 and listed["truncated"] is True
    with pytest.raises(LookupError):
        await mcp_tools.get_project_run(DB(), None, SimpleNamespace(id=project_id), {"run_id": str(uuid4())})

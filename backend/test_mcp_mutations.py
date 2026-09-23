from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.mcp_extended import _meta_attachment
from app.services.mcp_governance import TOOL_CATALOG
from app.services import mcp_mutations


def test_mutation_catalog_is_closed_and_confirmation_gated():
    for name in (
        "treseko.test-runs.create", "treseko.test-runs.execute", "treseko.test-runs.status", "treseko.test-runs.cancel",
        "treseko.cases.create", "treseko.cases.update", "treseko.cases.archive",
        "treseko.bugs.create-from-result", "treseko.bugs.create-from-snapshot", "treseko.bugs.update", "treseko.bugs.transition", "treseko.bugs.close",
    ):
        schema = TOOL_CATALOG[name].input_schema
        assert schema["additionalProperties"] is False
        if TOOL_CATALOG[name].operation == "commit":
            assert "confirmation" in schema["required"]
            assert "idempotency_key" in schema["required"]


def test_mcp_attachment_url_is_sanitized():
    attachment = SimpleNamespace(id="a", filename_original="x", content_type="text/plain", size=1, sha256="x", public_url="javascript:alert(1)")
    link = SimpleNamespace(id="l", attachment_id="a", tipo="RESULT", attachment=attachment)
    assert _meta_attachment(link)["url"] is None


@pytest.mark.asyncio
async def test_update_case_preserves_steps_when_steps_are_omitted(monkeypatch):
    case_id = "00000000-0000-0000-0000-000000000001"
    project_id = "00000000-0000-0000-0000-000000000002"
    case = SimpleNamespace(
        id=case_id,
        master_id="00000000-0000-0000-0000-000000000003",
        proyecto_id=project_id,
        titulo="Login",
        descripcion="Original",
        prioridad="MEDIA",
        criticidad="MEDIA",
        formato_prueba="CLASICA",
        tipo_prueba="MANUAL",
        dataset=[],
        configuracion_api={},
        suite_id=None,
        componente_id=None,
        version=1,
        activo=True,
    )
    current_steps = [
        SimpleNamespace(numero_paso=1, accion="Abrir login", datos=None, resultado_esperado="Se muestra el formulario"),
        SimpleNamespace(numero_paso=2, accion="Enviar credenciales", datos='{"user":"demo"}', resultado_esperado="Acceso concedido"),
    ]
    captured = {}

    class Result:
        def scalars(self):
            return self

        def all(self):
            return current_steps

    db = SimpleNamespace(
        scalar=AsyncMock(return_value=case),
        execute=AsyncMock(return_value=Result()),
    )

    async def fake_update(_db, _master_id, payload):
        captured["payload"] = payload
        return case

    monkeypatch.setattr(mcp_mutations.suites_cases, "update_caso_prueba", fake_update)

    await mcp_mutations.update_case(
        db,
        SimpleNamespace(id="user"),
        SimpleNamespace(id=project_id),
        {"case_id": case_id, "description": "Actualizada", "confirmation": "UPDATE_CASE"},
    )

    assert [step.accion for step in captured["payload"].pasos] == ["Abrir login", "Enviar credenciales"]
    assert [step.resultado_esperado for step in captured["payload"].pasos] == ["Se muestra el formulario", "Acceso concedido"]

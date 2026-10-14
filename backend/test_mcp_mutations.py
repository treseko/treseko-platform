from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

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
    step_data = TOOL_CATALOG["treseko.cases.create"].input_schema["properties"]["steps"]["items"]["properties"]["data"]
    assert step_data["anyOf"][0] == {"type": "string", "maxLength": 10000}
    assert step_data["anyOf"][1] == {"type": "null"}
    for name in ("treseko.cases.create", "treseko.cases.update"):
        properties = TOOL_CATALOG[name].input_schema["properties"]
        assert {"story_ids", "acceptance_criteria_ids"}.issubset(properties)


def test_mcp_attachment_url_is_sanitized():
    attachment = SimpleNamespace(id="a", filename_original="x", content_type="text/plain", size=1, sha256="x", public_url="javascript:alert(1)")
    link = SimpleNamespace(id="l", attachment_id="a", tipo="RESULT", attachment=attachment)
    assert _meta_attachment(link)["url"] is None


@pytest.mark.asyncio
async def test_execute_classic_automated_run_enqueues_playwright_jobs(monkeypatch):
    from app import models
    from app.repositories import automation_jobs
    from app.services.edition import usage_limits

    project_id, organization_id, run_id, case_id, execution_id, user_id, job_id = (uuid4() for _ in range(7))
    project = SimpleNamespace(id=project_id, organizacion_id=organization_id)
    user = SimpleNamespace(id=user_id)
    run = SimpleNamespace(id=run_id, proyecto_id=project_id, origen="AUTOMATIZADA",
                          estado_run=models.EstadoRun.ABIERTO)
    case = SimpleNamespace(id=case_id, proyecto_id=project_id, codigo="TC-1",
                           formato_prueba=models.FormatoPrueba.CLASICA,
                           tipo_prueba=models.TipoPrueba.AUTOMATIZADA,
                           script_automatizado="async ({page}) => { await page.goto('https://example.test'); }")
    execution = SimpleNamespace(id=execution_id, test_run_id=run_id, caso_id=case_id)
    created_job = SimpleNamespace(id=job_id, estado=models.AutomationJobStatus.PENDING)

    class Cases:
        def scalars(self): return self
        def unique(self): return self
        def all(self): return [case]

    class Executions:
        def all(self): return [(execution, case)]

    db = SimpleNamespace(scalar=AsyncMock(return_value=run), execute=AsyncMock(side_effect=[Cases(), Executions()]))
    quota = AsyncMock()

    async def create_job(_db, _execution_id, _user_id, *, commit, quota_checked):
        assert commit is False and quota_checked is True
        return created_job

    monkeypatch.setattr(automation_jobs, "create_automation_job_for_execution", create_job)
    monkeypatch.setattr(usage_limits, "enforce_weekly_automated_execution_limit", quota)

    result = await mcp_mutations.execute_test_run(
        db, user, project, {"run_id": str(run_id)}
    )

    assert result["accepted"] is True
    assert result["runner"] == "playwright_worker"
    assert result["dispatch_status"] == "PENDING"
    assert result["jobs"] == [{"job_id": str(job_id), "execution_id": str(execution_id),
                               "case_id": str(case_id), "status": "PENDING"}]
    quota.assert_awaited_once_with(db, solution_id=organization_id, increment=1)


@pytest.mark.asyncio
async def test_classic_manual_run_is_not_dispatched_as_playwright(monkeypatch):
    from app import models

    project_id, run_id, case_id = uuid4(), uuid4(), uuid4()
    run = SimpleNamespace(id=run_id, proyecto_id=project_id, origen="MANUAL",
                          estado_run=models.EstadoRun.ABIERTO)
    case = SimpleNamespace(id=case_id, proyecto_id=project_id,
                           formato_prueba=models.FormatoPrueba.CLASICA,
                           tipo_prueba=models.TipoPrueba.MANUAL, script_automatizado=None)

    class Cases:
        def scalars(self): return self
        def unique(self): return self
        def all(self): return [case]

    db = SimpleNamespace(scalar=AsyncMock(return_value=run), execute=AsyncMock(return_value=Cases()))
    with pytest.raises(ValueError, match="requiere origen AUTOMATIZADA"):
        await mcp_mutations.execute_test_run(
            db, SimpleNamespace(id=uuid4()), SimpleNamespace(id=project_id), {"run_id": str(run_id)}
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("job_status", "expected_dispatch"),
    [("PENDING", "PENDING"), ("RUNNING", "RUNNING"), ("FAILED", "COMPLETED"), ("CANCELLED", "CANCELLED")],
)
async def test_status_reports_playwright_job_state(job_status, expected_dispatch):
    from app import models

    project_id, run_id, job_id, execution_id, case_id = (uuid4() for _ in range(5))
    run = SimpleNamespace(id=run_id, proyecto_id=project_id, build_id=None,
                          nombre="run", estado_run=models.EstadoRun.ABIERTO)
    worker_job = SimpleNamespace(id=job_id, ejecucion_id=execution_id, caso_id=case_id,
                                 estado=models.AutomationJobStatus(job_status), fecha_creacion=None)

    class Rows:
        def scalars(self): return self
        def all(self): return [worker_job]

    db = SimpleNamespace(scalar=AsyncMock(return_value=run), get=AsyncMock(return_value=None),
                         execute=AsyncMock(return_value=Rows()))
    result = await mcp_mutations.status_test_run(
        db, None, SimpleNamespace(id=project_id), {"run_id": str(run_id)}
    )

    assert result["dispatch_status"] == expected_dispatch
    assert result["runner"] == "playwright_worker"
    assert result["jobs"] == [{"job_id": str(job_id), "execution_id": str(execution_id),
                               "case_id": str(case_id), "status": job_status}]


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

    async def fake_update(_db, _master_id, payload, *, commit):
        assert commit is False
        captured["payload"] = payload
        return case

    from app.repositories import case_mutation_policy
    monkeypatch.setattr(case_mutation_policy, "current_case_for_write", AsyncMock(return_value=case))
    monkeypatch.setattr(mcp_mutations.suites_cases, "update_caso_prueba", fake_update)

    await mcp_mutations.update_case(
        db,
        SimpleNamespace(id="00000000-0000-0000-0000-000000000004"),
        SimpleNamespace(id=project_id),
        {"case_id": case_id, "description": "Actualizada", "confirmation": "UPDATE_CASE"},
    )

    assert [step.accion for step in captured["payload"].pasos] == ["Abrir login", "Enviar credenciales"]
    assert [step.resultado_esperado for step in captured["payload"].pasos] == ["Se muestra el formulario", "Acceso concedido"]


@pytest.mark.asyncio
async def test_case_traceability_replaces_story_and_criterion_links():
    from app.models import AcceptanceCriterionCase, CasoHistoria
    project_id, story_id, criterion_id = uuid4(), uuid4(), uuid4()
    story = SimpleNamespace(id=story_id, ultima_actualizacion=None)
    criterion = SimpleNamespace(id=criterion_id, historia_id=story_id)
    added, statements = [], []

    class Result:
        def __init__(self, rows=()): self.rows = list(rows)
        def scalars(self): return self
        def all(self): return self.rows

    # Select statements are filtered by the relevant table. Return the matching
    # row for each validator query without coupling the test to SQLAlchemy internals.
    class FakeDB:
        async def execute(self, statement):
            statements.append(statement)
            sql = str(statement).lower()
            return Result([criterion] if "acceptance_criteria" in sql else [story] if "historias_usuario" in sql else [])
        def add(self, value): added.append(value)
        async def flush(self): pass

    case = SimpleNamespace(master_id=uuid4())
    story_ids, criterion_ids = await mcp_mutations._replace_case_traceability(
        FakeDB(), SimpleNamespace(id=uuid4()), SimpleNamespace(id=project_id), case,
        {"story_ids": [str(story_id)], "acceptance_criteria_ids": [str(criterion_id)]},
    )
    assert story_ids == [str(story_id)]
    assert criterion_ids == [str(criterion_id)]
    assert any(isinstance(item, CasoHistoria) and item.historia_id == story_id for item in added)
    assert any(isinstance(item, AcceptanceCriterionCase) and item.acceptance_criterion_id == criterion_id for item in added)
    assert len(statements) == 4


@pytest.mark.asyncio
async def test_cancel_test_run_cancels_only_unclaimed_playwright_jobs(monkeypatch):
    from app import models

    project_id, run_id = uuid4(), uuid4()
    run = SimpleNamespace(id=run_id, proyecto_id=project_id, build_id=None, nombre="run",
                          estado_run=models.EstadoRun.ABIERTO, fecha_cierre=None)
    pending = SimpleNamespace(job_type="EXECUTION", estado=models.AutomationJobStatus.PENDING,
                              fecha_fin=None, error_message=None)

    class Rows:
        def scalars(self): return self
        def all(self): return [pending]

    db = SimpleNamespace(scalar=AsyncMock(return_value=run), execute=AsyncMock(return_value=Rows()),
                         commit=AsyncMock())
    queue_cancel = AsyncMock()
    monkeypatch.setattr(mcp_mutations.mcp_execution_queue, "cancel", queue_cancel)
    result = await mcp_mutations.cancel_test_run(
        db, SimpleNamespace(id=uuid4()), SimpleNamespace(id=project_id),
        {"run_id": str(run_id), "confirmation": "CANCEL_TEST_RUN"},
    )

    assert run.estado_run == models.EstadoRun.CERRADO
    assert run.fecha_cierre is not None
    assert pending.estado == models.AutomationJobStatus.CANCELLED
    assert pending.fecha_fin is not None
    assert "antes de que el worker iniciara" in pending.error_message
    queue_cancel.assert_awaited_once_with(db, run_id)
    db.commit.assert_awaited_once()
    assert result["status"] == models.EstadoRun.CERRADO.value

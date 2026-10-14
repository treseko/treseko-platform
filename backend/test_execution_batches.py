from types import SimpleNamespace
from uuid import uuid4
import pytest
from app.main import app
from app import models
from app.api.routers import execution_batches as route

@pytest.mark.parametrize('origin,fmt,expected', [
    ('IA', models.FormatoPrueba.CLASICA, models.ExecutionMode.IA),
    ('AUTOMATIZADA_WORKER', models.FormatoPrueba.CONVERSACIONAL, models.ExecutionMode.AUTOMATIZADA),
    ('AUTOMATIZADA_WORKER', models.FormatoPrueba.CLASICA, models.ExecutionMode.AUTOMATIZADA),
])
async def test_batch_enqueues_every_case_with_recording_choice(monkeypatch, origin, fmt, expected):
    run = SimpleNamespace(id=uuid4(), nombre='Batch', proyecto_id=uuid4(), build_id=uuid4(), origen=origin)
    cases = [SimpleNamespace(id=uuid4(), formato_prueba=fmt, tipo_prueba=models.TipoPrueba.AUTOMATIZADA, activo=True, proyecto_id=run.proyecto_id, componente_id=run.build_id, estado_caso=models.EstadoCaso.ACTIVO) for _ in range(2)]
    executions = [SimpleNamespace(id=uuid4(), caso_id=c.id, execution_mode=None) for c in cases]
    user = SimpleNamespace(id=uuid4(), activo=True)
    calls = []
    class Db:
        bind = SimpleNamespace(dialect=SimpleNamespace(name='sqlite'))
        async def execute(self, statement):
            return SimpleNamespace(all=lambda: list(zip(executions, cases)), scalars=lambda: SimpleNamespace(all=lambda: cases))
        async def get(self, *args): return SimpleNamespace(organizacion_id=uuid4(), proyecto_id=run.proyecto_id, componente_id=run.build_id)
        async def commit(self): calls.append('commit')
        async def rollback(self): calls.append('rollback')
        async def flush(self): pass
    async def create(db, payload, user_id, **kwargs):
        assert kwargs['commit'] is False
        assert payload.entorno_id is not None and payload.dataset_id is not None
        return run
    async def noop(*args, **kwargs): pass
    async def enqueue(db, execution, actor, mode):
        assert mode == expected
        job = SimpleNamespace(id=uuid4(), payload_congelado={})
        calls.append(job)
        return job
    async def worker(db, execution_id, actor, **kwargs):
        assert kwargs['commit'] is False and kwargs['quota_checked'] is True
        job = SimpleNamespace(id=uuid4(), payload_congelado={'record_video': kwargs['record_video']}, estado=models.AutomationJobStatus.BLOCKED_BY_RUNNER, error_message='No compatible worker')
        calls.append(job)
        return job
    monkeypatch.setattr(route, 'create_automation_job_for_execution', worker)
    monkeypatch.setattr(route.auth, 'has_module_permission', lambda *args: True)
    monkeypatch.setattr(route.auth, 'has_capability_permission', lambda *args: True)
    monkeypatch.setattr(route.access_control, 'is_build_active', lambda *args: True)
    monkeypatch.setattr(route.access_control, 'require_project_access', noop)
    for name in ['validate_mission', 'enforce_weekly_ai_execution_limit', 'enforce_weekly_automated_execution_limit']:
        monkeypatch.setattr(route, name, noop)
    monkeypatch.setattr(route, 'create_test_run', create)
    monkeypatch.setattr(route, 'enqueue_ai_execution', enqueue)
    payload = route.ExecutionBatchRequest(proyecto_id=run.proyecto_id, build_id=run.build_id, nombre='Batch', entorno='QA', origen=origin, caso_ids=[c.id for c in cases], entorno_id=uuid4(), dataset_id=uuid4(), record_video=False)
    result = await route.create_execution_batch(payload, Db(), user)
    assert len(result['jobs']) == 2
    assert all(job.payload_congelado['record_video'] is False for job in calls[:-1])
    assert calls[-1] == 'commit'
    if fmt == models.FormatoPrueba.CLASICA and origin != 'IA':
        assert all(job['status'] == 'BLOCKED_BY_RUNNER' and job['error'] for job in result['jobs'])


def test_batch_rejects_manual():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        route.ExecutionBatchRequest(proyecto_id=uuid4(), nombre='Bad', entorno='QA', origen='MANUAL', caso_ids=[uuid4()])


async def test_batch_denies_missing_creation_permission_before_database(monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr(route.auth, 'has_module_permission', lambda *args: True)
    monkeypatch.setattr(route.auth, 'has_capability_permission', lambda *args: False)
    payload = route.ExecutionBatchRequest(proyecto_id=uuid4(), nombre='Denied', entorno='QA', origen='IA', caso_ids=[uuid4()])
    with pytest.raises(HTTPException) as error:
        await route.create_execution_batch(payload, None, SimpleNamespace(id=uuid4()))
    assert error.value.status_code == 403

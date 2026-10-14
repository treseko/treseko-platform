from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError
from fastapi import HTTPException
from app.main import app as _app
from app import models
from app.time_utils import utc_now
from app.services import ai_scheduled_missions as service
from app.api.routers.ai_scheduled_missions import AiMissionRequest


def payload(**updates):
    return dict(proyecto_id=uuid4(), build_id=uuid4(), caso_ids=[uuid4()],
                nombre='Nightly', scheduled_at=utc_now() + timedelta(minutes=2), **updates)


@pytest.mark.parametrize('date', [utc_now() - timedelta(minutes=1), utc_now().replace(tzinfo=None)])
def test_schedule_rejects_past_or_naive_dates(date):
    data = payload()
    data['scheduled_at'] = date
    with pytest.raises(ValidationError):
        AiMissionRequest(**data)


def test_schedule_requires_cases_and_deduplicates():
    data = payload()
    case = data['caso_ids'][0]
    data['caso_ids'] = [case, case]
    assert AiMissionRequest(**data).caso_ids == [case]
    data['caso_ids'] = []
    with pytest.raises(ValidationError):
        AiMissionRequest(**data)


async def test_schedule_revalidates_actor_permissions_before_reading_scope():
    user = SimpleNamespace(activo=False)
    with pytest.raises(HTTPException) as error:
        await service.validate_mission(None, user, uuid4(), uuid4(), [uuid4()])
    assert error.value.status_code == 403


async def test_schedule_requires_scheduler_capability_before_project_query(monkeypatch):
    monkeypatch.setattr(service.auth, 'has_capability_permission', lambda user, key, level: key != 'motor_ia.scheduler')
    monkeypatch.setattr(service.auth, 'has_module_permission', lambda *args: True)
    with pytest.raises(HTTPException) as error:
        await service.validate_mission(None, SimpleNamespace(activo=True), uuid4(), uuid4(), [uuid4()], require_scheduling=True)
    assert error.value.status_code == 403


async def test_due_mission_creates_and_enqueues_atomically(monkeypatch):
    run = SimpleNamespace(id=uuid4())
    execution = SimpleNamespace(id=uuid4())
    mission = SimpleNamespace(proyecto_id=uuid4(), build_id=uuid4(), caso_ids=[str(uuid4())],
                              nombre='Nightly', creado_por=uuid4(), test_run_id=None, estado='PENDING')
    calls = []
    user = SimpleNamespace(id=mission.creado_por, organizacion_id=uuid4())
    class Db:
        async def get(self, *args): return user
        async def execute(self, *args):
            return SimpleNamespace(scalar_one_or_none=lambda: user, scalars=lambda: SimpleNamespace(all=lambda: [execution]))
    async def validate(*args, **kwargs): calls.append('validate')
    async def create(db, payload, user_id, *, commit=True):
        assert commit is False
        calls.append('create')
        return run
    async def enqueue(*args):
        calls.append('enqueue')
        return SimpleNamespace(payload_congelado={})
    async def quota(*args, **kwargs): pass
    monkeypatch.setattr(service, 'enforce_weekly_ai_execution_limit', quota)
    monkeypatch.setattr(service, 'validate_mission', validate)
    monkeypatch.setattr(service, 'create_test_run', create)
    monkeypatch.setattr(service, 'enqueue_ai_execution', enqueue)
    await service.launch_mission(Db(), mission)
    assert calls == ['validate', 'create', 'enqueue']
    assert mission.test_run_id == run.id
    assert mission.estado == 'QUEUED'


async def test_due_mission_does_not_enqueue_when_scope_revoked(monkeypatch):
    async def denied(*args, **kwargs): raise HTTPException(403, 'denied')
    monkeypatch.setattr(service, 'validate_mission', denied)
    class Db:
        async def execute(self, *args): return SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(id=uuid4()))
    mission = SimpleNamespace(proyecto_id=uuid4(), build_id=uuid4(), caso_ids=[str(uuid4())],
                              nombre='Nightly', creado_por=uuid4())
    with pytest.raises(HTTPException):
        await service.launch_mission(Db(), mission)


@pytest.mark.parametrize('status, expected', [(503, 'PENDING'), (429, 'PENDING'), (403, 'BLOCKED'), (409, 'BLOCKED')])
async def test_due_mission_retries_transient_failures_and_blocks_invalid_scope(monkeypatch, status, expected):
    from contextlib import asynccontextmanager
    mission = SimpleNamespace(estado='PENDING', error_message=None)
    class Db:
        bind = SimpleNamespace(dialect=SimpleNamespace(name='sqlite'))
        committed = False
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def execute(self, *args):
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [mission]))
        @asynccontextmanager
        async def begin_nested(self): yield
        async def commit(self): self.committed = True
    db = Db()
    async def paused(*args): return False
    async def launch(*args): raise HTTPException(status, 'controlled failure')
    monkeypatch.setattr(service, 'AsyncSessionLocal', lambda: db)
    monkeypatch.setattr(service, 'ai_queue_paused', paused)
    monkeypatch.setattr(service, 'launch_mission', launch)
    assert await service.drain_scheduled_missions() == 0
    assert db.committed
    assert mission.estado == expected
    assert bool(mission.error_message)


async def test_scheduler_cleanup_failure_does_not_prevent_due_missions_or_queue(monkeypatch):
    from app.services import ai_execution_queue as queue, ai_video_recordings as videos
    calls = []
    async def broken_cleanup():
        calls.append('cleanup')
        raise RuntimeError('controlled unavailable video storage')
    async def due(): calls.append('due')
    async def drain(): calls.append('queue')
    monkeypatch.setattr(videos, 'cleanup_worker_video_storage', broken_cleanup)
    monkeypatch.setattr(service, 'drain_scheduled_missions', due)
    monkeypatch.setattr(queue, 'drain_ai_execution_queue', drain)
    await queue._scheduler_tick()
    assert calls == ['cleanup', 'due', 'queue']


def test_schedule_trims_names_and_rejects_blank_names():
    data = payload(); data['nombre'] = '  Nightly  '
    assert AiMissionRequest(**data).nombre == 'Nightly'
    data['nombre'] = '   '
    with pytest.raises(ValidationError): AiMissionRequest(**data)

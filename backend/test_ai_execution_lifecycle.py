"""Database-independent regression tests for the durable AI lifecycle policy."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.main import app as _app  # noqa: F401 - initialize repository modules in production order
from app import models
import app.services.ai_execution_queue as ai_execution_queue
from app.domain_models.enums import EstadoResultado, ExecutionMode
from app.services.ai_execution_lifecycle import (
    can_accept_terminal_result,
    resolve_queued_execution_mode,
    terminal_report_metadata,
)


def test_only_active_execution_accepts_the_first_terminal_writer():
    assert can_accept_terminal_result(EstadoResultado.EJECUTANDO_AI)
    assert not can_accept_terminal_result(EstadoResultado.PASO)
    assert not can_accept_terminal_result(EstadoResultado.FALLO)
    assert not can_accept_terminal_result(EstadoResultado.BLOQUEADO)


def test_late_callback_after_timeout_or_recovery_is_ignored_by_policy():
    state = EstadoResultado.EJECUTANDO_AI
    assert can_accept_terminal_result(state)

    # Timeout/recovery is a terminal transition. Any later callback observes
    # the terminal state and cannot become a second writer.
    state = EstadoResultado.FALLO
    assert not can_accept_terminal_result(state)
    state = EstadoResultado.BLOQUEADO
    assert not can_accept_terminal_result(state)


def test_queue_mode_is_immutable_and_legacy_jobs_default_to_ai():
    assert resolve_queued_execution_mode({"execution_mode": "AUTOMATIZADA"}) == ExecutionMode.AUTOMATIZADA
    assert resolve_queued_execution_mode({"execution_mode": "IA"}) == ExecutionMode.IA
    assert resolve_queued_execution_mode({}) == ExecutionMode.IA
    assert resolve_queued_execution_mode(None) == ExecutionMode.IA


def test_terminal_metadata_marks_report_complete_for_idempotent_recovery():
    metadata = terminal_report_metadata(
        delivery_id="ai-timeout:execution-1",
        completed_via="backend.timeout_watcher",
        human_review_required=True,
    )
    assert metadata["report_complete"] is True
    assert metadata["terminal_delivery_id"] == "ai-timeout:execution-1"
    assert metadata["human_review_required"] is True


@pytest.mark.asyncio
async def test_dispatch_closes_job_when_trigger_returns_terminal_blocked(monkeypatch):
    """A normal trigger return can still terminally block invalid configuration."""
    job_id = uuid4()
    execution_id = uuid4()
    job = SimpleNamespace(
        id=job_id,
        ejecucion_id=execution_id,
        job_type=ai_execution_queue.AI_EXECUTION_JOB_TYPE,
        estado=models.AutomationJobStatus.CLAIMED,
        fecha_inicio=None,
        payload_congelado={"execution_mode": "IA"},
    )
    execution = SimpleNamespace(id=execution_id, estado_resultado=models.EstadoResultado.SIN_CORRER)
    commits = 0

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, model, identifier, **_kwargs):
            if model is models.AutomationJob:
                return job if identifier == job_id else None
            if model is models.EjecucionCaso:
                return execution if identifier == execution_id else None
            return None

        async def commit(self):
            nonlocal commits
            commits += 1

    monkeypatch.setattr(ai_execution_queue, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(ai_execution_queue, "_publish", lambda *_args, **_kwargs: _async_noop())

    async def fake_trigger(_execution_id, _db, _mode, **_options):
        execution.estado_resultado = models.EstadoResultado.BLOQUEADO

    async def fake_mark(_db, _execution_id, status):
        assert status is models.EstadoResultado.BLOQUEADO
        job.estado = models.AutomationJobStatus.BLOCKED

    monkeypatch.setattr(ai_execution_queue, "trigger_ai_execution", fake_trigger)
    monkeypatch.setattr(ai_execution_queue, "mark_ai_execution_finished", fake_mark)

    await ai_execution_queue._dispatch(job_id)

    assert job.estado is models.AutomationJobStatus.BLOCKED
    assert commits == 2


async def _async_noop():
    return None


@pytest.mark.asyncio
async def test_queue_claim_keeps_advisory_lock_until_commit_after_claim(monkeypatch):
    """The PostgreSQL lock must cover the slot count and pending-job claim."""
    events = []
    job = SimpleNamespace(id=uuid4(), estado=models.AutomationJobStatus.PENDING, fecha_claim=None)

    class Result:
        def __init__(self, rows=()):
            self.rows = rows

        def all(self):
            return list(self.rows)

        def scalars(self):
            return self

        def first(self):
            return self.rows[0] if self.rows else None

    class FakeSession:
        bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def execute(self, statement):
            if "pg_advisory_xact_lock" in str(statement):
                events.append("lock")
                return Result()
            if "app_settings" in str(statement):
                events.append('pause-check')
                return Result()
            events.append("query")
            if events.count("query") == 1:
                return Result([])  # active execution reconciliation
            if events.count("query") == 2:
                return Result([])  # active slot count
            return Result([job])  # pending jobs to claim

        async def commit(self):
            events.append("commit")

    async def fake_recover(_db, *, commit):
        events.append(("recover", commit))
        return 0

    monkeypatch.setattr(ai_execution_queue, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(ai_execution_queue, "recover_stale_ai_executions", fake_recover)
    monkeypatch.setattr(ai_execution_queue, "get_ai_engine_config", lambda _db: _config())
    monkeypatch.setattr(ai_execution_queue, "_publish", lambda *_args, **_kwargs: _async_noop())
    def ignore_task(coroutine):
        coroutine.close()

    monkeypatch.setattr(ai_execution_queue.asyncio, "create_task", ignore_task)

    claimed = await ai_execution_queue.drain_ai_execution_queue()

    assert claimed == 1
    assert job.estado is models.AutomationJobStatus.CLAIMED
    assert events.index("lock") < events.index(("recover", False))
    assert events.index('lock') < events.index('pause-check') < events.index(('recover', False))
    assert events[-1] == "commit"


async def _config():
    return {"max_parallel_ai_runs": 1}

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app import crud, models
from app.repositories import automation_jobs, test_runs_automation_runners as runner_repository


def _run(coro):
    return asyncio.run(coro)


async def _database(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'worker-lock.sqlite'}")
    async with engine.begin() as connection:
        await connection.run_sync(models.AutomationRunner.__table__.create)
        await connection.run_sync(models.AutomationJob.__table__.create)
    return engine


def test_worker_update_lock_is_durable_resumable_and_owner_released(tmp_path):
    async def scenario():
        engine = await _database(tmp_path)
        try:
            async with AsyncSession(engine, expire_on_commit=False) as db:
                runner = models.AutomationRunner(
                    id=uuid4(), nombre="worker-lock", token_hash="a" * 64,
                    capabilities={}, estado="ONLINE", activo=True,
                )
                runner_id = runner.id
                db.add(runner)
                await db.commit()

                _, created = await runner_repository.acquire_automation_runner_update_lock(
                    db, runner_id, "stable-update-lock-token-1234567890",
                )
                assert created is True
                await db.refresh(runner)
                first_hash = runner.update_lock_token_hash
                assert first_hash and len(first_hash) == 64
                assert runner.update_lock_acquired_at is not None

                _, created = await runner_repository.acquire_automation_runner_update_lock(
                    db, runner_id, "stable-update-lock-token-1234567890",
                )
                assert created is False
                assert runner.update_lock_token_hash == first_hash

                with pytest.raises(ValueError, match="worker_update_already_locked"):
                    await runner_repository.acquire_automation_runner_update_lock(
                            db, runner_id, "different-update-lock-token-1234567890",
                    )
                with pytest.raises(ValueError, match="worker_update_lock_token_mismatch"):
                    await runner_repository.release_automation_runner_update_lock(
                            db, runner_id, "different-update-lock-token-1234567890",
                    )

                await runner_repository.release_automation_runner_update_lock(
                    db, runner_id, "stable-update-lock-token-1234567890",
                )
                runner = await db.get(models.AutomationRunner, runner_id)
                await db.refresh(runner)
                assert runner.update_lock_token_hash is None
                assert runner.update_lock_acquired_at is None
                # A repeated release is safe after a lost HTTP response.
                _, released = await runner_repository.release_automation_runner_update_lock(
                    db, runner_id, "stable-update-lock-token-1234567890",
                )
                assert released is False
        finally:
            await engine.dispose()

    _run(scenario())


def test_update_lock_refuses_active_job_and_claim_checks_lock_before_job_scope(tmp_path, monkeypatch):
    async def scenario():
        engine = await _database(tmp_path)
        try:
            async with AsyncSession(engine, expire_on_commit=False) as db:
                runner_id, organization_id, job_id = uuid4(), uuid4(), uuid4()
                runner = models.AutomationRunner(
                    id=runner_id, organizacion_id=organization_id, nombre="active-worker",
                    token_hash="b" * 64, capabilities={}, estado="BUSY", activo=True,
                )
                job = models.AutomationJob(
                    id=job_id, organizacion_id=organization_id, runner_id=runner_id,
                    estado=models.AutomationJobStatus.RUNNING, creado_por=uuid4(),
                )
                db.add_all([runner, job])
                await db.commit()

                with pytest.raises(ValueError, match="worker_update_busy"):
                    await runner_repository.acquire_automation_runner_update_lock(
                        db, runner_id, "stable-update-lock-token-1234567890",
                    )

                await db.execute(
                    __import__("sqlalchemy").update(models.AutomationJob)
                    .where(models.AutomationJob.id == job_id)
                    .values(estado=models.AutomationJobStatus.PENDING, runner_id=None)
                )
                await db.commit()
                await runner_repository.acquire_automation_runner_update_lock(
                    db, runner_id, "stable-update-lock-token-1234567890",
                )
                monkeypatch.setattr(automation_jobs, "recover_stale_automation_jobs", lambda _db: asyncio.sleep(0))
                runner = await db.get(models.AutomationRunner, runner_id)
                job = await db.get(models.AutomationJob, job_id)
                with pytest.raises(ValueError, match="worker está pausado"):
                    await automation_jobs.claim_automation_job(db, job, runner)
        finally:
            await engine.dispose()

    _run(scenario())

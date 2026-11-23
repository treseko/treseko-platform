"""Opt-in real PostgreSQL lock races in an owned disposable container.

Only the three queue/intent tables are installed; unrelated FKs are omitted
from test-local copies. This certifies the ledger lock protocol, not full app
migrations, authentication, or data-preserving platform upgrades.
"""
import asyncio
import json
import os
import shutil
import subprocess
from uuid import uuid4

import pytest
import sqlalchemy as sa
from asyncpg.exceptions import CannotConnectNowError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app import models
from app.repositories import automation_claim_intents as intents

pytestmark = pytest.mark.skipif(os.getenv("TRESEKO_RUN_DOCKER_UPDATE_TESTS") != "1",
                               reason="Explicit isolated Docker integration opt-in required")


@pytest.fixture
def database_url():
    docker = shutil.which("docker")
    assert docker
    owner = uuid4().hex
    container = subprocess.run([docker, "run", "--detach", "--pull=never",
        "--name", "treseko-claim-test-" + owner[:12], "--label", "io.treseko.claim-test=" + owner,
        "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1::5432",
        "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:15-alpine"],
        check=True, capture_output=True, text=True).stdout.strip()
    try:
        info = json.loads(subprocess.run([docker, "inspect", container], check=True,
                          capture_output=True, text=True).stdout)[0]
        port = info["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"]
        yield f"postgresql+asyncpg://postgres@127.0.0.1:{port}/postgres"
    finally:
        label = subprocess.run([docker, "inspect", "--format",
            '{{index .Config.Labels "io.treseko.claim-test"}}', container],
            check=True, capture_output=True, text=True).stdout.strip()
        assert label == owner, "Refuse cleanup of an unowned container"
        subprocess.run([docker, "rm", "-f", "-v", container], check=True, capture_output=True)


def isolated_metadata():
    metadata = sa.MetaData()
    for model in (models.AutomationRunner, models.AutomationJob, models.AutomationClaimIntent):
        table = model.__table__.to_metadata(metadata)
        for constraint in list(table.constraints):
            if isinstance(constraint, sa.ForeignKeyConstraint):
                table.constraints.remove(constraint)
        table.foreign_keys.clear()
        for column in table.columns:
            column.foreign_keys.clear()
    return metadata


@pytest.mark.parametrize("mode", ["close-first", "claim-first", "duplicate-claim",
                                  "competing-intent", "aborted-close"])
def test_serialized_intent_race(database_url, mode):
    async def run():
        engine = create_async_engine(database_url)
        task = None
        try:
            for attempt in range(100):
                try:
                    async with engine.connect() as connection:
                        await connection.execute(sa.text("SELECT 1"))
                    break
                except (OSError, sa.exc.DBAPIError, CannotConnectNowError):
                    if attempt == 99:
                        raise
                    await asyncio.sleep(0.1)
            async with engine.begin() as connection:
                await connection.run_sync(isolated_metadata().create_all)
            sessions = async_sessionmaker(engine, expire_on_commit=False)
            async with sessions() as db:
                organization = uuid4()
                runner = models.AutomationRunner(nombre="isolated", organizacion_id=organization,
                    token_hash=uuid4().hex, activo=True, capabilities={"frameworks": ["playwright"],
                    "framework_languages": {"playwright": ["javascript"]}})
                job = models.AutomationJob(creado_por=uuid4(), organizacion_id=organization,
                    required_framework="playwright", required_language="javascript")
                db.add_all([runner, job])
                await db.commit()
                runner_id, job_id = runner.id, job.id
            intent_id = uuid4()
            async with sessions() as first, sessions() as second:
                first_runner = await first.get(models.AutomationRunner, runner_id)
                second_runner = await second.get(models.AutomationRunner, runner_id)
                second_pid = await second.scalar(sa.text("SELECT pg_backend_pid()"))
                if mode in ("close-first", "aborted-close"):
                    assert await intents.reconcile(first, first_runner, intent_id, job_id) == "CLOSED"
                else:
                    assert await intents.claim(first, first_runner, intent_id, job_id)

                second_intent = uuid4() if mode == "competing-intent" else intent_id

                async def compete():
                    operation = intents.reconcile if mode == "claim-first" else intents.claim
                    result = await operation(second, second_runner, second_intent, job_id)
                    await second.commit()
                    return result

                task = asyncio.create_task(compete())
                # Observe the actual PostgreSQL lock wait, not an assumed race
                # based on a sleep or a scheduled Python coroutine.
                async with engine.connect() as observer:
                    for _ in range(100):
                        blocked = await observer.scalar(sa.text("SELECT cardinality(pg_blocking_pids(:pid))"),
                                                        {"pid": second_pid})
                        if blocked:
                            break
                        assert not task.done(), "Second operation bypassed the transaction lock"
                        await asyncio.sleep(0.02)
                    else:
                        pytest.fail("Did not observe PostgreSQL lock contention")
                if mode == "aborted-close":
                    await first.rollback()
                else:
                    await first.commit()
                result = await asyncio.wait_for(task, 5)
                if mode in ("close-first", "competing-intent"):
                    assert result is None
                elif mode == "claim-first":
                    assert result == "WAIT"
                else:
                    assert result.id == job_id
            async with sessions() as check:
                job = await check.get(models.AutomationJob, job_id)
                intent = await check.get(models.AutomationClaimIntent, (runner_id, intent_id))
                assert job.attempt_count == (0 if mode == "close-first" else 1)
                assert intent.state == ("CLOSED" if mode == "close-first" else "CLAIMED")
                if mode != "close-first":
                    assert intent.lease_fingerprint == intents.fingerprint(job.lease_token)
                if mode == "competing-intent":
                    other = await check.get(models.AutomationClaimIntent, (runner_id, second_intent))
                    assert other.state == "CLOSED"
        finally:
            if task and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await engine.dispose()
    asyncio.run(run())

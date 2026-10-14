"""Apply the complete migration chain to an isolated PostgreSQL database."""
import asyncio
import os
from pathlib import Path
import subprocess
import sys

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory
from asyncpg.exceptions import CannotConnectNowError
from sqlalchemy.ext.asyncio import create_async_engine

from test_claim_intent_postgres import database_url

HEAD_REVISION = ScriptDirectory.from_config(Config(str(Path(__file__).parent / "alembic.ini"))).get_current_head()

pytestmark = pytest.mark.skipif(os.getenv("TRESEKO_RUN_DOCKER_UPDATE_TESTS") != "1",
                               reason="Explicit isolated Docker integration opt-in required")


@pytest.mark.parametrize("previous_revision", [False, True])
def test_full_chain_reaches_claim_intent_revision(database_url, previous_revision):
    async def run():
        engine = create_async_engine(database_url)
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
            env = {**os.environ, "DATABASE_URL": database_url,
                   "TRESEKO_DISABLE_INSTALLATION_PING": "1"}
            result = await asyncio.to_thread(subprocess.run,
                [sys.executable, "-m", "alembic", "upgrade", "head"],
                cwd=Path(__file__).parent, env=env, capture_output=True, text=True, timeout=120)
            assert result.returncode == 0, result.stderr[-8000:]
            if previous_revision:
                # Empty-ledger downgrade removes only the new table. Exercise
                # applying the new revision when that table does not yet exist.
                result = await asyncio.to_thread(subprocess.run,
                    [sys.executable, "-m", "alembic", "downgrade", "20260905_0061"],
                    cwd=Path(__file__).parent, env=env, capture_output=True, text=True, timeout=120)
                assert result.returncode == 0, result.stderr[-8000:]
                async with engine.begin() as connection:
                    await connection.execute(sa.text("CREATE TABLE migration_preservation_probe (value TEXT)"))
                    await connection.execute(sa.text("INSERT INTO migration_preservation_probe VALUES ('preserve')"))
                result = await asyncio.to_thread(subprocess.run,
                    [sys.executable, "-m", "alembic", "upgrade", "head"],
                    cwd=Path(__file__).parent, env=env, capture_output=True, text=True, timeout=120)
                assert result.returncode == 0, result.stderr[-8000:]
            async with engine.connect() as connection:
                assert await connection.scalar(sa.text("SELECT version_num FROM alembic_version")) == HEAD_REVISION
                assert await connection.scalar(sa.text("SELECT count(*) FROM automation_claim_intents")) == 0
                assert await connection.scalar(sa.text("SELECT count(*) FROM ai_scheduled_missions")) == 0
                assert await connection.scalar(sa.text("SELECT count(*) FROM ai_video_recordings")) == 0
                assert await connection.scalar(sa.text(
                    "SELECT is_nullable FROM information_schema.columns "
                    "WHERE table_name = 'ai_scheduled_missions' AND column_name = 'record_video'"
                )) == "NO"
                if previous_revision:
                    assert await connection.scalar(sa.text("SELECT value FROM migration_preservation_probe")) == "preserve"
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_migrate_only_real_chain_preserves_update_ownership(database_url, tmp_path):
    async def run():
        engine = create_async_engine(database_url)
        try:
            for attempt in range(100):
                try:
                    async with engine.connect() as connection:
                        await connection.execute(sa.text('SELECT 1'))
                    break
                except (OSError, sa.exc.DBAPIError, CannotConnectNowError):
                    if attempt == 99:
                        raise
                    await asyncio.sleep(.1)
            backend = Path(__file__).resolve().parent
            frontend, updates = tmp_path / 'frontend', tmp_path / 'updates'
            frontend.mkdir()
            updates.mkdir()
            markers = {frontend / '.maintenance': 'coordinator-owned',
                       frontend / '.treseko-update-fence': 'transaction-owned',
                       updates / 'update-ready': str(tmp_path / 'absent-package')}
            for path, value in markers.items():
                path.write_text(value)
            env = {**os.environ, 'DATABASE_URL': database_url,
                   'PATH': str(Path(sys.executable).parent) + os.pathsep + os.defpath,
                   'TRESEKO_DISABLE_INSTALLATION_PING': '1', 'TRESEKO_DEPLOY_MODE': 'local',
                   'TRESEKO_APP_DIR': str(backend), 'TRESEKO_FRONTEND_HTML_DIR': str(frontend),
                   'UPDATES_DIR': str(updates), 'DB_BACKUP_DIR': str(tmp_path / 'backups'),
                   'TRESEKO_ENGINE_DIR': str(tmp_path / 'engine'),
                   'TRESEKO_WORKER_DIR': str(tmp_path / 'worker'),
                   'AUTO_BACKUP_ENABLED': 'false', 'CHECK_PENDING_UPDATE': 'true'}
            for key in ('DATABASE_URL_FILE', 'DB_PASSWORD_FILE', 'SECRET_KEY_FILE', 'AI_ENGINE_INTERNAL_TOKEN_FILE'):
                env.pop(key, None)
            result = await asyncio.to_thread(subprocess.run,
                ['/bin/sh', str(backend / 'entrypoint.sh'), 'migrate-only'],
                cwd=backend, env=env, capture_output=True, text=True, timeout=120)
            assert result.returncode == 0, result.stderr[-8000:]
            async with engine.connect() as connection:
                assert await connection.scalar(sa.text('SELECT version_num FROM alembic_version')) == HEAD_REVISION
                assert await connection.scalar(sa.text('SELECT count(*) FROM automation_claim_intents')) == 0
            for path, value in markers.items():
                assert path.read_text() == value
            assert not (updates / 'update-applied').exists()
        finally:
            await engine.dispose()
    asyncio.run(run())

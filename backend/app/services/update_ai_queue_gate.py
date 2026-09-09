"""Coordinator-owned PostgreSQL gate for the AI scheduler admission.

The scheduler must honor ``PAUSE_KEY`` under the shared advisory lock. This
does not bootstrap or certify legacy 1.0.2 installations without that protocol.
"""
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import time

from .update_journal import exclusive_lock, save_json
from .update_transaction import TransactionFailure
from .update_transport import IDENTIFIER

AI_QUEUE_LOCK = 728194031
PAUSE_KEY = 'treseko.update.ai_scheduler_pause'


class AIQueueLocalGate:
    """Durable AI admission gate kept outside the PostgreSQL data snapshot."""

    def __init__(self, config):
        required = {'database_url_file', 'database_name', 'timeout_seconds', 'journal_directory'}
        if (not isinstance(config, dict) or set(config) != required
                or not isinstance(config['database_name'], str) or not config['database_name']
                or type(config['timeout_seconds']) not in {int, float}
                or not math.isfinite(config['timeout_seconds'])
                or not 0 < config['timeout_seconds'] <= 1800):
            raise ValueError('Explicit AI queue gate configuration required')
        journal = Path(config['journal_directory'])
        if not journal.is_absolute() or '..' in journal.parts:
            raise ValueError('Absolute private AI queue journal directory required')
        path = Path(config['database_url_file'])
        if not path.is_absolute():
            raise ValueError('Absolute private database credential path required')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            with os.fdopen(fd, 'rb') as source:
                info = os.fstat(source.fileno())
                if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                        or info.st_mode & 0o077 or info.st_size > 4096):
                    raise ValueError('Database credential file must be private and operator-owned')
                endpoint = source.read(4097).strip()
        except Exception:
            raise
        if not endpoint.startswith(b'postgresql+asyncpg://'):
            raise ValueError('PostgreSQL async connection required')
        self.config = dict(config)
        self.url = endpoint.decode()
        self.timeout = config['timeout_seconds']
        self.journal_directory = journal
        self.identity = hashlib.sha256(
            json.dumps(config, sort_keys=True).encode() + b'\0' + endpoint
        ).hexdigest()

    @property
    def _journal(self):
        return self.journal_directory / 'ai-queue-gate.json'

    def _tombstone(self, transaction):
        return self.journal_directory / ('.ai-queue-gate-released-' + transaction + '.json')

    def _binding(self, transaction):
        return {'schema': 1, 'identity': self.identity, 'transaction': transaction}

    def _read_state(self):
        if not self._journal.exists():
            return None
        try:
            state = json.loads(self._journal.read_text())
        except (OSError, ValueError) as exc:
            raise TransactionFailure('AI queue gate journal is unreadable') from exc
        if (not isinstance(state, dict)
                or set(state) != {'schema', 'identity', 'transaction', 'phase'}
                or type(state['schema']) is not int or state['schema'] != 1
                or state['identity'] != self.identity
                or not isinstance(state['transaction'], str)
                or not IDENTIFIER.fullmatch(state['transaction'])
                or state['phase'] not in {'acquiring', 'closed', 'releasing', 'released'}):
            raise TransactionFailure('AI queue gate journal differs from inventory')
        return state

    def _run(self, action, transaction):
        async def bounded():
            return await self._database(action, transaction)
        try:
            return asyncio.run(asyncio.wait_for(bounded(), timeout=self.timeout))
        except asyncio.TimeoutError as exc:
            raise TransactionFailure('AI queue gate operation timed out; keep admission closed') from exc

    async def _database_name(self, db):
        from sqlalchemy import text

        if await db.scalar(text('SELECT current_database()')) != self.config['database_name']:
            raise TransactionFailure('AI queue database differs from inventory')

    async def _marker(self, db, transaction):
        from sqlalchemy import text

        value = await db.scalar(text(
            'SELECT value FROM app_settings '
            'WHERE key = :pause_key FOR SHARE'),
            {'pause_key': PAUSE_KEY})
        expected = {'schema': 1, 'transaction': transaction}
        if value is None or value != expected or type(value.get('schema')) is not int:
            raise TransactionFailure('AI queue pause marker is missing or owned by another transaction')

    async def _active(self, db):
        from sqlalchemy import text

        jobs = await db.scalar(text(
            "SELECT count(*) FROM automation_jobs "
            "WHERE job_type = 'AI_EXECUTION' AND estado IN ('CLAIMED', 'RUNNING')"))
        executions = await db.scalar(text(
            "SELECT count(*) FROM ejecuciones_casos "
            "WHERE estado_resultado = 'EJECUTANDO_AI'"))
        return int(jobs or 0) + int(executions or 0)

    async def _database(self, action, transaction):
        from sqlalchemy import text
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
        from sqlalchemy.pool import NullPool

        engine = create_async_engine(self.url, poolclass=NullPool,
                                     connect_args={'timeout': 10, 'command_timeout': 10})
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            if action == 'acquire':
                async with sessions() as db:
                    await self._database_name(db)
                    await self._set_pause(db, transaction, paused=True)
                    await db.commit()
                deadline = time.monotonic() + self.timeout
                while True:
                    async with sessions() as db:
                        await self._database_name(db)
                        await self._marker(db, transaction)
                        active = await self._active(db)
                    if active == 0:
                        return {'ok': True, 'active': 0}
                    if time.monotonic() >= deadline:
                        raise TransactionFailure('AI queue work did not drain; keep admission closed')
                    await asyncio.sleep(.2)
            if action == 'assert':
                async with sessions() as db:
                    await self._database_name(db)
                    await self._marker(db, transaction)
                    active = await self._active(db)
                    if active:
                        raise TransactionFailure('AI queue work remains active')
                    return {'ok': True, 'active': 0}
            if action == 'release':
                async with sessions() as db:
                    await self._database_name(db)
                    await self._set_pause(db, transaction, paused=False)
                    await db.commit()
                async with sessions() as db:
                    await self._database_name(db)
                    if await db.scalar(text(
                            'SELECT 1 FROM app_settings WHERE key = :pause_key'),
                            {'pause_key': PAUSE_KEY}) is not None:
                        raise TransactionFailure('AI queue release not confirmed')
                    return {'ok': True}
            if action == 'release_replay':
                async with sessions() as db:
                    await self._database_name(db)
                    await db.execute(text('SELECT pg_advisory_xact_lock(728194031)'))
                    if await db.scalar(text(
                            'SELECT 1 FROM app_settings WHERE key = :pause_key'),
                            {'pause_key': PAUSE_KEY}) is not None:
                        raise TransactionFailure('Released AI queue transaction found an active marker')
                    return {'ok': True}
            raise ValueError('Unsupported AI queue gate operation')
        finally:
            await engine.dispose()

    async def _set_pause(self, db, transaction, *, paused):
        from sqlalchemy import text

        if getattr(getattr(getattr(db, 'bind', None), 'dialect', None), 'name', None) != 'postgresql':
            raise TransactionFailure('Coordinated AI scheduler pause requires PostgreSQL')
        await db.execute(text('SELECT pg_advisory_xact_lock(728194031)'))
        value = await db.scalar(text(
            'SELECT value FROM app_settings '
            'WHERE key = :pause_key FOR UPDATE'),
            {'pause_key': PAUSE_KEY})
        expected = {'schema': 1, 'transaction': transaction}
        if value is not None and (value != expected or type(value.get('schema')) is not int):
            raise TransactionFailure('AI scheduler pause belongs to another transaction or is invalid')
        if paused and value is None:
            await db.execute(text(
                'INSERT INTO app_settings (key, value) '
                'VALUES (:pause_key, CAST(:pause_value AS json))'),
                {'pause_key': PAUSE_KEY, 'pause_value': json.dumps(expected, separators=(',', ':'))})
        elif not paused and value is not None:
            await db.execute(text(
                'DELETE FROM app_settings WHERE key = :pause_key'),
                {'pause_key': PAUSE_KEY})

    def acquire(self, transaction):
        if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
            raise ValueError('Invalid gate transaction')
        with exclusive_lock(self.journal_directory / '.ai-queue-gate.lock'):
            state = self._read_state()
            tombstone = self._tombstone(transaction)
            if tombstone.exists() or (state and state['phase'] == 'released'
                                      and state['transaction'] == transaction):
                raise TransactionFailure('Released AI queue transaction cannot reacquire')
            if state and state['phase'] != 'released' and state['transaction'] != transaction:
                raise TransactionFailure('AI queue gate belongs to another transaction')
            if state and state['phase'] == 'released':
                state = None
            if state is None:
                state = {**self._binding(transaction), 'phase': 'acquiring'}
                save_json(self._journal, state)
            elif state['phase'] not in {'acquiring', 'closed'}:
                raise TransactionFailure('AI queue gate journal is not recoverable')
            self._run('acquire', transaction)
            state['phase'] = 'closed'
            save_json(self._journal, state)

    def assert_closed(self, transaction):
        if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
            raise ValueError('Invalid gate transaction')
        with exclusive_lock(self.journal_directory / '.ai-queue-gate.lock'):
            state = self._read_state()
            if (not state or state['transaction'] != transaction or state['phase'] != 'closed'):
                raise TransactionFailure('AI queue gate closure is not journal-confirmed')
            self._run('assert', transaction)

    def release(self, transaction):
        if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
            raise ValueError('Invalid gate transaction')
        with exclusive_lock(self.journal_directory / '.ai-queue-gate.lock'):
            state = self._read_state()
            if not state:
                raise TransactionFailure('AI queue release requires a closed coordinator gate')
            if state['transaction'] != transaction:
                raise TransactionFailure('AI queue gate belongs to another transaction')
            if state['phase'] == 'released':
                if not self._tombstone(transaction).exists():
                    raise TransactionFailure('Released AI queue tombstone is missing')
                self._run('release_replay', transaction)
                return
            if state['phase'] not in {'closed', 'releasing'}:
                raise TransactionFailure('AI queue release requires a closed coordinator gate')
            if state['phase'] == 'closed':
                self._run('assert', transaction)
            state['phase'] = 'releasing'
            save_json(self._journal, state)
            self._run('release', transaction)
            save_json(self._tombstone(transaction), self._binding(transaction))
            state['phase'] = 'released'
            save_json(self._journal, state)

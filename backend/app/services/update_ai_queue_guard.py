"""Compose backend wrapper: pause/observe AI work before stopping the backend.

Underlying runtime still owns ingress, other drains, snapshots and live versions.
No database credential, command or target comes from a release/RPC request.
"""
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
import stat

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from .. import models
from .update_ai_queue_control import PAUSE_KEY, set_ai_queue_pause
from .update_transaction import TransactionFailure
from .update_journal import exclusive_lock, save_json


class AIQueueAdmissionGuard:
    def __init__(self, runtime, config):
        if (not isinstance(config, dict) or set(config) != {'database_url_file', 'database_name', 'timeout_seconds'}
                or not isinstance(config['database_name'], str) or not config['database_name']
                or type(config['timeout_seconds']) not in {int, float}
                or not math.isfinite(config['timeout_seconds']) or not 0 < config['timeout_seconds'] <= 1800):
            raise ValueError('Explicit AI queue database control configuration required')
        path = Path(config['database_url_file'])
        if not path.is_absolute():
            raise ValueError('Absolute private database credential path required')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd) as source:
            info = os.fstat(source.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                    or info.st_mode & 0o077 or info.st_size > 4096):
                raise ValueError('Database credential file must be private and operator-owned')
            self.url = source.read(4097).strip()
        if not self.url.startswith('postgresql+asyncpg://'):
            raise ValueError('PostgreSQL async connection required')
        self.runtime, self.config = runtime, dict(config)
        # Bind replay to the credential/endpoint bytes without journaling them.
        identity = getattr(runtime, 'configuration_identity', None) or ''
        self.identity = hashlib.sha256((identity + '\0' + json.dumps(config, sort_keys=True) + '\0' + self.url).encode()).hexdigest()
        runtime.configuration_identity = self.identity

    async def _control(self, action, transaction):
        engine = create_async_engine(self.url, poolclass=NullPool,
                                     connect_args={'timeout': 10, 'command_timeout': 10})
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with sessions() as db:
                if await db.scalar(text('SELECT current_database()')) != self.config['database_name']:
                    raise TransactionFailure('AI queue database differs from inventory')
                row = await db.get(models.AppSetting, PAUSE_KEY)
                expected = {'schema': 1, 'transaction': transaction}
                if row is not None and (row.value != expected or type(row.value.get('schema')) is not int):
                    raise TransactionFailure('AI queue pause is owned by another transaction or invalid')
                if action == 'prepare':
                    return
                if action in {'pause', 'resume'}:
                    await set_ai_queue_pause(db, transaction, paused=action == 'pause')
                    await db.commit()
            async with sessions() as db:
                row = await db.get(models.AppSetting, PAUSE_KEY)
                if action == 'resume':
                    if row is not None:
                        raise TransactionFailure('AI queue resume not confirmed')
                    return
                if row is None or row.value != expected:
                    raise TransactionFailure('AI queue pause not confirmed')
                jobs = await db.scalar(select(func.count()).select_from(models.AutomationJob).where(
                    models.AutomationJob.job_type == 'AI_EXECUTION',
                    models.AutomationJob.estado.in_([models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING])))
                executions = await db.scalar(select(func.count()).select_from(models.EjecucionCaso).where(
                    models.EjecucionCaso.estado_resultado == models.EstadoResultado.EJECUTANDO_AI))
                return jobs + executions
        finally:
            await engine.dispose()

    async def _wait_paused(self, transaction):
        await self._control('pause', transaction)
        while await self._control('observe', transaction):
            await asyncio.sleep(.2)

    def __call__(self, operation, context, release):
        root = Path(context['directory'])
        if not root.is_absolute():
            raise ValueError('Private participant journal directory required')
        with exclusive_lock(root / '.ai-queue-control.lock'):
            journal = root / 'ai-queue-control.json'
            binding = {'schema': 1, 'transaction': context['transaction'], 'identity': self.identity}
            if journal.exists():
                if json.loads(journal.read_text()) != binding:
                    raise TransactionFailure('AI queue control inventory changed; no database action allowed')
            elif operation != 'prepare':
                raise TransactionFailure('AI queue control must prepare first')
            else:
                save_json(journal, binding)
            return self._execute(operation, context, release)

    def _execute(self, operation, context, release):
        transaction = context['transaction']
        async def control(action):
            return await asyncio.wait_for(self._control(action, transaction), timeout=self.config['timeout_seconds'])
        if operation == 'prepare':
            asyncio.run(control('prepare'))
        if operation == 'quiesce':
            if self.runtime.fence(transaction) is not True:
                raise TransactionFailure('Verified ingress fence required before pausing AI queue')
            async def wait():
                await asyncio.wait_for(self._wait_paused(transaction), timeout=self.config['timeout_seconds'])
            try:
                asyncio.run(wait())
            except TimeoutError as exc:
                raise TransactionFailure('AI work is not drained; retain pause and retry recovery') from exc
        if operation in {'snapshot', 'apply', 'verify', 'verify_rollback'}:
            if asyncio.run(control('observe')) != 0:
                raise TransactionFailure('AI work remains active; retain pause')
        result = self.runtime(operation, context, release)
        if operation == 'activate' and result.get('ok') is True:
            asyncio.run(control('resume'))
        return result

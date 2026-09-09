"""Durable AI scheduler admission pause serialized with its PostgreSQL claim lock.

These internal functions do not commit, cancel jobs or declare workloads drained.
The coordinator adapter must commit/read back before relying on a pause receipt.
"""
from sqlalchemy import select, text

from .. import models
from .update_transaction import TransactionFailure
from .update_transport import IDENTIFIER

AI_QUEUE_LOCK = 728194031
PAUSE_KEY = 'treseko.update.ai_scheduler_pause'


async def ai_queue_paused(db):
    # Presence closes admission even when the stored value is malformed.
    return (await db.execute(select(models.AppSetting.key).where(models.AppSetting.key == PAUSE_KEY))).first() is not None


async def set_ai_queue_pause(db, transaction, *, paused):
    if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction) or type(paused) is not bool:
        raise ValueError('Explicit update transaction and pause decision required')
    if getattr(getattr(getattr(db, 'bind', None), 'dialect', None), 'name', None) != 'postgresql':
        raise TransactionFailure('Coordinated AI scheduler pause requires PostgreSQL')
    await db.execute(text(f'SELECT pg_advisory_xact_lock({AI_QUEUE_LOCK})'))
    row = (await db.execute(select(models.AppSetting).where(models.AppSetting.key == PAUSE_KEY)
                            .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    expected = {'schema': 1, 'transaction': transaction}
    if row is not None and (row.value != expected or type(row.value.get('schema')) is not int):
        raise TransactionFailure('AI scheduler pause belongs to another transaction or is invalid')
    if paused and row is None:
        db.add(models.AppSetting(key=PAUSE_KEY, value=expected))
    elif not paused and row is not None:
        await db.delete(row)
    await db.flush()
    return {'schema': 1, 'transaction': transaction, 'paused': paused}

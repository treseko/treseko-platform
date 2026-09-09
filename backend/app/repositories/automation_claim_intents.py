"""Atomic claim/reconciliation ledger. Caller must commit before responding.

Always lock intent then job. No helper here commits or recovers stale jobs;
the existing lease recovery must run before entering this transaction.
"""
import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .. import crud, models
from ..time_utils import utc_now
from .automation_preparation import _runner_supports_job


def fingerprint(token):
    return hashlib.sha256(token.encode()).hexdigest() if token else None


async def lock_intent(db, runner, attempt_id, job_id):
    table = models.AutomationClaimIntent
    await db.execute(insert(table).values(runner_id=runner.id, attempt_id=attempt_id,
                                         job_id=job_id, state="OPEN")
                     .on_conflict_do_nothing(index_elements=[table.runner_id, table.attempt_id]))
    intent = (await db.execute(select(table).where(
        table.runner_id == runner.id, table.attempt_id == attempt_id,
    ).with_for_update().execution_options(populate_existing=True))).scalar_one()
    if intent.job_id != job_id:
        raise ValueError("El intento corresponde a otro job")
    return intent


async def lock_job(db, job_id):
    return (await db.execute(select(models.AutomationJob).where(
        models.AutomationJob.id == job_id,
    ).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()


def close(intent):
    intent.state = "CLOSED"
    intent.closed_at = utc_now()


async def claim(db, runner, attempt_id, job_id):
    intent = await lock_intent(db, runner, attempt_id, job_id)
    if intent.state == "CLOSED":
        return None
    job = await lock_job(db, job_id)
    if not job or job.organizacion_id != runner.organizacion_id or not _runner_supports_job(runner, job):
        close(intent)
        return None
    active = job.estado in (models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING)
    if intent.state == "CLAIMED":
        if active and job.runner_id == runner.id and fingerprint(job.lease_token) == intent.lease_fingerprint:
            return job  # same attempt: no second assignment or attempt increment
        close(intent)
        return None
    if job.estado != models.AutomationJobStatus.PENDING or job.runner_id is not None:
        close(intent)
        return None
    now = utc_now()
    job.runner_id = runner.id
    job.estado = models.AutomationJobStatus.CLAIMED
    job.fecha_claim = now
    job.lease_token = secrets.token_urlsafe(48)
    job.lease_expires_at = now + timedelta(seconds=max(60, int(job.timeout_seconds or 300)))
    job.attempt_count = int(job.attempt_count or 0) + 1
    intent.state = "CLAIMED"
    intent.lease_fingerprint = fingerprint(job.lease_token)
    runner.estado = "BUSY"
    runner.ultimo_heartbeat = now
    await db.flush()
    return job


async def reconcile(db, runner, attempt_id, job_id):
    intent = await lock_intent(db, runner, attempt_id, job_id)
    if intent.state == "CLOSED":
        return "CLOSED"
    if intent.state == "CLAIMED":
        job = await lock_job(db, job_id)
        if (job and job.runner_id == runner.id
                and job.estado in (models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING)
                and fingerprint(job.lease_token) == intent.lease_fingerprint):
            # Do not cancel executions or defeat attempt limits. Existing lease
            # recovery decides whether an expired job is requeued or timed out.
            return "WAIT"
    close(intent)  # also seals a request which has not reached claim yet
    await db.flush()
    return "CLOSED"

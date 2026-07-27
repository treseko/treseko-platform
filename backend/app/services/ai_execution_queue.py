"""Global, durable scheduler for governed AI executions.

The database is the source of truth.  Browser sessions only render this queue;
they never decide which execution may enter the Engine.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select

from .. import models
from ..database import AsyncSessionLocal
from ..repositories.ai_execution_triggers import recover_stale_ai_executions, trigger_ai_execution
from ..repositories.core_settings_ai_workflow_helpers import get_ai_engine_config
from ..services.realtime_events import realtime_event_bus
from ..time_utils import utc_now

logger = logging.getLogger(__name__)

AI_EXECUTION_JOB_TYPE = "AI_EXECUTION"
ACTIVE_QUEUE_STATES = (models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING)
FINAL_QUEUE_STATES = (
    models.AutomationJobStatus.PASSED,
    models.AutomationJobStatus.FAILED,
    models.AutomationJobStatus.BLOCKED,
    models.AutomationJobStatus.ERROR,
    models.AutomationJobStatus.TIMEOUT,
    models.AutomationJobStatus.CANCELLED,
)
_scheduler_task: asyncio.Task | None = None
_scheduler_lock = asyncio.Lock()


async def enqueue_ai_execution(db, execution: models.EjecucionCaso, user_id: UUID) -> models.AutomationJob:
    existing = (await db.execute(
        select(models.AutomationJob)
        .where(
            models.AutomationJob.ejecucion_id == execution.id,
            models.AutomationJob.job_type == AI_EXECUTION_JOB_TYPE,
            models.AutomationJob.estado.in_((models.AutomationJobStatus.PENDING, *ACTIVE_QUEUE_STATES)),
        )
        .order_by(models.AutomationJob.fecha_creacion.desc())
    )).scalars().first()
    if existing:
        return existing
    job = models.AutomationJob(
        job_type=AI_EXECUTION_JOB_TYPE,
        test_run_id=execution.test_run_id,
        ejecucion_id=execution.id,
        caso_id=execution.caso_id,
        estado=models.AutomationJobStatus.PENDING,
        required_framework="treseko-ai",
        required_language="typescript",
        timeout_seconds=900,
        # Never place provider credentials or prompt data in this durable row.
        payload_congelado={"queue_kind": "ai_execution", "execution_id": str(execution.id)},
        creado_por=user_id,
    )
    db.add(job)
    await db.flush()
    return job


async def _context(db, job: models.AutomationJob):
    row = (await db.execute(
        select(models.TestRun, models.CasoPrueba, models.Build)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.AutomationJob.caso_id)
        .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
        .where(models.AutomationJob.id == job.id)
    )).first()
    return row


async def _publish(db, job: models.AutomationJob, event_type: str, *, position: int | None = None):
    row = await _context(db, job)
    if not row:
        return
    run, case, build = row
    payload = {
        "ai_queue": {
            "job_id": str(job.id),
            "status": job.estado.value,
            "position": position,
            "queued_at": job.fecha_creacion.isoformat() if job.fecha_creacion else None,
        },
        "execution": {"id": str(job.ejecucion_id), "estado": "EJECUTANDO_AI" if job.estado == models.AutomationJobStatus.RUNNING else "SIN_CORRER", "mode": "IA"},
    }
    await realtime_event_bus.publish(
        run.proyecto_id, event_type, actor_id=job.creado_por,
        component_id=build.componente_id if build else case.componente_id,
        build_id=run.build_id, case_id=case.id, run_id=run.id, execution_id=job.ejecucion_id,
        payload=payload,
    )


async def list_project_ai_queue(db, project_id: UUID, *, recent_hours: int = 24):
    cutoff = utc_now() - timedelta(hours=recent_hours)
    rows = (await db.execute(
        select(models.AutomationJob, models.EjecucionCaso, models.CasoPrueba, models.TestRun)
        .join(models.EjecucionCaso, models.EjecucionCaso.id == models.AutomationJob.ejecucion_id)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.AutomationJob.caso_id)
        .join(models.TestRun, models.TestRun.id == models.AutomationJob.test_run_id)
        .where(
            models.AutomationJob.job_type == AI_EXECUTION_JOB_TYPE,
            models.TestRun.proyecto_id == project_id,
            (models.AutomationJob.estado.notin_(FINAL_QUEUE_STATES)) | (models.AutomationJob.fecha_fin >= cutoff),
        )
        .order_by(models.AutomationJob.fecha_creacion.asc())
    )).all()
    pending_position = 0
    items = []
    for job, execution, case, run in rows:
        if job.estado == models.AutomationJobStatus.PENDING:
            pending_position += 1
        status = "EN_ESPERA" if job.estado == models.AutomationJobStatus.PENDING else (
            "EN_EJECUCION" if job.estado in ACTIVE_QUEUE_STATES else (execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else str(execution.estado_resultado))
        )
        items.append({
            "job_id": str(job.id), "execution_id": str(execution.id), "case_id": str(case.id),
            "run_id": str(run.id), "case_code": case.codigo, "case_title": case.titulo,
            "run_name": run.nombre, "status": status,
            "queue_position": pending_position if job.estado == models.AutomationJobStatus.PENDING else None,
            "queued_at": job.fecha_creacion, "started_at": job.fecha_inicio,
            "ended_at": job.fecha_fin, "message": execution.observaciones or job.error_message,
            "confidence": execution.ai_confidence, "consensus": execution.ai_consensus,
            "human_review_required": bool(execution.ai_human_review_required),
        })
    return items


async def _dispatch(job_id: UUID):
    async with AsyncSessionLocal() as db:
        job = await db.get(models.AutomationJob, job_id, with_for_update=True)
        if not job or job.job_type != AI_EXECUTION_JOB_TYPE or job.estado != models.AutomationJobStatus.CLAIMED:
            return
        job.estado = models.AutomationJobStatus.RUNNING
        job.fecha_inicio = utc_now()
        await db.commit()
        await _publish(db, job, "ia.execution.running")
    try:
        async with AsyncSessionLocal() as db:
            await trigger_ai_execution(job.ejecucion_id, db)
    except Exception as exc:
        async with AsyncSessionLocal() as db:
            job = await db.get(models.AutomationJob, job_id, with_for_update=True)
            if job and job.estado in ACTIVE_QUEUE_STATES:
                job.estado = models.AutomationJobStatus.BLOCKED
                job.error_message = "El Motor IA no pudo aceptar la ejecucion encolada."
                job.fecha_fin = utc_now()
                await db.commit()
                await _publish(db, job, "ia.execution.blocked")
        logger.warning("Queued AI execution %s could not be dispatched: %s", job_id, type(exc).__name__)


async def drain_ai_execution_queue() -> int:
    if _scheduler_lock.locked():
        return 0
    async with _scheduler_lock:
        async with AsyncSessionLocal() as db:
            # Reconcile terminal callbacks and backend restarts before using a
            # slot. A stale execution is closed, never silently re-run.
            await recover_stale_ai_executions(db)
            active_rows = (await db.execute(
                select(models.AutomationJob, models.EjecucionCaso)
                .join(models.EjecucionCaso, models.EjecucionCaso.id == models.AutomationJob.ejecucion_id)
                .where(models.AutomationJob.job_type == AI_EXECUTION_JOB_TYPE, models.AutomationJob.estado.in_(ACTIVE_QUEUE_STATES))
            )).all()
            for job, execution in active_rows:
                if execution.estado_resultado not in (models.EstadoResultado.SIN_CORRER, models.EstadoResultado.EJECUTANDO_AI):
                    job.estado = (
                        models.AutomationJobStatus.PASSED if execution.estado_resultado == models.EstadoResultado.PASO
                        else models.AutomationJobStatus.BLOCKED if execution.estado_resultado == models.EstadoResultado.BLOQUEADO
                        else models.AutomationJobStatus.FAILED
                    )
                    job.fecha_fin = job.fecha_fin or utc_now()
            await db.commit()
            config = await get_ai_engine_config(db)
            limit = max(1, min(5, int(config.get("max_parallel_ai_runs") or 1)))
            active = (await db.execute(
                select(models.AutomationJob.id).where(
                    models.AutomationJob.job_type == AI_EXECUTION_JOB_TYPE,
                    models.AutomationJob.estado.in_(ACTIVE_QUEUE_STATES),
                )
            )).scalars().all()
            available = max(0, limit - len(active))
            if not available:
                return 0
            jobs = (await db.execute(
                select(models.AutomationJob)
                .where(models.AutomationJob.job_type == AI_EXECUTION_JOB_TYPE, models.AutomationJob.estado == models.AutomationJobStatus.PENDING)
                .order_by(models.AutomationJob.fecha_creacion.asc())
                .with_for_update(skip_locked=True)
                .limit(available)
            )).scalars().all()
            for job in jobs:
                job.estado = models.AutomationJobStatus.CLAIMED
                job.fecha_claim = utc_now()
            await db.commit()
            job_ids = [job.id for job in jobs]
            for position, job in enumerate(jobs, start=1):
                await _publish(db, job, "ia.execution.dispatched", position=position)
    for job_id in job_ids:
        asyncio.create_task(_dispatch(job_id))
    return len(job_ids)


async def mark_ai_execution_finished(db, execution_id: UUID, status: models.EstadoResultado):
    job = (await db.execute(
        select(models.AutomationJob).where(
            models.AutomationJob.ejecucion_id == execution_id,
            models.AutomationJob.job_type == AI_EXECUTION_JOB_TYPE,
            models.AutomationJob.estado.in_(ACTIVE_QUEUE_STATES),
        ).with_for_update()
    )).scalars().first()
    if not job:
        return
    mapping = {
        models.EstadoResultado.PASO: models.AutomationJobStatus.PASSED,
        models.EstadoResultado.BLOQUEADO: models.AutomationJobStatus.BLOCKED,
    }
    job.estado = mapping.get(status, models.AutomationJobStatus.FAILED)
    job.fecha_fin = utc_now()
    await db.flush()
    await _publish(db, job, "ia.execution.finished")


async def _loop():
    while True:
        try:
            await drain_ai_execution_queue()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("AI execution queue scheduler failed")
        await asyncio.sleep(2)


def start_ai_execution_scheduler():
    global _scheduler_task
    if not _scheduler_task or _scheduler_task.done():
        _scheduler_task = asyncio.create_task(_loop(), name="ai-execution-queue")

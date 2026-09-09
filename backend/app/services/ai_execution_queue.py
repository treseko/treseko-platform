"""Global, durable scheduler for governed AI executions.

The database is the source of truth.  Browser sessions only render this queue;
they never decide which execution may enter the Engine.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select, text

from .. import models
from ..database import AsyncSessionLocal
from ..repositories.ai_execution_triggers import recover_stale_ai_executions, trigger_ai_execution
from ..repositories.core_settings_ai_workflow_helpers import get_ai_engine_config
from ..services.realtime_events import realtime_event_bus
from ..services.ai_execution_lifecycle import resolve_queued_execution_mode
from ..time_utils import utc_now
from .update_ai_queue_control import AI_QUEUE_LOCK, ai_queue_paused

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
RECENT_FINISHED_QUEUE_LIMIT = 25
_scheduler_task: asyncio.Task | None = None
_scheduler_lock = asyncio.Lock()


def _visible_queue_rows(rows, *, finished_limit: int = RECENT_FINISHED_QUEUE_LIMIT):
    """Return unique active rows plus a bounded newest-first finished tail."""
    latest_row_by_execution = {}
    for row in rows:
        job = row[0]
        latest_row_by_execution[str(job.ejecucion_id)] = row
    unique_rows = list(latest_row_by_execution.values())
    active_rows = [row for row in unique_rows if row[0].estado not in FINAL_QUEUE_STATES]
    finished_rows = [row for row in unique_rows if row[0].estado in FINAL_QUEUE_STATES]
    return [*active_rows, *reversed(finished_rows[-finished_limit:])]


async def enqueue_ai_execution(
    db,
    execution: models.EjecucionCaso,
    user_id: UUID,
    requested_mode: models.ExecutionMode = models.ExecutionMode.IA,
) -> models.AutomationJob:
    # Serialize enqueue requests for the same execution.  This is deliberately
    # a row lock rather than a process-local lock: the API and scheduler may
    # run in different backend processes.
    locked_execution = await db.get(models.EjecucionCaso, execution.id, with_for_update=True)
    if locked_execution is None:
        raise ValueError("Ejecucion no encontrada para encolar la ejecución IA")
    execution = locked_execution
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
    run = await db.get(models.TestRun, execution.test_run_id)
    project = await db.get(models.Proyecto, run.proyecto_id) if run else None
    if not run or not project:
        raise ValueError("No se pudo resolver el alcance del proyecto para encolar la ejecución IA")
    job = models.AutomationJob(
        job_type=AI_EXECUTION_JOB_TYPE,
        organizacion_id=project.organizacion_id,
        proyecto_id=project.id,
        test_run_id=execution.test_run_id,
        ejecucion_id=execution.id,
        caso_id=execution.caso_id,
        estado=models.AutomationJobStatus.PENDING,
        required_framework="treseko-ai",
        required_language="typescript",
        timeout_seconds=900,
        # Never place provider credentials or prompt data in this durable row.
        payload_congelado={
            "queue_kind": "ai_execution",
            "execution_id": str(execution.id),
            "execution_mode": requested_mode.value,
        },
        creado_por=user_id,
    )
    db.add(job)
    await db.flush()
    return job


async def _context(db, job: models.AutomationJob):
    row = (await db.execute(
        select(models.TestRun, models.CasoPrueba, models.Build)
        .select_from(models.AutomationJob)
        .join(models.TestRun, models.TestRun.id == models.AutomationJob.test_run_id)
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
    # A logical execution may have more than one historical scheduler job
    # (for example after an explicit retry).  The operational monitor must not
    # render those rows as duplicate queue entries.  It also must not ship an
    # unbounded day of completed runs to the browser: reports remain available
    # from Run History, while this view keeps only a small recent tail.
    pending_position = 0
    items = []
    for job, execution, case, run in _visible_queue_rows(rows):
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


async def list_project_ai_history(db, project_id: UUID, *, limit: int = 100, offset: int = 0):
    """Return durable AI executions for the Motor IA history view.

    This is intentionally separate from the operational queue: the queue is a
    small live monitor, while this collection is the durable index from which
    the report and complete runtime traces can be opened after a refresh.
    """
    rows = (await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba, models.TestRun)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .where(
            models.TestRun.proyecto_id == project_id,
            models.EjecucionCaso.execution_mode == models.ExecutionMode.IA,
        )
        .order_by(models.EjecucionCaso.fecha_ejecucion.desc())
        .offset(offset)
        .limit(limit)
    )).all()
    history = []
    for execution, case, run in rows:
        report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
        history.append({
            "execution_id": str(execution.id),
            "run_id": str(run.id),
            "case_id": str(case.id),
            "case_code": case.codigo,
            "case_title": case.titulo,
            "run_name": run.nombre,
            "status": execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else str(execution.estado_resultado),
            "execution_mode": execution.execution_mode.value if hasattr(execution.execution_mode, "value") else str(execution.execution_mode),
            "executed_at": execution.fecha_ejecucion,
            "duration_seconds": execution.duracion_segundos,
            "confidence": execution.ai_confidence,
            "consensus": execution.ai_consensus,
            "failure_category": execution.ai_failure_category,
            "human_review_required": bool(execution.ai_human_review_required),
            "review_status": execution.ai_review_status.value if hasattr(execution.ai_review_status, "value") else str(execution.ai_review_status),
            "has_report": bool(report),
            "timeline_count": len(report.get("timeline") or []),
            "agent_event_count": len(report.get("agent_conversation") or []),
            "workflow_trace_count": len(report.get("workflow_traces") or []),
        })
    return history


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
            requested_mode = resolve_queued_execution_mode(job.payload_congelado)
            await trigger_ai_execution(job.ejecucion_id, db, requested_mode)
            execution = await db.get(models.EjecucionCaso, job.ejecucion_id)
            if execution and execution.estado_resultado in (
                models.EstadoResultado.BLOQUEADO,
                models.EstadoResultado.FALLO,
            ):
                # Configuration/dispatch validation can close the execution
                # normally instead of raising. Close the queue job exactly
                # once; mark_ai_execution_finished only updates active jobs.
                await mark_ai_execution_finished(db, execution.id, execution.estado_resultado)
                await db.commit()
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
            # The local asyncio lock is not enough when uvicorn has multiple
            # workers. PostgreSQL advisory locking makes the count-and-claim
            # section installation-wide; SQLite/fake sessions keep the local
            # lock used by tests and native single-process development.
            bind = getattr(db, "bind", None)
            dialect_name = getattr(getattr(bind, "dialect", None), "name", None)
            if dialect_name == "postgresql":
                await db.execute(text(f"SELECT pg_advisory_xact_lock({AI_QUEUE_LOCK})"))
            # Read only after taking the same lock as the durable pause writer.
            # Already claimed jobs may finish; do not recover or claim new work
            # while the updater owns this pause.
            if await ai_queue_paused(db):
                return 0
            # Reconcile terminal callbacks and backend restarts before using a
            # slot. A stale execution is closed, never silently re-run.
            # Keep recovery, reconciliation, slot counting and claiming in
            # this same transaction so the advisory transaction lock covers
            # the complete count-and-claim critical section.
            await recover_stale_ai_executions(db, commit=False)
            active_rows = (await db.execute(
                select(models.AutomationJob, models.EjecucionCaso)
                .join(models.EjecucionCaso, models.EjecucionCaso.id == models.AutomationJob.ejecucion_id)
                .where(models.AutomationJob.job_type == AI_EXECUTION_JOB_TYPE, models.AutomationJob.estado.in_(ACTIVE_QUEUE_STATES))
            )).all()
            for job, execution in active_rows:
                # A process can die after claiming a job but before starting
                # the dispatch. Requeue that orphan instead of consuming the
                # global AI slot forever; the execution remains SIN_CORRER and
                # no duplicate logical execution is created.
                if (
                    execution.estado_resultado == models.EstadoResultado.SIN_CORRER
                    and job.estado in ACTIVE_QUEUE_STATES
                    and job.fecha_inicio is None
                ):
                    job.estado = models.AutomationJobStatus.PENDING
                    job.fecha_claim = None
                    continue
                if execution.estado_resultado not in (models.EstadoResultado.SIN_CORRER, models.EstadoResultado.EJECUTANDO_AI):
                    job.estado = (
                        models.AutomationJobStatus.PASSED if execution.estado_resultado == models.EstadoResultado.PASO
                        else models.AutomationJobStatus.BLOCKED if execution.estado_resultado == models.EstadoResultado.BLOQUEADO
                        else models.AutomationJobStatus.FAILED
                    )
                    job.fecha_fin = job.fecha_fin or utc_now()
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
                await db.commit()
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

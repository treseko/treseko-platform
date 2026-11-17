from .repository_context import *
from sqlalchemy import and_


async def expire_stale_playwright_recordings(db: AsyncSession, *, now=None) -> int:
    now = now or utc_now()
    result = await db.execute(
        update(models.AutomationJob)
        .where(
            models.AutomationJob.job_type == "PLAYWRIGHT_RECORDING",
            or_(
                and_(
                    models.AutomationJob.estado == models.AutomationJobStatus.PENDING,
                    models.AutomationJob.fecha_creacion <= now - timedelta(minutes=30),
                ),
                and_(
                    models.AutomationJob.estado == models.AutomationJobStatus.RUNNING,
                    models.AutomationJob.fecha_inicio <= now - timedelta(minutes=30),
                ),
            ),
        )
        .values(
            estado=models.AutomationJobStatus.TIMEOUT,
            fecha_fin=now,
            error_message="La sesión de grabación superó el límite de 30 minutos.",
        )
        .returning(models.AutomationJob.id)
    )
    expired_ids = result.scalars().all()
    if expired_ids:
        await db.commit()
    return len(expired_ids)


async def complete_playwright_recording_job(db, job, payload, now):
    if job.estado not in {models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING}:
        raise ValueError("La grabación ya está cerrada y no admite otro resultado")
    if payload.status not in {
        models.AutomationJobStatus.PASSED,
        models.AutomationJobStatus.ERROR,
        models.AutomationJobStatus.TIMEOUT,
        models.AutomationJobStatus.CANCELLED,
        models.AutomationJobStatus.BLOCKED,
    }:
        raise ValueError("El estado de finalización de la grabación no es válido")
    recorded_script = (payload.metadata or {}).get("recorded_script")
    if payload.status == models.AutomationJobStatus.PASSED and (
        not isinstance(recorded_script, str) or not recorded_script.strip() or len(recorded_script) > 100_000
    ):
        raise ValueError("El Worker no devolvió un script de grabación válido")
    job.estado = payload.status
    job.logs = None
    job.error_message = payload.error_message
    job.metadata_resultado = {
        **(job.metadata_resultado or {}),
        "recorded_script": recorded_script if payload.status == models.AutomationJobStatus.PASSED else None,
        "recorder_control": "CANCEL" if payload.status == models.AutomationJobStatus.CANCELLED else "STOP",
        "duration_seconds": payload.duration_seconds,
    }
    job.fecha_fin = now
    if job.runner:
        job.runner.estado = "ONLINE"
        job.runner.ultimo_heartbeat = now
    job.lease_token = None
    job.lease_expires_at = None
    await db.commit()
    await db.refresh(job)
    return job

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..repositories.automation_job_results import _automation_result_fingerprint
from .automation_result_archive import archive_worker_result


def ensure_job_runner_access(job, runner) -> None:
    if not job.runner_id:
        raise HTTPException(status_code=409, detail="El job debe ser reclamado antes de reportar resultados")
    if job.runner_id != runner.id:
        raise HTTPException(status_code=403, detail="Este job fue tomado por otro runner")
    if job.organizacion_id != runner.organizacion_id:
        raise HTTPException(status_code=403, detail="El runner no tiene acceso a la solucion de este job")


async def prepare_worker_result_evidence(job_id, job, payload):
    completed = job.estado not in {
        models.AutomationJobStatus.PENDING,
        models.AutomationJobStatus.CLAIMED,
        models.AutomationJobStatus.RUNNING,
    }
    if completed and (
        getattr(job, "result_event_id", None) != payload.result_event_id
        or getattr(job, "result_fingerprint", None) != _automation_result_fingerprint(payload)
    ):
        raise HTTPException(409, "El job ya tiene un resultado distinto y no admite otra entrega")
    if not completed and payload.lease_token != job.lease_token:
        raise HTTPException(409, "El lease_token no es válido o ya fue reemplazado")
    try:
        return await archive_worker_result(job_id, payload)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


async def persist_worker_result_evidence(db: AsyncSession, job, evidence_url: str) -> None:
    job.metadata_resultado = {**(job.metadata_resultado or {}), "complete_evidence_url": evidence_url}
    await db.commit()
    await db.refresh(job)


def apply_worker_result_metadata(job, payload, evidence_url: str) -> None:
    job.logs = payload.logs
    job.metadata_resultado = {**(payload.metadata or {}), "complete_evidence_url": evidence_url}

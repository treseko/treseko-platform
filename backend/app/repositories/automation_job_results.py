from .legacy_common import *
from ..evidence_url_security import sanitize_evidence_url


async def complete_automation_job(db: AsyncSession, job: models.AutomationJob, payload: schemas.AutomationJobResult):
    now = utc_now()
    job.estado = payload.status
    job.logs = payload.logs
    job.error_message = payload.error_message
    metadata_resultado = dict(payload.metadata or {})
    if payload.steps:
        metadata_resultado["steps"] = [step.model_dump(mode="json") for step in payload.steps]
    if payload.observations:
        metadata_resultado["observations"] = payload.observations
    job.metadata_resultado = metadata_resultado
    job.fecha_fin = now

    if (job.job_type or "EXECUTION") == "DRY_RUN":
        persisted_artifacts = await _persist_automation_artifacts(db, job, payload.artifacts)
        if persisted_artifacts:
            metadata_resultado["artifacts"] = persisted_artifacts
            job.metadata_resultado = metadata_resultado
        if job.runner:
            job.runner.estado = "ONLINE"
            job.runner.ultimo_heartbeat = now
        await db.commit()
        await db.refresh(job)
        return job

    execution_result = await db.execute(
        select(models.EjecucionCaso).filter(models.EjecucionCaso.id == job.ejecucion_id)
    )
    execution = execution_result.scalar_one_or_none()
    if not execution:
        raise ValueError("Ejecucion no encontrada para el job")
    run_result = await db.execute(select(models.TestRun).filter(models.TestRun.id == execution.test_run_id))
    run = run_result.scalar_one_or_none()
    if run and run.build_id:
        build_active = (
            await db.execute(select(models.Build.activo).filter(models.Build.id == run.build_id))
        ).scalar_one_or_none()
        if build_active is False:
            raise ValueError("La build está inactiva. No se pueden registrar resultados de automatización sobre una build cerrada.")

    status_map = {
        models.AutomationJobStatus.PASSED: models.EstadoResultado.PASO,
        models.AutomationJobStatus.FAILED: models.EstadoResultado.FALLO,
        models.AutomationJobStatus.BLOCKED: models.EstadoResultado.BLOQUEADO,
        models.AutomationJobStatus.ERROR: models.EstadoResultado.FALLO,
        models.AutomationJobStatus.TIMEOUT: models.EstadoResultado.FALLO,
        models.AutomationJobStatus.CANCELLED: models.EstadoResultado.BLOQUEADO,
    }
    final_status = status_map.get(payload.status)
    if final_status:
        execution.estado_resultado = final_status
        execution.duracion_segundos = max(0, payload.duration_seconds or 0)
        execution.observaciones = payload.observations or payload.error_message
        execution.fecha_ejecucion = now

        snapshots_result = await db.execute(
            select(models.SnapshotPaso)
            .filter(models.SnapshotPaso.ejecucion_caso_id == execution.id)
            .order_by(models.SnapshotPaso.numero_paso)
        )
        snapshots = snapshots_result.scalars().all()
        snapshots_by_number = {snapshot.numero_paso: snapshot for snapshot in snapshots}
        reported_numbers = set()
        for step in payload.steps:
            reported_numbers.add(step.number)
            snapshot = snapshots_by_number.get(step.number)
            if not snapshot:
                snapshot = models.SnapshotPaso(
                    ejecucion_caso_id=execution.id,
                    numero_paso=step.number,
                    accion_congelada=f"Paso automatizado {step.number}",
                    resultado_esperado_congelado="Reportado por worker automatizado",
                )
                db.add(snapshot)
                await db.flush()
                snapshots.append(snapshot)
                snapshots_by_number[snapshot.numero_paso] = snapshot
            snapshot.estado_paso = step.status
            snapshot.comentarios = step.observations
            snapshot.evidencia_url = sanitize_evidence_url(step.evidence_url)
            snapshot.error_log = step.error_log

        payload_evidence_url = sanitize_evidence_url(payload.evidence_url)
        if snapshots and not payload.steps:
            for index, snapshot in enumerate(snapshots):
                if final_status == models.EstadoResultado.PASO:
                    snapshot.estado_paso = models.EstadoResultado.PASO
                elif index == 0:
                    snapshot.estado_paso = final_status
                    snapshot.comentarios = payload.observations or payload.error_message
                    snapshot.evidencia_url = payload_evidence_url
                else:
                    snapshot.estado_paso = models.EstadoResultado.SIN_CORRER
        elif not snapshots and not payload.steps:
            snapshot = models.SnapshotPaso(
                ejecucion_caso_id=execution.id,
                numero_paso=0,
                accion_congelada="Ejecucion automatizada",
                resultado_esperado_congelado="Resultado reportado por worker automatizado",
                estado_paso=final_status,
                comentarios=payload.observations or payload.error_message,
                evidencia_url=payload_evidence_url,
                error_log=payload.error_message,
            )
            db.add(snapshot)
            await db.flush()
            snapshots.append(snapshot)
            snapshots_by_number[snapshot.numero_paso] = snapshot

        default_artifact_snapshot = next(
            (
                snapshot for snapshot in snapshots
                if snapshot.estado_paso in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}
            ),
            snapshots[0] if snapshots else None,
        )
        persisted_artifacts = await _persist_automation_artifacts(
            db,
            job,
            payload.artifacts,
            snapshots_by_number=snapshots_by_number,
            default_snapshot=default_artifact_snapshot,
        )
        if persisted_artifacts:
            metadata_resultado["artifacts"] = persisted_artifacts
            job.metadata_resultado = metadata_resultado

        case_result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == execution.caso_id))
        case = case_result.scalar_one_or_none()
        if case:
            case.ultimo_resultado = final_status.value
            case.ultima_ejecucion_por = execution.ejecutado_por
            case.ultima_ejecucion_fecha = now

        pending_result = await db.execute(
            select(models.EjecucionCaso.id)
            .filter(
                models.EjecucionCaso.test_run_id == execution.test_run_id,
                models.EjecucionCaso.estado_resultado == models.EstadoResultado.SIN_CORRER,
            )
            .limit(1)
        )
        if run and pending_result.scalar_one_or_none() is None:
            run.estado_run = models.EstadoRun.CERRADO
            run.fecha_cierre = now

    if job.runner:
        job.runner.estado = "ONLINE"
        job.runner.ultimo_heartbeat = now

    await db.commit()
    await db.refresh(job)
    return job

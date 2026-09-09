from .repository_context import *
from ..services.edition.usage_limits import enforce_weekly_automated_execution_limit
from sqlalchemy import update


async def create_automation_job_for_execution(
    db: AsyncSession,
    ejecucion_id: UUID,
    user_id: UUID,
    debug_mode: bool = False,
):
    execution_result = await db.execute(
        select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejecucion_id)
    )
    execution = execution_result.scalar_one_or_none()
    if not execution:
        raise ValueError("Ejecucion no encontrada")

    run_result = await db.execute(select(models.TestRun).filter(models.TestRun.id == execution.test_run_id))
    run = run_result.scalar_one_or_none()
    if not run:
        raise ValueError("Run no encontrado")
    project_result = await db.execute(
        select(models.Proyecto).filter(models.Proyecto.id == run.proyecto_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise ValueError("Proyecto no encontrado")

    if run.build_id:
        build = (await db.execute(select(models.Build).filter(models.Build.id == run.build_id))).scalar_one_or_none()
        if build is None or not access_control.is_build_active(build):
            raise ValueError("La build está inactiva. No se pueden crear jobs de automatización sobre una build cerrada.")

    case_result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == execution.caso_id))
    case = case_result.scalar_one_or_none()
    if not case:
        raise ValueError("Caso no encontrado")
    if case.tipo_prueba != models.TipoPrueba.AUTOMATIZADA:
        raise ValueError("El caso no es de tipo AUTOMATIZADA")
    if not (case.script_automatizado or "").strip():
        raise ValueError("El caso no tiene script automatizado")

    existing_result = await db.execute(
        select(models.AutomationJob)
        .filter(
            models.AutomationJob.ejecucion_id == ejecucion_id,
            models.AutomationJob.estado.in_([
                models.AutomationJobStatus.PENDING,
                models.AutomationJobStatus.CLAIMED,
                models.AutomationJobStatus.RUNNING,
            ]),
        )
        .order_by(models.AutomationJob.fecha_creacion.desc())
    )
    existing = existing_result.scalars().first()
    if existing:
        execution.execution_mode = models.ExecutionMode.AUTOMATIZADA
        await db.commit()
        return existing
    await enforce_weekly_automated_execution_limit(db, solution_id=project.organizacion_id)
    execution.execution_mode = models.ExecutionMode.AUTOMATIZADA
    execution.fecha_ejecucion = utc_now()

    steps_result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id == execution.id)
        .order_by(models.SnapshotPaso.numero_paso)
    )
    snapshots = steps_result.scalars().all()
    required_framework, required_runtime = _parse_framework_requirement(case.framework)
    _, required_language = _parse_framework_language(case.framework)
    prepared_script, function_refs = await prepare_automation_script_for_case(db, case)
    resolved_dataset = await resolve_case_dataset(db, case.id, run.build_id, run.entorno_id, run.dataset_id)
    payload_variables = resolved_dataset["variables_resueltas"] if resolved_dataset else (run.variables_resueltas or {})
    payload_dataset = resolved_dataset["dataset_resuelto"] if resolved_dataset else (run.datasets_resueltos or {}).get(str(case.id), [])
    payload = {
        "test_run_id": str(run.id),
        "ejecucion_id": str(execution.id),
        "caso_id": str(case.id),
        "case_code": case.codigo,
        "case_title": case.titulo,
        "case_version": case.version,
        "build_id": str(run.build_id) if run.build_id else None,
        "environment": run.entorno,
        "entorno_id": str(run.entorno_id) if run.entorno_id else None,
        "dataset_id": str(run.dataset_id) if run.dataset_id else None,
        "variables": payload_variables,
        "dataset": payload_dataset,
        "case_variables": resolved_dataset["dataset_caso_resuelto"] if resolved_dataset else [],
        "environment_variables": resolved_dataset["variables_ambiente"] if resolved_dataset else {},
        "component_variables": resolved_dataset["variables_componente"] if resolved_dataset else {},
        "framework": required_framework,
        "framework_version": required_runtime,
        "language": required_language,
        "debug_mode": bool(debug_mode),
        "script_format": _detect_automation_script_format(prepared_script, required_framework, required_language),
        "script": prepared_script,
        "functions": function_refs,
        "steps": [
            {
                "snapshot_id": str(snapshot.id),
                "number": snapshot.numero_paso,
                "action": snapshot.accion_congelada,
                # Keep the template for auditability, but execute the exact
                # value resolved for this isolated case/run when available.
                "data": snapshot.datos_resueltos if snapshot.datos_resueltos is not None else snapshot.datos_congelados,
                "expected": snapshot.resultado_esperado_congelado,
            }
            for snapshot in snapshots
        ],
    }
    payload = schemas.redact_automation_sensitive_value(payload)
    job = models.AutomationJob(
        organizacion_id=project.organizacion_id,
        proyecto_id=run.proyecto_id,
        test_run_id=run.id,
        ejecucion_id=execution.id,
        caso_id=case.id,
        build_id=run.build_id,
        required_framework=required_framework,
        required_language=required_language,
        required_runtime=required_runtime,
        timeout_seconds=300,
        payload_congelado=payload,
        creado_por=user_id,
    )
    run.origen = "AUTOMATIZADA_WORKER"
    db.add(job)
    await db.flush()
    compatible_runner = await _find_compatible_runner_for_job(db, job)
    if not compatible_runner:
        now = utc_now()
        job.estado = models.AutomationJobStatus.BLOCKED_BY_RUNNER
        job.error_message = f"No hay worker compatible disponible para {required_framework} + {required_language}"
        job.fecha_fin = now
        execution.estado_resultado = models.EstadoResultado.BLOQUEADO
        execution.execution_mode = models.ExecutionMode.AUTOMATIZADA
        execution.observaciones = job.error_message
        execution.fecha_ejecucion = now
        case.ultimo_resultado = models.EstadoResultado.BLOQUEADO.value
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
        if pending_result.scalar_one_or_none() is None:
            run.estado_run = models.EstadoRun.CERRADO
            run.fecha_cierre = now
    await db.commit()
    await db.refresh(job)
    return job


async def create_automation_dry_run_job(
    db: AsyncSession,
    payload: schemas.AutomationDryRunRequest,
    user_id: UUID,
):
    if not (payload.script_automatizado or "").strip():
        raise ValueError("El script esta vacio")

    project_result = await db.execute(
        select(models.Proyecto).filter(models.Proyecto.id == payload.proyecto_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise ValueError("El proyecto indicado no existe")

    required_framework, required_runtime = _parse_framework_requirement(payload.framework)
    framework_from_payload, language_from_framework = _parse_framework_language(payload.framework)
    required_framework = framework_from_payload or required_framework
    required_language = _normalize_language(payload.lenguaje or language_from_framework, required_framework)
    variables, environment_name, dataset_name, dataset_vars, case_vars = await _resolve_dry_run_variables(db, payload)
    prepared_script, function_refs = await prepare_automation_script_for_context(
        db,
        script=payload.script_automatizado,
        proyecto_id=payload.proyecto_id,
        componente_id=payload.componente_id,
        framework=payload.framework,
    )

    job_payload = {
        "dry_run": True,
        "job_type": "DRY_RUN",
        "case_code": payload.codigo or "DRY-RUN",
        "case_title": payload.titulo or "Prueba temporal del editor",
        "case_version": None,
        "proyecto_id": str(payload.proyecto_id),
        "componente_id": str(payload.componente_id) if payload.componente_id else None,
        "environment": environment_name,
        "entorno_id": str(payload.entorno_id) if payload.entorno_id else None,
        "dataset_id": str(payload.dataset_id) if payload.dataset_id else None,
        "dataset_name": dataset_name,
        "variables": variables,
        "dataset": [{"key": key, "value": value} for key, value in variables.items()],
        "dataset_ambiente": dataset_vars,
        "dataset_caso": case_vars,
        "case_variables": [{"key": key, "value": value} for key, value in case_vars.items()],
        "framework": required_framework,
        "framework_version": required_runtime,
        "language": required_language,
        "debug_mode": bool(payload.debug_mode),
        "script_format": _detect_automation_script_format(prepared_script, required_framework, required_language),
        "script": prepared_script,
        "functions": function_refs,
        "steps": _automation_steps_for_payload(payload.pasos),
    }

    job_payload = schemas.redact_automation_sensitive_value(job_payload)
    job = models.AutomationJob(
        job_type="DRY_RUN",
        organizacion_id=project.organizacion_id,
        proyecto_id=payload.proyecto_id,
        test_run_id=None,
        ejecucion_id=None,
        caso_id=None,
        build_id=None,
        required_framework=required_framework,
        required_language=required_language,
        required_runtime=required_runtime,
        timeout_seconds=payload.timeout_seconds,
        payload_congelado=job_payload,
        creado_por=user_id,
    )
    db.add(job)
    await db.flush()

    compatible_runner = await _find_compatible_runner_for_job(db, job)
    if not compatible_runner:
        job.estado = models.AutomationJobStatus.BLOCKED_BY_RUNNER
        job.error_message = f"No hay worker compatible disponible para {required_framework} + {required_language}"

    await db.commit()
    await db.refresh(job)
    return job

async def get_automation_job(db: AsyncSession, job_id: UUID):
    result = await db.execute(select(models.AutomationJob).filter(models.AutomationJob.id == job_id))
    return result.scalar_one_or_none()

async def list_automation_jobs(
    db: AsyncSession,
    limit: int = 20,
    runner_id: Optional[UUID] = None,
    status: Optional[models.AutomationJobStatus] = None,
    include_dry_runs: bool = False,
    proyecto_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    build_id: Optional[UUID] = None,
    accessible_project_ids: Optional[List[UUID]] = None,
    accessible_user_id: Optional[UUID] = None,
):
    query = (
        select(models.AutomationJob)
        .outerjoin(models.TestRun, models.TestRun.id == models.AutomationJob.test_run_id)
        .outerjoin(models.Build, models.Build.id == models.AutomationJob.build_id)
        .outerjoin(models.CasoPrueba, models.CasoPrueba.id == models.AutomationJob.caso_id)
    )
    if not include_dry_runs:
        query = query.filter(models.AutomationJob.job_type.notin_(("DRY_RUN", "AI_EXECUTION")))
    if runner_id:
        query = query.filter(models.AutomationJob.runner_id == runner_id)
    if status:
        query = query.filter(models.AutomationJob.estado == status)
    if proyecto_id:
        query = query.filter(or_(
            models.TestRun.proyecto_id == proyecto_id,
            models.Build.proyecto_id == proyecto_id,
            models.CasoPrueba.proyecto_id == proyecto_id,
            # Dry-runs do not have a run/build/case row. Their controlled
            # project scope is intentionally frozen in the job payload.
            models.AutomationJob.payload_congelado["proyecto_id"].as_string() == str(proyecto_id),
        ))
    elif accessible_project_ids is not None:
        if not accessible_project_ids:
            return []
        access_filters = [
            models.TestRun.proyecto_id.in_(accessible_project_ids),
            models.Build.proyecto_id.in_(accessible_project_ids),
            models.CasoPrueba.proyecto_id.in_(accessible_project_ids),
        ]
        if accessible_user_id:
            access_filters.append(and_(
                models.AutomationJob.job_type == "DRY_RUN",
                models.AutomationJob.creado_por == accessible_user_id,
            ))
        query = query.filter(or_(*access_filters))
    if component_id:
        query = query.filter(or_(
            models.Build.componente_id == component_id,
            models.CasoPrueba.componente_id == component_id,
        ))
    if build_id:
        query = query.filter(or_(
            models.AutomationJob.build_id == build_id,
            models.TestRun.build_id == build_id,
        ))
    query = query.order_by(models.AutomationJob.fecha_creacion.desc()).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()

async def _mark_expired_job_entities(db: AsyncSession, job: models.AutomationJob, now) -> None:
    """Move the persisted execution side of an exhausted lease to timeout."""
    execution_ids = []
    if job.ejecucion_id:
        execution_ids = [job.ejecucion_id]
    elif job.job_type == "API_EXECUTION" and job.test_run_id:
        execution_ids = list((await db.execute(
            select(models.EjecucionCaso.id).where(
                models.EjecucionCaso.test_run_id == job.test_run_id,
                models.EjecucionCaso.estado_resultado == models.EstadoResultado.SIN_CORRER,
            )
        )).scalars().all())

    if not execution_ids:
        return

    executions = (await db.execute(
        select(models.EjecucionCaso).where(models.EjecucionCaso.id.in_(execution_ids)).with_for_update()
    )).scalars().all()
    case_ids = [execution.caso_id for execution in executions]
    for execution in executions:
        execution.estado_resultado = models.EstadoResultado.FALLO
        execution.observaciones = "El worker no renovó el lease y el job terminó por timeout."
        execution.fecha_ejecucion = now

    if case_ids:
        cases = (await db.execute(
            select(models.CasoPrueba).where(models.CasoPrueba.id.in_(case_ids)).with_for_update()
        )).scalars().all()
        for case in cases:
            case.ultimo_resultado = models.EstadoResultado.FALLO.value
            case.ultima_ejecucion_fecha = now

    run_id = job.test_run_id or (executions[0].test_run_id if executions else None)
    if run_id:
        pending = await db.scalar(select(models.EjecucionCaso.id).where(
            models.EjecucionCaso.test_run_id == run_id,
            models.EjecucionCaso.estado_resultado == models.EstadoResultado.SIN_CORRER,
        ).limit(1))
        if pending is None:
            run = await db.get(models.TestRun, run_id, with_for_update=True)
            if run:
                run.estado_run = models.EstadoRun.CERRADO
                run.fecha_cierre = now


async def recover_stale_automation_jobs(
    db: AsyncSession,
    *,
    now=None,
    limit: int = 100,
) -> int:
    """Recover worker jobs whose lease expired, under row locks.

    AI_EXECUTION is intentionally not requeued here: it has a separate queue
    and must require an explicit retry after an interruption.
    """
    now = now or utc_now()
    jobs = (await db.execute(
        select(models.AutomationJob).where(
            models.AutomationJob.estado.in_((
                models.AutomationJobStatus.CLAIMED,
                models.AutomationJobStatus.RUNNING,
            )),
            models.AutomationJob.lease_expires_at.is_not(None),
            models.AutomationJob.lease_expires_at <= now,
        ).order_by(models.AutomationJob.lease_expires_at).with_for_update(skip_locked=True).limit(limit)
    )).scalars().all()
    recovered = 0
    for job in jobs:
        recovered += 1
        exhausted = int(job.attempt_count or 0) >= max(1, int(job.max_attempts or 1))
        previous_runner_id = job.runner_id
        if not exhausted and job.job_type != "AI_EXECUTION":
            job.estado = models.AutomationJobStatus.PENDING
            job.runner_id = None
            job.lease_token = None
            job.lease_expires_at = None
            job.fecha_claim = None
            job.fecha_inicio = None
            job.fecha_fin = None
            job.error_message = "El lease del worker venció; el job volvió a la cola para un nuevo intento."
            if previous_runner_id:
                runner = await db.get(models.AutomationRunner, previous_runner_id, with_for_update=True)
                if runner:
                    runner.estado = "ONLINE"
                    runner.ultimo_heartbeat = now
            continue

        job.estado = models.AutomationJobStatus.TIMEOUT
        job.error_message = (
            "El job terminó por timeout después de agotar sus intentos. "
            "No se reintentó automáticamente una ejecución IA."
            if job.job_type == "AI_EXECUTION"
            else "El job terminó por timeout después de agotar sus intentos de worker."
        )
        job.fecha_fin = now
        job.lease_token = None
        job.lease_expires_at = None
        await _mark_expired_job_entities(db, job, now)
        if job.runner_id:
            runner = await db.get(models.AutomationRunner, job.runner_id, with_for_update=True)
            if runner:
                runner.estado = "ONLINE"
                runner.ultimo_heartbeat = now

    if recovered:
        await db.commit()
    return recovered

async def get_next_automation_job(db: AsyncSession, runner: models.AutomationRunner):
    await recover_stale_automation_jobs(db)
    result = await db.execute(
        select(models.AutomationJob)
        .filter(
            models.AutomationJob.estado == models.AutomationJobStatus.PENDING,
            models.AutomationJob.job_type != "AI_EXECUTION",
            models.AutomationJob.organizacion_id == runner.organizacion_id,
        )
        .order_by(models.AutomationJob.fecha_creacion)
    )
    jobs = result.scalars().all()
    for job in jobs:
        if _runner_supports_job(runner, job):
            return job
    return None

async def claim_automation_job(db: AsyncSession, job: models.AutomationJob, runner: models.AutomationRunner):
    job_id = job.id
    runner_organization_id = runner.organizacion_id
    await recover_stale_automation_jobs(db)
    if job.organizacion_id != runner.organizacion_id:
        raise ValueError("El runner no tiene acceso a la solucion de este job")
    if not _runner_supports_job(runner, job):
        raise ValueError("El runner no es compatible con este job")
    now = utc_now()
    lease_token = secrets.token_urlsafe(48)
    lease_expires_at = now + timedelta(seconds=max(60, int(job.timeout_seconds or 300)))
    claim = await db.execute(
        update(models.AutomationJob)
        .where(
            models.AutomationJob.id == job_id,
            models.AutomationJob.estado == models.AutomationJobStatus.PENDING,
            models.AutomationJob.runner_id.is_(None),
            models.AutomationJob.organizacion_id == runner_organization_id,
        )
        .values(
            runner_id=runner.id,
            estado=models.AutomationJobStatus.CLAIMED,
            fecha_claim=now,
            lease_token=lease_token,
            lease_expires_at=lease_expires_at,
            attempt_count=models.AutomationJob.attempt_count + 1,
        )
        .returning(models.AutomationJob.id)
    )
    if claim.scalar_one_or_none() is None:
        await db.rollback()
        # The caller may still hold the pre-claim ORM instance in its identity
        # map. Force a fresh read so concurrent-claim errors describe the
        # committed owner/state instead of the stale PENDING snapshot.
        current = await db.get(models.AutomationJob, job_id, populate_existing=True)
        if current and current.organizacion_id != runner_organization_id:
            raise ValueError("El runner no tiene acceso a la solucion de este job")
        if current and current.estado == models.AutomationJobStatus.CLAIMED:
            raise ValueError("El job ya fue reclamado y no puede reclamarse nuevamente")
        raise ValueError("El job ya no esta pendiente y no puede reclamarse")
    runner.estado = "BUSY"
    runner.ultimo_heartbeat = now
    await db.commit()
    await db.refresh(job)
    return job

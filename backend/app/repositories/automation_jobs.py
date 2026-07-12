from .legacy_common import *
from ..services.edition.usage_limits import enforce_weekly_automated_execution_limit


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
        build_active = (
            await db.execute(select(models.Build.activo).filter(models.Build.id == run.build_id))
        ).scalar_one_or_none()
        if build_active is False:
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
                "data": snapshot.datos_congelados,
                "expected": snapshot.resultado_esperado_congelado,
            }
            for snapshot in snapshots
        ],
    }
    payload = schemas.redact_automation_sensitive_value(payload)
    job = models.AutomationJob(
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
        query = query.filter(models.AutomationJob.job_type != "DRY_RUN")
    if runner_id:
        query = query.filter(models.AutomationJob.runner_id == runner_id)
    if status:
        query = query.filter(models.AutomationJob.estado == status)
    if proyecto_id:
        query = query.filter(or_(
            models.TestRun.proyecto_id == proyecto_id,
            models.Build.proyecto_id == proyecto_id,
            models.CasoPrueba.proyecto_id == proyecto_id,
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

async def get_next_automation_job(db: AsyncSession, runner: models.AutomationRunner):
    result = await db.execute(
        select(models.AutomationJob)
        .filter(models.AutomationJob.estado == models.AutomationJobStatus.PENDING)
        .order_by(models.AutomationJob.fecha_creacion)
    )
    jobs = result.scalars().all()
    for job in jobs:
        if _runner_supports_job(runner, job):
            return job
    return None

async def claim_automation_job(db: AsyncSession, job: models.AutomationJob, runner: models.AutomationRunner):
    if job.estado not in {models.AutomationJobStatus.PENDING, models.AutomationJobStatus.CLAIMED}:
        raise ValueError("El job ya no esta disponible")
    if not _runner_supports_job(runner, job):
        raise ValueError("El runner no es compatible con este job")
    now = utc_now()
    job.runner_id = runner.id
    job.estado = models.AutomationJobStatus.CLAIMED
    job.fecha_claim = now
    runner.estado = "BUSY"
    runner.ultimo_heartbeat = now
    await db.commit()
    await db.refresh(job)
    return job

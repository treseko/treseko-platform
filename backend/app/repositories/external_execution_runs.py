from .legacy_common import *
from ..evidence_url_security import sanitize_evidence_url
from ..services.error_sanitizer import sanitize_external_error
from ..services.edition.usage_limits import enforce_weekly_automated_execution_limit


def _sanitize_external_execution_text(value: Optional[str], *, max_len: int) -> Optional[str]:
    if value is None or not str(value).strip():
        return value
    return sanitize_external_error(value, max_len=max_len)


async def record_external_execution_report(
    db: AsyncSession,
    payload: schemas.ExternalExecutionReport,
    user: models.Usuario,
):
    from .. import access_control

    case_final_statuses = {
        models.EstadoResultado.PASO,
        models.EstadoResultado.FALLO,
        models.EstadoResultado.BLOQUEADO,
    }
    step_statuses = case_final_statuses | {models.EstadoResultado.SIN_CORRER}

    org_result = await db.execute(
        select(models.Organizacion).filter(
            models.Organizacion.codigo == payload.solution_code,
            models.Organizacion.activo.is_(True),
        )
    )
    org = org_result.scalar_one_or_none()
    if not org:
        raise ValueError("La solucion indicada no existe")

    project_result = await db.execute(
        select(models.Proyecto).filter(
            models.Proyecto.codigo == payload.project_code,
            models.Proyecto.organizacion_id == org.id,
        )
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise ValueError("El proyecto indicado no existe en la solucion")
    await access_control.require_project_access(db, user, project.id, "edit")

    component_result = await db.execute(
        select(models.Componente).filter(
            models.Componente.codigo == payload.component_code,
            models.Componente.proyecto_id == project.id,
        )
    )
    component = component_result.scalar_one_or_none()
    if not component:
        raise ValueError("El componente indicado no existe en el proyecto")

    build_result = await db.execute(
        select(models.Build).filter(
            models.Build.codigo == payload.build_code,
            models.Build.proyecto_id == project.id,
            models.Build.componente_id == component.id,
        )
    )
    build = build_result.scalar_one_or_none()
    if not build:
        raise ValueError("La build indicada no existe en el componente")
    if not build.activo:
        raise ValueError("La build indicada esta inactiva y no permite reportar ejecuciones")

    run = None
    if payload.external_run_id:
        run_result = await db.execute(
            select(models.TestRun).filter(
                models.TestRun.proyecto_id == project.id,
                models.TestRun.build_id == build.id,
                models.TestRun.origen == "EXTERNAL_API",
                models.TestRun.external_run_id == payload.external_run_id,
            )
        )
        run = run_result.scalar_one_or_none()

    assigned_result = await db.execute(
        select(models.BuildCaso.caso_id).filter(models.BuildCaso.build_id == build.id)
    )
    assigned_case_ids = set(assigned_result.scalars().all())

    case_codes = [item.case_code for item in payload.cases]
    cases_result = await db.execute(
        select(models.CasoPrueba).filter(
            models.CasoPrueba.codigo.in_(case_codes),
            models.CasoPrueba.proyecto_id == project.id,
            models.CasoPrueba.componente_id == component.id,
            models.CasoPrueba.activo == True,
        )
    )
    cases_by_code = {case.codigo: case for case in cases_result.scalars().all()}
    missing_or_unassigned = [
        case_code
        for case_code in case_codes
        if case_code not in cases_by_code or cases_by_code[case_code].id not in assigned_case_ids
    ]
    if missing_or_unassigned:
        raise ValueError(
            "Los casos no existen, no pertenecen al componente o no estan asignados a la build: "
            + ", ".join(sorted(set(missing_or_unassigned)))
        )

    existing_case_ids: set = set()
    if run:
        existing_result = await db.execute(
            select(models.EjecucionCaso.caso_id).filter(models.EjecucionCaso.test_run_id == run.id)
        )
        existing_case_ids = set(existing_result.scalars().all())
    requested_case_ids = {cases_by_code[case_code].id for case_code in case_codes}
    new_execution_count = len(requested_case_ids - existing_case_ids)
    await enforce_weekly_automated_execution_limit(db, solution_id=org.id, increment=new_execution_count)

    processed = 0
    results: list[schemas.ExternalExecutionCaseResult] = []

    for item in payload.cases:
        item_evidence_url = sanitize_evidence_url(item.evidence_url)
        item_observations = _sanitize_external_execution_text(item.observations, max_len=4000)
        if item.status not in case_final_statuses:
            raise ValueError(f"Estado final invalido para caso {item.case_code}. Usa PASO, FALLO o BLOQUEADO.")
        invalid_step = next((step for step in item.steps if step.status not in step_statuses), None)
        if invalid_step:
            raise ValueError(f"Estado invalido en caso {item.case_code}, paso {invalid_step.number}.")

        case = cases_by_code[item.case_code]

        original_steps_result = await db.execute(
            select(models.PasoPrueba)
            .filter(models.PasoPrueba.caso_id == case.id)
            .order_by(models.PasoPrueba.numero_paso)
        )
        original_steps = original_steps_result.scalars().all()
        known_numbers = {step.numero_paso for step in original_steps}
        reported_numbers = [step.number for step in item.steps]
        duplicate_numbers = sorted({number for number in reported_numbers if reported_numbers.count(number) > 1})
        if duplicate_numbers:
            raise ValueError(f"El caso {item.case_code} contiene pasos duplicados: {duplicate_numbers}")
        unknown_numbers = sorted(set(reported_numbers) - known_numbers)
        if original_steps and unknown_numbers:
            raise ValueError(f"El caso {item.case_code} contiene pasos inexistentes: {unknown_numbers}")
        if original_steps and item.status == models.EstadoResultado.PASO and set(reported_numbers) != known_numbers:
            missing_numbers = sorted(known_numbers - set(reported_numbers))
            raise ValueError(f"El caso {item.case_code} marcado como PASO debe reportar todos sus pasos. Faltan: {missing_numbers}")

        if not run:
            run = models.TestRun(
                proyecto_id=project.id,
                build_id=build.id,
                origen="EXTERNAL_API",
                external_run_id=payload.external_run_id,
                nombre=f"External API - {payload.external_run_id or utc_now().isoformat()}",
                entorno=payload.environment or "qa",
                estado_run=models.EstadoRun.ABIERTO,
                creado_por=user.id,
            )
            db.add(run)
            await db.flush()

        existing_result = await db.execute(
            select(models.EjecucionCaso).filter(
                models.EjecucionCaso.test_run_id == run.id,
                models.EjecucionCaso.caso_id == case.id,
            )
        )
        execution = existing_result.scalar_one_or_none()
        if execution and not payload.overwrite:
            raise ValueError(f"El caso {item.case_code} ya fue reportado en este external_run_id")

        now = utc_now()
        if execution:
            await db.execute(delete(models.SnapshotPaso).where(models.SnapshotPaso.ejecucion_caso_id == execution.id))
            execution.estado_resultado = item.status
            execution.duracion_segundos = max(0, item.duration_seconds or 0)
            execution.observaciones = item_observations
            execution.fecha_ejecucion = now
            execution.ejecutado_por = user.id
            execution.version_ejecutada = case.version
            execution.execution_mode = models.ExecutionMode.EXTERNA
        else:
            execution = models.EjecucionCaso(
                test_run_id=run.id,
                caso_id=case.id,
                version_ejecutada=case.version,
                estado_resultado=item.status,
                execution_mode=models.ExecutionMode.EXTERNA,
                ejecutado_por=user.id,
                duracion_segundos=max(0, item.duration_seconds or 0),
                observaciones=item_observations,
                fecha_ejecucion=now,
            )
            db.add(execution)
            await db.flush()

        external_steps = {step.number: step for step in item.steps}

        if original_steps:
            for original in original_steps:
                reported = external_steps.get(original.numero_paso)
                reported_observations = _sanitize_external_execution_text(reported.observations, max_len=4000) if reported else None
                reported_error_log = _sanitize_external_execution_text(reported.error_log, max_len=12000) if reported else None
                db.add(models.SnapshotPaso(
                    ejecucion_caso_id=execution.id,
                    paso_id=original.id,
                    numero_paso=original.numero_paso,
                    accion_congelada=original.accion,
                    datos_congelados=original.datos,
                    resultado_esperado_congelado=original.resultado_esperado,
                    estado_paso=reported.status if reported else models.EstadoResultado.SIN_CORRER,
                    comentarios=reported_observations,
                    evidencia_url=(sanitize_evidence_url(reported.evidence_url) if reported else None) or (item_evidence_url if original.numero_paso == 1 else None),
                    error_log=reported_error_log,
                ))
        else:
            known_numbers = set()

        for reported in item.steps:
            if reported.number in known_numbers:
                continue
            db.add(models.SnapshotPaso(
                ejecucion_caso_id=execution.id,
                numero_paso=reported.number,
                accion_congelada=f"Paso externo {reported.number}",
                resultado_esperado_congelado="Reportado por runner externo",
                estado_paso=reported.status,
                comentarios=_sanitize_external_execution_text(reported.observations, max_len=4000),
                evidencia_url=sanitize_evidence_url(reported.evidence_url) or item_evidence_url,
                error_log=_sanitize_external_execution_text(reported.error_log, max_len=12000),
            ))

        if not original_steps and not item.steps:
            db.add(models.SnapshotPaso(
                ejecucion_caso_id=execution.id,
                numero_paso=1,
                accion_congelada="Ejecucion automatizada externa",
                resultado_esperado_congelado="Resultado reportado por runner externo",
                estado_paso=item.status,
                comentarios=item_observations,
                evidencia_url=item_evidence_url,
            ))

        case.ultimo_resultado = item.status.value
        case.ultima_ejecucion_por = user.id
        case.ultima_ejecucion_fecha = now

        processed += 1
        results.append(schemas.ExternalExecutionCaseResult(
            case_code=item.case_code,
            status="saved",
            execution_id=execution.id,
            final_status=item.status,
        ))

    await db.commit()
    return schemas.ExternalExecutionReportResponse(
        run_id=run.id if run else None,
        external_run_id=payload.external_run_id,
        solution_code=payload.solution_code,
        project_code=payload.project_code,
        component_code=payload.component_code,
        build_code=payload.build_code,
        processed=processed,
        rejected=0,
        results=results,
    )

async def get_test_runs_proyecto(
    db: AsyncSession,
    proyecto_id: UUID,
    skip: int = 0,
    limit: int = 100,
    build_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    case_query: Optional[str] = None,
    case_code: Optional[str] = None,
    status: Optional[str] = None,
    origin: Optional[str] = None,
    runner_id: Optional[UUID] = None,
    environment_id: Optional[UUID] = None,
    dataset_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    has_evidence: Optional[bool] = None,
    version_executed: Optional[int] = None,
    ai_review_status: Optional[str] = None,
):
    query = select(models.TestRun).filter(models.TestRun.proyecto_id == proyecto_id)
    if build_id:
        query = query.filter(models.TestRun.build_id == build_id)
    if origin:
        query = query.filter(models.TestRun.origen == origin)
    if runner_id:
        query = query.filter(models.TestRun.creado_por == runner_id)
    if environment_id:
        query = query.filter(models.TestRun.entorno_id == environment_id)
    if dataset_id:
        query = query.filter(models.TestRun.dataset_id == dataset_id)
    if date_from:
        query = query.filter(models.TestRun.fecha_creacion >= ensure_utc(date_from))
    if date_to:
        query = query.filter(models.TestRun.fecha_creacion <= ensure_utc(date_to))

    if component_id or case_query or case_code or status or version_executed is not None or has_evidence is not None or ai_review_status:
        query = query.join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
        if component_id or case_query or case_code:
            query = query.join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        if component_id:
            query = query.filter(models.CasoPrueba.componente_id == component_id)
        if case_code:
            query = query.filter(func.lower(models.CasoPrueba.codigo) == case_code.lower())
        if case_query:
            pattern = f"%{case_query.lower()}%"
            query = query.filter(or_(
                func.lower(models.CasoPrueba.codigo).like(pattern),
                func.lower(models.CasoPrueba.titulo).like(pattern),
            ))
        if status:
            query = query.filter(models.EjecucionCaso.estado_resultado == status)
        if version_executed is not None:
            query = query.filter(models.EjecucionCaso.version_ejecutada == version_executed)
        if ai_review_status:
            query = query.filter(models.EjecucionCaso.ai_review_status == ai_review_status)
        if has_evidence is not None:
            query = query.outerjoin(models.SnapshotPaso, models.SnapshotPaso.ejecucion_caso_id == models.EjecucionCaso.id)
            query = query.outerjoin(models.SnapshotAttachment, models.SnapshotAttachment.snapshot_id == models.SnapshotPaso.id)
            evidence_filter = or_(
                models.SnapshotPaso.evidencia_url.isnot(None),
                models.SnapshotAttachment.attachment_id.isnot(None),
            )
            query = query.filter(evidence_filter if has_evidence else ~evidence_filter)
        query = query.distinct()

    result = await db.execute(
        query
        .order_by(models.TestRun.fecha_creacion.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

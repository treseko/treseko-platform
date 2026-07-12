from typing import Annotated

from fastapi import APIRouter

from ...main_context import *
from ...services.ai_report_sanitizer import sanitize_ai_report_payload


router = APIRouter(tags=["Test Runs"])

async def _require_test_run_access(
    db: AsyncSession,
    current_user: models.Usuario,
    run_id: UUID,
    level: str = "read",
):
    db_run = await db.get(models.TestRun, run_id)
    if not db_run:
        raise HTTPException(status_code=404, detail="Run no encontrado")
    await access_control.require_project_access(db, current_user, db_run.proyecto_id, level)
    return db_run


async def _require_execution_access(
    db: AsyncSession,
    current_user: models.Usuario,
    ejecucion_id: UUID,
    level: str = "read",
):
    result = await db.execute(
        select(models.EjecucionCaso, models.TestRun)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Ejecucion no encontrada")
    execution, db_run = row
    await access_control.require_project_access(db, current_user, db_run.proyecto_id, level)
    return execution, db_run


@router.post("/test-runs/", response_model=schemas.TestRun)
async def create_test_run(
    run: schemas.TestRunCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.manual", "edit"))
):
    db_build = None
    await access_control.require_project_access(db, current_user, run.proyecto_id, "edit")
    if not run.build_id:
        raise HTTPException(status_code=400, detail="Toda ejecución debe pertenecer a una build activa")

    result = await db.execute(
        select(models.Build).filter(
            models.Build.id == run.build_id,
            models.Build.proyecto_id == run.proyecto_id,
        )
    )
    db_build = result.scalar_one_or_none()
    if not db_build:
        raise HTTPException(status_code=400, detail="La build no pertenece al proyecto seleccionado")
    if not db_build.activo:
        raise HTTPException(status_code=409, detail="La build está inactiva. No se pueden crear nuevas ejecuciones sobre una build cerrada.")
    if not db_build.componente_id:
        raise HTTPException(status_code=400, detail="La build no tiene componente asociado")
    if run.caso_ids:
        case_rows = await db.execute(
            select(models.CasoPrueba).filter(models.CasoPrueba.id.in_(run.caso_ids))
        )
        cases_by_id = {case.id: case for case in case_rows.scalars().all()}
        if set(run.caso_ids) != set(cases_by_id):
            raise HTTPException(status_code=400, detail="Uno o mas casos no existen")
        if any(case.proyecto_id != run.proyecto_id for case in cases_by_id.values()):
            raise HTTPException(status_code=400, detail="Todos los casos deben pertenecer al proyecto de la ejecucion")
        invalid_cases = await db.execute(
            select(models.CasoPrueba).filter(
                models.CasoPrueba.id.in_(run.caso_ids),
                models.CasoPrueba.proyecto_id == run.proyecto_id,
                or_(
                    models.CasoPrueba.componente_id.is_(None),
                    models.CasoPrueba.componente_id != db_build.componente_id,
                ),
            ).limit(1)
        )
        if invalid_cases.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="La build solo puede ejecutar casos de su componente")
    try:
        created_run = await crud.create_test_run(db=db, run=run, user_id=current_user.id)
        await realtime_event_bus.publish(
            created_run.proyecto_id,
            "execution.run.created",
            actor_id=current_user.id,
            component_id=db_build.componente_id,
            build_id=created_run.build_id,
            run_id=created_run.id,
            payload={
                "run": {
                    "id": str(created_run.id),
                    "origen": created_run.origen,
                    "estado": created_run.estado_run,
                },
            },
        )
        await realtime_event_bus.publish(
            created_run.proyecto_id,
            "report.metrics.invalidated",
            actor_id=current_user.id,
            component_id=db_build.componente_id,
            build_id=created_run.build_id,
            run_id=created_run.id,
            payload={"source": "execution.run.created"},
        )
        return created_run
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/proyectos/{proyecto_id}/test-runs/")
async def read_test_runs(
    proyecto_id: UUID,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    build_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    case_query: Annotated[Optional[str], Query(max_length=200)] = None,
    case_code: Annotated[Optional[str], Query(max_length=80)] = None,
    status: Annotated[Optional[str], Query(max_length=50)] = None,
    origin: Annotated[Optional[str], Query(max_length=50)] = None,
    runner_id: Optional[UUID] = None,
    environment_id: Optional[UUID] = None,
    dataset_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    has_evidence: Optional[bool] = None,
    version_executed: Optional[int] = None,
    ai_review_status: Annotated[Optional[str], Query(max_length=50)] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.ver", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if build_id:
        db_build = await access_control.require_build_access(db, current_user, build_id, "read")
        if db_build.proyecto_id != proyecto_id:
            raise HTTPException(status_code=404, detail="Build no encontrado para el proyecto")
    if component_id:
        db_component = await access_control.require_component_access(db, current_user, component_id, "read")
        if db_component.proyecto_id != proyecto_id:
            raise HTTPException(status_code=404, detail="Componente no encontrado para el proyecto")
    return await crud.get_test_runs_summary(
        db,
        proyecto_id=proyecto_id,
        skip=skip,
        limit=limit,
        build_id=build_id,
        component_id=component_id,
        case_query=case_query,
        case_code=case_code,
        status=status,
        origin=origin,
        runner_id=runner_id,
        environment_id=environment_id,
        dataset_id=dataset_id,
        date_from=date_from,
        date_to=date_to,
        has_evidence=has_evidence,
        version_executed=version_executed,
        ai_review_status=ai_review_status,
    )

@router.get("/test-runs/{run_id}/detalle/")
async def read_test_run_detail(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.ver", "read"))
):
    await _require_test_run_access(db, current_user, run_id, "read")
    detail = await crud.get_test_run_detail(db, run_id=run_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Run no encontrado")
    return detail

@router.get("/test-runs/{run_id}/ejecuciones/", response_model=List[schemas.EjecucionCaso])
async def read_ejecuciones_run(
    run_id: UUID,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.ver", "read"))
):
    await _require_test_run_access(db, current_user, run_id, "read")
    return await crud.get_ejecuciones_run(db, run_id=run_id, skip=skip, limit=limit)

@router.get("/ejecuciones/{ejecucion_id}/snapshots/", response_model=List[schemas.SnapshotPaso])
async def read_snapshots_ejecucion(
    ejecucion_id: UUID,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.ver", "read"))
):
    await _require_execution_access(db, current_user, ejecucion_id, "read")
    return await crud.get_snapshots_ejecucion(db, ejecucion_id=ejecucion_id, skip=skip, limit=limit)

@router.get("/ejecuciones/{ejecucion_id}/ai-report/")
async def read_ai_execution_report(
    ejecucion_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    if not (
        auth.has_capability_permission(current_user, "motor_ia.logs", "read")
        or auth.has_capability_permission(current_user, "historial.evidencias", "read")
        or auth.has_capability_permission(current_user, "ejecutar.ia", "read")
        or auth.has_module_permission(current_user, "motor_ia", "read")
        or auth.has_module_permission(current_user, "historial", "read")
        or auth.has_module_permission(current_user, "ejecutar", "read")
    ):
        raise HTTPException(status_code=403, detail="No tienes permiso para ver reportes IA")
    result = await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba, models.TestRun)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Ejecucion no encontrada")
    execution, case, run = row
    await access_control.require_project_access(db, current_user, run.proyecto_id, "read")
    execution_mode = crud._execution_mode_value(execution, case, run.origen)
    is_ai_execution = execution_mode == models.ExecutionMode.IA.value or crud._has_ai_execution_data(execution)
    ai_report = execution.ai_report or {}
    review_status = crud._review_status_for_execution(execution) if is_ai_execution else models.AiReviewStatus.NO_REQUIERE_REVISION.value
    review_required = bool(is_ai_execution and review_status == models.AiReviewStatus.REQUIERE_REVISION.value)
    if not ai_report and is_ai_execution:
        snapshots_result = await db.execute(
            select(models.SnapshotPaso)
            .filter(models.SnapshotPaso.ejecucion_caso_id == execution.id)
            .order_by(models.SnapshotPaso.numero_paso)
        )
        snapshots = snapshots_result.scalars().all()
        failed_snapshots = [
            snapshot for snapshot in snapshots
            if snapshot.estado_paso in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}
        ]
        if snapshots or execution.estado_resultado in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}:
            ai_report = {
                "schema_version": 1,
                "legacy": True,
                "execution_id": str(execution.id),
                "summary": execution.observaciones or (failed_snapshots[0].comentarios if failed_snapshots else "Ejecucion IA sin reporte estructurado."),
                "status": execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else execution.estado_resultado,
                "confidence": execution.ai_confidence or 0,
                "consensus": execution.ai_consensus or (execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else execution.estado_resultado),
                "failure_category": execution.ai_failure_category or "legacy_ai_execution",
                "error_code": "AI_HUMAN_REVIEW_REQUIRED" if review_required else None,
                "human_review_required": review_required,
                "errors": [snapshot.error_log or snapshot.comentarios for snapshot in failed_snapshots if snapshot.error_log or snapshot.comentarios],
                "steps": [
                    {
                        "number": snapshot.numero_paso,
                        "status": snapshot.estado_paso.value if hasattr(snapshot.estado_paso, "value") else snapshot.estado_paso,
                        "observations": snapshot.comentarios or snapshot.error_log,
                        "confidence": 0,
                        "failure_category": "legacy_snapshot",
                        "attempts": [],
                    }
                    for snapshot in snapshots
                ],
            }
    if not ai_report or not is_ai_execution:
        raise HTTPException(status_code=404, detail="Reporte IA no disponible para esta ejecución")

    enriched_snapshots = (await crud._load_enriched_snapshots_by_execution(db, [execution], run)).get(execution.id, [])
    evidence_by_step = {
        int(snapshot.get("numero_paso")): snapshot
        for snapshot in enriched_snapshots
        if snapshot.get("numero_paso") is not None
    }
    if evidence_by_step:
        ai_report = dict(ai_report)
        enriched_steps = []
        for step in ai_report.get("steps") or []:
            step_payload = dict(step)
            evidence = evidence_by_step.get(int(step_payload.get("number") or 0))
            if evidence:
                evidencias = evidence.get("evidencias") or []
                first_evidence = evidencias[0] if evidencias else None
                step_payload["evidence_url"] = step_payload.get("evidence_url") or evidence.get("evidencia_url") or (first_evidence or {}).get("public_url")
                step_payload["evidences"] = step_payload.get("evidences") or evidencias
            enriched_steps.append(step_payload)
        ai_report["steps"] = enriched_steps
    ai_report = sanitize_ai_report_payload(ai_report)

    return {
        "execution_id": str(execution.id),
        "case_id": str(execution.caso_id),
        "case_code": case.codigo,
        "case_title": case.titulo,
        "status": execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else execution.estado_resultado,
        "observations": sanitize_ai_report_payload(execution.observaciones),
        "duration_seconds": execution.duracion_segundos,
        "confidence": execution.ai_confidence or ai_report.get("confidence"),
        "consensus": execution.ai_consensus or ai_report.get("consensus"),
        "failure_category": execution.ai_failure_category or ai_report.get("failure_category"),
        "error_code": ai_report.get("error_code") or ai_report.get("ai_error_code"),
        "execution_mode": execution_mode,
        "review_status": review_status,
        "reviewed_by": str(execution.ai_reviewed_by) if execution.ai_reviewed_by else None,
        "reviewed_at": execution.ai_reviewed_at.isoformat() if execution.ai_reviewed_at else None,
        "review_note": sanitize_ai_report_payload(execution.ai_review_note),
        "human_review_required": review_required,
        "ai_report": ai_report,
    }

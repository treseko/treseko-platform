from fastapi import APIRouter

from ...main_context import *
from ...services.edition.entitlement_service import ensure_feature_enabled
from ...services.edition.usage_limits import enforce_weekly_ai_execution_limit


router = APIRouter(tags=["legacy_automation_execution"])

@router.post("/ejecuciones/{ejecucion_id}/automatizar/")
async def trigger_ai_run(
    ejecucion_id: UUID, 
    background_tasks: BackgroundTasks,
    request: Optional[schemas.AutomationExecutionRequest] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.automatizada", "edit"))
):
    if not auth.has_module_permission(current_user, "automatizacion", "read"):
        raise HTTPException(
            status_code=403,
            detail="Necesitas permiso de automatizacion para ejecutar jobs en workers dedicados",
        )
    result = await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba, models.TestRun, models.Build, models.Proyecto)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
        .join(models.Proyecto, models.Proyecto.id == models.TestRun.proyecto_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Ejecucion no encontrada")
    ejecucion, caso, run, build, project = row
    await access_control.require_project_access(db, current_user, run.proyecto_id, "edit")
    if run.build_id and build and not build.activo:
        raise HTTPException(
            status_code=409,
            detail="La build está inactiva. No se pueden iniciar pruebas automatizadas ni IA sobre una build cerrada.",
        )
    if ejecucion.estado_resultado == models.EstadoResultado.EJECUTANDO_AI:
        raise HTTPException(status_code=409, detail="Esta prueba IA ya está en ejecución.")
    if run.origen == "IA" or caso.tipo_prueba == models.TipoPrueba.AUTOMATIZADA_AI:
        await ensure_feature_enabled(db, "ai.basic_execution")
        # Validar engine ANTES de mandar a background
        # Si el engine esta caido, el usuario tiene que saber ahora, no despues
        try:
            health = await crud.check_ai_engine_health(db)
            if health.get("status") != "ok":
                error_detail = health.get('detail', 'Motor IA no responde')
                await _emit_ai_engine_unavailable_event(
                    db,
                    actor=current_user,
                    execution=ejecucion,
                    case=caso,
                    run=run,
                    detail=str(error_detail),
                )
                raise HTTPException(
                    status_code=503,
                    detail=f"NO SE PUEDE EJECUTAR: El Motor IA no esta disponible. {error_detail}. Verifica que el servicio interno del Motor IA este corriendo."
                )
        except HTTPException:
            raise
        except Exception as health_err:
            await _emit_ai_engine_unavailable_event(
                db,
                actor=current_user,
                execution=ejecucion,
                case=caso,
                run=run,
                detail=str(health_err),
            )
            raise HTTPException(
                status_code=503,
                detail=f"NO SE PUEDE EJECUTAR: No se pudo verificar el estado del Motor IA. {health_err}"
            )

        snapshots = await crud.get_snapshots_ejecucion(db, ejecucion_id)
        variables_resueltas = run.variables_resueltas or {}
        resolved_dataset = await crud.resolve_case_dataset(db, caso.id, run.build_id, run.entorno_id, run.dataset_id)
        if resolved_dataset:
            variables_resueltas = resolved_dataset["variables_resueltas"]
        base_url = crud.get_ai_base_url_from_context(variables_resueltas, snapshots)
        if not base_url:
            ejecucion.estado_resultado = models.EstadoResultado.BLOQUEADO
            ejecucion.execution_mode = models.ExecutionMode.IA
            ejecucion.observaciones = "Motor IA requiere una URL base en el ambiente/dataset o en los datos de un paso."
            ejecucion.ai_report = {
                "schema_version": 1,
                "execution_id": str(ejecucion.id),
                "summary": ejecucion.observaciones,
                "status": "BLOQUEADO",
                "confidence": 100,
                "consensus": "BLOQUEADO",
                "failure_category": "missing_base_url",
                "error_code": "AI_WORKFLOW_BLOCKED",
                "human_review_required": False,
                "errors": [ejecucion.observaciones],
                "steps": [],
            }
            ejecucion.ai_confidence = 100
            ejecucion.ai_consensus = "BLOQUEADO"
            ejecucion.ai_failure_category = "missing_base_url"
            ejecucion.ai_human_review_required = False
            ejecucion.ai_review_status = models.AiReviewStatus.NO_REQUIERE_REVISION
            await db.commit()
            await realtime_event_bus.publish(
                run.proyecto_id,
                "execution.case.completed",
                actor_id=current_user.id,
                component_id=build.componente_id if build else caso.componente_id,
                build_id=run.build_id,
                case_id=caso.id,
                run_id=run.id,
                execution_id=ejecucion.id,
                payload={
                    "execution": {"id": str(ejecucion.id), "estado": models.EstadoResultado.BLOQUEADO.value, "mode": "IA"},
                    "source": "ai.missing_base_url",
                },
            )
            raise HTTPException(
                status_code=400,
                detail="Motor IA requiere una URL base en el ambiente/dataset o en los datos de un paso."
            )

        if ejecucion.execution_mode != models.ExecutionMode.IA:
            await enforce_weekly_ai_execution_limit(db, solution_id=project.organizacion_id)
        ejecucion.execution_mode = models.ExecutionMode.IA
        ejecucion.fecha_ejecucion = utc_now()
        ejecucion.ai_review_status = models.AiReviewStatus.NO_REQUIERE_REVISION
        await db.commit()
        await realtime_event_bus.publish(
            run.proyecto_id,
            "execution.case.started",
            actor_id=current_user.id,
            component_id=build.componente_id if build else caso.componente_id,
            build_id=run.build_id,
            case_id=caso.id,
            run_id=run.id,
            execution_id=ejecucion.id,
            payload={"execution": {"id": str(ejecucion.id), "mode": "IA"}},
        )
        await realtime_event_bus.publish(
            run.proyecto_id,
            "ia.execution.updated",
            actor_id=current_user.id,
            component_id=build.componente_id if build else caso.componente_id,
            build_id=run.build_id,
            case_id=caso.id,
            run_id=run.id,
            execution_id=ejecucion.id,
            payload={"status": "started"},
        )
        background_tasks.add_task(crud.trigger_ai_execution_background, ejecucion_id=ejecucion_id)
        return {"message": "Ejecucion por IA iniciada en segundo plano", "mode": "IA"}
    try:
        job = await crud.create_automation_job_for_execution(
            db,
            ejecucion_id,
            current_user.id,
            debug_mode=bool(request.debug_mode) if request else False,
        )
        await realtime_event_bus.publish(
            run.proyecto_id,
            "automation.job.created",
            actor_id=current_user.id,
            component_id=build.componente_id if build else caso.componente_id,
            build_id=run.build_id,
            case_id=caso.id,
            run_id=run.id,
            execution_id=ejecucion.id,
            payload={
                "automation_job": {
                    "id": str(job.id),
                    "estado": job.estado.value if hasattr(job.estado, "value") else str(job.estado),
                },
            },
        )
        return {
            "message": "Job de automatizacion creado para worker dedicado",
            "mode": "AUTOMATIZADA_WORKER",
            "job_id": str(job.id),
            "status": job.estado.value if hasattr(job.estado, "value") else job.estado,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"message": "Ejecución por IA iniciada en segundo plano"}

@router.post("/casos/{caso_id}/ejecutar-automatizada/")
async def ejecutar_caso_automatizada(
    caso_id: UUID,
    test_run_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.automatizada", "edit"))
):
    """
    Dispara la ejecución automatizada de un caso de prueba.
    El worker se ejecuta en segundo plano con Playwright.
    """
    if not auth.has_module_permission(current_user, "automatizacion", "read"):
        raise HTTPException(
            status_code=403,
            detail="Necesitas permiso de automatizacion para ejecutar pruebas automatizadas",
        )

    result = await db.execute(
        select(models.CasoPrueba, models.TestRun)
        .filter(models.CasoPrueba.id == caso_id, models.TestRun.id == test_run_id)
    )
    row = result.first()
    
    if not row:
        raise HTTPException(status_code=404, detail="Caso o run no encontrado")
    caso, run = row
    if caso.proyecto_id != run.proyecto_id:
        raise HTTPException(status_code=400, detail="El caso no pertenece al proyecto del run")
    await access_control.require_project_access(db, current_user, run.proyecto_id, "edit")
    if run.build_id:
        build = (await db.execute(select(models.Build).filter(models.Build.id == run.build_id))).scalar_one_or_none()
        if build and not build.activo:
            raise HTTPException(
                status_code=409,
                detail="La build está inactiva. No se pueden iniciar pruebas automatizadas sobre una build cerrada.",
            )
    
    if caso.tipo_prueba != models.TipoPrueba.AUTOMATIZADA:
        raise HTTPException(status_code=400, detail="El caso no es de tipo AUTOMATIZADA")
    
    if not caso.script_automatizado:
        raise HTTPException(status_code=400, detail="El caso no tiene script automatizado")
    
    from .worker import ejecutar_caso_automatizado as worker_ejecutar
    
    # Ejecutar en background
    background_tasks.add_task(
        worker_ejecutar,
        caso_id=caso_id,
        test_run_id=test_run_id,
        usuario_id=current_user.id
    )
    build = None
    if run and run.build_id:
        build = (await db.execute(select(models.Build).filter(models.Build.id == run.build_id))).scalar_one_or_none()
    await realtime_event_bus.publish(
        run.proyecto_id if run else caso.proyecto_id,
        "execution.case.started",
        actor_id=current_user.id,
        component_id=build.componente_id if build else caso.componente_id,
        build_id=run.build_id if run else None,
        case_id=caso.id,
        run_id=test_run_id,
        payload={"execution": {"mode": "AUTOMATIZADA"}},
    )
    
    return {
        "message": "Ejecución automatizada iniciada en segundo plano",
        "caso_id": str(caso_id),
        "test_run_id": str(test_run_id)
    }

import logging

from fastapi import APIRouter

from ...main_context import *


router = APIRouter(tags=["Ejecuciones"])
logger = logging.getLogger(__name__)


def _log_execution_update_requested(ejecucion_id: UUID, estado: models.EstadoResultado, actor_id: UUID) -> None:
    logger.debug(
        "Execution update requested: execution_id=%s status=%s actor_id=%s",
        ejecucion_id,
        estado.value,
        actor_id,
    )


async def _execution_context(db: AsyncSession, ejecucion_id: UUID):
    result = await db.execute(
        select(
            models.TestRun.proyecto_id,
            models.TestRun.build_id,
            models.Build.componente_id,
            models.Build.activo.label("build_activo"),
            models.EjecucionCaso.caso_id,
            models.EjecucionCaso.test_run_id,
        )
        .join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
        .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    return result.first()


async def _execution_context_for_snapshot(db: AsyncSession, snapshot_id: UUID):
    result = await db.execute(
        select(
            models.TestRun.proyecto_id,
            models.TestRun.build_id,
            models.Build.componente_id,
            models.Build.activo.label("build_activo"),
            models.EjecucionCaso.caso_id,
            models.EjecucionCaso.test_run_id,
            models.SnapshotPaso.ejecucion_caso_id,
        )
        .join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
        .join(models.SnapshotPaso, models.SnapshotPaso.ejecucion_caso_id == models.EjecucionCaso.id)
        .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
        .filter(models.SnapshotPaso.id == snapshot_id)
    )
    return result.first()


def _ensure_context_build_is_active(context) -> None:
    if context and context.build_id and context.build_activo is not True:
        raise HTTPException(status_code=409, detail="La build está inactiva. No se pueden modificar ejecuciones, evidencias ni resultados de una build cerrada.")


async def _ensure_run_build_is_active(db: AsyncSession, run: models.TestRun | None) -> None:
    if not run or not run.build_id:
        return
    build_active = (
        await db.execute(select(models.Build.activo).filter(models.Build.id == run.build_id))
    ).scalar_one_or_none()
    if build_active is not True:
        raise HTTPException(status_code=409, detail="La build está inactiva. No se pueden modificar ejecuciones, evidencias ni resultados de una build cerrada.")


@router.patch("/snapshots/{snapshot_id}/", response_model=schemas.SnapshotPaso)
async def update_snapshot(
    snapshot_id: UUID, 
    estado: models.EstadoResultado, 
    comentarios: Optional[str] = None,
    evidencia_url: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.evidencias", "edit"))
):
    try:
        snapshot_context = await _execution_context_for_snapshot(db, snapshot_id)
        if not snapshot_context:
            raise HTTPException(status_code=404, detail="Snapshot no encontrado")
        await access_control.require_project_access(db, current_user, snapshot_context.proyecto_id, "edit")
        _ensure_context_build_is_active(snapshot_context)
        db_snapshot = await crud.update_snapshot_status(
            db=db, 
            snapshot_id=snapshot_id, 
            estado=estado, 
            comentarios=comentarios, 
            evidencia_url=evidencia_url
        )
        if db_snapshot is None:
            raise HTTPException(status_code=404, detail="Snapshot no encontrado")
        if snapshot_context:
            await realtime_event_bus.publish(
                snapshot_context.proyecto_id,
                "execution.snapshot.updated",
                actor_id=current_user.id,
                component_id=snapshot_context.componente_id,
                build_id=snapshot_context.build_id,
                case_id=snapshot_context.caso_id,
                run_id=snapshot_context.test_run_id,
                execution_id=db_snapshot.ejecucion_caso_id,
                payload={
                    "snapshot": {
                        "id": str(db_snapshot.id),
                        "numero_paso": db_snapshot.numero_paso,
                        "estado": estado.value,
                    },
                },
            )
            await realtime_event_bus.publish(
                snapshot_context.proyecto_id,
                "report.metrics.invalidated",
                actor_id=current_user.id,
                component_id=snapshot_context.componente_id,
                build_id=snapshot_context.build_id,
                case_id=snapshot_context.caso_id,
                run_id=snapshot_context.test_run_id,
                execution_id=db_snapshot.ejecucion_caso_id,
                payload={"source": "execution.snapshot.updated"},
            )
        if estado in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}:
            project_result = await db.execute(
                select(models.TestRun.proyecto_id)
                .join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
                .filter(models.EjecucionCaso.id == db_snapshot.ejecucion_caso_id)
            )
            event_type = "snapshot.failed" if estado == models.EstadoResultado.FALLO else "snapshot.blocked"
            await notification_event_service.emit_event(
                db=db,
                event_type=event_type,
                actor_user_id=current_user.id,
                proyecto_id=project_result.scalar_one_or_none(),
                entity_type="snapshot",
                entity_id=db_snapshot.id,
                severity="warning",
                payload={
                    "snapshot": {"id": str(db_snapshot.id), "numero_paso": db_snapshot.numero_paso, "estado": estado.value, "comentarios": comentarios},
                    "actor": {"id": str(current_user.id), "email": current_user.email, "nombre": current_user.nombre_completo or current_user.email},
                },
                dedupe_key=f"{event_type}:{db_snapshot.id}:{estado.value}",
            )
            
        return db_snapshot
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.patch("/ejecuciones/{ejecucion_id}/snapshots/", response_model=List[schemas.SnapshotPaso])
async def update_execution_snapshots(
    ejecucion_id: UUID,
    payload: schemas.SnapshotPasoBulkUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.evidencias", "edit"))
):
    try:
        execution_context = await _execution_context(db, ejecucion_id)
        if not execution_context:
            raise HTTPException(status_code=404, detail="Ejecución no encontrada")
        await access_control.require_project_access(db, current_user, execution_context.proyecto_id, "edit")
        _ensure_context_build_is_active(execution_context)
        updated = await crud.update_execution_snapshots_bulk(
            db=db,
            ejecucion_id=ejecucion_id,
            updates=payload.snapshots,
        )
        if execution_context:
            await realtime_event_bus.publish(
                execution_context.proyecto_id,
                "execution.snapshot.updated",
                actor_id=current_user.id,
                component_id=execution_context.componente_id,
                build_id=execution_context.build_id,
                case_id=execution_context.caso_id,
                run_id=execution_context.test_run_id,
                execution_id=ejecucion_id,
                payload={"snapshot_count": len(updated), "source": "bulk"},
            )
        return updated
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.patch("/ejecuciones/{ejecucion_id}/", response_model=schemas.EjecucionCaso)
async def update_ejecucion(
    ejecucion_id: UUID, 
    estado: models.EstadoResultado,
    duracion: int = 0,
    comentarios: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.evidencias", "edit"))
):
    _log_execution_update_requested(ejecucion_id, estado, current_user.id)
    result = await db.execute(select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejecucion_id))
    existing_ejecucion = result.scalar_one_or_none()
    if existing_ejecucion is None:
        raise HTTPException(status_code=404, detail="Ejecución no encontrada")

    run_result = await db.execute(select(models.TestRun).filter(models.TestRun.id == existing_ejecucion.test_run_id))
    execution_run = run_result.scalar_one_or_none()
    if execution_run is None:
        raise HTTPException(status_code=404, detail="Run no encontrado")
    await access_control.require_project_access(db, current_user, execution_run.proyecto_id, "edit")
    await _ensure_run_build_is_active(db, execution_run)
    config = await crud.get_attachment_config(db)
    is_manual_run = (execution_run.origen if execution_run else "MANUAL") == "MANUAL"
    requires_failure_documentation = bool(config.get("require_evidence_on_failure"))
    is_failure_state = estado in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}
    if is_manual_run and requires_failure_documentation and is_failure_state:
        def is_user_note(value: Optional[str]) -> bool:
            note = (value or "").strip()
            return bool(note and not note.lower().startswith("bloqueado autom"))

        has_documentation = is_user_note(comentarios)
        if not has_documentation:
            snapshots_result = await db.execute(
                select(models.SnapshotPaso)
                .filter(models.SnapshotPaso.ejecucion_caso_id == ejecucion_id)
                .order_by(models.SnapshotPaso.numero_paso)
            )
            snapshots = snapshots_result.scalars().all()
            conclusive_snapshots = [
                snapshot
                for snapshot in snapshots
                if snapshot.estado_paso in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}
            ]
            snapshots_to_check = conclusive_snapshots[:1] if conclusive_snapshots else [
                snapshot for snapshot in snapshots if snapshot.numero_paso == 0
            ]
            for snapshot in snapshots_to_check:
                if is_user_note(snapshot.comentarios) or (snapshot.evidencia_url or "").strip():
                    has_documentation = True
                    break
                attachment_result = await db.execute(
                    select(models.SnapshotAttachment.id)
                    .filter(models.SnapshotAttachment.snapshot_id == snapshot.id)
                    .limit(1)
                )
                if attachment_result.scalar_one_or_none() is not None:
                    has_documentation = True
                    break

        if not has_documentation:
            await notification_event_service.emit_event(
                db=db,
                event_type="evidence.required_missing",
                actor_user_id=current_user.id,
                proyecto_id=execution_run.proyecto_id if execution_run else None,
                entity_type="execution",
                entity_id=ejecucion_id,
                severity="warning",
                payload={
                    "execution": {"id": str(ejecucion_id), "estado": estado.value},
                    "actor": {"id": str(current_user.id), "email": current_user.email, "nombre": current_user.nombre_completo or current_user.email},
                    "message": "Falta evidencia o comentario para guardar fallo/bloqueo.",
                },
                dedupe_key=f"evidence.required_missing:{ejecucion_id}:{estado.value}:{utc_now().strftime('%Y%m%d%H%M')}",
            )
            raise HTTPException(
                status_code=400,
                detail="Agrega un comentario o adjunta evidencia antes de guardar este fallo o bloqueo.",
            )

    db_ejecucion = await crud.update_ejecucion_status(db=db, ejecucion_id=ejecucion_id, estado=estado, duracion=duracion, observaciones=comentarios)
    if db_ejecucion is None:
        raise HTTPException(status_code=404, detail="Ejecución no encontrada")
    fecha_ejecucion = utc_now()
    db_ejecucion.fecha_ejecucion = fecha_ejecucion
    
    # Actualizar campos de última ejecución en el caso de prueba
    logger.debug(
        "Updating case last execution result: case_id=%s status=%s",
        db_ejecucion.caso_id,
        estado.value,
    )
    result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == db_ejecucion.caso_id))
    db_caso = result.scalar_one_or_none()
    if db_caso:
        db_caso.ultimo_resultado = estado.value
        db_caso.ultima_ejecucion_por = current_user.id
        db_caso.ultima_ejecucion_fecha = fecha_ejecucion
        await db.commit()
        await db.refresh(db_ejecucion)
        await db.refresh(db_caso)
        logger.debug(
            "Case last execution result updated: case_id=%s status=%s",
            db_caso.id,
            db_caso.ultimo_resultado,
        )
    else:
        logger.debug("Case not found while updating execution: execution_id=%s", ejecucion_id)
    if estado in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO, models.EstadoResultado.PASO}:
        event_type = {
            models.EstadoResultado.FALLO: "execution.failed",
            models.EstadoResultado.BLOQUEADO: "execution.blocked",
            models.EstadoResultado.PASO: "execution.completed",
        }[estado]
        await notification_event_service.emit_event(
            db=db,
            event_type=event_type,
            actor_user_id=current_user.id,
            proyecto_id=execution_run.proyecto_id if execution_run else None,
            entity_type="execution",
            entity_id=db_ejecucion.id,
            severity="warning" if estado != models.EstadoResultado.PASO else "info",
            payload={
                "execution": {"id": str(db_ejecucion.id), "estado": estado.value, "comentarios": comentarios},
                "caso": {"id": str(db_caso.id), "codigo": db_caso.codigo, "titulo": db_caso.titulo} if db_caso else {},
                "actor": {"id": str(current_user.id), "email": current_user.email, "nombre": current_user.nombre_completo or current_user.email},
            },
            dedupe_key=f"{event_type}:{db_ejecucion.id}:{estado.value}",
        )
    if db_ejecucion.execution_mode == models.ExecutionMode.IA and db_ejecucion.ai_human_review_required:
        await notification_event_service.emit_event(
            db=db,
            event_type="ai.execution.review_required",
            actor_user_id=current_user.id,
            proyecto_id=execution_run.proyecto_id if execution_run else None,
            entity_type="execution",
            entity_id=db_ejecucion.id,
            severity="warning",
            payload={
                "execution": {
                    "id": str(db_ejecucion.id),
                    "estado": estado.value,
                    "confidence": db_ejecucion.ai_confidence,
                    "failure_category": db_ejecucion.ai_failure_category,
                },
                "caso": {"id": str(db_caso.id), "codigo": db_caso.codigo, "titulo": db_caso.titulo} if db_caso else {},
                "actor": {"id": str(current_user.id), "email": current_user.email, "nombre": current_user.nombre_completo or current_user.email},
                "message": "La ejecucion IA requiere revision humana.",
            },
            dedupe_key=f"ai.execution.review_required:{db_ejecucion.id}",
        )
    if db_ejecucion.execution_mode == models.ExecutionMode.IA and estado in {models.EstadoResultado.PASO, models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}:
        ai_event_type = "ai.execution.completed" if estado == models.EstadoResultado.PASO else "ai.execution.failed"
        await notification_event_service.emit_event(
            db=db,
            event_type=ai_event_type,
            actor_user_id=current_user.id,
            proyecto_id=execution_run.proyecto_id if execution_run else None,
            entity_type="execution",
            entity_id=db_ejecucion.id,
            severity="info" if ai_event_type == "ai.execution.completed" else "warning",
            payload={
                "execution": {"id": str(db_ejecucion.id), "estado": estado.value, "confidence": db_ejecucion.ai_confidence},
                "caso": {"id": str(db_caso.id), "codigo": db_caso.codigo, "titulo": db_caso.titulo} if db_caso else {},
                "actor": {"id": str(current_user.id), "email": current_user.email, "nombre": current_user.nombre_completo or current_user.email},
                "message": f"Ejecucion IA {estado.value}",
            },
            dedupe_key=f"{ai_event_type}:{db_ejecucion.id}:{estado.value}",
        )
    build_component_id = None
    if execution_run and execution_run.build_id:
        build_component_id = (
            await db.execute(select(models.Build.componente_id).filter(models.Build.id == execution_run.build_id))
        ).scalar_one_or_none()
    realtime_event_type = "execution.case.updated"
    if estado in {models.EstadoResultado.PASO, models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}:
        realtime_event_type = "execution.case.completed"
    await realtime_event_bus.publish(
        execution_run.proyecto_id if execution_run else None,
        realtime_event_type,
        actor_id=current_user.id,
        component_id=build_component_id,
        build_id=execution_run.build_id if execution_run else None,
        case_id=db_ejecucion.caso_id,
        run_id=db_ejecucion.test_run_id,
        execution_id=db_ejecucion.id,
        payload={
            "execution": {
                "id": str(db_ejecucion.id),
                "estado": estado.value,
                "duracion": duracion,
                "mode": db_ejecucion.execution_mode.value if hasattr(db_ejecucion.execution_mode, "value") else db_ejecucion.execution_mode,
            },
            "case": {"id": str(db_caso.id), "codigo": db_caso.codigo, "titulo": db_caso.titulo} if db_caso else {},
        },
    )
    await realtime_event_bus.publish(
        execution_run.proyecto_id if execution_run else None,
        "report.metrics.invalidated",
        actor_id=current_user.id,
        component_id=build_component_id,
        build_id=execution_run.build_id if execution_run else None,
        case_id=db_ejecucion.caso_id,
        run_id=db_ejecucion.test_run_id,
        execution_id=db_ejecucion.id,
        payload={"source": realtime_event_type},
    )
    
    return db_ejecucion

@router.post("/ejecuciones/{ejecucion_id}/ai-review", response_model=schemas.EjecucionCaso)
@router.post("/ejecuciones/{ejecucion_id}/ai-review/", response_model=schemas.EjecucionCaso)
async def mark_ai_execution_reviewed(
    ejecucion_id: UUID,
    payload: schemas.AiExecutionReviewUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.ia", "edit")),
):
    if not (
        auth.has_module_permission(current_user, "motor_ia", "read")
        or auth.has_module_permission(current_user, "historial", "edit")
        or auth.has_module_permission(current_user, "ejecutar", "edit")
    ):
        raise HTTPException(status_code=403, detail="No tienes permiso para revisar ejecuciones IA")
    try:
        execution = await crud.mark_ai_execution_reviewed(db, ejecucion_id, current_user.id, payload.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if execution is None:
        raise HTTPException(status_code=404, detail="Ejecucion no encontrada para revision IA")
    run = (await db.execute(select(models.TestRun).filter(models.TestRun.id == execution.test_run_id))).scalar_one_or_none()
    await _ensure_run_build_is_active(db, run)
    await realtime_event_bus.publish(
        run.proyecto_id if run else None,
        "ia.execution.updated",
        actor_id=current_user.id,
        build_id=run.build_id if run else None,
        case_id=execution.caso_id,
        run_id=execution.test_run_id,
        execution_id=execution.id,
        payload={"review_status": execution.ai_review_status},
    )
    return execution

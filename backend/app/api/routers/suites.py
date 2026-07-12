from fastapi import APIRouter

from ...main_context import *


router = APIRouter(tags=["Suites"])

async def _require_suite_access(
    db: AsyncSession,
    current_user: models.Usuario,
    suite_id: UUID,
    level: str = "read",
):
    db_suite = await crud.get_suite(db, suite_id)
    if not db_suite:
        raise HTTPException(status_code=404, detail="Suite no encontrada")
    await access_control.require_project_access(db, current_user, db_suite.proyecto_id, level)
    return db_suite


async def _require_suite_reorder_access(
    db: AsyncSession,
    current_user: models.Usuario,
    suite_ids: list[UUID],
):
    if not suite_ids:
        return None
    result = await db.execute(select(models.Suite).filter(models.Suite.id.in_(suite_ids)))
    suites = result.scalars().all()
    if len({suite.id for suite in suites}) != len(set(suite_ids)):
        raise HTTPException(status_code=404, detail="Una o mas suites no existen")
    project_ids = {suite.proyecto_id for suite in suites}
    if len(project_ids) != 1:
        raise HTTPException(status_code=400, detail="No se pueden reordenar suites de proyectos distintos")
    project_id = next(iter(project_ids))
    await access_control.require_project_access(db, current_user, project_id, "edit")
    return suites[0]


@router.post("/suites/", response_model=schemas.Suite)
async def create_suite(
    request: Request,
    suite: schemas.SuiteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.suites", "edit"))
):
    await access_control.require_project_access(db, current_user, suite.proyecto_id, "edit")
    if suite.componente_id:
        component_result = await db.execute(
            select(models.Componente.id).filter(
                models.Componente.id == suite.componente_id,
                models.Componente.proyecto_id == suite.proyecto_id,
            )
        )
        if not component_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="El componente no pertenece al proyecto de la suite")
    if suite.parent_id:
        parent = await crud.get_suite(db, suite.parent_id)
        if not parent or parent.proyecto_id != suite.proyecto_id:
            raise HTTPException(status_code=400, detail="La suite padre no pertenece al proyecto")
        if parent.componente_id and suite.componente_id and parent.componente_id != suite.componente_id:
            raise HTTPException(status_code=400, detail="La sub-suite debe pertenecer al mismo componente que la suite padre")
    new_suite = await crud.create_suite(db=db, suite=suite)
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="suite",
        recurso_id=new_suite.id,
        detalles={"nombre": suite.nombre, "proyecto_id": str(suite.proyecto_id)},
        ip_address=client_ip
    )
    await realtime_event_bus.publish(
        new_suite.proyecto_id,
        "suite.created",
        actor_id=current_user.id,
        component_id=new_suite.componente_id,
        suite_id=new_suite.id,
        payload={"suite": {"id": str(new_suite.id), "nombre": new_suite.nombre}},
    )
    
    return new_suite

@router.get("/proyectos/{proyecto_id}/suites/", response_model=List[schemas.Suite])
async def read_suites_proyecto(
    proyecto_id: UUID,
    componente_id: Optional[UUID] = None,
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.suites", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if componente_id:
        db_component = await access_control.require_component_access(db, current_user, componente_id, "read")
        if db_component.proyecto_id != proyecto_id:
            raise HTTPException(status_code=404, detail="Componente no encontrado para el proyecto")
    return await crud.get_root_suites_proyecto(db, proyecto_id=proyecto_id, componente_id=componente_id, include_archived=include_archived)

@router.patch("/suites/reorder")
async def reorder_suites(
    request: Request,
    reorder_request: schemas.SuiteReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.suites", "edit"))
):
    first_suite_context = await _require_suite_reorder_access(db, current_user, reorder_request.orden)
    exito = await crud.reorder_suites(db=db, suite_ids=reorder_request.orden)
    if not exito:
        raise HTTPException(status_code=400, detail="Error al reordenar suites")
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="REORDER",
        recurso="suite",
        detalles={"suite_ids": [str(sid) for sid in reorder_request.orden]},
        ip_address=client_ip
    )
    if first_suite_context:
        await realtime_event_bus.publish(
            first_suite_context.proyecto_id,
            "suite.reordered",
            actor_id=current_user.id,
            component_id=first_suite_context.componente_id,
            payload={"suite_ids": [str(sid) for sid in reorder_request.orden]},
        )
    
    return {"detail": "Suites reordenadas correctamente"}

@router.patch("/suites/{suite_id}", response_model=schemas.Suite)
async def update_suite(
    request: Request,
    suite_id: UUID,
    suite: schemas.SuiteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.suites", "edit"))
):
    await _require_suite_access(db, current_user, suite_id, "edit")
    updated = await crud.update_suite(db=db, suite_id=suite_id, suite_update=suite)
    if not updated:
        raise HTTPException(status_code=404, detail="Suite no encontrada")
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE",
        recurso="suite",
        recurso_id=suite_id,
        detalles=suite.model_dump(exclude_unset=True),
        ip_address=client_ip
    )
    await realtime_event_bus.publish(
        updated.proyecto_id,
        "suite.updated",
        actor_id=current_user.id,
        component_id=updated.componente_id,
        suite_id=updated.id,
        payload={"suite": {"id": str(updated.id), "nombre": updated.nombre}},
    )
    
    return updated

@router.patch("/suites/{suite_id}/archive")
async def archive_suite(
    request: Request,
    suite_id: UUID,
    payload: schemas.SuiteArchiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.suites", "edit"))
):
    suite_context = await _require_suite_access(db, current_user, suite_id, "edit")
    exito, mensaje, detalles = await crud.archive_suite_tree(db=db, suite_id=suite_id, archivado=payload.archivado)
    if not exito:
        raise HTTPException(status_code=404, detail=mensaje)

    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="ARCHIVE" if payload.archivado else "RESTORE",
        recurso="suite",
        recurso_id=suite_id,
        detalles=detalles,
        ip_address=client_ip
    )
    if suite_context:
        await realtime_event_bus.publish(
            suite_context.proyecto_id,
            "suite.archived" if payload.archivado else "suite.restored",
            actor_id=current_user.id,
            component_id=suite_context.componente_id,
            suite_id=suite_id,
            payload={"suite": {"id": str(suite_id)}, "details": detalles},
        )

    return {"detail": mensaje, **detalles}

@router.delete("/suites/{suite_id}")
async def delete_suite(
    request: Request,
    suite_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.suites", "edit"))
):
    suite_context = await _require_suite_access(db, current_user, suite_id, "edit")
    exito, mensaje = await crud.delete_suite(db=db, suite_id=suite_id)
    if not exito:
        raise HTTPException(status_code=400, detail=mensaje)
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="DELETE",
        recurso="suite",
        recurso_id=suite_id,
        ip_address=client_ip
    )
    if suite_context:
        await realtime_event_bus.publish(
            suite_context.proyecto_id,
            "suite.deleted",
            actor_id=current_user.id,
            component_id=suite_context.componente_id,
            suite_id=suite_id,
            payload={"suite": {"id": str(suite_id), "nombre": suite_context.nombre}},
        )
    
    return {"detail": mensaje}

@router.post("/suites/{suite_id}/clone", response_model=schemas.SuiteCloneResponse)
async def clone_suite(
    request: Request,
    suite_id: UUID,
    clone_request: Optional[schemas.SuiteCloneRequest] = None,
    nuevo_nombre: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.suites", "edit"))
):
    body_was_provided = clone_request is not None
    payload = clone_request or schemas.SuiteCloneRequest(nuevo_nombre=nuevo_nombre)
    suite_context = await _require_suite_access(db, current_user, suite_id, "edit")
    if payload.parent_id:
        parent = await _require_suite_access(db, current_user, payload.parent_id, "edit")
        if parent.proyecto_id != suite_context.proyecto_id:
            raise HTTPException(status_code=400, detail="La suite destino no pertenece al proyecto original")
    try:
        clone_result = await crud.clone_suite(
            db=db,
            suite_id=suite_id,
            nuevo_nombre=payload.nuevo_nombre or nuevo_nombre,
            parent_id=payload.parent_id,
            include_cases=payload.include_cases,
            keep_original_parent_when_parent_omitted=not body_was_provided
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not clone_result:
        raise HTTPException(status_code=404, detail="Suite no encontrada")
    cloned = clone_result["suite"]
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CLONE",
        recurso="suite",
        recurso_id=cloned.id,
        detalles={
            "original_id": str(suite_id),
            "nuevo_nombre": cloned.nombre,
            "parent_id": str(payload.parent_id) if payload.parent_id else None,
            "include_cases": payload.include_cases,
            "suites_copiadas": clone_result["suites_copiadas"],
            "casos_copiados": clone_result["casos_copiados"]
        },
        ip_address=client_ip
    )
    await realtime_event_bus.publish(
        cloned.proyecto_id,
        "suite.created",
        actor_id=current_user.id,
        component_id=cloned.componente_id,
        suite_id=cloned.id,
        payload={
            "suite": {"id": str(cloned.id), "nombre": cloned.nombre},
            "source": "clone",
            "original_id": str(suite_id),
        },
    )
    
    return clone_result

@router.patch("/suites/{suite_id}/move")
async def move_suite(
    request: Request,
    suite_id: UUID,
    move_request: schemas.SuiteMoveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.suites", "edit"))
):
    suite_context = await _require_suite_access(db, current_user, suite_id, "edit")
    if move_request.parent_id:
        parent = await _require_suite_access(db, current_user, move_request.parent_id, "edit")
        if parent.proyecto_id != suite_context.proyecto_id:
            raise HTTPException(status_code=400, detail="La suite padre no pertenece al proyecto")
    exito, mensaje = await crud.move_suite(db=db, suite_id=suite_id, new_parent_id=move_request.parent_id)
    if not exito:
        raise HTTPException(status_code=400, detail=mensaje)
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="MOVE",
        recurso="suite",
        recurso_id=suite_id,
        detalles={"new_parent_id": str(move_request.parent_id) if move_request.parent_id else None},
        ip_address=client_ip
    )
    if suite_context:
        await realtime_event_bus.publish(
            suite_context.proyecto_id,
            "suite.moved",
            actor_id=current_user.id,
            component_id=suite_context.componente_id,
            suite_id=suite_id,
            payload={"suite": {"id": str(suite_id)}, "parent_id": str(move_request.parent_id) if move_request.parent_id else None},
        )
    
    return {"detail": mensaje}

# --- ENDPOINTS CASOS DE PRUEBA ---

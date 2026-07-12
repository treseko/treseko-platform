from typing import Annotated

from fastapi import APIRouter

from ...main_context import *


router = APIRouter(tags=["Casos"])

async def _get_case_or_404(db: AsyncSession, caso_id: UUID):
    result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == caso_id))
    db_case = result.scalar_one_or_none()
    if not db_case:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    return db_case


async def _require_case_access(
    db: AsyncSession,
    current_user: models.Usuario,
    caso_id: UUID,
    level: str = "read",
):
    db_case = await _get_case_or_404(db, caso_id)
    await access_control.require_project_access(db, current_user, db_case.proyecto_id, level)
    return db_case


async def _require_case_master_access(
    db: AsyncSession,
    current_user: models.Usuario,
    master_id: UUID,
    level: str = "read",
):
    result = await db.execute(
        select(models.CasoPrueba)
        .filter(models.CasoPrueba.master_id == master_id)
        .order_by(models.CasoPrueba.version.desc())
        .limit(1)
    )
    db_case = result.scalar_one_or_none()
    if not db_case:
        raise HTTPException(status_code=404, detail="Caso de prueba no encontrado")
    await access_control.require_project_access(db, current_user, db_case.proyecto_id, level)
    return db_case


async def validate_caso_component(db: AsyncSession, caso: schemas.CasoPruebaCreate):
    componentes_result = await db.execute(
        select(models.Componente.id).filter(models.Componente.proyecto_id == caso.proyecto_id).limit(1)
    )
    project_has_components = componentes_result.scalar_one_or_none() is not None
    if project_has_components and not caso.componente_id:
        raise HTTPException(status_code=400, detail="El caso de prueba debe pertenecer a un componente del proyecto")
    if caso.componente_id:
        component_result = await db.execute(
            select(models.Componente).filter(
                models.Componente.id == caso.componente_id,
                models.Componente.proyecto_id == caso.proyecto_id,
            )
        )
        if not component_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="El componente no pertenece al proyecto del caso")
    if caso.suite_id:
        suite_result = await db.execute(
            select(models.Suite).filter(
                models.Suite.id == caso.suite_id,
                models.Suite.proyecto_id == caso.proyecto_id,
            )
        )
        db_suite = suite_result.scalar_one_or_none()
        if not db_suite:
            raise HTTPException(status_code=400, detail="La suite no pertenece al proyecto del caso")
        if db_suite.componente_id and caso.componente_id and db_suite.componente_id != caso.componente_id:
            raise HTTPException(status_code=400, detail="La suite no pertenece al componente del caso")


async def _publish_case_change(
    event_type: str,
    caso: models.CasoPrueba,
    current_user: models.Usuario,
    payload: dict | None = None,
):
    estado_caso = caso.estado_caso.value if hasattr(caso.estado_caso, "value") else caso.estado_caso
    case_payload = {
        "case": {
            "id": str(caso.id),
            "master_id": str(caso.master_id) if caso.master_id else None,
            "codigo": caso.codigo,
            "titulo": caso.titulo,
            "version": caso.version,
            "estado": estado_caso,
        },
        **(payload or {}),
    }
    await realtime_event_bus.publish(
        caso.proyecto_id,
        event_type,
        actor_id=current_user.id,
        component_id=caso.componente_id,
        suite_id=caso.suite_id,
        case_id=caso.id,
        payload=case_payload,
    )
    await realtime_event_bus.publish(
        caso.proyecto_id,
        "report.metrics.invalidated",
        actor_id=current_user.id,
        component_id=caso.componente_id,
        suite_id=caso.suite_id,
        case_id=caso.id,
        payload={"source": event_type},
    )

@router.post("/casos/", response_model=schemas.CasoPrueba)
async def create_caso_prueba(
    request: Request,
    caso: schemas.CasoPruebaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "edit"))
):
    await access_control.require_project_access(db, current_user, caso.proyecto_id, "edit")
    caso.creado_por = current_user.id
    await validate_caso_component(db, caso)
    try:
        new_caso = await crud.create_caso_prueba(db=db, caso=caso)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail="No se pudo crear el caso: pasos duplicados o datos relacionados invalidos") from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo crear el caso por un error de base de datos: {exc.__class__.__name__}") from exc
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="caso",
        recurso_id=new_caso.id,
        detalles={"titulo": caso.titulo, "proyecto_id": str(caso.proyecto_id)},
        ip_address=client_ip
    )
    await _publish_case_change("case.created", new_caso, current_user)
    
    return new_caso

@router.put("/casos/{master_id}", response_model=schemas.CasoPrueba)
async def update_caso_prueba(
    request: Request,
    master_id: UUID,
    caso: schemas.CasoPruebaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "edit"))
):
    existing_case = await _require_case_master_access(db, current_user, master_id, "edit")
    if existing_case.proyecto_id != caso.proyecto_id:
        raise HTTPException(status_code=400, detail="No se puede mover un caso a otro proyecto")
    caso.creado_por = current_user.id
    await access_control.require_project_access(db, current_user, caso.proyecto_id, "edit")
    await validate_caso_component(db, caso)
    try:
        updated = await crud.update_caso_prueba(db=db, master_id=master_id, caso_update=caso)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="No se pudo actualizar el caso por una restriccion de datos relacionada a sus pasos o evidencias") from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo actualizar el caso por un error de base de datos: {exc.__class__.__name__}") from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Caso de prueba no encontrado")
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE",
        recurso="caso",
        recurso_id=updated.id,
        detalles={"master_id": str(master_id), "version": updated.version},
        ip_address=client_ip
    )
    await _publish_case_change("case.version.created", updated, current_user, {"master_id": str(master_id)})
    
    return updated

@router.get("/proyectos/{proyecto_id}/casos/")
async def read_casos_proyecto(
    proyecto_id: UUID,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[Optional[int], Query(ge=1)] = None,
    estado: Annotated[Optional[str], Query(max_length=50)] = None,
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if estado is not None and estado not in {item.value for item in models.EstadoCaso}:
        raise HTTPException(status_code=422, detail="Estado de caso invalido")
    casos = await crud.get_casos_proyecto(db, proyecto_id=proyecto_id, include_archived=include_archived, estado=estado)
    if limit is None:
        return casos[skip:]
    return casos[skip:skip+limit]

@router.get("/casos/{caso_id}/historial")
async def get_caso_historial(
    caso_id: UUID,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    build_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("ejecutar", "read"))
):
    """Obtener historial de ejecuciones de un caso"""
    caso = await _require_case_access(db, current_user, caso_id, "read")
    if build_id:
        db_build = await access_control.require_build_access(db, current_user, build_id, "read")
        if db_build.proyecto_id != caso.proyecto_id:
            raise HTTPException(status_code=404, detail="Build no encontrado para el caso")
    ejecuciones = await crud.get_caso_execution_history(db, caso_id, limit, build_id=build_id)
    execution_ids = [ejec.id for ejec in ejecuciones]
    user_ids = {ejec.ejecutado_por for ejec in ejecuciones if ejec.ejecutado_por}
    run_ids = {ejec.test_run_id for ejec in ejecuciones if ejec.test_run_id}
    users = {}
    runs = {}
    builds = {}
    components = {}
    environments = {}
    datasets = {}
    if user_ids:
        users_result = await db.execute(select(models.Usuario).filter(models.Usuario.id.in_(user_ids)))
        users = {user.id: user for user in users_result.scalars().all()}
    if run_ids:
        runs_result = await db.execute(select(models.TestRun).filter(models.TestRun.id.in_(run_ids)))
        runs = {run.id: run for run in runs_result.scalars().all()}
    build_ids = {run.build_id for run in runs.values() if run.build_id}
    if build_id:
        build_ids.add(build_id)
    if build_ids:
        builds_result = await db.execute(select(models.Build).filter(models.Build.id.in_(build_ids)))
        builds = {build.id: build for build in builds_result.scalars().all()}
    component_ids = {caso.componente_id} if caso and caso.componente_id else set()
    component_ids.update(build.componente_id for build in builds.values() if build.componente_id)
    if component_ids:
        components_result = await db.execute(select(models.Componente).filter(models.Componente.id.in_(component_ids)))
        components = {component.id: component for component in components_result.scalars().all()}
    environment_ids = {run.entorno_id for run in runs.values() if run.entorno_id}
    if environment_ids:
        environments_result = await db.execute(select(models.Entorno).filter(models.Entorno.id.in_(environment_ids)))
        environments = {environment.id: environment for environment in environments_result.scalars().all()}
    dataset_ids = {run.dataset_id for run in runs.values() if run.dataset_id}
    if dataset_ids:
        datasets_result = await db.execute(select(models.EntornoDataset).filter(models.EntornoDataset.id.in_(dataset_ids)))
        datasets = {dataset.id: dataset for dataset in datasets_result.scalars().all()}
    details_by_execution = await crud.get_execution_history_details_bulk(db, execution_ids)
    historial = []
    for index, ejec in enumerate(ejecuciones):
        user = users.get(ejec.ejecutado_por)
        run = runs.get(ejec.test_run_id)
        build = builds.get(run.build_id) if run and run.build_id else None
        component_id = caso.componente_id if caso else None
        if not component_id and build:
            component_id = build.componente_id
        component = components.get(component_id) if component_id else None
        environment = environments.get(run.entorno_id) if run and run.entorno_id else None
        dataset = datasets.get(run.dataset_id) if run and run.dataset_id else None
        details = details_by_execution.get(ejec.id) or {}
        fecha_historial = ejec.fecha_ejecucion
        if index == 0 and caso and caso.ultima_ejecucion_fecha:
            fecha_historial = caso.ultima_ejecucion_fecha
        
        historial.append({
            "id": str(ejec.id),
            "estado": ejec.estado_resultado.value,
            "fecha": isoformat_utc(fecha_historial),
            "ejecutado_por": user.email if user else None,
            "ejecutado_por_nombre": user.nombre_completo if user else None,
            "duracion_segundos": ejec.duracion_segundos,
            "intento_numero": ejec.intento_numero,
            "version_ejecutada": ejec.version_ejecutada,
            "test_run_id": str(ejec.test_run_id),
            "build_id": str(run.build_id) if run and run.build_id else (str(build_id) if build_id else None),
            "build_nombre": build.nombre if build else None,
            "build_codigo": build.codigo if build else None,
            "componente_id": str(component_id) if component_id else None,
            "componente_nombre": component.nombre if component else None,
            "entorno_id": str(run.entorno_id) if run and run.entorno_id else None,
            "entorno_nombre": environment.nombre if environment else (run.entorno if run else None),
            "dataset_id": str(run.dataset_id) if run and run.dataset_id else None,
            "dataset_nombre": dataset.nombre if dataset else None,
            "execution_mode": crud._execution_mode_value(ejec, caso),
            "ai_review_status": crud._review_status_for_execution(ejec),
            "ai_human_review_required": bool(
                ejec.ai_human_review_required
                or ((ejec.ai_report or {}).get("human_review_required") if isinstance(ejec.ai_report, dict) else False)
            ),
            "paso_fallido": details["paso_fallido"],
            "snapshot_id": details.get("snapshot_id"),
            "datos_prueba": details.get("datos_prueba"),
            "resultado_esperado": details.get("resultado_esperado"),
            "accion": details.get("accion"),
            "evidencia_url": details["evidencia_url"],
            "evidencias": details.get("evidencias", []),
            "observaciones": details["observaciones"] or ejec.observaciones,
        })
    return historial

@router.get("/casos/{master_id}/versions", response_model=List[schemas.CasoVersion])
async def read_caso_versions(
    master_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.versiones", "read"))
):
    await _require_case_master_access(db, current_user, master_id, "read")
    versions = await crud.get_caso_versions(db, master_id=master_id)
    return versions

@router.get("/casos/{caso_id}", response_model=schemas.CasoPruebaConPasos)
async def read_caso(
    caso_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "read"))
):
    await _require_case_access(db, current_user, caso_id, "read")
    caso = await crud.get_caso_with_pasos(db, caso_id=caso_id)
    if not caso:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    return caso

@router.patch("/casos/{caso_id}/metadata", response_model=schemas.CasoPrueba)
async def update_caso_metadata(
    request: Request,
    caso_id: UUID,
    update: schemas.CasoPruebaUpdateMetadata,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "edit"))
):
    await _require_case_access(db, current_user, caso_id, "edit")
    updated = await crud.update_caso_metadata(db=db, caso_id=caso_id, update=update)
    if not updated:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE_METADATA",
        recurso="caso",
        recurso_id=caso_id,
        detalles=update.model_dump(exclude_unset=True),
        ip_address=client_ip
    )
    event_type = "case.archived" if update.estado == models.EstadoCaso.ARCHIVADO else "case.updated"
    await _publish_case_change(event_type, updated, current_user, {"updated_fields": update.model_dump(exclude_unset=True)})
    
    return updated

@router.patch("/casos/{caso_id}/move", response_model=schemas.CasoPrueba)
async def move_caso(
    request: Request,
    caso_id: UUID,
    move_request: schemas.CasoMoveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "edit"))
):
    await _require_case_access(db, current_user, caso_id, "edit")
    try:
        moved = await crud.move_caso(db=db, caso_id=caso_id, suite_id=move_request.suite_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not moved:
        raise HTTPException(status_code=404, detail="Caso no encontrado")

    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="MOVE",
        recurso="caso",
        recurso_id=caso_id,
        detalles={"suite_id": str(move_request.suite_id)},
        ip_address=client_ip
    )
    await _publish_case_change("case.moved", moved, current_user, {"suite_id": str(move_request.suite_id) if move_request.suite_id else None})

    return moved

@router.delete("/casos/{caso_id}")
async def delete_caso(
    request: Request,
    caso_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "edit"))
):
    case_context = await _require_case_access(db, current_user, caso_id, "edit")
    exito, mensaje = await crud.delete_caso(db=db, caso_id=caso_id)
    if not exito:
        raise HTTPException(status_code=400, detail=mensaje)
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="DELETE",
        recurso="caso",
        recurso_id=caso_id,
        ip_address=client_ip
    )
    if case_context:
        await _publish_case_change("case.archived", case_context, current_user, {"source": "delete"})
    
    return {"detail": mensaje}

@router.post("/casos/{caso_id}/clone", response_model=schemas.CasoPrueba)
async def clone_caso(
    request: Request,
    caso_id: UUID,
    suite_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "edit"))
):
    await _require_case_access(db, current_user, caso_id, "edit")
    try:
        cloned = await crud.clone_caso(db=db, caso_id=caso_id, suite_id=suite_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not cloned:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CLONE",
        recurso="caso",
        recurso_id=cloned.id,
        detalles={"original_id": str(caso_id), "suite_id": str(suite_id) if suite_id else None},
        ip_address=client_ip
    )
    await _publish_case_change("case.created", cloned, current_user, {"source": "clone", "original_id": str(caso_id)})
    
    return cloned

@router.get("/proyectos/{proyecto_id}/casos/search", response_model=schemas.CasoSearchResponse)
async def search_casos(
    proyecto_id: UUID,
    q: Annotated[str, Query(max_length=200)] = "",
    suite_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    build_id: Optional[UUID] = None,
    prioridad: Annotated[Optional[str], Query(max_length=50)] = None,
    criticidad: Annotated[Optional[str], Query(max_length=50)] = None,
    estado: Annotated[Optional[str], Query(max_length=50)] = None,
    tag: Annotated[Optional[str], Query(max_length=80)] = None,
    etiqueta: Annotated[Optional[str], Query(max_length=80)] = None,
    include_archived: bool = False,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[Optional[int], Query(ge=1)] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if estado is not None and estado not in {item.value for item in models.EstadoCaso}:
        raise HTTPException(status_code=422, detail="Estado de caso invalido")
    if suite_id:
        suite_result = await db.execute(
            select(models.Suite).filter(
                models.Suite.id == suite_id,
                models.Suite.proyecto_id == proyecto_id,
            )
        )
        if not suite_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Suite no encontrada para el proyecto")
    if component_id:
        component_result = await db.execute(
            select(models.Componente).filter(
                models.Componente.id == component_id,
                models.Componente.proyecto_id == proyecto_id,
            )
        )
        if not component_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Componente no encontrado para el proyecto")
    if build_id:
        build_result = await db.execute(
            select(models.Build).filter(
                models.Build.id == build_id,
                models.Build.proyecto_id == proyecto_id,
            )
        )
        if not build_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Build no encontrada para el proyecto")
    items, total = await crud.search_casos(
        db=db,
        proyecto_id=proyecto_id,
        query=q,
        suite_id=suite_id,
        component_id=component_id,
        build_id=build_id,
        prioridad=prioridad,
        criticidad=criticidad,
        estado=estado,
        etiqueta=etiqueta or tag,
        include_archived=include_archived,
        skip=skip,
        limit=limit
    )
    return schemas.CasoSearchResponse(
        items=items,
        total=total,
        skip=skip,
        limit=limit
    )

# --- ENDPOINTS TEST RUNS ---

@router.post("/casos/{caso_id}/dataset/resolve", response_model=schemas.DatasetResolveResponse)
async def resolve_case_dataset(
    caso_id: UUID,
    payload: schemas.DatasetResolveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.ver", "read"))
):
    caso = await _require_case_access(db, current_user, caso_id, "read")
    if payload.build_id:
        db_build = await access_control.require_build_access(db, current_user, payload.build_id, "read")
        if db_build.proyecto_id != caso.proyecto_id:
            raise HTTPException(status_code=404, detail="Build no encontrado para el caso")
    if payload.entorno_id:
        env_result = await db.execute(
            select(models.Entorno).filter(
                models.Entorno.id == payload.entorno_id,
                models.Entorno.proyecto_id == caso.proyecto_id,
            )
        )
        if not env_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Entorno no encontrado para el caso")
    if payload.dataset_id:
        dataset_result = await db.execute(
            select(models.EntornoDataset)
            .join(models.Entorno, models.Entorno.id == models.EntornoDataset.entorno_id)
            .filter(
                models.EntornoDataset.id == payload.dataset_id,
                models.Entorno.proyecto_id == caso.proyecto_id,
            )
        )
        if not dataset_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Dataset no encontrado para el caso")
    resolved = await crud.resolve_case_dataset(
        db,
        caso_id=caso_id,
        build_id=payload.build_id,
        entorno_id=payload.entorno_id,
        dataset_id=payload.dataset_id,
    )
    if not resolved:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    return resolved


router.export_symbols = {"validate_caso_component": validate_caso_component}

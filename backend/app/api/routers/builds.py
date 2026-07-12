from fastapi import APIRouter
from typing import Annotated

from ...main_context import *


router = APIRouter(tags=["Builds"])

@router.get("/proyectos/{proyecto_id}/builds/", response_model=List[schemas.Build])
async def read_builds_proyecto(
    proyecto_id: UUID, 
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.builds", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_builds_proyecto(db, proyecto_id=proyecto_id, skip=skip, limit=limit)

@router.get("/componentes/{componente_id}/builds/", response_model=List[schemas.Build])
async def read_builds_componente(
    componente_id: UUID, 
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.builds", "read"))
):
    await access_control.require_component_access(db, current_user, componente_id, "read")
    return await crud.get_builds_componente(db, componente_id=componente_id, skip=skip, limit=limit)

@router.post("/builds/", response_model=schemas.Build)
async def create_build(
    build: schemas.BuildCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.builds", "edit"))
):
    await access_control.require_project_access(db, current_user, build.proyecto_id, "edit")
    result = await db.execute(
        select(models.Componente).filter(
            models.Componente.id == build.componente_id,
            models.Componente.proyecto_id == build.proyecto_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="El componente no pertenece al proyecto seleccionado")
    created_build = await crud.create_build(db=db, build=build)
    if created_build.activo:
        await notification_event_service.emit_event(
            db=db,
            event_type="build.activated",
            actor_user_id=current_user.id,
            proyecto_id=created_build.proyecto_id,
            entity_type="build",
            entity_id=created_build.id,
            severity="info",
            payload={"build": {"id": str(created_build.id), "nombre": created_build.nombre}, "actor": {"email": current_user.email}, "message": f"Build activa: {created_build.nombre}"},
            dedupe_key=f"build.activated:{created_build.id}",
        )
    await realtime_event_bus.publish(
        created_build.proyecto_id,
        "build.created",
        actor_id=current_user.id,
        component_id=created_build.componente_id,
        build_id=created_build.id,
        payload={
            "build": {
                "id": str(created_build.id),
                "nombre": created_build.nombre,
                "codigo": created_build.codigo,
                "activo": created_build.activo,
            },
        },
    )
    await realtime_event_bus.publish(
        created_build.proyecto_id,
        "report.metrics.invalidated",
        actor_id=current_user.id,
        component_id=created_build.componente_id,
        build_id=created_build.id,
        payload={"source": "build.created"},
    )
    return created_build

@router.patch("/builds/{build_id}", response_model=schemas.Build)
async def update_build(
    build_id: UUID, 
    build: schemas.BuildUpdate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.builds", "edit"))
):
    current_build = await access_control.require_build_access(db, current_user, build_id, "edit")
    if "componente_id" in build.model_fields_set and build.componente_id != current_build.componente_id:
        raise HTTPException(
            status_code=422,
            detail="No se puede mover una build entre componentes. Crea una build nueva en el componente destino.",
        )
    db_build = await crud.update_build(db=db, build_id=build_id, build_update=build)
    if not db_build:
        raise HTTPException(status_code=404, detail="Build no encontrada")
    if build.activo is True:
        await notification_event_service.emit_event(
            db=db,
            event_type="build.activated",
            actor_user_id=current_user.id,
            proyecto_id=db_build.proyecto_id,
            entity_type="build",
            entity_id=db_build.id,
            severity="info",
            payload={"build": {"id": str(db_build.id), "nombre": db_build.nombre}, "actor": {"email": current_user.email}, "message": f"Build activa: {db_build.nombre}"},
            dedupe_key=f"build.activated:{db_build.id}",
        )
    elif build.activo is False:
        await notification_event_service.emit_event(
            db=db,
            event_type="build.closed",
            actor_user_id=current_user.id,
            proyecto_id=db_build.proyecto_id,
            entity_type="build",
            entity_id=db_build.id,
            severity="info",
            payload={"build": {"id": str(db_build.id), "nombre": db_build.nombre}, "actor": {"email": current_user.email}, "message": f"Build cerrada: {db_build.nombre}"},
            dedupe_key=f"build.closed:{db_build.id}",
        )
    await realtime_event_bus.publish(
        db_build.proyecto_id,
        "build.updated",
        actor_id=current_user.id,
        component_id=db_build.componente_id,
        build_id=db_build.id,
        payload={
            "build": {
                "id": str(db_build.id),
                "nombre": db_build.nombre,
                "codigo": db_build.codigo,
                "activo": db_build.activo,
            },
            "updated_fields": build.model_dump(exclude_unset=True, exclude_none=True),
        },
    )
    await realtime_event_bus.publish(
        db_build.proyecto_id,
        "report.metrics.invalidated",
        actor_id=current_user.id,
        component_id=db_build.componente_id,
        build_id=db_build.id,
        payload={"source": "build.updated"},
    )
    return db_build

@router.delete("/builds/{build_id}")
async def delete_build(
    build_id: UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.builds", "edit"))
):
    db_build = await access_control.require_build_access(db, current_user, build_id, "edit")
    deleted = await crud.delete_build(db=db, build_id=build_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Build no encontrada")
    await realtime_event_bus.publish(
        db_build.proyecto_id,
        "build.deleted",
        actor_id=current_user.id,
        component_id=db_build.componente_id,
        build_id=db_build.id,
        payload={"build": {"id": str(db_build.id), "nombre": db_build.nombre}},
    )
    await realtime_event_bus.publish(
        db_build.proyecto_id,
        "report.metrics.invalidated",
        actor_id=current_user.id,
        component_id=db_build.componente_id,
        build_id=db_build.id,
        payload={"source": "build.deleted"},
    )
    return {"ok": True}

@router.get("/builds/{build_id}/casos/", response_model=List[schemas.CasoPrueba])
async def read_build_casos(
    build_id: UUID, 
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.build_scope", "read"))
):
    await access_control.require_build_access(db, current_user, build_id, "read")
    return await crud.get_build_casos(db=db, build_id=build_id, skip=skip, limit=limit)

@router.get("/proyectos/{proyecto_id}/build-casos/")
async def read_project_build_case_ids(
    proyecto_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.build_scope", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_project_build_case_ids(db=db, proyecto_id=proyecto_id)

@router.get("/builds/{build_id}/casos/ultimos-resultados/")
async def read_build_latest_case_results(
    build_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("ejecutar", "read"))
):
    await access_control.require_build_access(db, current_user, build_id, "read")
    return await crud.get_build_latest_case_results(db=db, build_id=build_id)

@router.get("/builds/{build_id}/casos/fallos-previos/", response_model=List[schemas.CasoPrueba])
async def read_previous_failed_build_cases(
    build_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.build_scope", "read"))
):
    await access_control.require_build_access(db, current_user, build_id, "read")
    return await crud.get_previous_failed_build_cases(db=db, build_id=build_id)

@router.put("/builds/{build_id}/casos/", response_model=List[schemas.CasoPrueba])
async def update_build_casos(
    build_id: UUID, 
    payload: schemas.BuildCasosUpdate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.build_scope", "edit"))
):
    db_build = await access_control.require_build_access(db, current_user, build_id, "edit")
    if not db_build.activo:
        raise HTTPException(status_code=409, detail="La build está inactiva y no permite modificar su alcance de casos")
    ok, message, casos = await crud.set_build_casos(db=db, build_id=build_id, caso_ids=payload.caso_ids)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    await realtime_event_bus.publish(
        db_build.proyecto_id,
        "build.cases.updated",
        actor_id=current_user.id,
        component_id=db_build.componente_id,
        build_id=db_build.id,
        payload={"case_count": len(casos), "source": "build.scope"},
    )
    await realtime_event_bus.publish(
        db_build.proyecto_id,
        "report.metrics.invalidated",
        actor_id=current_user.id,
        component_id=db_build.componente_id,
        build_id=db_build.id,
        payload={"source": "build.cases.updated"},
    )
    return casos

@router.post("/builds/{build_id}/casos/promote-version/", response_model=List[schemas.CasoPrueba])
async def promote_build_case_version(
    build_id: UUID,
    payload: schemas.BuildCasoPromoteVersion,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.build_scope", "edit"))
):
    db_build = await access_control.require_build_access(db, current_user, build_id, "edit")
    if not db_build.activo:
        raise HTTPException(status_code=409, detail="La build está inactiva y no permite promover versiones de casos")
    ok, message, casos = await crud.promote_build_case_version(
        db=db,
        build_id=build_id,
        old_caso_id=payload.old_caso_id,
        new_caso_id=payload.new_caso_id,
    )
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    await realtime_event_bus.publish(
        db_build.proyecto_id,
        "build.cases.updated",
        actor_id=current_user.id,
        component_id=db_build.componente_id,
        build_id=db_build.id,
        case_id=payload.new_caso_id,
        payload={
            "old_case_id": str(payload.old_caso_id),
            "new_case_id": str(payload.new_caso_id),
            "source": "case.version.promoted",
        },
    )
    await realtime_event_bus.publish(
        db_build.proyecto_id,
        "report.metrics.invalidated",
        actor_id=current_user.id,
        component_id=db_build.componente_id,
        build_id=db_build.id,
        case_id=payload.new_caso_id,
        payload={"source": "build.cases.updated"},
    )
    return casos

# --- ENDPOINTS SUITES ---

from fastapi import APIRouter
from typing import Annotated

from ...main_context import *


router = APIRouter(tags=["Componentes"])

@router.post("/componentes/", response_model=schemas.Componente)
async def create_componente(
    comp: schemas.ComponenteCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.componentes", "edit"))
):
    await access_control.require_project_access(db, current_user, comp.proyecto_id, "edit")
    created = await crud.create_componente(db=db, comp=comp)
    await realtime_event_bus.publish(
        created.proyecto_id,
        "component.created",
        actor_id=current_user.id,
        component_id=created.id,
        payload={"component": {"id": str(created.id), "nombre": created.nombre}},
    )
    return created

@router.get("/proyectos/{proyecto_id}/componentes/", response_model=List[schemas.Componente])
async def read_componentes_proyecto(
    proyecto_id: UUID, 
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.componentes", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_componentes_proyecto(db, proyecto_id=proyecto_id, skip=skip, limit=limit)

@router.patch("/componentes/{componente_id}", response_model=schemas.Componente)
async def update_componente(
    componente_id: UUID, 
    comp: schemas.ComponenteUpdate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.componentes", "edit"))
):
    db_component = await access_control.require_component_access(db, current_user, componente_id, "edit")
    db_comp = await crud.update_componente(db=db, componente_id=componente_id, comp_update=comp)
    if not db_comp:
        raise HTTPException(status_code=404, detail="Componente no encontrado")
    await realtime_event_bus.publish(
        db_comp.proyecto_id,
        "component.updated",
        actor_id=current_user.id,
        component_id=db_comp.id,
        payload={"component": {"id": str(db_comp.id), "nombre": db_comp.nombre}},
    )
    return db_comp

@router.delete("/componentes/{componente_id}")
async def delete_componente(
    componente_id: UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.componentes", "edit"))
):
    db_component = await access_control.require_component_access(db, current_user, componente_id, "edit")
    deleted = await crud.delete_componente(db=db, componente_id=componente_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Componente no encontrado")
    await realtime_event_bus.publish(
        db_component.proyecto_id,
        "component.deleted",
        actor_id=current_user.id,
        component_id=db_component.id,
        payload={"component": {"id": str(db_component.id), "nombre": db_component.nombre}},
    )
    return {"ok": True}

# --- ENDPOINTS BUILDS ---

from fastapi import APIRouter
from typing import Annotated

from ...main_context import *


router = APIRouter(tags=["automation_functions"])

# --- ENDPOINTS FUNCIONES AUTOMATIZADAS ---

@router.get("/proyectos/{proyecto_id}/funciones/", response_model=List[schemas.FuncionAutomatizada])
async def read_funciones_proyecto(
    proyecto_id: UUID,
    suite_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    include_herencia: bool = False,
    include_componentes: bool = False,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.funciones", "read"))
):
    if include_herencia:
        return await crud.get_funciones_herencia(
            db,
            proyecto_id=proyecto_id,
            suite_id=suite_id,
            component_id=component_id,
            include_componentes=include_componentes,
            skip=skip,
            limit=limit,
        )
    return await crud.get_funciones_proyecto(
        db,
        proyecto_id=proyecto_id,
        suite_id=suite_id,
        component_id=component_id,
        include_componentes=include_componentes,
        skip=skip,
        limit=limit,
    )

@router.post("/funciones/", response_model=schemas.FuncionAutomatizada)
async def create_funcion_automatizada(
    funcion: schemas.FuncionAutomatizadaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.funciones", "edit"))
):
    try:
        funcion_data = funcion.model_copy(update={"creado_por": current_user.id})
        return await crud.create_funcion_automatizada(db, funcion=funcion_data)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="No se pudo crear la funcion: verifica proyecto, componente y datos obligatorios.") from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo crear la funcion por un error de base de datos: {exc.__class__.__name__}") from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo crear la funcion: {exc.__class__.__name__}") from exc

@router.get("/funciones/{master_id}/", response_model=schemas.FuncionAutomatizada)
async def read_funcion_automatizada(
    master_id: UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.funciones", "read"))
):
    funcion = await crud.get_funcion_automatizada(db, master_id=master_id)
    if not funcion:
        raise HTTPException(status_code=404, detail="Funcion no encontrada")
    return funcion

@router.get("/funciones/{master_id}/versions/", response_model=List[schemas.FuncionAutomatizada])
async def read_funcion_versions(
    master_id: UUID, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.funciones", "read"))
):
    return await crud.get_funcion_versions(db, master_id=master_id)

@router.put("/funciones/{master_id}/", response_model=schemas.FuncionAutomatizada)
async def update_funcion_automatizada(
    master_id: UUID,
    funcion_update: schemas.FuncionAutomatizadaUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.funciones", "edit"))
):
    try:
        funcion = await crud.update_funcion_automatizada(db, master_id=master_id, funcion_update=funcion_update, creado_por=current_user.id)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="No se pudo actualizar la funcion: verifica proyecto, componente y datos obligatorios.") from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo actualizar la funcion por un error de base de datos: {exc.__class__.__name__}") from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo actualizar la funcion: {exc.__class__.__name__}") from exc
    if not funcion:
        raise HTTPException(status_code=404, detail="Funcion no encontrada")
    return funcion

@router.delete("/funciones/{master_id}/")
async def delete_funcion_automatizada(
    master_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("automatizacion.funciones", "edit"))
):
    try:
        deleted = await crud.delete_funcion_automatizada(db, master_id=master_id)
    except SQLAlchemyError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo eliminar la funcion por un error de base de datos: {exc.__class__.__name__}") from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo eliminar la funcion: {exc.__class__.__name__}") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Funcion no encontrada")
    return {"ok": True}

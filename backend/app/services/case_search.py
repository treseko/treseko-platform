from typing import Optional
from uuid import UUID

from ..main_context import *


async def search_cases(
    proyecto_id: UUID,
    q: str,
    suite_id: Optional[UUID],
    component_id: Optional[UUID],
    build_id: Optional[UUID],
    prioridad: Optional[str],
    criticidad: Optional[str],
    estado: Optional[str],
    etiqueta: Optional[str],
    tag: Optional[str],
    include_archived: bool,
    skip: int,
    limit: Optional[int],
    db: AsyncSession,
    current_user: models.Usuario,
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if estado is not None and estado not in {item.value for item in models.EstadoCaso}:
        raise HTTPException(status_code=422, detail="Estado de caso invalido")
    if suite_id:
        suite_result = await db.execute(select(models.Suite).filter(models.Suite.id == suite_id, models.Suite.proyecto_id == proyecto_id))
        if not suite_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Suite no encontrada para el proyecto")
    if component_id:
        component_result = await db.execute(select(models.Componente).filter(models.Componente.id == component_id, models.Componente.proyecto_id == proyecto_id))
        if not component_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Componente no encontrado para el proyecto")
    if build_id:
        build_result = await db.execute(select(models.Build).filter(models.Build.id == build_id, models.Build.proyecto_id == proyecto_id))
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
        limit=limit,
    )
    return schemas.CasoSearchResponse(items=items, total=total, skip=skip, limit=limit)


async def resolve_dataset(caso_id: UUID, payload: schemas.DatasetResolveRequest, db: AsyncSession, current_user: models.Usuario):
    case_result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == caso_id))
    caso = case_result.scalar_one_or_none()
    if not caso:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    await access_control.require_project_access(db, current_user, caso.proyecto_id, "read")
    if payload.build_id:
        db_build = await access_control.require_build_access(db, current_user, payload.build_id, "read")
        if db_build.proyecto_id != caso.proyecto_id:
            raise HTTPException(status_code=404, detail="Build no encontrado para el caso")
    if payload.entorno_id:
        env_result = await db.execute(select(models.Entorno).filter(models.Entorno.id == payload.entorno_id, models.Entorno.proyecto_id == caso.proyecto_id))
        if not env_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Entorno no encontrado para el caso")
    if payload.dataset_id:
        dataset_result = await db.execute(
            select(models.EntornoDataset).join(models.Entorno, models.Entorno.id == models.EntornoDataset.entorno_id).filter(
                models.EntornoDataset.id == payload.dataset_id,
                models.Entorno.proyecto_id == caso.proyecto_id,
            )
        )
        if not dataset_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Dataset no encontrado para el caso")
    resolved = await crud.resolve_case_dataset(db, caso_id=caso_id, build_id=payload.build_id, entorno_id=payload.entorno_id, dataset_id=payload.dataset_id)
    if not resolved:
        raise HTTPException(status_code=404, detail="Caso no encontrado")
    return resolved

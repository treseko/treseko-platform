from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from .. import models, schemas
from ..repositories.suite_policy import lock_suite_project, require_editable_suite


async def validate_caso_component(db: AsyncSession, caso: schemas.CasoPruebaCreate):
    await lock_suite_project(db, caso.proyecto_id)
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
        try:
            await require_editable_suite(db, caso.proyecto_id, caso.suite_id, caso.componente_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

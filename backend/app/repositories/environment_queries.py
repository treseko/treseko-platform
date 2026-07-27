from .repository_context import *

async def get_entornos_proyecto(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.Entorno)
        .options(
            selectinload(models.Entorno.datasets),
            with_loader_criteria(models.EntornoDataset, models.EntornoDataset.activo == True),
        )
        .filter(
            models.Entorno.proyecto_id == proyecto_id,
            models.Entorno.activo == True,
        )
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def create_entorno(db: AsyncSession, entorno: schemas.EntornoCreate):
    db_entorno = models.Entorno(**entorno.model_dump())
    db.add(db_entorno)
    await db.commit()
    result = await db.execute(
        select(models.Entorno)
        .options(
            selectinload(models.Entorno.datasets),
            with_loader_criteria(models.EntornoDataset, models.EntornoDataset.activo == True),
        )
        .filter(models.Entorno.id == db_entorno.id)
    )
    return result.scalar_one()

from .repository_context import *

async def create_funcion_automatizada(db: AsyncSession, funcion: schemas.FuncionAutomatizadaCreate):
    master_id = uuid.uuid4()
    db_funcion = models.FuncionAutomatizada(
        master_id=master_id,
        **funcion.model_dump()
    )
    db.add(db_funcion)
    await db.commit()
    await db.refresh(db_funcion)
    return db_funcion

async def get_funcion_automatizada(db: AsyncSession, master_id: UUID):
    result = await db.execute(
        select(models.FuncionAutomatizada)
        .filter(models.FuncionAutomatizada.master_id == master_id)
        .order_by(models.FuncionAutomatizada.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()

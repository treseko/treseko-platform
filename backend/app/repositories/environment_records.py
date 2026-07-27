from .repository_context import *


async def update_entorno(db: AsyncSession, entorno_id: UUID, entorno_update: schemas.EntornoUpdate):
    result = await db.execute(select(models.Entorno).filter(models.Entorno.id == entorno_id))
    db_entorno = result.scalar_one_or_none()
    if not db_entorno:
        return None
    for field, value in entorno_update.model_dump(exclude_unset=True).items():
        setattr(db_entorno, field, value)
    await db.commit()
    result = await db.execute(
        select(models.Entorno)
        .options(
            selectinload(models.Entorno.datasets),
            with_loader_criteria(models.EntornoDataset, models.EntornoDataset.activo == True),
        )
        .filter(models.Entorno.id == entorno_id)
    )
    return result.scalar_one()

async def delete_entorno(db: AsyncSession, entorno_id: UUID):
    result = await db.execute(select(models.Entorno).filter(models.Entorno.id == entorno_id))
    db_entorno = result.scalar_one_or_none()
    if not db_entorno:
        return False
    db_entorno.activo = False
    await db.commit()
    return True

async def get_entorno_datasets(db: AsyncSession, entorno_id: UUID):
    result = await db.execute(
        select(models.EntornoDataset)
        .join(models.Entorno, models.Entorno.id == models.EntornoDataset.entorno_id)
        .filter(
            models.EntornoDataset.entorno_id == entorno_id,
            models.EntornoDataset.activo == True,
            models.Entorno.activo == True,
        )
        .order_by(models.EntornoDataset.es_default.desc(), models.EntornoDataset.fecha_creacion)
    )
    return result.scalars().all()

async def create_entorno_dataset(db: AsyncSession, entorno_id: UUID, dataset: schemas.EntornoDatasetCreate):
    entorno_result = await db.execute(select(models.Entorno).filter(models.Entorno.id == entorno_id, models.Entorno.activo == True))
    entorno = entorno_result.scalar_one_or_none()
    if not entorno:
        return None
    existing_result = await db.execute(
        select(models.EntornoDataset).filter(
            models.EntornoDataset.entorno_id == entorno_id,
            models.EntornoDataset.activo == True,
        )
    )
    existing = existing_result.scalars().all()
    make_default = dataset.es_default or len(existing) == 0
    if make_default:
        for item in existing:
            item.es_default = False
    reusable_result = await db.execute(
        select(models.EntornoDataset).filter(
            models.EntornoDataset.entorno_id == entorno_id,
            models.EntornoDataset.nombre == dataset.nombre,
            models.EntornoDataset.activo == False,
        )
    )
    reusable = reusable_result.scalar_one_or_none()
    if reusable:
        for field, value in dataset.model_dump(exclude={"es_default"}).items():
            setattr(reusable, field, value)
        reusable.activo = True
        reusable.es_default = make_default
        await db.commit()
        await db.refresh(reusable)
        return reusable
    db_dataset = models.EntornoDataset(
        entorno_id=entorno_id,
        **dataset.model_dump(exclude={"es_default"}),
        es_default=make_default,
    )
    db.add(db_dataset)
    await db.commit()
    await db.refresh(db_dataset)
    return db_dataset

async def update_entorno_dataset(db: AsyncSession, dataset_id: UUID, dataset_update: schemas.EntornoDatasetUpdate):
    result = await db.execute(select(models.EntornoDataset).filter(models.EntornoDataset.id == dataset_id))
    db_dataset = result.scalar_one_or_none()
    if not db_dataset:
        return None
    update_data = dataset_update.model_dump(exclude_unset=True)
    if update_data.get("es_default"):
        siblings = await db.execute(
            select(models.EntornoDataset).filter(
                models.EntornoDataset.entorno_id == db_dataset.entorno_id,
                models.EntornoDataset.id != db_dataset.id,
                models.EntornoDataset.activo == True,
            )
        )
        for sibling in siblings.scalars().all():
            sibling.es_default = False
    for field, value in update_data.items():
        setattr(db_dataset, field, value)
    await db.commit()
    await db.refresh(db_dataset)
    return db_dataset

async def delete_entorno_dataset(db: AsyncSession, dataset_id: UUID):
    result = await db.execute(select(models.EntornoDataset).filter(models.EntornoDataset.id == dataset_id))
    db_dataset = result.scalar_one_or_none()
    if not db_dataset:
        return False
    entorno_id = db_dataset.entorno_id
    was_default = db_dataset.es_default
    db_dataset.activo = False
    db_dataset.es_default = False
    await db.flush()
    if was_default:
        next_result = await db.execute(
            select(models.EntornoDataset)
            .filter(
                models.EntornoDataset.entorno_id == entorno_id,
                models.EntornoDataset.activo == True,
            )
            .order_by(models.EntornoDataset.fecha_creacion)
            .limit(1)
        )
        next_dataset = next_result.scalar_one_or_none()
        if next_dataset:
            next_dataset.es_default = True
    await db.commit()
    return True

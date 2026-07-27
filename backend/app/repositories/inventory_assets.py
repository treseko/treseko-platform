from .repository_context import *

async def get_dispositivos(db: AsyncSession, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.Dispositivo)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def create_dispositivo(db: AsyncSession, dispositivo: schemas.DispositivoBase):
    db_disp = models.Dispositivo(**dispositivo.model_dump())
    db.add(db_disp)
    await db.commit()
    await db.refresh(db_disp)
    return db_disp

async def get_nodos(db: AsyncSession, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.NodoEjecucion)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def create_nodo(db: AsyncSession, nodo: schemas.NodoEjecucionBase):
    db_nodo = models.NodoEjecucion(**nodo.model_dump())
    db.add(db_nodo)
    await db.commit()
    await db.refresh(db_nodo)
    return db_nodo

async def get_inventory_assets(
    db: AsyncSession,
    proyecto_id: UUID,
    skip: int = 0,
    limit: int = 100,
    tipo: Optional[str] = None,
    naturaleza: Optional[str] = None,
    estado: Optional[str] = None,
    criticidad: Optional[str] = None,
    parent_id: Optional[UUID] = None,
    q: Optional[str] = None,
):
    filters = [
        models.InventoryAsset.proyecto_id == proyecto_id,
        models.InventoryAsset.activo == True,
    ]
    if tipo:
        filters.append(models.InventoryAsset.tipo == tipo)
    if naturaleza:
        filters.append(models.InventoryAsset.naturaleza == naturaleza)
    if estado:
        filters.append(models.InventoryAsset.estado == estado)
    if criticidad:
        filters.append(models.InventoryAsset.criticidad == criticidad)
    if parent_id:
        filters.append(models.InventoryAsset.parent_id == parent_id)
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(or_(
            models.InventoryAsset.nombre.ilike(pattern),
            models.InventoryAsset.descripcion.ilike(pattern),
            models.InventoryAsset.ubicacion.ilike(pattern),
            models.InventoryAsset.responsable.ilike(pattern),
            models.InventoryAsset.serial.ilike(pattern),
            models.InventoryAsset.asset_tag.ilike(pattern),
        ))

    result = await db.execute(
        select(models.InventoryAsset)
        .options(selectinload(models.InventoryAsset.endpoints), selectinload(models.InventoryAsset.children))
        .filter(*filters)
        .order_by(models.InventoryAsset.fecha_creacion.desc(), models.InventoryAsset.nombre)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().unique().all()

async def get_inventory_asset(db: AsyncSession, asset_id: UUID):
    result = await db.execute(
        select(models.InventoryAsset)
        .options(selectinload(models.InventoryAsset.endpoints), selectinload(models.InventoryAsset.children))
        .filter(models.InventoryAsset.id == asset_id, models.InventoryAsset.activo == True)
    )
    return result.scalars().unique().one_or_none()

async def _inventory_parent_is_valid(db: AsyncSession, proyecto_id: UUID, parent_id: Optional[UUID], asset_id: Optional[UUID] = None):
    if parent_id is None:
        return True
    if asset_id and parent_id == asset_id:
        return False
    result = await db.execute(
        select(models.InventoryAsset.id).filter(
            models.InventoryAsset.id == parent_id,
            models.InventoryAsset.proyecto_id == proyecto_id,
            models.InventoryAsset.activo == True,
        )
    )
    return result.scalar_one_or_none() is not None

async def create_inventory_asset(db: AsyncSession, proyecto_id: UUID, asset: schemas.InventoryAssetCreate):
    if not await _inventory_parent_is_valid(db, proyecto_id, asset.parent_id):
        return None
    payload = asset.model_dump(exclude={"endpoints", "metadata"})
    db_asset = models.InventoryAsset(
        proyecto_id=proyecto_id,
        metadata_json=asset.metadata,
        **payload,
    )
    for endpoint in asset.endpoints:
        db_asset.endpoints.append(models.InventoryEndpoint(**endpoint.model_dump()))
    db.add(db_asset)
    await db.commit()
    return await get_inventory_asset(db, db_asset.id)

async def update_inventory_asset(db: AsyncSession, asset_id: UUID, asset_update: schemas.InventoryAssetUpdate):
    db_asset = await get_inventory_asset(db, asset_id)
    if not db_asset:
        return None
    update_data = asset_update.model_dump(exclude_unset=True)
    if "parent_id" in update_data:
        if not await _inventory_parent_is_valid(db, db_asset.proyecto_id, update_data["parent_id"], asset_id=asset_id):
            return False
    metadata_value = update_data.pop("metadata", None) if "metadata" in update_data else None
    for field, value in update_data.items():
        setattr(db_asset, field, value)
    if metadata_value is not None:
        db_asset.metadata_json = metadata_value
    await db.commit()
    return await get_inventory_asset(db, asset_id)

async def delete_inventory_asset(db: AsyncSession, asset_id: UUID):
    db_asset = await get_inventory_asset(db, asset_id)
    if not db_asset:
        return False
    db_asset.activo = False
    for endpoint in db_asset.endpoints:
        endpoint.activo = False
    children_result = await db.execute(
        select(models.InventoryAsset).filter(models.InventoryAsset.parent_id == asset_id)
    )
    for child in children_result.scalars().all():
        child.parent_id = None
    await db.commit()
    return True

async def create_inventory_endpoint(db: AsyncSession, asset_id: UUID, endpoint: schemas.InventoryEndpointCreate):
    db_asset = await get_inventory_asset(db, asset_id)
    if not db_asset:
        return None
    db_endpoint = models.InventoryEndpoint(asset_id=asset_id, **endpoint.model_dump())
    db.add(db_endpoint)
    await db.commit()
    await db.refresh(db_endpoint)
    return db_endpoint

async def update_inventory_endpoint(db: AsyncSession, endpoint_id: UUID, endpoint_update: schemas.InventoryEndpointUpdate):
    result = await db.execute(select(models.InventoryEndpoint).filter(models.InventoryEndpoint.id == endpoint_id))
    db_endpoint = result.scalar_one_or_none()
    if not db_endpoint:
        return None
    for field, value in endpoint_update.model_dump(exclude_unset=True).items():
        setattr(db_endpoint, field, value)
    await db.commit()
    await db.refresh(db_endpoint)
    return db_endpoint

async def delete_inventory_endpoint(db: AsyncSession, endpoint_id: UUID):
    result = await db.execute(select(models.InventoryEndpoint).filter(models.InventoryEndpoint.id == endpoint_id))
    db_endpoint = result.scalar_one_or_none()
    if not db_endpoint:
        return False
    db_endpoint.activo = False
    await db.commit()
    return True

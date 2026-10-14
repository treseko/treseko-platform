from .repository_context import *


async def _lock_inventory_project(db, project_id):
    # Serialize topology changes so concurrent A->B/B->A cannot form a cycle.
    await db.execute(select(models.Proyecto.id).where(models.Proyecto.id == project_id).with_for_update())


async def get_inventory_categories(db, proyecto_id):
    result = await db.execute(select(models.InventoryCategory).where(
        models.InventoryCategory.proyecto_id == proyecto_id
    ).order_by(models.InventoryCategory.nombre))
    return result.scalars().all()


async def create_inventory_category(db, proyecto_id, category):
    await _lock_inventory_project(db, proyecto_id)
    existing = await db.scalar(select(models.InventoryCategory.id).where(
        models.InventoryCategory.proyecto_id == proyecto_id,
        func.lower(models.InventoryCategory.nombre) == category.nombre.lower(),
    ))
    if existing:
        raise ValueError("Ya existe una categoría con ese nombre")
    created = models.InventoryCategory(proyecto_id=proyecto_id, nombre=category.nombre)
    db.add(created)
    await db.commit()
    await db.refresh(created)
    return created


async def _validate_category(db, project_id, category_id):
    if category_id and not await db.scalar(select(models.InventoryCategory.id).where(
        models.InventoryCategory.id == category_id,
        models.InventoryCategory.proyecto_id == project_id,
    )):
        raise ValueError("La categoría no existe en este proyecto")

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
        .execution_options(populate_existing=True)
    )
    return result.scalars().unique().one_or_none()

async def _inventory_parent_is_valid(db: AsyncSession, proyecto_id: UUID, parent_id: Optional[UUID], asset_id: Optional[UUID] = None):
    if parent_id is None:
        return True
    if asset_id and parent_id == asset_id:
        return False
    visited = {asset_id} if asset_id else set()
    while parent_id is not None:
        if parent_id in visited:
            return False
        visited.add(parent_id)
        result = await db.execute(select(models.InventoryAsset.parent_id).where(
            models.InventoryAsset.id == parent_id,
            models.InventoryAsset.proyecto_id == proyecto_id,
            models.InventoryAsset.activo == True,
        ))
        row = result.first()
        if row is None:
            return False
        parent_id = row[0]
    return True

async def create_inventory_asset(db: AsyncSession, proyecto_id: UUID, asset: schemas.InventoryAssetCreate):
    await _lock_inventory_project(db, proyecto_id)
    await _validate_category(db, proyecto_id, asset.categoria_id)
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
    project_id = await db.scalar(select(models.InventoryAsset.proyecto_id).where(models.InventoryAsset.id == asset_id))
    if project_id:
        await _lock_inventory_project(db, project_id)
    db_asset = await get_inventory_asset(db, asset_id)
    if not db_asset:
        return None
    update_data = asset_update.model_dump(exclude_unset=True)
    endpoints = update_data.pop("endpoints", None)
    if "categoria_id" in update_data and update_data["categoria_id"] != db_asset.categoria_id:
        await _validate_category(db, db_asset.proyecto_id, update_data["categoria_id"])
    if "parent_id" in update_data:
        if not await _inventory_parent_is_valid(db, db_asset.proyecto_id, update_data["parent_id"], asset_id=asset_id):
            return False
    # Validate the complete endpoint replacement before changing any field.
    originals = {endpoint.id: endpoint for endpoint in db_asset.endpoints if endpoint.activo}
    endpoint_ids = [endpoint["id"] for endpoint in endpoints or [] if endpoint.get("id")]
    if len(endpoint_ids) != len(set(endpoint_ids)) or any(key not in originals for key in endpoint_ids):
        raise ValueError("Los endpoints deben pertenecer al activo y no repetirse")
    metadata_value = update_data.pop("metadata", None) if "metadata" in update_data else None
    for field, value in update_data.items():
        setattr(db_asset, field, value)
    if metadata_value is not None:
        db_asset.metadata_json = metadata_value
    if endpoints is not None:
        retained = set(endpoint_ids)
        for key, endpoint in originals.items():
            if key not in retained:
                endpoint.activo = False
        for values in endpoints:
            values = dict(values)
            endpoint_id = values.pop("id", None)
            if endpoint_id:
                for field, value in values.items():
                    setattr(originals[endpoint_id], field, value)
            else:
                db_asset.endpoints.append(models.InventoryEndpoint(**values))
    await db.commit()
    return await get_inventory_asset(db, asset_id)

async def delete_inventory_asset(db: AsyncSession, asset_id: UUID):
    project_id = await db.scalar(select(models.InventoryAsset.proyecto_id).where(models.InventoryAsset.id == asset_id))
    if project_id:
        await _lock_inventory_project(db, project_id)
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

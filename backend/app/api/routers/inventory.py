from fastapi import APIRouter

from ...main_context import *


router = APIRouter(tags=["inventory"])

# --- ENDPOINTS INFRAESTRUCTURA ---

@router.get("/infraestructura/dispositivos/", response_model=List[schemas.Dispositivo])
async def read_dispositivos(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.dispositivos", "read"))
):
    return await crud.get_dispositivos(db, skip=skip, limit=limit)

@router.post("/infraestructura/dispositivos/", response_model=schemas.Dispositivo)
async def create_dispositivo(
    dispositivo: schemas.DispositivoBase, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.dispositivos", "edit"))
):
    return await crud.create_dispositivo(db, dispositivo=dispositivo)

@router.get("/infraestructura/nodos/", response_model=List[schemas.NodoEjecucion])
async def read_nodos(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.nodos", "read"))
):
    return await crud.get_nodos(db, skip=skip, limit=limit)


def _asset_response(asset):
    return {
        "id": asset.id,
        "proyecto_id": asset.proyecto_id,
        "categoria_id": asset.categoria_id,
        "parent_id": asset.parent_id,
        "nombre": asset.nombre,
        "tipo": asset.tipo,
        "naturaleza": asset.naturaleza,
        "estado": asset.estado,
        "criticidad": asset.criticidad,
        "descripcion": asset.descripcion,
        "ubicacion": asset.ubicacion,
        "responsable": asset.responsable,
        "fabricante": asset.fabricante,
        "modelo": asset.modelo,
        "serial": asset.serial,
        "asset_tag": asset.asset_tag,
        "sistema_operativo": asset.sistema_operativo,
        "metadata": asset.metadata_json or {},
        "activo": asset.activo,
        "endpoints": [endpoint for endpoint in asset.endpoints if endpoint.activo],
        "children_count": len([child for child in asset.children if child.activo]),
        "fecha_creacion": asset.fecha_creacion,
        "fecha_actualizacion": asset.fecha_actualizacion,
    }


@router.get("/infraestructura/activos/", response_model=List[schemas.InventoryAsset])
async def read_inventory_assets(
    proyecto_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    tipo: Optional[str] = None,
    naturaleza: Optional[str] = None,
    estado: Optional[str] = None,
    criticidad: Optional[str] = None,
    parent_id: Optional[UUID] = None,
    q: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.categorias", "read"))
):
    assets = await crud.get_inventory_assets(
        db,
        proyecto_id=proyecto_id,
        skip=skip,
        limit=limit,
        tipo=tipo,
        naturaleza=naturaleza,
        estado=estado,
        criticidad=criticidad,
        parent_id=parent_id,
        q=q,
    )
    return [_asset_response(asset) for asset in assets]


@router.post("/infraestructura/activos/", response_model=schemas.InventoryAsset)
async def create_inventory_asset(
    proyecto_id: UUID,
    asset: schemas.InventoryAssetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.categorias", "edit"))
):
    created = await crud.create_inventory_asset(db, proyecto_id=proyecto_id, asset=asset)
    if created is None:
        raise HTTPException(status_code=422, detail="parent_id invalido o pertenece a otro proyecto")
    return _asset_response(created)


@router.get("/infraestructura/activos/{asset_id}", response_model=schemas.InventoryAsset)
async def read_inventory_asset(
    asset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.categorias", "read"))
):
    asset = await crud.get_inventory_asset(db, asset_id=asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Activo de inventario no encontrado")
    return _asset_response(asset)


@router.patch("/infraestructura/activos/{asset_id}", response_model=schemas.InventoryAsset)
async def update_inventory_asset(
    asset_id: UUID,
    asset_update: schemas.InventoryAssetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.categorias", "edit"))
):
    updated = await crud.update_inventory_asset(db, asset_id=asset_id, asset_update=asset_update)
    if updated is False:
        raise HTTPException(status_code=422, detail="parent_id invalido o pertenece a otro proyecto")
    if not updated:
        raise HTTPException(status_code=404, detail="Activo de inventario no encontrado")
    return _asset_response(updated)


@router.delete("/infraestructura/activos/{asset_id}")
async def delete_inventory_asset(
    asset_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.categorias", "edit"))
):
    deleted = await crud.delete_inventory_asset(db, asset_id=asset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Activo de inventario no encontrado")
    return {"ok": True}


@router.post("/infraestructura/activos/{asset_id}/endpoints/", response_model=schemas.InventoryEndpoint)
async def create_inventory_endpoint(
    asset_id: UUID,
    endpoint: schemas.InventoryEndpointCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.categorias", "edit"))
):
    created = await crud.create_inventory_endpoint(db, asset_id=asset_id, endpoint=endpoint)
    if not created:
        raise HTTPException(status_code=404, detail="Activo de inventario no encontrado")
    return created


@router.patch("/infraestructura/endpoints/{endpoint_id}", response_model=schemas.InventoryEndpoint)
async def update_inventory_endpoint(
    endpoint_id: UUID,
    endpoint_update: schemas.InventoryEndpointUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.categorias", "edit"))
):
    updated = await crud.update_inventory_endpoint(db, endpoint_id=endpoint_id, endpoint_update=endpoint_update)
    if not updated:
        raise HTTPException(status_code=404, detail="Endpoint de inventario no encontrado")
    return updated


@router.delete("/infraestructura/endpoints/{endpoint_id}")
async def delete_inventory_endpoint(
    endpoint_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("inventario.categorias", "edit"))
):
    deleted = await crud.delete_inventory_endpoint(db, endpoint_id=endpoint_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Endpoint de inventario no encontrado")
    return {"ok": True}

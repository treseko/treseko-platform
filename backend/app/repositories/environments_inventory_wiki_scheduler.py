from .legacy_common import *
from ..services.error_sanitizer import sanitize_external_error


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

# --- INFRAESTRUCTURA (DISPOSITIVOS Y NODOS) ---
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

# --- WIKI ---
async def get_wiki_pages_proyecto(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.WikiPage)
        .filter(models.WikiPage.proyecto_id == proyecto_id)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def get_wiki_page(db: AsyncSession, page_id: UUID):
    result = await db.execute(select(models.WikiPage).filter(models.WikiPage.id == page_id))
    return result.scalar_one_or_none()

async def create_wiki_page(db: AsyncSession, page: schemas.WikiPageCreate):
    db_page = models.WikiPage(**page.model_dump())
    db.add(db_page)
    await db.flush()
    # Crear entrada inicial en el historial
    db_history = models.WikiHistory(
        page_id=db_page.id,
        contenido=db_page.contenido,
        editado_por=db_page.creado_por,
        comentario_cambio="Creación inicial"
    )
    db.add(db_history)
    await db.commit()
    await db.refresh(db_page)
    return db_page

async def update_wiki_page(db: AsyncSession, page_id: UUID, content: str, user_id: UUID, comment: str):
    result = await db.execute(select(models.WikiPage).filter(models.WikiPage.id == page_id))
    db_page = result.scalar_one_or_none()
    if not db_page: return None
    db_page.contenido = content
    db_page.ultima_edicion_por = user_id
    db_history = models.WikiHistory(
        page_id=page_id,
        contenido=content,
        editado_por=user_id,
        comentario_cambio=comment
    )
    db.add(db_history)
    await db.commit()
    await db.refresh(db_page)
    return db_page

async def update_wiki_page_data(db: AsyncSession, page_id: UUID, page_update: schemas.WikiPageUpdate, user_id: UUID):
    result = await db.execute(select(models.WikiPage).filter(models.WikiPage.id == page_id))
    db_page = result.scalar_one_or_none()
    if not db_page:
        return None
    update_data = page_update.model_dump(exclude_unset=True)
    if "titulo" in update_data:
        db_page.titulo = update_data["titulo"]
    if "contenido" in update_data:
        db_page.contenido = update_data["contenido"]
    db_page.ultima_edicion_por = user_id
    db_history = models.WikiHistory(
        page_id=page_id,
        contenido=db_page.contenido,
        editado_por=user_id,
        comentario_cambio=update_data.get("comentario_cambio") or "Edicion de contenido",
    )
    db.add(db_history)
    await db.commit()
    await db.refresh(db_page)
    return db_page

async def get_wiki_history(db: AsyncSession, page_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.WikiHistory)
        .filter(models.WikiHistory.page_id == page_id)
        .order_by(models.WikiHistory.fecha_edicion.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def delete_wiki_page(db: AsyncSession, page_id: UUID):
    result = await db.execute(select(models.WikiPage).filter(models.WikiPage.id == page_id))
    db_page = result.scalar_one_or_none()
    if not db_page:
        return False
    await db.delete(db_page)
    await db.commit()
    return True

# --- SCHEDULER ---
async def get_scheduled_runs_proyecto(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.ScheduledRun)
        .filter(models.ScheduledRun.proyecto_id == proyecto_id)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def create_scheduled_run(db: AsyncSession, schedule: schemas.ScheduledRunCreate):
    db_schedule = models.ScheduledRun(**schedule.model_dump())
    db.add(db_schedule)
    await db.commit()
    await db.refresh(db_schedule)
    return db_schedule

# --- AUDIT LOG ---
MAX_AUDIT_DETAILS_BYTES = 64 * 1024
AUDIT_REDACTED_VALUE = "[redacted]"
AUDIT_SECRET_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "cookie",
    "password",
    "refresh_token",
    "secret",
    "set_cookie",
    "token",
}


def _audit_detail_key_is_secret(key: Any) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", "_", str(key or "").strip().lower()).strip("_")
    return normalized in AUDIT_SECRET_KEYS or normalized.endswith(("_api_key", "_password", "_secret", "_token"))


def _sanitize_audit_details(value: Any, *, depth: int = 0) -> Any:
    if depth > 8:
        return "[max-depth]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, str):
        return sanitize_external_error(value, max_len=1000)
    if isinstance(value, list):
        return [_sanitize_audit_details(item, depth=depth + 1) for item in value[:200]]
    if isinstance(value, dict):
        sanitized = {}
        for key, item in list(value.items())[:200]:
            safe_key = str(key)[:120]
            sanitized[safe_key] = AUDIT_REDACTED_VALUE if _audit_detail_key_is_secret(key) else _sanitize_audit_details(item, depth=depth + 1)
        return sanitized
    return sanitize_external_error(value, max_len=1000)


def _bounded_audit_details(value: Optional[dict]) -> dict:
    sanitized = _sanitize_audit_details(value or {})
    encoded = json.dumps(sanitized, ensure_ascii=False, default=str, separators=(",", ":")).encode("utf-8")
    if len(encoded) <= MAX_AUDIT_DETAILS_BYTES:
        return sanitized if isinstance(sanitized, dict) else {"value": sanitized}
    return {"truncated": True, "reason": "audit details exceeded size limit"}


async def create_audit_log(
    db: AsyncSession,
    usuario_id: Optional[UUID],
    accion: str,
    recurso: str,
    recurso_id: Optional[UUID] = None,
    detalles: Optional[dict] = None,
    ip_address: Optional[str] = None
):
    db_log = models.AuditLog(
        usuario_id=usuario_id,
        accion=accion,
        recurso=recurso,
        recurso_id=recurso_id,
        detalles=_bounded_audit_details(detalles),
        ip_address=ip_address
    )
    db.add(db_log)
    await db.commit()
    return db_log

async def get_audit_logs(db: AsyncSession, skip: int = 0, limit: int = 100, usuario_id: Optional[UUID] = None):
    query = select(models.AuditLog).order_by(models.AuditLog.fecha.desc())
    if usuario_id:
        query = query.filter(models.AuditLog.usuario_id == usuario_id)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()

# --- FUNCIONES AUTOMATIZADAS ---
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

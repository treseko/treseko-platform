from .legacy_common import *


async def clone_caso(db: AsyncSession, caso_id: UUID, suite_id: Optional[UUID] = None):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(models.CasoPrueba)
        .options(selectinload(models.CasoPrueba.pasos))
        .filter(models.CasoPrueba.id == caso_id)
    )
    original = result.scalar_one_or_none()
    if not original:
        return None

    target_suite_id = suite_id or original.suite_id
    if target_suite_id:
        suite_result = await db.execute(select(models.Suite).filter(models.Suite.id == target_suite_id, models.Suite.activo == True))
        target_suite = suite_result.scalar_one_or_none()
        if not target_suite:
            raise ValueError("La suite destino no existe o esta inactiva")
        if target_suite.proyecto_id != original.proyecto_id:
            raise ValueError("La suite destino no pertenece al proyecto del caso")
        if original.componente_id and target_suite.componente_id != original.componente_id:
            raise ValueError("No se puede copiar un caso a una suite de otro componente")
        if not original.componente_id and target_suite.componente_id:
            raise ValueError("No se puede copiar un caso sin componente a una suite con componente")
    
    cloned = models.CasoPrueba(
        master_id=uuid.uuid4(),
        codigo=await generate_case_code(db),
        proyecto_id=original.proyecto_id,
        suite_id=target_suite_id,
        componente_id=original.componente_id,
        titulo=original.titulo,
        descripcion=original.descripcion,
        precondiciones=original.precondiciones,
        postcondiciones=original.postcondiciones,
        version=1,
        prioridad=original.prioridad,
        criticidad=original.criticidad,
        tipo_prueba=original.tipo_prueba,
        estado_caso=original.estado_caso,
        dataset=original.dataset,
        etiquetas=original.etiquetas or [],
        script_automatizado=original.script_automatizado,
        framework=original.framework,
        creado_por=original.creado_por
    )
    db.add(cloned)
    await db.flush()
    
    for paso in original.pasos:
        new_paso = models.PasoPrueba(
            caso_id=cloned.id,
            numero_paso=paso.numero_paso,
            accion=paso.accion,
            datos=paso.datos,
            resultado_esperado=paso.resultado_esperado,
            metadata_ai=paso.metadata_ai
        )
        db.add(new_paso)
    
    await db.commit()
    await db.refresh(cloned)
    return cloned

async def get_caso_versions(db: AsyncSession, master_id: UUID):
    result = await db.execute(
        select(models.CasoPrueba)
        .options(selectinload(models.CasoPrueba.pasos))
        .filter(models.CasoPrueba.master_id == master_id)
        .order_by(models.CasoPrueba.version.desc())
    )
    return result.scalars().all()

async def search_casos(
    db: AsyncSession, 
    proyecto_id: UUID, 
    query: str = "",
    suite_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    build_id: Optional[UUID] = None,
    prioridad: Optional[str] = None,
    criticidad: Optional[str] = None,
    estado: Optional[str] = None,
    etiqueta: Optional[str] = None,
    include_archived: bool = False,
    skip: int = 0, 
    limit: Optional[int] = None
) -> tuple[list, int]:
    await ensure_case_codes(db, proyecto_id)
    base_query = select(models.CasoPrueba).filter(
        models.CasoPrueba.proyecto_id == proyecto_id,
        *_visible_case_filter()
    )
    
    if query:
        base_query = base_query.filter(
            (models.CasoPrueba.titulo.ilike(f"%{query}%")) | 
            (models.CasoPrueba.descripcion.ilike(f"%{query}%")) |
            (models.CasoPrueba.codigo.ilike(f"%{query}%")) |
            (cast(models.CasoPrueba.etiquetas, String).ilike(f"%{query}%"))
        )
    
    if suite_id:
        base_query = base_query.filter(models.CasoPrueba.suite_id == suite_id)

    if component_id:
        base_query = base_query.filter(models.CasoPrueba.componente_id == component_id)

    if build_id:
        build_case_ids = select(models.BuildCaso.caso_id).filter(models.BuildCaso.build_id == build_id)
        base_query = base_query.filter(models.CasoPrueba.id.in_(build_case_ids))
    
    if prioridad:
        base_query = base_query.filter(models.CasoPrueba.prioridad == prioridad)
    
    if criticidad:
        base_query = base_query.filter(models.CasoPrueba.criticidad == criticidad)
    
    if estado:
        base_query = base_query.filter(models.CasoPrueba.estado_caso == estado)
    elif not include_archived:
        base_query = base_query.filter(models.CasoPrueba.estado_caso != models.EstadoCaso.ARCHIVADO)

    if etiqueta:
        base_query = base_query.filter(cast(models.CasoPrueba.etiquetas, String).ilike(f"%{etiqueta}%"))
    
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()
    
    items_query = base_query.offset(skip)
    if limit is not None:
        items_query = items_query.limit(limit)
    items_result = await db.execute(items_query)
    items = items_result.scalars().all()
    
    return items, total

async def update_caso_metadata(db: AsyncSession, caso_id: UUID, update: schemas.CasoPruebaUpdateMetadata):
    db_caso = await get_caso(db, caso_id)
    if not db_caso:
        return None
    update_data = update.model_dump(exclude_unset=True)
    estado_caso = update_data.pop("estado_caso", None)
    for field, value in update_data.items():
        setattr(db_caso, field, value)

    if estado_caso is not None:
        master_wide_states = {models.EstadoCaso.ARCHIVADO, models.EstadoCaso.ACTIVO}
        if estado_caso in master_wide_states or db_caso.estado_caso == models.EstadoCaso.ARCHIVADO:
            versions_result = await db.execute(
                select(models.CasoPrueba).filter(
                    models.CasoPrueba.master_id == db_caso.master_id,
                    *_visible_case_filter()
                )
            )
            for version in versions_result.scalars().all():
                version.estado_caso = estado_caso
        else:
            db_caso.estado_caso = estado_caso
    await db.commit()
    await db.refresh(db_caso)
    return db_caso

async def move_caso(db: AsyncSession, caso_id: UUID, suite_id: UUID):
    db_caso = await get_caso(db, caso_id)
    if not db_caso:
        return None
    suite_result = await db.execute(
        select(models.Suite).filter(
            models.Suite.id == suite_id,
            models.Suite.activo == True
        )
    )
    target_suite = suite_result.scalar_one_or_none()
    if not target_suite:
        raise ValueError("La suite destino no existe o esta inactiva")
    if target_suite.proyecto_id != db_caso.proyecto_id:
        raise ValueError("La suite destino no pertenece al proyecto del caso")
    if db_caso.componente_id and target_suite.componente_id != db_caso.componente_id:
        raise ValueError("No se puede mover un caso a una suite de otro componente")
    if not db_caso.componente_id and target_suite.componente_id:
        raise ValueError("No se puede mover un caso sin componente a una suite con componente")
    db_caso.suite_id = suite_id
    await db.commit()
    await db.refresh(db_caso)
    return db_caso

def _normalize_dataset(dataset: Any) -> List[Dict[str, str]]:
    if not dataset:
        return []
    if isinstance(dataset, list):
        normalized = []
        for item in dataset:
            if isinstance(item, dict):
                if "key" in item:
                    normalized.append({"key": str(item.get("key") or ""), "value": str(item.get("value") or "")})
                else:
                    normalized.extend({"key": str(key), "value": str(value)} for key, value in item.items())
        return [item for item in normalized if item["key"]]
    if isinstance(dataset, dict):
        return [{"key": str(key), "value": str(value)} for key, value in dataset.items()]
    return [{"key": "contexto", "value": str(dataset)}]

def _resolve_placeholders(value: str, variables: Dict[str, str]) -> str:
    def replace(match: re.Match) -> str:
        key = match.group(1)
        return str(variables.get(key, match.group(0)))
    return PLACEHOLDER_RE.sub(replace, value or "")


def _case_variable_aliases(case_variables: Dict[str, str]) -> Dict[str, str]:
    aliases = {}
    lower_lookup = {str(key).strip().lower(): str(value) for key, value in (case_variables or {}).items()}
    case_url = (
        lower_lookup.get("base_url")
        or lower_lookup.get("url")
        or lower_lookup.get("target_url")
        or lower_lookup.get("app_url")
        or lower_lookup.get("site_url")
    )
    contexto = lower_lookup.get("contexto")
    if not case_url and contexto and re.match(r"^https?://", contexto.strip(), re.IGNORECASE):
        case_url = contexto.strip()
    if case_url:
        aliases.update({
            "base_url": case_url,
            "url": case_url,
            "BASE_URL": case_url,
            "URL": case_url,
            "CASE.BASE_URL": case_url,
            "CASE.URL": case_url,
        })
    aliases.update({f"CASE.{key}": value for key, value in (case_variables or {}).items()})
    return aliases

async def resolve_case_dataset(
    db: AsyncSession,
    caso_id: UUID,
    build_id: Optional[UUID] = None,
    entorno_id: Optional[UUID] = None,
    dataset_id: Optional[UUID] = None,
):
    result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == caso_id))
    caso = result.scalar_one_or_none()
    if not caso:
        return None

    entorno = None
    if entorno_id:
        entorno_result = await db.execute(
            select(models.Entorno).filter(
                models.Entorno.id == entorno_id,
                models.Entorno.proyecto_id == caso.proyecto_id,
                models.Entorno.activo == True,
            )
        )
        entorno = entorno_result.scalar_one_or_none()

    native_env = {}
    env_variables = {}
    env_dataset = None
    dataset_variables = {}
    component_variables = {}
    if entorno:
        native_env = {
            "ENV.ID": str(entorno.id),
            "ENV.NAME": entorno.nombre or "",
            "ENV.BASE_URL": entorno.url or "",
            "ENV.URL": entorno.url or "",
            "ENV.VERSION": entorno.version or "",
            "ENV.STATUS": entorno.status or "",
        }
        raw_env_variables = {str(key): str(value) for key, value in (entorno.variables or {}).items()}
        env_variables = {
            **raw_env_variables,
            **{f"ENV.{key}": value for key, value in raw_env_variables.items()},
        }
        if dataset_id:
            dataset_result = await db.execute(
                select(models.EntornoDataset).filter(
                    models.EntornoDataset.id == dataset_id,
                    models.EntornoDataset.entorno_id == entorno.id,
                    models.EntornoDataset.activo == True,
                )
            )
            env_dataset = dataset_result.scalar_one_or_none()
        else:
            dataset_result = await db.execute(
                select(models.EntornoDataset)
                .filter(
                    models.EntornoDataset.entorno_id == entorno.id,
                    models.EntornoDataset.activo == True,
                )
                .order_by(models.EntornoDataset.es_default.desc(), models.EntornoDataset.fecha_creacion)
            )
            env_dataset = dataset_result.scalars().first()
        if dataset_id and not env_dataset:
            raise ValueError("El dataset seleccionado no pertenece al ambiente o esta inactivo")
        raw_dataset_variables = {str(key): str(value) for key, value in ((env_dataset.variables if env_dataset else {}) or {}).items()}
        dataset_variables = {
            **raw_dataset_variables,
            **{f"DATASET.{key}": value for key, value in raw_dataset_variables.items()},
        }

    if caso.componente_id:
        component_result = await db.execute(
            select(models.Componente).filter(
                models.Componente.id == caso.componente_id,
                models.Componente.proyecto_id == caso.proyecto_id,
            )
        )
        componente = component_result.scalar_one_or_none()
        if componente:
            raw_component_variables = {str(key): str(value) for key, value in (componente.variables or {}).items()}
            component_variables = {
                **raw_component_variables,
                **{f"COMPONENT.{key}": value for key, value in raw_component_variables.items()},
                "COMPONENT.ID": str(componente.id),
                "COMPONENT.CODE": componente.codigo or "",
                "COMPONENT.NAME": componente.nombre or "",
            }

    variable_context = {
        **native_env,
        **env_variables,
        **component_variables,
        **dataset_variables,
    }

    dataset_original = _normalize_dataset(caso.dataset)
    dataset_resuelto = [
        {
            "key": item["key"],
            "value": _resolve_placeholders(item["value"], variable_context),
        }
        for item in dataset_original
    ]
    case_dataset_variables = {item["key"]: item["value"] for item in dataset_resuelto}
    variables_resueltas = {
        **variable_context,
        **case_dataset_variables,
        **_case_variable_aliases(case_dataset_variables),
    }
    environment_dataset_resuelto = [
        {"key": key, "value": value}
        for key, value in ((env_dataset.variables if env_dataset else {}) or {}).items()
    ]
    combined_dataset = [
        *environment_dataset_resuelto,
        *dataset_resuelto,
    ]
    return {
        "caso_id": caso.id,
        "entorno_id": entorno.id if entorno else None,
        "entorno_nombre": entorno.nombre if entorno else None,
        "dataset_id": env_dataset.id if env_dataset else None,
        "dataset_nombre": env_dataset.nombre if env_dataset else None,
        "dataset_original": dataset_original,
        "dataset_ambiente": environment_dataset_resuelto,
        "dataset_caso_resuelto": dataset_resuelto,
        "variables_ambiente": {**native_env, **env_variables},
        "variables_componente": component_variables,
        "variables_configuradas": {},
        "variables_resueltas": variables_resueltas,
        "dataset_resuelto": combined_dataset,
    }

# --- TEST RUNS ---

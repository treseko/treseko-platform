import copy
import json

from .repository_context import *
from .dataset_variables import native_environment_variables
from .suites_cases import (
    _ensure_case_code_available,
    clone_case_traceability,
    generate_case_code,
    generate_unique_case_title,
    get_caso,
    update_caso_metadata_versioned,
)


class CaseArchiveConflict(ValueError):
    """Raised when a case is still part of the active evaluation scope."""


class CaseOrganizationConflict(ValueError):
    """Raised when the client reordered a stale sibling snapshot."""


def organization_revision(rows) -> str:
    payload = [[str(row.id), str(row.suite_id) if row.suite_id else None, int(row.orden or 0)] for row in rows]
    value = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    digest = 2166136261
    for char in value:
        digest ^= ord(char)
        digest = (digest * 16777619) & 0xffffffff
    return f"{digest:08x}"


def organization_lock_suite_ids(source_suite_id, destination_suite_id):
    return tuple(sorted({suite_id for suite_id in (source_suite_id, destination_suite_id) if suite_id is not None}, key=str))

async def _active_builds_for_case_master(db: AsyncSession, master_id: UUID):
    versions_result = await db.execute(
        select(models.CasoPrueba.id).filter(models.CasoPrueba.master_id == master_id)
    )
    version_ids = versions_result.scalars().all()
    if not version_ids:
        return []

    builds_result = await db.execute(
        select(models.Build.id, models.Build.nombre)
        .join(models.BuildCaso, models.BuildCaso.build_id == models.Build.id)
        .filter(
            models.BuildCaso.caso_id.in_(version_ids),
            models.Build.estado == "ACTIVA",
            models.Build.activo.is_(True),
        )
        .order_by(models.Build.nombre)
    )
    return builds_result.all()


async def clone_caso(db: AsyncSession, caso_id: UUID, suite_id: Optional[UUID] = None):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(models.CasoPrueba)
        .options(
            selectinload(models.CasoPrueba.pasos)
            .selectinload(models.PasoPrueba.attachments)
            .selectinload(models.PasoAttachment.attachment)
        )
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

    cloned_code = await generate_case_code(db)
    await _ensure_case_code_available(db, original.proyecto_id, cloned_code)
    cloned_title = await generate_unique_case_title(
        db, target_suite_id, original.titulo, for_copy=True
    )

    cloned = models.CasoPrueba(
        master_id=uuid.uuid4(),
        codigo=cloned_code,
        proyecto_id=original.proyecto_id,
        suite_id=target_suite_id,
        componente_id=original.componente_id,
        titulo=cloned_title,
        descripcion=original.descripcion,
        precondiciones=original.precondiciones,
        postcondiciones=original.postcondiciones,
        version=1,
        prioridad=original.prioridad,
        criticidad=original.criticidad,
        tipo_prueba=original.tipo_prueba,
        formato_prueba=original.formato_prueba,
        estado_caso=original.estado_caso,
        dataset=copy.deepcopy(original.dataset),
        configuracion_chatbot=copy.deepcopy(original.configuracion_chatbot or {}),
        configuracion_api=copy.deepcopy(original.configuracion_api or {}),
        etiquetas=copy.deepcopy(original.etiquetas or []),
        script_automatizado=original.script_automatizado,
        framework=original.framework,
        creado_por=original.creado_por
    )
    db.add(cloned)
    await db.flush()
    await clone_case_traceability(db, original.master_id, cloned.master_id)

    cloned_steps_by_original_id = {}
    for paso in original.pasos:
        new_paso = models.PasoPrueba(
            caso_id=cloned.id,
            numero_paso=paso.numero_paso,
            accion=paso.accion,
            datos=paso.datos,
            resultado_esperado=paso.resultado_esperado,
            metadata_ai=copy.deepcopy(paso.metadata_ai),
        )
        db.add(new_paso)
        cloned_steps_by_original_id[paso.id] = new_paso

    if cloned_steps_by_original_id:
        await db.flush()
        attachment_result = await db.execute(
            select(models.PasoAttachment).filter(
                models.PasoAttachment.paso_id.in_(cloned_steps_by_original_id)
            )
        )
        for original_link in attachment_result.scalars().all():
            db.add(models.PasoAttachment(
                paso_id=cloned_steps_by_original_id[original_link.paso_id].id,
                attachment_id=original_link.attachment_id,
                tipo=original_link.tipo,
            ))

    await db.commit()
    await db.refresh(cloned)
    return cloned

async def get_caso_versions(db: AsyncSession, master_id: UUID):
    result = await db.execute(
        select(models.CasoPrueba)
        .options(
            selectinload(models.CasoPrueba.pasos)
            .selectinload(models.PasoPrueba.attachments)
            .selectinload(models.PasoAttachment.attachment)
        )
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

    items_query = base_query.order_by(
        models.CasoPrueba.suite_id,
        models.CasoPrueba.orden,
        models.CasoPrueba.id,
    ).offset(skip)
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

    if estado_caso == models.EstadoCaso.ARCHIVADO and db_caso.estado_caso != models.EstadoCaso.ARCHIVADO:
        active_builds = await _active_builds_for_case_master(db, db_caso.master_id)
        if active_builds:
            build_names = ", ".join(nombre for _build_id, nombre in active_builds)
            raise CaseArchiveConflict(
                "No se puede archivar la prueba porque está asignada a la build activa"
                + (f" ({build_names}). Retírala de esa build antes de archivarla." if build_names else ".")
            )

    updated = db_caso
    if update_data:
        updated = await update_caso_metadata_versioned(
            db=db,
            caso_id=caso_id,
            update=schemas.CasoPruebaUpdateMetadata(**update_data),
        )

    if estado_caso is not None:
        master_wide_states = {models.EstadoCaso.ARCHIVADO, models.EstadoCaso.ACTIVO}
        if estado_caso in master_wide_states or updated.estado_caso == models.EstadoCaso.ARCHIVADO:
            versions_result = await db.execute(
                select(models.CasoPrueba).filter(
                    models.CasoPrueba.master_id == updated.master_id,
                    *_visible_case_filter()
                )
            )
            for version in versions_result.scalars().all():
                version.estado_caso = estado_caso
        else:
            updated.estado_caso = estado_caso
    await db.commit()
    await db.refresh(updated)
    return updated

async def move_caso(db: AsyncSession, caso_id: UUID, suite_id: UUID):
    db_caso = await get_caso(db, caso_id)
    if not db_caso:
        return None
    if not db_caso.activo or db_caso.estado_caso == models.EstadoCaso.ARCHIVADO:
        raise ValueError("No se pueden mover casos archivados o inactivos")
    if db_caso.suite_id:
        source_result = await db.execute(select(models.Suite).where(models.Suite.id == db_caso.suite_id))
        source_suite = source_result.scalar_one_or_none()
        if not source_suite or not source_suite.activo or source_suite.archivado:
            raise ValueError("La suite origen no existe o esta inactiva o archivada")
    suite_result = await db.execute(
        select(models.Suite).filter(
            models.Suite.id == suite_id,
            models.Suite.activo == True,
            models.Suite.archivado == False,
        )
    )
    target_suite = suite_result.scalar_one_or_none()
    if not target_suite:
        raise ValueError("La suite destino no existe o esta inactiva o archivada")
    if target_suite.proyecto_id != db_caso.proyecto_id:
        raise ValueError("La suite destino no pertenece al proyecto del caso")
    if db_caso.componente_id and target_suite.componente_id != db_caso.componente_id:
        raise ValueError("No se puede mover un caso a una suite de otro componente")
    if not db_caso.componente_id and target_suite.componente_id:
        raise ValueError("No se puede mover un caso sin componente a una suite con componente")
    sibling_result = await db.execute(select(models.CasoPrueba).where(
        models.CasoPrueba.proyecto_id == db_caso.proyecto_id,
        models.CasoPrueba.suite_id.in_({db_caso.suite_id, suite_id}),
        models.CasoPrueba.activo == True,
        models.CasoPrueba.estado_caso != models.EstadoCaso.ARCHIVADO,
    ).order_by(models.CasoPrueba.suite_id, models.CasoPrueba.orden, models.CasoPrueba.id).with_for_update())
    siblings = sibling_result.scalars().all()
    source = [row for row in siblings if row.suite_id == db_caso.suite_id and row.id != db_caso.id]
    destination = [row for row in siblings if row.suite_id == suite_id and row.id != db_caso.id]
    for index, row in enumerate(source):
        row.orden = index
    for index, row in enumerate(destination):
        row.orden = index
    db_caso.orden = len(destination)
    update_data = {"suite_id": suite_id}
    return await update_caso_metadata_versioned(
        db=db,
        caso_id=caso_id,
        update=schemas.CasoPruebaUpdateMetadata(**update_data),
    )


async def reorder_casos(db: AsyncSession, caso_id: UUID, suite_id: Optional[UUID], orden: list[UUID], orden_origen: Optional[list[UUID]] = None, revision: Optional[str] = None):
    """Atomically assign dense order and optionally move the latest case."""
    if len(orden) != len(set(orden)):
        raise ValueError("La lista de casos contiene duplicados")
    case = await get_caso(db, caso_id)
    if not case:
        return None
    if not case.activo or case.estado_caso == models.EstadoCaso.ARCHIVADO:
        raise ValueError("No se pueden organizar casos archivados o inactivos")
    if case.suite_id:
        source_suite = (await db.execute(select(models.Suite).where(models.Suite.id == case.suite_id))).scalar_one_or_none()
        if not source_suite or not source_suite.activo or source_suite.archivado:
            raise ValueError("La suite origen no existe o esta inactiva")
    destination_id = suite_id or case.suite_id
    if destination_id is None:
        raise ValueError("Los casos sin suite no se pueden organizar")
    target = (await db.execute(select(models.Suite).where(models.Suite.id == destination_id, models.Suite.activo == True, models.Suite.archivado == False))).scalar_one_or_none()
    if not target or target.proyecto_id != case.proyecto_id:
        raise ValueError("La suite destino no pertenece al proyecto del caso")
    if target.componente_id != case.componente_id:
        raise ValueError("No se puede mover un caso a una suite de otro componente")
    lock_suite_ids = organization_lock_suite_ids(case.suite_id, destination_id)
    sibling_result = await db.execute(select(models.CasoPrueba).where(
        models.CasoPrueba.proyecto_id == case.proyecto_id,
        models.CasoPrueba.suite_id.in_(lock_suite_ids),
        models.CasoPrueba.activo == True,
        models.CasoPrueba.estado_caso != models.EstadoCaso.ARCHIVADO,
    ).order_by(models.CasoPrueba.suite_id, models.CasoPrueba.orden, models.CasoPrueba.id).with_for_update())
    locked_siblings = sibling_result.scalars().all()
    destination = [row for row in locked_siblings if row.suite_id == destination_id]
    source = [row for row in locked_siblings if row.suite_id == case.suite_id]
    current_rows = list(locked_siblings)
    expected_revision = organization_revision(sorted(current_rows, key=lambda row: (str(row.suite_id), int(row.orden or 0), str(row.id))))
    if revision is not None and revision != expected_revision:
        raise CaseOrganizationConflict("La organización cambió; recarga y vuelve a intentarlo")
    destination_ids = {row.id for row in destination}
    if destination_id != case.suite_id:
        destination_ids.add(case.id)
    if set(orden) != destination_ids:
        raise ValueError("La lista completa de casos hermanos es obligatoria")
    if destination_id != case.suite_id:
        source_ids = [row.id for row in source]
        if (
            len(orden_origen or source_ids) != len(set(orden_origen or source_ids))
            or set(orden_origen or source_ids) != set(source_ids)
            or case.id not in set(source_ids)
        ):
            raise ValueError("La lista completa de casos hermanos es obligatoria")
        for index, item_id in enumerate(orden_origen or source_ids):
            row = next((row for row in source if row.id == item_id), None)
            if row is None:
                raise ValueError("La lista completa de casos hermanos es obligatoria")
            row.orden = index
    elif orden_origen is not None and (
        len(orden_origen) != len(set(orden_origen))
        or set(orden_origen) != {row.id for row in destination}
    ):
        raise ValueError("La lista completa de casos hermanos es obligatoria")
    by_id = {row.id: row for row in destination}
    for index, item_id in enumerate(orden):
        row = by_id.get(item_id) or (case if item_id == case.id else None)
        if row is None:
            raise ValueError("La lista completa de casos hermanos es obligatoria")
        row.suite_id = destination_id
        row.orden = index
    await db.flush()
    await db.refresh(case)
    return case


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
        native_env = native_environment_variables(entorno)
        raw_env_variables = {str(key): str(value) for key, value in (entorno.variables or {}).items()}
        env_variables = {
            **raw_env_variables,
            **{f"ENV.{key}": value for key, value in raw_env_variables.items()},
        }
        for key, value in raw_env_variables.items():
            if key.lower() == "url":
                env_variables["ENV.URL"] = value
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
        "configuracion_chatbot_ambiente": entorno.configuracion_chatbot if entorno else {},
        "variables_componente": component_variables,
        "variables_configuradas": {},
        "variables_resueltas": variables_resueltas,
        "dataset_resuelto": combined_dataset,
    }

# --- TEST RUNS ---

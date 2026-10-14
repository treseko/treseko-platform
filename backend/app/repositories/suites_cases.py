import copy
from .repository_context import *
from .case_mutation_policy import current_case_for_write, lock_case_master, require_archivable_masters
async def clone_case_traceability(
    db: AsyncSession,
    original_master_id: UUID,
    cloned_master_id: UUID,
) -> None:
    story_result = await db.execute(
        select(models.CasoHistoria).filter(
            models.CasoHistoria.caso_master_id == original_master_id
        )
    )
    for original_link in story_result.scalars().all():
        db.add(models.CasoHistoria(
            caso_master_id=cloned_master_id,
            historia_id=original_link.historia_id,
            creado_por=original_link.creado_por,
            historia_actualizada_en_vinculo=original_link.historia_actualizada_en_vinculo,
            requiere_revision=original_link.requiere_revision,
            fecha_revision=original_link.fecha_revision,
            revisado_por=original_link.revisado_por,
        ))
    criterion_result = await db.execute(
        select(models.AcceptanceCriterionCase).filter(
            models.AcceptanceCriterionCase.caso_master_id == original_master_id
        )
    )
    for original_link in criterion_result.scalars().all():
        db.add(models.AcceptanceCriterionCase(
            acceptance_criterion_id=original_link.acceptance_criterion_id,
            caso_master_id=cloned_master_id,
            creado_por=original_link.creado_por,
        ))
# --- CASOS DE PRUEBA ---
async def generate_case_code(db: AsyncSession, prefix: str = "TC") -> str:
    result = await db.execute(
        select(models.CasoPrueba.codigo).filter(models.CasoPrueba.codigo.like(f"{prefix}-%"))
    )
    existing_codes = {str(code).strip() for code in result.scalars().all() if code}
    max_number = 0
    for code in existing_codes:
        if not code:
            continue
        try:
            max_number = max(max_number, int(str(code).split("-")[-1]))
        except ValueError:
            continue
    next_number = max_number + 1
    candidate = f"{prefix}-{next_number:03d}"
    while candidate in existing_codes:
        next_number += 1
        candidate = f"{prefix}-{next_number:03d}"
    return candidate


def _case_title_key(title: Optional[str]) -> str:
    return " ".join(str(title or "").split()).casefold()


def _fit_case_title(title: str, suffix: str = "") -> str:
    max_length = 255
    available = max_length - len(suffix)
    return f"{title[:max(0, available)].rstrip()}{suffix}"


async def generate_unique_case_title(
    db: AsyncSession,
    suite_id: Optional[UUID],
    title: str,
    *,
    for_copy: bool = False,
    exclude_master_id: Optional[UUID] = None,
) -> str:
    """Return a title unused by the current visible cases in a suite."""
    if not suite_id:
        return _fit_case_title(f"Copia de {title}" if for_copy else title)

    await db.execute(
        select(models.Suite.id)
        .filter(models.Suite.id == suite_id)
        .with_for_update()
    )
    latest_versions = (
        select(
            models.CasoPrueba.master_id,
            func.max(models.CasoPrueba.version).label("max_version"),
        )
        .filter(
            models.CasoPrueba.suite_id == suite_id,
            models.CasoPrueba.activo == True,
        )
        .group_by(models.CasoPrueba.master_id)
        .subquery()
    )
    result = await db.execute(
        select(models.CasoPrueba.titulo)
        .join(
            latest_versions,
            (models.CasoPrueba.master_id == latest_versions.c.master_id)
            & (models.CasoPrueba.version == latest_versions.c.max_version),
        )
        .filter(
            models.CasoPrueba.suite_id == suite_id,
            models.CasoPrueba.activo == True,
            models.CasoPrueba.estado_caso != models.EstadoCaso.ARCHIVADO,
            *(
                [models.CasoPrueba.master_id != exclude_master_id]
                if exclude_master_id
                else []
            ),
        )
    )
    occupied = {
        _case_title_key(existing_title)
        for existing_title in result.scalars().all()
        if existing_title
    }
    base_title = f"Copia de {title}" if for_copy else title
    candidate = _fit_case_title(base_title)
    if _case_title_key(candidate) not in occupied:
        return candidate

    number = 2
    while True:
        suffix = f" ({number})"
        candidate = _fit_case_title(base_title, suffix)
        if _case_title_key(candidate) not in occupied:
            return candidate
        number += 1


async def _ensure_case_code_available(
    db: AsyncSession,
    proyecto_id: UUID,
    codigo: Optional[str],
    *,
    master_id: Optional[UUID] = None,
) -> None:
    if not codigo:
        return
    result = await db.execute(
        select(models.CasoPrueba.master_id)
        .filter(models.CasoPrueba.proyecto_id == proyecto_id)
        .filter(models.CasoPrueba.codigo == codigo)
        .limit(1)
    )
    existing_master_id = result.scalar_one_or_none()
    if existing_master_id and existing_master_id != master_id:
        raise ValueError(f"Ya existe otro caso con el codigo {codigo} en este proyecto")
async def ensure_case_codes(db: AsyncSession, proyecto_id: Optional[UUID] = None):
    query = select(models.CasoPrueba).order_by(models.CasoPrueba.fecha_creacion, models.CasoPrueba.id)
    if proyecto_id:
        query = query.filter(models.CasoPrueba.proyecto_id == proyecto_id)
    result = await db.execute(query)
    casos = result.scalars().all()
    master_codes = {
        str(caso.master_id): caso.codigo
        for caso in casos
        if caso.codigo
    }
    changed = False
    for caso in casos:
        if caso.codigo:
            continue
        master_key = str(caso.master_id)
        code = master_codes.get(master_key)
        if not code:
            code = await generate_case_code(db)
            master_codes[master_key] = code
        caso.codigo = code
        changed = True
        await db.flush()
    if changed:
        await db.commit()
def _step_attachment_links_by_number(steps) -> dict[int, list[tuple[UUID, str]]]:
    return {step.numero_paso: [(link.attachment_id, link.tipo) for link in (step.attachments or [])] for step in steps}
async def _copy_step_attachments(db: AsyncSession, source_links_by_number: dict[int, list[tuple[UUID, str]]], target_steps: list[models.PasoPrueba]) -> None:
    await db.flush()
    for target_step in target_steps:
        db.add_all([
            models.PasoAttachment(paso_id=target_step.id, attachment_id=attachment_id, tipo=tipo)
            for attachment_id, tipo in source_links_by_number.get(target_step.numero_paso, [])
        ])

# The dataset is execution input, not part of the immutable definition of a
# case.  It can therefore change without producing a new version.  Every
# other authoring field is versioned once the case has terminal evidence.
VERSIONED_CASE_FIELDS = frozenset({
    "proyecto_id",
    "suite_id",
    "componente_id",
    "titulo",
    "descripcion",
    "precondiciones",
    "postcondiciones",
    "prioridad",
    "criticidad",
    "tipo_prueba",
    "formato_prueba",
    "configuracion_chatbot",
    "configuracion_api",
    "etiquetas",
    "script_automatizado",
    "framework",
})

CASE_MODEL_FIELDS = VERSIONED_CASE_FIELDS | {"codigo", "estado_caso", "dataset", "creado_por", "orden"}


def _step_definition(step) -> dict:
    if hasattr(step, "model_dump"):
        return step.model_dump()
    return {
        "numero_paso": step.numero_paso,
        "accion": step.accion,
        "datos": step.datos,
        "resultado_esperado": step.resultado_esperado,
        "metadata_ai": step.metadata_ai,
    }


def _same_case_value(left, right) -> bool:
    return left == right or str(left) == str(right)


def case_definition_changed(latest_caso, caso_data: dict, latest_steps: list, pasos_data: list) -> bool:
    """Return whether an edit changes the versioned case definition.

    This deliberately ignores ``dataset`` so dataset-only edits keep the
    current version while API/chatbot/scripts/steps and authoring metadata are
    preserved as immutable versions after execution.
    """
    for field in VERSIONED_CASE_FIELDS:
        if field in caso_data and not _same_case_value(caso_data[field], getattr(latest_caso, field)):
            return True
    current_steps = [_step_definition(step) for step in sorted(latest_steps, key=lambda item: item.numero_paso)]
    incoming_steps = [_step_definition(step) for step in sorted(pasos_data, key=lambda item: item.numero_paso)]
    return current_steps != incoming_steps


def _case_model_data(caso) -> dict:
    return {
        field: copy.deepcopy(getattr(caso, field))
        for field in CASE_MODEL_FIELDS
        if hasattr(caso, field)
    }


async def _create_case_version(
    db: AsyncSession,
    latest_caso,
    master_id: UUID,
    caso_data: dict,
    pasos_data: list,
    source_attachment_links: dict[int, list[tuple[UUID, str]]],
    *, commit: bool = True,
):
    db_new_version = models.CasoPrueba(
        **caso_data,
        master_id=master_id,
        version=latest_caso.version + 1,
    )
    db.add(db_new_version)
    await db.flush()
    target_steps = [models.PasoPrueba(**_step_definition(paso), caso_id=db_new_version.id) for paso in pasos_data]
    db.add_all(target_steps)
    await _copy_step_attachments(db, source_attachment_links, target_steps)
    if commit:
        await db.commit()
    else:
        await db.flush()
    await db.refresh(db_new_version)
    return db_new_version


async def update_caso_prueba(db: AsyncSession, master_id: UUID, caso_update: schemas.CasoPruebaCreate, *, commit: bool = True):
    latest_caso = await current_case_for_write(db, master_id)
    if not latest_caso: return None
    if caso_update.estado_caso == models.EstadoCaso.ARCHIVADO:
        await require_archivable_masters(db, [master_id])
    pasos_data = caso_update.pasos
    caso_data = caso_update.model_dump(exclude={"pasos", "request_id"})
    caso_data["codigo"] = latest_caso.codigo or await generate_case_code(db)
    if not latest_caso.codigo:
        latest_caso.codigo = caso_data["codigo"]
    await _ensure_case_code_available(
        db,
        caso_data["proyecto_id"],
        caso_data.get("codigo"),
        master_id=master_id,
    )
    latest_steps_result = await db.execute(
        select(models.PasoPrueba)
        .options(selectinload(models.PasoPrueba.attachments))
        .where(models.PasoPrueba.caso_id == latest_caso.id)
    )
    latest_steps = latest_steps_result.scalars().all()
    source_attachment_links = _step_attachment_links_by_number(latest_steps)
    has_terminal_execution = await has_executions(db, latest_caso.id)
    if caso_update.estado_caso in {models.EstadoCaso.ARCHIVADO, models.EstadoCaso.ACTIVO}:
        versions = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.master_id == master_id))).scalars().all()
        for version in versions:
            version.estado_caso = caso_update.estado_caso
    if not has_terminal_execution or not case_definition_changed(latest_caso, caso_data, latest_steps, pasos_data):
        for field, value in caso_data.items():
            if field in {"codigo", "creado_por"}:
                continue
            setattr(latest_caso, field, value)
        paso_ids_subquery = select(models.PasoPrueba.id).where(models.PasoPrueba.caso_id == latest_caso.id)
        await db.execute(
            delete(models.PasoAttachment)
            .where(models.PasoAttachment.paso_id.in_(paso_ids_subquery))
            .execution_options(synchronize_session=False)
        )
        await db.execute(
            delete(models.PasoPrueba)
            .where(models.PasoPrueba.caso_id == latest_caso.id)
            .execution_options(synchronize_session=False)
        )
        await db.flush()
        target_steps = [models.PasoPrueba(**paso.model_dump(), caso_id=latest_caso.id) for paso in pasos_data]
        db.add_all(target_steps)
        await _copy_step_attachments(db, source_attachment_links, target_steps)
        if commit:
            await db.commit()
        else:
            await db.flush()
        return await get_caso(db, latest_caso.id)
    return await _create_case_version(
        db,
        latest_caso,
        master_id,
        caso_data,
        pasos_data,
        source_attachment_links, commit=commit,
    )
async def get_casos_proyecto(db: AsyncSession, proyecto_id: UUID, include_archived: bool = False, estado: Optional[str] = None):
    from sqlalchemy import func
    await ensure_case_codes(db, proyecto_id)
    filters = [
        models.CasoPrueba.proyecto_id == proyecto_id,
        *_visible_case_filter()
    ]
    if estado:
        filters.append(models.CasoPrueba.estado_caso == estado)
    elif not include_archived:
        filters.append(models.CasoPrueba.estado_caso != models.EstadoCaso.ARCHIVADO)
    subq = (select(models.CasoPrueba.master_id, func.max(models.CasoPrueba.version).label("max_v")).filter(
        *filters
    ).group_by(models.CasoPrueba.master_id).subquery())
    query = (select(models.CasoPrueba).join(subq, (models.CasoPrueba.master_id == subq.c.master_id) & (models.CasoPrueba.version == subq.c.max_v)).order_by(models.CasoPrueba.orden, models.CasoPrueba.id))
    result = await db.execute(query)
    casos = result.scalars().all()
    caso_ids = [caso.id for caso in casos]
    steps_count_by_case = {}
    if caso_ids:
        steps_count_result = await db.execute(
            select(models.PasoPrueba.caso_id, func.count(models.PasoPrueba.id))
            .filter(models.PasoPrueba.caso_id.in_(caso_ids))
            .group_by(models.PasoPrueba.caso_id)
        )
        steps_count_by_case = {case_id: count for case_id, count in steps_count_result.all()}
    user_ids = {caso.ultima_ejecucion_por for caso in casos if caso.ultima_ejecucion_por}
    users_by_id = {}
    if user_ids:
        users_result = await db.execute(select(models.Usuario).filter(models.Usuario.id.in_(user_ids)))
        users_by_id = {user.id: user for user in users_result.scalars().all()}
    # Enriquecer con información de última ejecución
    casos_enriquecidos = []
    for caso in casos:
        caso_dict = {
            "id": caso.id,
            "master_id": caso.master_id,
            "codigo": caso.codigo,
            "proyecto_id": caso.proyecto_id,
            "suite_id": caso.suite_id,
            "orden": caso.orden,
            "componente_id": caso.componente_id,
            "titulo": caso.titulo,
            "descripcion": caso.descripcion,
            "precondiciones": caso.precondiciones,
            "postcondiciones": caso.postcondiciones,
            "version": caso.version,
            "prioridad": caso.prioridad,
            "criticidad": caso.criticidad,
            "tipo_prueba": caso.tipo_prueba,
            "formato_prueba": caso.formato_prueba,
            "estado_caso": caso.estado_caso,
            "dataset": caso.dataset,
            "etiquetas": caso.etiquetas or [],
            "activo": caso.activo,
            "creado_por": caso.creado_por,
            "ultimo_resultado": caso.ultimo_resultado,
            "ultima_ejecucion_por": caso.ultima_ejecucion_por,
            "ultima_ejecucion_fecha": caso.ultima_ejecucion_fecha.isoformat() if caso.ultima_ejecucion_fecha else None,
            "steps_count": steps_count_by_case.get(caso.id, 0),
            "fecha_creacion": caso.fecha_creacion,
            "ultima_modificacion": caso.ultima_modificacion,
        }
        # Obtener información del usuario que ejecutó
        if caso.ultima_ejecucion_por:
            user = users_by_id.get(caso.ultima_ejecucion_por)
            if user:
                caso_dict["ultima_ejecucion_por_nombre"] = user.nombre_completo
                caso_dict["ultima_ejecucion_por_email"] = user.email
        casos_enriquecidos.append(caso_dict)
    return casos_enriquecidos
async def get_caso(db: AsyncSession, caso_id: UUID):
    result = await db.execute(
        select(models.CasoPrueba)
        .filter(models.CasoPrueba.id == caso_id)
    )
    return result.scalar_one_or_none()
async def get_caso_with_pasos(db: AsyncSession, caso_id: UUID):
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(models.CasoPrueba)
        .options(selectinload(models.CasoPrueba.pasos))
        .filter(models.CasoPrueba.id == caso_id)
    )
    return result.scalar_one_or_none()
async def delete_caso(db: AsyncSession, caso_id: UUID) -> tuple[bool, str]:
    db_caso = await get_caso(db, caso_id)
    if not db_caso:
        return False, "Caso no encontrado"
    if await has_executions(db, caso_id):
        return False, f"No se puede eliminar el caso porque tiene ejecuciones"
    db_caso.activo = False
    await db.commit()
    return True, "Caso eliminado correctamente"

from .case_write_operations import create_caso_prueba, update_caso_metadata_versioned

from .suite_structure import clone_suite, clone_suite_recursive, move_suite, reorder_suites

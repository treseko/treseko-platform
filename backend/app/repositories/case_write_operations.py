"""Case creation and metadata writes, with explicit transaction ownership."""
from .repository_context import *
from .case_mutation_policy import current_case_for_write, lock_case_master

async def create_caso_prueba(db: AsyncSession, caso: schemas.CasoPruebaCreate, *, commit: bool = True):
    from .suites_cases import generate_case_code, _ensure_case_code_available, case_definition_changed
    pasos_data = caso.pasos
    caso_data = caso.model_dump(exclude={"pasos", "request_id"})
    master_id = uuid.uuid5(uuid.NAMESPACE_URL, f"treseko:case:{caso.creado_por}:{caso.request_id}") if caso.request_id else uuid.uuid4()
    if caso.request_id:
        await lock_case_master(db, master_id)
        existing = await db.scalar(select(models.CasoPrueba).where(models.CasoPrueba.master_id == master_id).order_by(models.CasoPrueba.version.desc()).limit(1))
        if existing:
            if existing.proyecto_id != caso.proyecto_id or existing.creado_por != caso.creado_por:
                raise ValueError("El identificador de guardado ya pertenece a otra operación")
            steps = (await db.execute(select(models.PasoPrueba).where(models.PasoPrueba.caso_id == existing.id))).scalars().all()
            if case_definition_changed(existing, caso_data, steps, pasos_data) or existing.dataset != caso.dataset:
                raise ValueError("El identificador de guardado ya fue utilizado con otra definición. Recarga la prueba para editarla.")
            return existing

    if not caso_data.get("codigo"):
        caso_data["codigo"] = await generate_case_code(db)
    await _ensure_case_code_available(db, caso_data["proyecto_id"], caso_data.get("codigo"))
    db_caso = models.CasoPrueba(**caso_data, master_id=master_id)
    db.add(db_caso)
    await db.flush()
    for paso in pasos_data:
        db_paso = models.PasoPrueba(**paso.model_dump(), caso_id=db_caso.id)
        db.add(db_paso)
    if commit:
        await db.commit()
    else:
        await db.flush()
    await db.refresh(db_caso)
    return db_caso

async def update_caso_metadata_versioned(db: AsyncSession, caso_id: UUID, update: schemas.CasoPruebaUpdateMetadata, *, commit: bool = True):
    """Apply versionable metadata through the same immutable-version policy."""
    from .suites_cases import get_caso, _step_attachment_links_by_number, _case_model_data, _create_case_version
    from .builds_suites import has_executions
    latest_caso = await get_caso(db, caso_id)
    if not latest_caso:
        return None
    current = await current_case_for_write(db, latest_caso.master_id)
    if current.id != caso_id:
        raise ValueError("La versión del caso cambió. Recarga la prueba antes de editarla.")
    latest_caso = current
    update_data = update.model_dump(exclude_unset=True)
    update_data.pop("estado_caso", None)
    if not update_data:
        return latest_caso

    latest_steps_result = await db.execute(
        select(models.PasoPrueba)
        .options(selectinload(models.PasoPrueba.attachments))
        .where(models.PasoPrueba.caso_id == latest_caso.id)
    )
    latest_steps = latest_steps_result.scalars().all()
    source_attachment_links = _step_attachment_links_by_number(latest_steps)
    caso_data = _case_model_data(latest_caso)
    caso_data.update(update_data)

    if not await has_executions(db, latest_caso.id):
        for field, value in update_data.items():
            setattr(latest_caso, field, value)
        if commit:
            await db.commit()
        else:
            await db.flush()
        await db.refresh(latest_caso)
        return latest_caso

    return await _create_case_version(
        db,
        latest_caso,
        latest_caso.master_id,
        caso_data,
        latest_steps,
        source_attachment_links, commit=commit,
    )

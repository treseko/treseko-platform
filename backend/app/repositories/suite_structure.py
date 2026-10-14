import copy
from .repository_context import *
from .builds_suites import get_suite, get_all_descendant_suites

async def _clone_cases_for_suite(db: AsyncSession, original_suite_id: UUID, cloned_suite_id: UUID) -> int:
    from .suites_cases import generate_case_code, generate_unique_case_title, clone_case_traceability
    latest = select(models.CasoPrueba.master_id, func.max(models.CasoPrueba.version).label("version")).group_by(models.CasoPrueba.master_id).subquery()
    result = await db.execute(select(models.CasoPrueba).join(latest,
        (models.CasoPrueba.master_id == latest.c.master_id) & (models.CasoPrueba.version == latest.c.version),
    ).options(selectinload(models.CasoPrueba.pasos)).where(
        models.CasoPrueba.suite_id == original_suite_id,
        models.CasoPrueba.activo.is_(True),
        models.CasoPrueba.estado_caso != models.EstadoCaso.ARCHIVADO,
    ))
    originals = result.scalars().all()
    original_step_ids = [step.id for original in originals for step in original.pasos]
    attachment_links_by_step = {}
    if original_step_ids:
        attachment_result = await db.execute(
            select(models.PasoAttachment).filter(
                models.PasoAttachment.paso_id.in_(original_step_ids)
            )
        )
        for link in attachment_result.scalars().all():
            attachment_links_by_step.setdefault(link.paso_id, []).append(link)
    copied = 0
    for original in originals:
        cloned_title = await generate_unique_case_title(db, cloned_suite_id, original.titulo, for_copy=True)
        cloned_case = models.CasoPrueba(
            master_id=uuid.uuid4(),
            codigo=await generate_case_code(db),
            proyecto_id=original.proyecto_id,
            suite_id=cloned_suite_id,
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
        db.add(cloned_case)
        await db.flush()
        await clone_case_traceability(db, original.master_id, cloned_case.master_id)
        cloned_steps = []
        for paso in original.pasos:
            cloned_step = models.PasoPrueba(
                caso_id=cloned_case.id,
                numero_paso=paso.numero_paso,
                accion=paso.accion,
                datos=paso.datos,
                resultado_esperado=paso.resultado_esperado,
                metadata_ai=copy.deepcopy(paso.metadata_ai),
            )
            db.add(cloned_step)
            cloned_steps.append((paso, cloned_step))
        if cloned_steps:
            await db.flush()
            for original_step, cloned_step in cloned_steps:
                for original_link in attachment_links_by_step.get(original_step.id, []):
                    db.add(models.PasoAttachment(
                        paso_id=cloned_step.id,
                        attachment_id=original_link.attachment_id,
                        tipo=original_link.tipo,
                    ))
        copied += 1
    return copied
async def _clone_suite_tree(
    db: AsyncSession, original: models.Suite, new_parent_id: Optional[UUID],
    nuevo_nombre: Optional[str] = None, include_cases: bool = True,
) -> tuple[models.Suite, int, int]:
    from .suite_policy import suite_rows, descendants
    rows = await suite_rows(db, original.proyecto_id)
    children = descendants(rows, original.id)
    by_id = {row.id: row for row in rows}
    if any(row.activo and row.componente_id != by_id[row.parent_id].componente_id for row in children):
        raise ValueError('La rama tiene componentes inconsistentes. Revisa la ubicación de sus subsuites antes de copiarla.')
    by_parent = {}
    for row in rows:
        if row.activo and not row.archivado:
            by_parent.setdefault(row.parent_id, []).append(row)
    pending = [(original, new_parent_id, nuevo_nombre)]
    cloned_root, suite_count, case_count = None, 0, 0
    while pending:
        source, parent_id, name = pending.pop()
        order = await db.scalar(select(func.max(models.Suite.orden)).where(
            models.Suite.proyecto_id == source.proyecto_id, models.Suite.parent_id == parent_id,
            models.Suite.componente_id == source.componente_id, models.Suite.activo == True,
        ))
        cloned = models.Suite(proyecto_id=source.proyecto_id, componente_id=source.componente_id,
            parent_id=parent_id, nombre=name or source.nombre, descripcion=source.descripcion,
            color=source.color, icono=source.icono or 'folder', orden=(order if order is not None else -1) + 1)
        db.add(cloned)
        await db.flush()
        if cloned_root is None:
            cloned_root = cloned
        suite_count += 1
        if include_cases:
            case_count += await _clone_cases_for_suite(db, source.id, cloned.id)
        children = sorted(by_parent.get(source.id, []), key=lambda row: (row.orden or 0, row.nombre, str(row.id)))
        pending.extend((child, cloned.id, None) for child in reversed(children))
    return cloned_root, suite_count, case_count
async def clone_suite(
    db: AsyncSession,
    suite_id: UUID,
    nuevo_nombre: Optional[str] = None,
    parent_id: Optional[UUID] = None,
    include_cases: bool = True,
    keep_original_parent_when_parent_omitted: bool = True,
    *, commit: bool = True,
):
    db_suite = await get_suite(db, suite_id)
    if not db_suite:
        return None
    from .suite_policy import suite_rows, editable_path
    db_suite = editable_path(await suite_rows(db, db_suite.proyecto_id), suite_id)
    if not db_suite.activo:
        raise ValueError("No se puede copiar una suite inactiva")
    target_parent_id = db_suite.parent_id if keep_original_parent_when_parent_omitted and parent_id is None else parent_id
    if target_parent_id:
        if target_parent_id == suite_id:
            raise ValueError("No se puede copiar una suite dentro de si misma")
        descendants = await get_all_descendant_suites(db, suite_id)
        if any(descendant.id == target_parent_id for descendant in descendants):
            raise ValueError("No se puede copiar una suite dentro de una de sus subsuites")
        parent = editable_path(await suite_rows(db, db_suite.proyecto_id), target_parent_id)
        if not parent or not parent.activo or parent.archivado:
            raise ValueError("La suite padre destino no existe o esta inactiva")
        if parent.proyecto_id != db_suite.proyecto_id:
            raise ValueError("La suite padre destino no pertenece al proyecto")
        if parent.componente_id != db_suite.componente_id:
            raise ValueError("La suite padre destino no pertenece al mismo componente")
    cloned, suites_copiadas, casos_copiados = await _clone_suite_tree(
        db,
        db_suite,
        target_parent_id,
        nuevo_nombre or f"Copia de {db_suite.nombre}"[:150],
        include_cases=include_cases
    )
    if commit:
        await db.commit()
    else:
        await db.flush()
    await db.refresh(cloned)
    return {
        "suite": cloned,
        "suites_copiadas": suites_copiadas,
        "casos_copiados": casos_copiados
    }
async def clone_suite_recursive(db: AsyncSession, original_id: UUID, new_parent_id: UUID):
    original = await get_suite(db, original_id)
    if original:
        await clone_suite(db, original_id, nuevo_nombre=original.nombre, parent_id=new_parent_id,
            include_cases=False, keep_original_parent_when_parent_omitted=False, commit=False)

async def move_suite(db: AsyncSession, suite_id: UUID, new_parent_id: Optional[UUID], *, commit: bool = True) -> tuple[bool, str]:
    db_suite = await get_suite(db, suite_id)
    if not db_suite:
        return False, "Suite no encontrada"
    from .suite_policy import suite_rows, editable_path, descendants
    rows = await suite_rows(db, db_suite.proyecto_id)
    db_suite = editable_path(rows, suite_id)
    if new_parent_id:
        if new_parent_id == suite_id:
            return False, "No se puede mover una suite a sí misma"
        children = descendants(rows, suite_id)
        if any(d.id == new_parent_id for d in children):
            return False, "No se puede mover una suite a uno de sus descendientes"
        new_parent = editable_path(rows, new_parent_id)
        if not new_parent:
            return False, "Suite padre no encontrada"
        if new_parent.proyecto_id != db_suite.proyecto_id:
            return False, "No se puede mover a una suite de otro proyecto"
        if db_suite.componente_id != new_parent.componente_id:
            return False, "No se puede mover a una suite de otro componente"
    if db_suite.parent_id == new_parent_id:
        return True, 'La suite ya está en esa carpeta'
    db_suite.parent_id = new_parent_id
    siblings = [row for row in rows if row.id != suite_id and row.activo and row.parent_id == new_parent_id and row.componente_id == db_suite.componente_id]
    db_suite.orden = max((row.orden or 0 for row in siblings), default=-1) + 1
    if commit:
        await db.commit()
    else:
        await db.flush()
    await db.refresh(db_suite)
    return True, "Suite movida correctamente"
async def reorder_suites(db: AsyncSession, suite_ids: list[UUID], *, commit: bool = True) -> bool:
    for index, suite_id in enumerate(suite_ids):
        result = await db.execute(select(models.Suite).filter(models.Suite.id == suite_id))
        suite = result.scalar_one_or_none()
        if suite:
            suite.orden = index
    if commit:
        await db.commit()
    else:
        await db.flush()
    return True

from .legacy_common import *


async def _clone_cases_for_suite(db: AsyncSession, original_suite_id: UUID, cloned_suite_id: UUID) -> int:
    result = await db.execute(
        select(models.CasoPrueba)
        .options(selectinload(models.CasoPrueba.pasos))
        .filter(
            models.CasoPrueba.suite_id == original_suite_id,
            models.CasoPrueba.activo == True
        )
    )
    originals = result.scalars().all()
    copied = 0
    for original in originals:
        cloned_case = models.CasoPrueba(
            master_id=uuid.uuid4(),
            codigo=await generate_case_code(db),
            proyecto_id=original.proyecto_id,
            suite_id=cloned_suite_id,
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
        db.add(cloned_case)
        await db.flush()
        for paso in original.pasos:
            db.add(models.PasoPrueba(
                caso_id=cloned_case.id,
                numero_paso=paso.numero_paso,
                accion=paso.accion,
                datos=paso.datos,
                resultado_esperado=paso.resultado_esperado,
                metadata_ai=paso.metadata_ai
            ))
        copied += 1
    return copied

async def _clone_suite_tree(
    db: AsyncSession,
    original: models.Suite,
    new_parent_id: Optional[UUID],
    nuevo_nombre: Optional[str] = None,
    include_cases: bool = True
) -> tuple[models.Suite, int, int]:
    cloned = models.Suite(
        proyecto_id=original.proyecto_id,
        componente_id=original.componente_id,
        parent_id=new_parent_id,
        nombre=nuevo_nombre or original.nombre,
        descripcion=original.descripcion,
        color=original.color,
        icono=getattr(original, "icono", None) or "folder",
        orden=original.orden
    )
    db.add(cloned)
    await db.flush()

    suites_copiadas = 1
    casos_copiados = await _clone_cases_for_suite(db, original.id, cloned.id) if include_cases else 0

    result = await db.execute(
        select(models.Suite).filter(models.Suite.parent_id == original.id, models.Suite.activo == True)
    )
    children = result.scalars().all()
    for child in children:
        _, child_suites, child_cases = await _clone_suite_tree(
            db,
            child,
            cloned.id,
            include_cases=include_cases
        )
        suites_copiadas += child_suites
        casos_copiados += child_cases

    return cloned, suites_copiadas, casos_copiados

async def clone_suite(
    db: AsyncSession,
    suite_id: UUID,
    nuevo_nombre: Optional[str] = None,
    parent_id: Optional[UUID] = None,
    include_cases: bool = True,
    keep_original_parent_when_parent_omitted: bool = True
):
    db_suite = await get_suite(db, suite_id)
    if not db_suite:
        return None
    if not db_suite.activo:
        raise ValueError("No se puede copiar una suite inactiva")

    target_parent_id = db_suite.parent_id if keep_original_parent_when_parent_omitted and parent_id is None else parent_id
    if target_parent_id:
        if target_parent_id == suite_id:
            raise ValueError("No se puede copiar una suite dentro de si misma")
        descendants = await get_all_descendant_suites(db, suite_id)
        if any(descendant.id == target_parent_id for descendant in descendants):
            raise ValueError("No se puede copiar una suite dentro de una de sus subsuites")
        parent = await get_suite(db, target_parent_id)
        if not parent or not parent.activo:
            raise ValueError("La suite padre destino no existe o esta inactiva")
        if parent.proyecto_id != db_suite.proyecto_id:
            raise ValueError("La suite padre destino no pertenece al proyecto")
        if parent.componente_id != db_suite.componente_id:
            raise ValueError("La suite padre destino no pertenece al mismo componente")

    cloned, suites_copiadas, casos_copiados = await _clone_suite_tree(
        db,
        db_suite,
        target_parent_id,
        nuevo_nombre or f"Copia de {db_suite.nombre}",
        include_cases=include_cases
    )
    await db.commit()
    await db.refresh(cloned)
    return {
        "suite": cloned,
        "suites_copiadas": suites_copiadas,
        "casos_copiados": casos_copiados
    }

async def clone_suite_recursive(db: AsyncSession, original_id: UUID, new_parent_id: UUID):
    result = await db.execute(select(models.Suite).filter(models.Suite.id == original_id))
    original = result.scalar_one_or_none()
    if not original:
        return
    
    cloned = models.Suite(
        proyecto_id=original.proyecto_id,
        componente_id=original.componente_id,
        parent_id=new_parent_id,
        nombre=original.nombre,
        descripcion=original.descripcion,
        color=original.color,
        icono=getattr(original, "icono", None) or "folder",
        orden=original.orden
    )
    db.add(cloned)
    await db.flush()
    
    result = await db.execute(
        select(models.Suite).filter(models.Suite.parent_id == original_id, models.Suite.activo == True)
    )
    children = result.scalars().all()
    for child in children:
        await clone_suite_recursive(db, child.id, cloned.id)

async def move_suite(db: AsyncSession, suite_id: UUID, new_parent_id: Optional[UUID]) -> tuple[bool, str]:
    db_suite = await get_suite(db, suite_id)
    if not db_suite:
        return False, "Suite no encontrada"
    
    if new_parent_id:
        if new_parent_id == suite_id:
            return False, "No se puede mover una suite a sí misma"
        
        descendants = await get_all_descendant_suites(db, suite_id)
        if any(d.id == new_parent_id for d in descendants):
            return False, "No se puede mover una suite a uno de sus descendientes"
        
        result = await db.execute(select(models.Suite).filter(models.Suite.id == new_parent_id))
        new_parent = result.scalar_one_or_none()
        if not new_parent:
            return False, "Suite padre no encontrada"
        
        if new_parent.proyecto_id != db_suite.proyecto_id:
            return False, "No se puede mover a una suite de otro proyecto"
        if db_suite.componente_id and new_parent.componente_id and db_suite.componente_id != new_parent.componente_id:
            return False, "No se puede mover a una suite de otro componente"
        if not db_suite.componente_id and new_parent.componente_id:
            db_suite.componente_id = new_parent.componente_id
    
    db_suite.parent_id = new_parent_id
    await db.commit()
    await db.refresh(db_suite)
    return True, "Suite movida correctamente"

async def reorder_suites(db: AsyncSession, suite_ids: list[UUID]) -> bool:
    for index, suite_id in enumerate(suite_ids):
        result = await db.execute(select(models.Suite).filter(models.Suite.id == suite_id))
        suite = result.scalar_one_or_none()
        if suite:
            suite.orden = index
    await db.commit()
    return True

# --- CASOS DE PRUEBA ---
async def generate_case_code(db: AsyncSession, prefix: str = "TC") -> str:
    result = await db.execute(
        select(models.CasoPrueba.codigo).filter(models.CasoPrueba.codigo.like(f"{prefix}-%"))
    )
    max_number = 0
    for code in result.scalars().all():
        if not code:
            continue
        try:
            max_number = max(max_number, int(str(code).split("-")[-1]))
        except ValueError:
            continue
    return f"{prefix}-{max_number + 1:03d}"

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

async def create_caso_prueba(db: AsyncSession, caso: schemas.CasoPruebaCreate):
    pasos_data = caso.pasos
    caso_data = caso.model_dump(exclude={"pasos"})
    if not caso_data.get("codigo"):
        caso_data["codigo"] = await generate_case_code(db)
    db_caso = models.CasoPrueba(**caso_data, master_id=uuid.uuid4())
    db.add(db_caso)
    await db.flush()
    for paso in pasos_data:
        db_paso = models.PasoPrueba(**paso.model_dump(), caso_id=db_caso.id)
        db.add(db_paso)
    await db.commit()
    await db.refresh(db_caso)
    return db_caso

async def update_caso_prueba(db: AsyncSession, master_id: UUID, caso_update: schemas.CasoPruebaCreate):
    result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.master_id == master_id).order_by(models.CasoPrueba.version.desc()).limit(1))
    latest_caso = result.scalar_one_or_none()
    if not latest_caso: return None
    pasos_data = caso_update.pasos
    caso_data = caso_update.model_dump(exclude={"pasos"})
    caso_data["codigo"] = latest_caso.codigo or await generate_case_code(db)
    if not latest_caso.codigo:
        latest_caso.codigo = caso_data["codigo"]

    if not await has_executions(db, latest_caso.id):
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
        for paso in pasos_data:
            db_paso = models.PasoPrueba(**paso.model_dump(), caso_id=latest_caso.id)
            db.add(db_paso)
        await db.commit()
        return await get_caso(db, latest_caso.id)

    new_version = latest_caso.version + 1
    db_new_version = models.CasoPrueba(**caso_data, master_id=master_id, version=new_version)
    db.add(db_new_version)
    await db.flush()
    for paso in pasos_data:
        db_paso = models.PasoPrueba(**paso.model_dump(), caso_id=db_new_version.id)
        db.add(db_paso)
    await db.commit()
    await db.refresh(db_new_version)
    return db_new_version

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
    query = (select(models.CasoPrueba).join(subq, (models.CasoPrueba.master_id == subq.c.master_id) & (models.CasoPrueba.version == subq.c.max_v)))
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
            "componente_id": caso.componente_id,
            "titulo": caso.titulo,
            "descripcion": caso.descripcion,
            "precondiciones": caso.precondiciones,
            "postcondiciones": caso.postcondiciones,
            "version": caso.version,
            "prioridad": caso.prioridad,
            "criticidad": caso.criticidad,
            "tipo_prueba": caso.tipo_prueba,
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

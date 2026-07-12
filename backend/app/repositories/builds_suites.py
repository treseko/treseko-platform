from .legacy_common import *


async def get_build_latest_case_results(db: AsyncSession, build_id: UUID):
    assigned_result = await db.execute(
        select(models.BuildCaso.caso_id).filter(models.BuildCaso.build_id == build_id)
    )
    assigned_case_ids = list(assigned_result.scalars().all())
    if not assigned_case_ids:
        return []

    assigned_cases_result = await db.execute(
        select(models.CasoPrueba).filter(models.CasoPrueba.id.in_(assigned_case_ids))
    )
    assigned_cases = assigned_cases_result.scalars().all()
    master_by_assigned_id = {caso.id: caso.master_id for caso in assigned_cases}
    master_ids = set(master_by_assigned_id.values())
    version_ids_result = await db.execute(
        select(models.CasoPrueba.id, models.CasoPrueba.master_id)
        .filter(models.CasoPrueba.master_id.in_(master_ids))
    )
    version_master_rows = version_ids_result.all()
    master_by_version_id = {case_id: master_id for case_id, master_id in version_master_rows}
    executable_case_ids = list(master_by_version_id.keys())

    result = await db.execute(
        select(models.EjecucionCaso)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .filter(models.TestRun.build_id == build_id)
        .filter(models.EjecucionCaso.caso_id.in_(executable_case_ids))
        .filter(models.EjecucionCaso.estado_resultado != models.EstadoResultado.SIN_CORRER)
        .order_by(models.EjecucionCaso.fecha_ejecucion.desc())
    )
    latest_by_master = {}
    previous_by_master = {}
    executions = result.scalars().all()
    for ejecucion in executions:
        master_id = master_by_version_id.get(ejecucion.caso_id)
        if not master_id:
            continue
        if master_id not in latest_by_master:
            latest_by_master[master_id] = ejecucion
        elif master_id not in previous_by_master:
            previous_by_master[master_id] = ejecucion

    ejecutor_ids = {
        ejecucion.ejecutado_por
        for ejecucion in [*latest_by_master.values(), *previous_by_master.values()]
        if ejecucion.ejecutado_por
    }
    users_by_id = {}
    if ejecutor_ids:
        users_result = await db.execute(select(models.Usuario).filter(models.Usuario.id.in_(ejecutor_ids)))
        users_by_id = {user.id: user for user in users_result.scalars().all()}

    rows = []
    for caso_id in assigned_case_ids:
        master_id = master_by_assigned_id.get(caso_id)
        ejecucion = latest_by_master.get(master_id)
        if not ejecucion:
            rows.append({
                "caso_id": str(caso_id),
                "estado": None,
                "fecha": None,
                "ejecutado_por": None,
                "ejecutado_por_nombre": None,
                "test_run_id": None,
                "ejecucion_id": None,
                "duracion_segundos": 0,
                "observaciones": None,
                "version_ejecutada": None,
                "version_ejecutada_anterior": None,
            })
            continue
        user = users_by_id.get(ejecucion.ejecutado_por)
        previous = previous_by_master.get(master_id)
        previous_user = users_by_id.get(previous.ejecutado_por) if previous else None
        details = await get_execution_history_details(db, ejecucion.id)
        previous_details = await get_execution_history_details(db, previous.id) if previous else {}
        rows.append({
            "caso_id": str(caso_id),
            "estado": ejecucion.estado_resultado.value,
            "fecha": ejecucion.fecha_ejecucion.isoformat() if ejecucion.fecha_ejecucion else None,
            "ejecutado_por": user.email if user else None,
            "ejecutado_por_nombre": user.nombre_completo if user else None,
            "test_run_id": str(ejecucion.test_run_id),
            "ejecucion_id": str(ejecucion.id),
            "snapshot_id": details.get("snapshot_id"),
            "duracion_segundos": ejecucion.duracion_segundos,
            "observaciones": ejecucion.observaciones,
            "paso_fallido": details.get("paso_fallido"),
            "datos_prueba": details.get("datos_prueba"),
            "resultado_esperado": details.get("resultado_esperado"),
            "version_ejecutada": ejecucion.version_ejecutada,
            "estado_anterior": previous.estado_resultado.value if previous else None,
            "fecha_anterior": previous.fecha_ejecucion.isoformat() if previous and previous.fecha_ejecucion else None,
            "ejecutado_por_anterior": previous_user.email if previous_user else None,
            "ejecutado_por_nombre_anterior": previous_user.nombre_completo if previous_user else None,
            "test_run_id_anterior": str(previous.test_run_id) if previous else None,
            "ejecucion_id_anterior": str(previous.id) if previous else None,
            "snapshot_id_anterior": previous_details.get("snapshot_id") if previous_details else None,
            "duracion_segundos_anterior": previous.duracion_segundos if previous else 0,
            "observaciones_anterior": previous.observaciones if previous else None,
            "paso_fallido_anterior": previous_details.get("paso_fallido") if previous_details else None,
            "version_ejecutada_anterior": previous.version_ejecutada if previous else None,
        })
    return rows

async def get_previous_failed_build_cases(db: AsyncSession, build_id: UUID):
    build_result = await db.execute(select(models.Build).filter(models.Build.id == build_id))
    target_build = build_result.scalar_one_or_none()
    if not target_build:
        return []

    previous_builds_query = (
        select(models.Build.id)
        .filter(models.Build.proyecto_id == target_build.proyecto_id)
        .filter(models.Build.id != target_build.id)
    )
    if target_build.componente_id:
        previous_builds_query = previous_builds_query.filter(models.Build.componente_id == target_build.componente_id)
    if target_build.fecha_creacion:
        previous_builds_query = previous_builds_query.filter(models.Build.fecha_creacion <= target_build.fecha_creacion)

    previous_builds_result = await db.execute(previous_builds_query)
    previous_build_ids = list(previous_builds_result.scalars().all())
    if not previous_build_ids:
        return []

    failed_rows_result = await db.execute(
        select(models.CasoPrueba.master_id, func.max(models.EjecucionCaso.fecha_ejecucion).label("last_failed_at"))
        .join(models.EjecucionCaso, models.EjecucionCaso.caso_id == models.CasoPrueba.id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .filter(models.TestRun.build_id.in_(previous_build_ids))
        .filter(models.EjecucionCaso.estado_resultado.in_([
            models.EstadoResultado.FALLO,
            models.EstadoResultado.BLOQUEADO,
        ]))
        .filter(models.CasoPrueba.proyecto_id == target_build.proyecto_id)
        .group_by(models.CasoPrueba.master_id)
    )
    failed_by_master = {
        master_id: last_failed_at
        for master_id, last_failed_at in failed_rows_result.all()
    }
    if not failed_by_master:
        return []

    latest_subq = (
        select(
            models.CasoPrueba.master_id,
            func.max(models.CasoPrueba.version).label("max_v"),
        )
        .filter(models.CasoPrueba.master_id.in_(failed_by_master.keys()))
        .filter(models.CasoPrueba.proyecto_id == target_build.proyecto_id)
        .filter(models.CasoPrueba.estado_caso.notin_(_non_executable_case_states()))
        .filter(*_visible_case_filter())
        .group_by(models.CasoPrueba.master_id)
        .subquery()
    )
    result = await db.execute(
        select(models.CasoPrueba)
        .join(
            latest_subq,
            (models.CasoPrueba.master_id == latest_subq.c.master_id)
            & (models.CasoPrueba.version == latest_subq.c.max_v),
        )
        .filter(models.CasoPrueba.proyecto_id == target_build.proyecto_id)
        .filter(models.CasoPrueba.estado_caso.notin_(_non_executable_case_states()))
        .filter(*_visible_case_filter())
        .order_by(models.CasoPrueba.codigo, models.CasoPrueba.titulo)
    )
    casos = [
        caso
        for caso in result.scalars().all()
        if not target_build.componente_id or caso.componente_id == target_build.componente_id
    ]
    if not casos:
        return []

    caso_ids = [caso.id for caso in casos]
    steps_count_result = await db.execute(
        select(models.PasoPrueba.caso_id, func.count(models.PasoPrueba.id))
        .filter(models.PasoPrueba.caso_id.in_(caso_ids))
        .group_by(models.PasoPrueba.caso_id)
    )
    steps_count_by_case = {
        caso_id: count
        for caso_id, count in steps_count_result.all()
    }
    for caso in casos:
        caso.latest_version = caso.version
        caso.latest_case_id = caso.id
        caso.is_outdated_version = False
        caso.steps_count = steps_count_by_case.get(caso.id, 0)
        caso.previous_failed_at = failed_by_master.get(caso.master_id)
    return casos

def _non_executable_case_states():
    return [models.EstadoCaso.DEPRECADO, models.EstadoCaso.ARCHIVADO]


async def set_build_casos(db: AsyncSession, build_id: UUID, caso_ids: list[UUID]):
    build_result = await db.execute(select(models.Build).filter(models.Build.id == build_id))
    db_build = build_result.scalar_one_or_none()
    if not db_build:
        return False, "Build no encontrada", []

    unique_ids = list(dict.fromkeys(caso_ids))
    casos = []
    if unique_ids:
        result = await db.execute(
            select(models.CasoPrueba).filter(
                models.CasoPrueba.id.in_(unique_ids),
                models.CasoPrueba.proyecto_id == db_build.proyecto_id,
                *_visible_case_filter(),
                models.CasoPrueba.estado_caso.notin_(_non_executable_case_states()),
            )
        )
        casos = result.scalars().all()
        valid_ids = {caso.id for caso in casos if not db_build.componente_id or caso.componente_id == db_build.componente_id}
        if len(valid_ids) != len(unique_ids):
            return False, "Hay casos invalidos, deprecados, archivados o de otro componente/proyecto", []
    else:
        valid_ids = set()

    current_result = await db.execute(select(models.BuildCaso.caso_id).filter(models.BuildCaso.build_id == build_id))
    current_ids = set(current_result.scalars().all())
    removed_ids = current_ids - valid_ids
    if removed_ids:
        removed_cases_result = await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id.in_(removed_ids)))
        removed_cases_by_id = {caso.id: caso for caso in removed_cases_result.scalars().all()}
        replacement_master_ids = {caso.master_id for caso in casos if caso.id in valid_ids}
        executed_result = await db.execute(
            select(models.CasoPrueba.id, models.CasoPrueba.codigo, models.CasoPrueba.titulo)
            .join(models.EjecucionCaso, models.EjecucionCaso.caso_id == models.CasoPrueba.id)
            .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
            .filter(models.TestRun.build_id == build_id)
            .filter(models.EjecucionCaso.caso_id.in_(removed_ids))
            .filter(models.EjecucionCaso.estado_resultado.in_([
                models.EstadoResultado.PASO,
                models.EstadoResultado.FALLO,
                models.EstadoResultado.BLOQUEADO,
            ]))
            .distinct()
        )
        locked_cases = [
            codigo or titulo
            for caso_id, codigo, titulo in executed_result.all()
            if not (
                removed_cases_by_id.get(caso_id)
                and removed_cases_by_id[caso_id].master_id in replacement_master_ids
            )
        ]
        if locked_cases:
            return False, f"No se pueden quitar casos ya ejecutados en esta build: {', '.join(locked_cases)}", []

    await db.execute(delete(models.BuildCaso).where(models.BuildCaso.build_id == build_id))
    for caso_id in valid_ids:
        db.add(models.BuildCaso(build_id=build_id, caso_id=caso_id))
    await db.commit()
    return True, "Casos asignados correctamente", await get_build_casos(db, build_id, limit=max(len(valid_ids), 1))

async def promote_build_case_version(db: AsyncSession, build_id: UUID, old_caso_id: UUID, new_caso_id: UUID):
    build_result = await db.execute(select(models.Build).filter(models.Build.id == build_id))
    db_build = build_result.scalar_one_or_none()
    if not db_build:
        return False, "Build no encontrada", []
    if not db_build.activo:
        return False, "La build esta inactiva y no permite nuevas ejecuciones", []

    cases_result = await db.execute(
        select(models.CasoPrueba).filter(models.CasoPrueba.id.in_([old_caso_id, new_caso_id]))
    )
    cases_by_id = {caso.id: caso for caso in cases_result.scalars().all()}
    old_case = cases_by_id.get(old_caso_id)
    new_case = cases_by_id.get(new_caso_id)
    if not old_case or not new_case:
        return False, "Caso de prueba no encontrado", []
    if old_case.master_id != new_case.master_id:
        return False, "Solo se puede actualizar a otra version del mismo caso", []
    if new_case.version <= old_case.version:
        return False, "La version destino debe ser mas nueva", []
    if new_case.estado_caso in _non_executable_case_states():
        return False, "La prueba fue deprecada o archivada y no se puede ejecutar", []
    if new_case.proyecto_id != db_build.proyecto_id or not new_case.activo:
        return False, "La nueva version no pertenece al proyecto o no esta activa", []
    if db_build.componente_id and new_case.componente_id != db_build.componente_id:
        return False, "La nueva version no pertenece al componente de la build", []

    current_result = await db.execute(select(models.BuildCaso.caso_id).filter(models.BuildCaso.build_id == build_id))
    current_ids = list(current_result.scalars().all())
    if old_caso_id not in current_ids:
        return False, "La version anterior no esta asignada a la build", []

    next_ids = []
    for caso_id in current_ids:
        if caso_id == old_caso_id:
            if new_caso_id not in next_ids:
                next_ids.append(new_caso_id)
        elif caso_id != new_caso_id and caso_id not in next_ids:
            next_ids.append(caso_id)

    return await set_build_casos(db, build_id, next_ids)

# --- SUITES ---
async def create_suite(db: AsyncSession, suite: schemas.SuiteCreate):
    data = suite.model_dump()
    if data.get("parent_id") and not data.get("componente_id"):
        parent = await get_suite(db, data["parent_id"])
        if parent:
            data["componente_id"] = parent.componente_id
    db_suite = models.Suite(**data)
    db.add(db_suite)
    await db.commit()
    await db.refresh(db_suite)
    return db_suite

async def get_suites_proyecto(db: AsyncSession, proyecto_id: UUID, componente_id: Optional[UUID] = None):
    query = select(models.Suite).filter(models.Suite.proyecto_id == proyecto_id)
    if componente_id:
        query = query.filter(models.Suite.componente_id == componente_id)
    result = await db.execute(query)
    return result.scalars().all()

async def get_root_suites_proyecto(db: AsyncSession, proyecto_id: UUID, componente_id: Optional[UUID] = None, include_archived: bool = False):
    filters = [
        models.Suite.proyecto_id == proyecto_id,
        models.Suite.activo == True,
    ]
    if not include_archived:
        filters.append(models.Suite.archivado == False)
    if componente_id:
        filters.append(models.Suite.componente_id == componente_id)
    result = await db.execute(
        select(models.Suite).filter(*filters).order_by(models.Suite.orden)
    )
    all_suites_db = result.scalars().all()
    suite_map = {str(s.id): schemas.Suite(
        id=s.id, proyecto_id=s.proyecto_id, componente_id=s.componente_id, parent_id=s.parent_id,
        nombre=s.nombre, descripcion=s.descripcion, color=s.color, icono=getattr(s, "icono", None) or "folder",
        orden=s.orden, activo=s.activo, archivado=s.archivado, children=[]
    ) for s in all_suites_db}
    roots = []
    for s_db in all_suites_db:
        s_schema = suite_map[str(s_db.id)]
        if s_db.parent_id:
            parent = suite_map.get(str(s_db.parent_id))
            if parent: parent.children.append(s_schema)
        else: roots.append(s_schema)
    return roots

async def get_suite(db: AsyncSession, suite_id: UUID):
    result = await db.execute(select(models.Suite).filter(models.Suite.id == suite_id))
    return result.scalar_one_or_none()

async def update_suite(db: AsyncSession, suite_id: UUID, suite_update: schemas.SuiteUpdate):
    db_suite = await get_suite(db, suite_id)
    if not db_suite:
        return None
    update_data = suite_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_suite, field, value)
    await db.commit()
    await db.refresh(db_suite)
    return db_suite

async def archive_suite_tree(db: AsyncSession, suite_id: UUID, archivado: bool) -> tuple[bool, str, dict]:
    db_suite = await get_suite(db, suite_id)
    if not db_suite or not db_suite.activo:
        return False, "Suite no encontrada", {}

    descendants = await get_all_descendant_suites(db, suite_id)
    all_suites = [db_suite] + descendants
    all_suite_ids = [suite.id for suite in all_suites]
    next_state = models.EstadoCaso.ARCHIVADO if archivado else models.EstadoCaso.ACTIVO

    for suite in all_suites:
        suite.archivado = archivado

    cases_result = await db.execute(
        select(models.CasoPrueba)
        .filter(
            models.CasoPrueba.suite_id.in_(all_suite_ids),
            *_visible_case_filter(),
        )
    )
    cases = cases_result.scalars().all()
    master_ids = {case.master_id for case in cases}
    if master_ids:
        versions_result = await db.execute(
            select(models.CasoPrueba).filter(
                models.CasoPrueba.master_id.in_(master_ids),
                *_visible_case_filter(),
            )
        )
        for version in versions_result.scalars().all():
            version.estado_caso = next_state

    await db.commit()
    action = "archivada" if archivado else "restaurada"
    return True, f"Suite {action} correctamente", {
        "suites_afectadas": len(all_suites),
        "casos_afectados": len(master_ids),
        "archivado": archivado,
    }

async def has_executions(db: AsyncSession, caso_id: UUID) -> bool:
    final_states = [
        models.EstadoResultado.PASO,
        models.EstadoResultado.FALLO,
        models.EstadoResultado.BLOQUEADO,
    ]
    result = await db.execute(
        select(models.EjecucionCaso.id)
        .filter(
            models.EjecucionCaso.caso_id == caso_id,
            models.EjecucionCaso.estado_resultado.in_(final_states),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None

async def get_all_descendant_suites(db: AsyncSession, suite_id: UUID) -> list:
    result = await db.execute(select(models.Suite).filter(models.Suite.parent_id == suite_id))
    children = result.scalars().all()
    all_descendants = list(children)
    for child in children:
        all_descendants.extend(await get_all_descendant_suites(db, child.id))
    return all_descendants

async def delete_suite(db: AsyncSession, suite_id: UUID) -> tuple[bool, str]:
    db_suite = await get_suite(db, suite_id)
    if not db_suite:
        return False, "Suite no encontrada"
    
    all_suite_ids = [suite_id] + [s.id for s in await get_all_descendant_suites(db, suite_id)]
    
    for sid in all_suite_ids:
        result = await db.execute(
            select(models.CasoPrueba).filter(
                models.CasoPrueba.suite_id == sid,
                models.CasoPrueba.activo == True
            )
        )
        casos = result.scalars().all()
        for caso in casos:
            if await has_executions(db, caso.id):
                return False, f"No se puede eliminar la suite porque el caso '{caso.titulo}' tiene ejecuciones"
    
    for sid in all_suite_ids:
        result = await db.execute(select(models.Suite).filter(models.Suite.id == sid))
        suite = result.scalar_one_or_none()
        if suite:
            suite.activo = False

    await db.execute(
        models.CasoPrueba.__table__.update()
        .where(models.CasoPrueba.suite_id.in_(all_suite_ids))
        .values(activo=False)
    )
    
    await db.commit()
    return True, "Suite eliminada correctamente"

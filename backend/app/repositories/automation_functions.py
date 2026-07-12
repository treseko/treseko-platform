from .legacy_common import *


async def get_funciones_proyecto(
    db: AsyncSession,
    proyecto_id: UUID,
    suite_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    include_componentes: bool = False,
    skip: int = 0,
    limit: int = 100,
):
    query = select(models.FuncionAutomatizada).filter(
        models.FuncionAutomatizada.proyecto_id == proyecto_id
    )
    if component_id:
        query = query.filter(
            (models.FuncionAutomatizada.scope == "PROYECTO")
            | (models.FuncionAutomatizada.componente_id == component_id)
            | (
                (models.FuncionAutomatizada.scope.is_(None))
                & (models.FuncionAutomatizada.suite_id.is_(None))
            )
        )
    elif suite_id:
        query = query.filter(models.FuncionAutomatizada.suite_id == suite_id)
    elif include_componentes:
        query = query.filter(
            (models.FuncionAutomatizada.suite_id.is_(None))
            & (
                (models.FuncionAutomatizada.scope == "PROYECTO")
                | (models.FuncionAutomatizada.scope == "COMPONENTE")
                | (models.FuncionAutomatizada.scope.is_(None))
            )
        )
    else:
        query = query.filter(
            (models.FuncionAutomatizada.suite_id.is_(None))
            & (
                (models.FuncionAutomatizada.scope == "PROYECTO")
                | (models.FuncionAutomatizada.scope.is_(None))
            )
        )
    query = query.order_by(models.FuncionAutomatizada.nombre, models.FuncionAutomatizada.version.desc())
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    funciones = result.scalars().all()
    seen_masters = set()
    latest = []
    for f in funciones:
        if f.master_id not in seen_masters:
            seen_masters.add(f.master_id)
            latest.append(f)
    return latest

async def get_funciones_herencia(
    db: AsyncSession,
    proyecto_id: UUID,
    suite_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    include_componentes: bool = False,
    skip: int = 0,
    limit: int = 100,
):
    project_query = select(models.FuncionAutomatizada).filter(
        models.FuncionAutomatizada.proyecto_id == proyecto_id,
        models.FuncionAutomatizada.suite_id.is_(None)
    )
    if component_id:
        project_query = project_query.filter(
            (models.FuncionAutomatizada.scope == "PROYECTO")
            | (models.FuncionAutomatizada.componente_id == component_id)
            | (
                (models.FuncionAutomatizada.scope.is_(None))
                & (models.FuncionAutomatizada.suite_id.is_(None))
            )
        )
    elif not include_componentes:
        project_query = project_query.filter(
            (models.FuncionAutomatizada.scope == "PROYECTO")
            | (models.FuncionAutomatizada.scope.is_(None))
        )

    result_proyecto = await db.execute(
        project_query.order_by(models.FuncionAutomatizada.nombre, models.FuncionAutomatizada.version.desc())
    )
    funciones = []
    seen_masters = set()
    for f in result_proyecto.scalars().all():
        if f.master_id not in seen_masters:
            seen_masters.add(f.master_id)
            funciones.append(f)

    if suite_id:
        suite_ids = []
        current_suite_id = suite_id
        while current_suite_id:
            suite_ids.append(current_suite_id)
            result_suite = await db.execute(
                select(models.Suite).filter(models.Suite.id == current_suite_id)
            )
            suite = result_suite.scalar_one_or_none()
            current_suite_id = suite.parent_id if suite else None

        for sid in reversed(suite_ids):
            result_suite_funcs = await db.execute(
                select(models.FuncionAutomatizada).filter(
                    models.FuncionAutomatizada.suite_id == sid
                ).order_by(models.FuncionAutomatizada.nombre, models.FuncionAutomatizada.version.desc())
            )
            for f in result_suite_funcs.scalars().all():
                if f.master_id not in seen_masters:
                    seen_masters.add(f.master_id)
                    funciones.append(f)

    # Aplicar paginación después de obtener todas las funciones
    return funciones[skip:skip+limit]

async def get_funcion_versions(db: AsyncSession, master_id: UUID):
    result = await db.execute(
        select(models.FuncionAutomatizada)
        .filter(models.FuncionAutomatizada.master_id == master_id)
        .order_by(models.FuncionAutomatizada.version.desc())
    )
    return result.scalars().all()

async def update_funcion_automatizada(db: AsyncSession, master_id: UUID, funcion_update: schemas.FuncionAutomatizadaUpdate, creado_por: UUID):
    current = await get_funcion_automatizada(db, master_id)
    if not current:
        return None
    update_data = funcion_update.model_dump(exclude_unset=True)
    new_version = models.FuncionAutomatizada(
        master_id=master_id,
        proyecto_id=current.proyecto_id,
        suite_id=update_data["suite_id"] if "suite_id" in update_data else current.suite_id,
        componente_id=update_data["componente_id"] if "componente_id" in update_data else current.componente_id,
        scope=update_data.get("scope") or current.scope or "PROYECTO",
        nombre=update_data.get("nombre") or current.nombre,
        descripcion=update_data["descripcion"] if "descripcion" in update_data else current.descripcion,
        codigo=update_data.get("codigo") or current.codigo,
        parametros=update_data["parametros"] if "parametros" in update_data else current.parametros,
        framework=update_data.get("framework") or current.framework,
        version=current.version + 1,
        creado_por=creado_por
    )
    db.add(new_version)
    await db.commit()
    await db.refresh(new_version)
    return new_version

async def delete_funcion_automatizada(db: AsyncSession, master_id: UUID):
    result = await db.execute(
        select(models.FuncionAutomatizada).filter(models.FuncionAutomatizada.master_id == master_id)
    )
    funciones = result.scalars().all()
    for f in funciones:
        await db.delete(f)
    await db.commit()
    return len(funciones) > 0

# --- VALIDACION DE SCRIPTS ---

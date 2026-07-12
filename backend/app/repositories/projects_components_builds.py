from .legacy_common import *
from ..project_status import PROJECT_ACTIVE_STATUSES, normalize_project_status
from ..services.edition.entitlement_service import enforce_limit
from ..time_utils import utc_now


async def add_organizacion_miembro(db: AsyncSession, org_id: UUID, miembro: schemas.OrganizacionMiembroCreate):
    result = await db.execute(
        select(models.OrganizacionMiembro).filter(
            models.OrganizacionMiembro.organizacion_id == org_id,
            models.OrganizacionMiembro.usuario_id == miembro.usuario_id,
        )
    )
    db_member = result.scalar_one_or_none()
    if db_member:
        db_member.rol_cliente = miembro.rol_cliente
    else:
        db_member = models.OrganizacionMiembro(
            organizacion_id=org_id,
            usuario_id=miembro.usuario_id,
            rol_cliente=miembro.rol_cliente,
        )
        db.add(db_member)
    await db.commit()
    result = await db.execute(
        select(models.OrganizacionMiembro)
        .options(selectinload(models.OrganizacionMiembro.usuario).selectinload(models.Usuario.rol_personalizado))
        .filter(models.OrganizacionMiembro.id == db_member.id)
    )
    return result.scalar_one()

async def delete_organizacion_miembro(db: AsyncSession, org_id: UUID, usuario_id: UUID):
    result = await db.execute(
        select(models.OrganizacionMiembro).filter(
            models.OrganizacionMiembro.organizacion_id == org_id,
            models.OrganizacionMiembro.usuario_id == usuario_id,
        )
    )
    db_member = result.scalar_one_or_none()
    if not db_member:
        return False
    await db.delete(db_member)
    await db.commit()
    return True

# --- PROYECTOS ---
async def get_proyectos(db: AsyncSession, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.Proyecto)
        .join(models.Organizacion, models.Organizacion.id == models.Proyecto.organizacion_id)
        .filter(models.Organizacion.activo.is_(True))
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def create_proyecto(db: AsyncSession, proyecto: schemas.ProyectoCreate):
    proyecto_data = proyecto.model_dump()
    if not proyecto_data.get("nombre"):
        raise ValueError("El nombre del proyecto es obligatorio")
    proyecto_data["organizacion_id"] = await resolve_project_organizacion(db, proyecto.organizacion_id)
    proyecto_data["estado"] = normalize_project_status(proyecto_data.get("estado"), proyecto_data.get("activo"))
    proyecto_data["activo"] = proyecto_data["estado"] in PROJECT_ACTIVE_STATUSES
    existing = await db.execute(select(models.Proyecto).filter(models.Proyecto.nombre == proyecto_data["nombre"]))
    if existing.scalar_one_or_none():
        raise ValueError("Ya existe un proyecto con ese nombre")
    proyecto_data["codigo"] = await generate_short_code(
        db,
        models.Proyecto,
        "PRJ",
        [models.Proyecto.organizacion_id == proyecto_data["organizacion_id"]],
    )
    db_proyecto = models.Proyecto(**proyecto_data)
    db.add(db_proyecto)
    await db.commit()
    await db.refresh(db_proyecto)
    return db_proyecto

async def get_proyecto(db: AsyncSession, proyecto_id: UUID):
    result = await db.execute(select(models.Proyecto).filter(models.Proyecto.id == proyecto_id))
    return result.scalar_one_or_none()

async def update_proyecto(db: AsyncSession, proyecto_id: UUID, proyecto_update: schemas.ProyectoUpdate):
    db_proyecto = await get_proyecto(db, proyecto_id)
    if not db_proyecto:
        return None
    update_data = proyecto_update.model_dump(exclude_unset=True)
    if update_data.get("nombre") is None and "nombre" in update_data:
        raise ValueError("El nombre del proyecto es obligatorio")
    if update_data.get("nombre"):
        existing = await db.execute(
            select(models.Proyecto).filter(
                models.Proyecto.nombre == update_data["nombre"],
                models.Proyecto.id != proyecto_id,
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError("Ya existe un proyecto con ese nombre")
    if "organizacion_id" in update_data:
        update_data["organizacion_id"] = await resolve_project_organizacion(db, update_data["organizacion_id"])
    if "estado" in update_data or "activo" in update_data:
        update_data["estado"] = normalize_project_status(update_data.get("estado"), update_data.get("activo", db_proyecto.activo))
        update_data["activo"] = update_data["estado"] in PROJECT_ACTIVE_STATUSES
    if update_data.get("imagen_url") is not None:
        update_data["imagen_url"] = str(update_data["imagen_url"]).strip() or None
    for field, value in update_data.items():
        setattr(db_proyecto, field, value)
    await db.commit()
    await db.refresh(db_proyecto)
    return db_proyecto

async def get_proyecto_miembros(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.ProyectoMiembro)
        .options(selectinload(models.ProyectoMiembro.usuario).selectinload(models.Usuario.rol_personalizado))
        .filter(models.ProyectoMiembro.proyecto_id == proyecto_id)
        .order_by(models.ProyectoMiembro.fecha_asignacion)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

def _organization_role_for_project_role(project_role: str):
    return "MEMBER"

async def ensure_project_user_organization_membership(db: AsyncSession, proyecto_id: UUID, usuario_id: UUID, rol_proyecto: str = "MEMBER"):
    project = await get_proyecto(db, proyecto_id)
    if not project:
        return
    result = await db.execute(
        select(models.OrganizacionMiembro).filter(
            models.OrganizacionMiembro.organizacion_id == project.organizacion_id,
            models.OrganizacionMiembro.usuario_id == usuario_id,
        )
    )
    if result.scalar_one_or_none():
        return
    count_result = await db.execute(
        select(func.count())
        .select_from(models.OrganizacionMiembro)
        .filter(models.OrganizacionMiembro.organizacion_id == project.organizacion_id)
    )
    await enforce_limit(
        db,
        "max_users",
        int(count_result.scalar() or 0),
        tenant_id=str(project.organizacion_id),
    )
    db.add(models.OrganizacionMiembro(
        organizacion_id=project.organizacion_id,
        usuario_id=usuario_id,
        rol_cliente=_organization_role_for_project_role(rol_proyecto),
    ))

async def add_proyecto_miembro(
    db: AsyncSession,
    proyecto_id: UUID,
    miembro: schemas.ProyectoMiembroCreate,
    ensure_organization_membership: bool = False,
):
    result = await db.execute(
        select(models.ProyectoMiembro).filter(
            models.ProyectoMiembro.proyecto_id == proyecto_id,
            models.ProyectoMiembro.usuario_id == miembro.usuario_id,
        )
    )
    db_member = result.scalar_one_or_none()
    if db_member:
        db_member.rol_proyecto = miembro.rol_proyecto
    else:
        db_member = models.ProyectoMiembro(
            proyecto_id=proyecto_id,
            usuario_id=miembro.usuario_id,
            rol_proyecto=miembro.rol_proyecto,
        )
        db.add(db_member)
    if ensure_organization_membership:
        await ensure_project_user_organization_membership(db, proyecto_id, miembro.usuario_id, miembro.rol_proyecto)
    await db.commit()
    result = await db.execute(
        select(models.ProyectoMiembro)
        .options(selectinload(models.ProyectoMiembro.usuario).selectinload(models.Usuario.rol_personalizado))
        .filter(models.ProyectoMiembro.id == db_member.id)
    )
    return result.scalar_one()

async def delete_proyecto_miembro(db: AsyncSession, proyecto_id: UUID, usuario_id: UUID):
    result = await db.execute(
        select(models.ProyectoMiembro).filter(
            models.ProyectoMiembro.proyecto_id == proyecto_id,
            models.ProyectoMiembro.usuario_id == usuario_id,
        )
    )
    db_member = result.scalar_one_or_none()
    if not db_member:
        return False
    await db.delete(db_member)
    await db.commit()
    return True

# --- COMPONENTES ---
async def create_componente(db: AsyncSession, comp: schemas.ComponenteCreate):
    comp_data = comp.model_dump()
    comp_data["codigo"] = await generate_short_code(
        db,
        models.Componente,
        "CMP",
        [models.Componente.proyecto_id == comp_data["proyecto_id"]],
    )
    db_comp = models.Componente(**comp_data)
    db.add(db_comp)
    await db.commit()
    await db.refresh(db_comp)
    return db_comp

async def get_componentes_proyecto(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.Componente)
        .filter(models.Componente.proyecto_id == proyecto_id)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def update_componente(db: AsyncSession, componente_id: UUID, comp_update: schemas.ComponenteUpdate):
    result = await db.execute(select(models.Componente).filter(models.Componente.id == componente_id))
    db_comp = result.scalar_one_or_none()
    if not db_comp:
        return None
    for field, value in comp_update.model_dump(exclude_unset=True).items():
        setattr(db_comp, field, value)
    await db.commit()
    await db.refresh(db_comp)
    return db_comp

async def delete_componente(db: AsyncSession, componente_id: UUID):
    result = await db.execute(select(models.Componente).filter(models.Componente.id == componente_id))
    db_comp = result.scalar_one_or_none()
    if not db_comp:
        return False
    await db.delete(db_comp)
    await db.commit()
    return True

# --- BUILDS ---
async def get_builds_proyecto(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.Build)
        .filter(models.Build.proyecto_id == proyecto_id)
        .order_by(models.Build.fecha_creacion.desc(), models.Build.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def get_builds_componente(db: AsyncSession, componente_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.Build)
        .filter(models.Build.componente_id == componente_id)
        .order_by(models.Build.fecha_creacion.desc(), models.Build.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def create_build(db: AsyncSession, build: schemas.BuildCreate):
    if build.activo:
        await db.execute(
            select(models.Build.id)
            .where(models.Build.componente_id == build.componente_id)
            .with_for_update()
        )
        await db.execute(
            models.Build.__table__.update()
            .where(models.Build.componente_id == build.componente_id)
            .values(activo=False)
        )
    build_data = build.model_dump()
    build_data["codigo"] = await generate_short_code(
        db,
        models.Build,
        "BLD",
        [models.Build.componente_id == build.componente_id],
    )
    db_build = models.Build(**build_data)
    db.add(db_build)
    await db.commit()
    await db.refresh(db_build)
    return db_build

async def update_build(db: AsyncSession, build_id: UUID, build_update: schemas.BuildUpdate):
    result = await db.execute(
        select(models.Build)
        .filter(models.Build.id == build_id)
        .with_for_update()
    )
    db_build = result.scalar_one_or_none()
    if not db_build:
        return None
    update_data = build_update.model_dump(exclude_unset=True)
    if "componente_id" in update_data:
        if update_data["componente_id"] != db_build.componente_id:
            raise ValueError("No se puede mover una build entre componentes.")
        update_data.pop("componente_id")
    target_component_id = db_build.componente_id
    if update_data.get("activo") is True:
        await db.execute(
            select(models.Build.id)
            .where(models.Build.componente_id == target_component_id)
            .with_for_update()
        )
        await db.execute(
            models.Build.__table__.update()
            .where(models.Build.componente_id == target_component_id)
            .where(models.Build.id != db_build.id)
            .values(activo=False)
        )
        if db_build.fecha_inicio is None:
            update_data["fecha_inicio"] = utc_now()
    elif update_data.get("activo") is False and "fecha_fin" not in build_update.model_fields_set:
        update_data["fecha_fin"] = utc_now()
    for field, value in update_data.items():
        setattr(db_build, field, value)
    await db.commit()
    await db.refresh(db_build)
    return db_build

async def delete_build(db: AsyncSession, build_id: UUID):
    result = await db.execute(select(models.Build).filter(models.Build.id == build_id))
    db_build = result.scalar_one_or_none()
    if not db_build:
        return False
    await db.delete(db_build)
    await db.commit()
    return True

async def get_build_casos(db: AsyncSession, build_id: UUID, skip: int = 0, limit: int = 200):
    result = await db.execute(
        select(models.CasoPrueba)
        .join(models.BuildCaso, models.BuildCaso.caso_id == models.CasoPrueba.id)
        .filter(models.BuildCaso.build_id == build_id, *_visible_case_filter())
        .order_by(models.CasoPrueba.codigo, models.CasoPrueba.titulo)
        .offset(skip)
        .limit(limit)
    )
    casos = result.scalars().all()
    if not casos:
        return []

    caso_ids = [caso.id for caso in casos]
    master_ids = {caso.master_id for caso in casos}
    steps_count_result = await db.execute(
        select(models.PasoPrueba.caso_id, func.count(models.PasoPrueba.id))
        .filter(models.PasoPrueba.caso_id.in_(caso_ids))
        .group_by(models.PasoPrueba.caso_id)
    )
    steps_count_by_case = {
        caso_id: count
        for caso_id, count in steps_count_result.all()
    }
    latest_subq = (
        select(
            models.CasoPrueba.master_id,
            func.max(models.CasoPrueba.version).label("max_v"),
        )
        .filter(models.CasoPrueba.master_id.in_(master_ids))
        .filter(*_visible_case_filter())
        .group_by(models.CasoPrueba.master_id)
        .subquery()
    )
    latest_result = await db.execute(
        select(models.CasoPrueba).join(
            latest_subq,
            (models.CasoPrueba.master_id == latest_subq.c.master_id)
            & (models.CasoPrueba.version == latest_subq.c.max_v),
        )
    )
    latest_by_master = {caso.master_id: caso for caso in latest_result.scalars().all()}
    for caso in casos:
        latest = latest_by_master.get(caso.master_id)
        caso.latest_version = latest.version if latest else caso.version
        caso.latest_case_id = latest.id if latest else caso.id
        caso.is_outdated_version = bool(latest and latest.id != caso.id)
        caso.steps_count = steps_count_by_case.get(caso.id, 0)
    return casos

async def get_project_build_case_ids(db: AsyncSession, proyecto_id: UUID):
    result = await db.execute(
        select(models.BuildCaso.build_id, models.BuildCaso.caso_id)
        .join(models.Build, models.Build.id == models.BuildCaso.build_id)
        .filter(models.Build.proyecto_id == proyecto_id)
        .order_by(models.BuildCaso.build_id)
    )
    grouped: dict[str, list[str]] = {}
    for build_id, caso_id in result.all():
        grouped.setdefault(str(build_id), []).append(str(caso_id))
    return grouped

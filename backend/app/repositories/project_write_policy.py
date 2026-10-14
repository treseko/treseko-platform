"""Rules shared by project creation, updates and imports."""
from sqlalchemy import func, select

from .. import models
from ..services.edition.entitlement_service import enforce_limit
from ..services.edition.entitlement_provider import get_entitlement_provider


async def lock_project_writes(db):
    # One transaction lock also covers transfers between organizations without
    # taking organization locks in competing orders. PostgreSQL is the runtime DB.
    if db.bind.dialect.name == "postgresql":
        await db.execute(select(func.pg_advisory_xact_lock(202610100071)))


async def prepare_project_write(db, organization_id):
    # Resolve entitlements before the capacity lock: license refresh may commit.
    # Reuse this snapshot only inside the current request's database session.
    snapshots = db.info.setdefault("project_entitlements", {})
    key = str(organization_id)
    if key not in snapshots:
        snapshots[key] = await get_entitlement_provider().get_state(db, tenant_id=key)
    await lock_project_writes(db)


async def validate_project_capacity(db, organization_id, *, exclude_project_id=None):
    query = select(func.count()).select_from(models.Proyecto).where(
        models.Proyecto.organizacion_id == organization_id,
        models.Proyecto.activo.is_(True),
    )
    if exclude_project_id is not None:
        query = query.where(models.Proyecto.id != exclude_project_id)
    count = await db.scalar(query)
    state = db.info["project_entitlements"][str(organization_id)]
    await enforce_limit(db, "max_projects", int(count or 0), tenant_id=str(organization_id), state=state)


async def validate_project_name(db, organization_id, name, *, exclude_project_id=None):
    query = select(models.Proyecto.id).where(
        models.Proyecto.organizacion_id == organization_id,
        models.Proyecto.nombre == name,
    )
    if exclude_project_id is not None:
        query = query.where(models.Proyecto.id != exclude_project_id)
    if await db.scalar(query):
        raise ValueError("Ya existe un proyecto con ese nombre en esta organización")

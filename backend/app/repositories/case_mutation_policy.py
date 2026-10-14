"""Shared guards for case versions and archive operations."""
import hashlib
from uuid import UUID
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from .. import models


class CaseArchiveConflict(ValueError):
    """A case remains assigned to an active build."""


async def lock_case_master(db: AsyncSession, master_id: UUID) -> None:
    # Lock a stable identity, including while a new version does not exist yet.
    if db.bind.dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(f"case:{master_id}".encode()).digest()[:8], "big", signed=True)
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


async def current_case_for_write(db: AsyncSession, master_id: UUID):
    await lock_case_master(db, master_id)
    return await db.scalar(select(models.CasoPrueba).where(
        models.CasoPrueba.master_id == master_id,
    ).order_by(models.CasoPrueba.version.desc()).limit(1).with_for_update().execution_options(populate_existing=True))


async def require_archivable_masters(db: AsyncSession, master_ids) -> None:
    if not master_ids:
        return
    builds = (await db.execute(select(models.Build.nombre).join(
        models.BuildCaso, models.BuildCaso.build_id == models.Build.id,
    ).join(models.CasoPrueba, models.CasoPrueba.id == models.BuildCaso.caso_id).where(
        models.CasoPrueba.master_id.in_(list(master_ids)),
        models.Build.estado == "ACTIVA", models.Build.activo.is_(True),
    ).distinct().order_by(models.Build.nombre))).scalars().all()
    if builds:
        raise CaseArchiveConflict(
            f"No se puede archivar la prueba o suite porque tiene casos asignados a una build activa ({', '.join(builds)}). Retíralos de esa build antes de archivarlos."
        )


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

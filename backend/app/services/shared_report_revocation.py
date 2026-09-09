from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from .. import models


async def hydrate_legacy_revocation_actor(db: AsyncSession, snapshot) -> None:
    """Resolve the revoker for snapshots created before ``revoked_by``."""
    if not snapshot or not snapshot.revoked_at or snapshot.revoked_by:
        return
    result = await db.execute(
        select(models.Usuario, models.AuditLog.recurso_id, models.AuditLog.detalles)
        .join(models.AuditLog, models.AuditLog.usuario_id == models.Usuario.id)
        .filter(
            models.AuditLog.accion == "REVOKE",
            models.AuditLog.recurso == "shared_report",
        )
        .order_by(models.AuditLog.fecha.desc())
    )
    group_id = ((snapshot.payload or {}).get("metadata") or {}).get("snapshot_group_id")
    for actor, resource_id, details in result.all():
        details = details if isinstance(details, dict) else {}
        if resource_id == snapshot.id or (group_id and details.get("snapshot_group_id") == group_id):
            snapshot._revocation_actor = actor
            return

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import access_control
from . import models


async def attachment_has_project_link(db: AsyncSession, attachment_id: UUID, proyecto_id: UUID) -> bool:
    step_row = (await db.execute(
        select(models.PasoAttachment.id)
        .join(models.PasoPrueba, models.PasoPrueba.id == models.PasoAttachment.paso_id)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.PasoPrueba.caso_id)
        .filter(models.PasoAttachment.attachment_id == attachment_id)
        .filter(models.CasoPrueba.proyecto_id == proyecto_id)
        .limit(1)
    )).scalar_one_or_none()
    if step_row:
        return True

    snapshot_row = (await db.execute(
        select(models.SnapshotAttachment.id)
        .join(models.SnapshotPaso, models.SnapshotPaso.id == models.SnapshotAttachment.snapshot_id)
        .join(models.EjecucionCaso, models.EjecucionCaso.id == models.SnapshotPaso.ejecucion_caso_id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .filter(models.SnapshotAttachment.attachment_id == attachment_id)
        .filter(models.TestRun.proyecto_id == proyecto_id)
        .limit(1)
    )).scalar_one_or_none()
    if snapshot_row:
        return True

    bug_row = (await db.execute(
        select(models.BugAttachment.id)
        .join(models.BugIssue, models.BugIssue.id == models.BugAttachment.bug_id)
        .filter(models.BugAttachment.attachment_id == attachment_id)
        .filter(models.BugIssue.proyecto_id == proyecto_id)
        .limit(1)
    )).scalar_one_or_none()
    return bool(bug_row)


async def require_attachment_link_access(
    db: AsyncSession,
    current_user: models.Usuario,
    attachment: models.Attachment,
    proyecto_id: UUID,
) -> None:
    if current_user.rol == models.Rol.ADMIN or attachment.created_by == current_user.id:
        return
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if await attachment_has_project_link(db, attachment.id, proyecto_id):
        return
    raise HTTPException(status_code=403, detail="No tienes permisos para vincular esta evidencia")

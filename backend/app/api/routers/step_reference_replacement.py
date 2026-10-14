"""Atomic replacement of editor reference links, preserving other evidence."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from ... import auth, crud, models, schemas, access_control
from ...database import get_db
from ...attachment_access import require_attachment_link_access
from ...repositories.case_mutation_policy import current_case_for_write

router = APIRouter(tags=["attachments"])
REFERENCE_TYPES = {"ACTION_REFERENCE", "EXPECTED_REFERENCE"}


class ReferenceReplacement(BaseModel):
    attachments: list[schemas.AttachmentLinkCreate] = Field(default_factory=list, max_length=100)


@router.put("/pasos/{paso_id}/references/", response_model=list[schemas.PasoAttachment])
async def replace_step_references(
    paso_id: UUID, payload: ReferenceReplacement, db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.adjuntos", "edit")),
):
    step = await db.get(models.PasoPrueba, paso_id)
    if not step:
        raise HTTPException(status_code=404, detail="Paso no encontrado")
    case = await db.get(models.CasoPrueba, step.caso_id)
    await access_control.require_project_access(db, current_user, case.proyecto_id, "edit")
    current = await current_case_for_write(db, case.master_id)
    if current.id != case.id:
        raise HTTPException(status_code=409, detail="La versión del caso cambió. Recarga la prueba antes de editarla.")
    # The master lock also serializes concurrent edits that replace step IDs.
    step = await db.scalar(select(models.PasoPrueba).where(models.PasoPrueba.id == paso_id).with_for_update().execution_options(populate_existing=True))
    if not step:
        raise HTTPException(status_code=409, detail="Los pasos cambiaron. Recarga la prueba antes de editarla.")
    desired = {(item.attachment_id, item.tipo) for item in payload.attachments}
    if any(kind not in REFERENCE_TYPES for _, kind in desired):
        raise HTTPException(status_code=422, detail="Solo se admiten referencias de acción o resultado esperado")
    for attachment_id, _ in desired:
        attachment = await crud.get_attachment(db, attachment_id)
        if not attachment:
            raise HTTPException(status_code=404, detail="Adjunto no encontrado")
        await require_attachment_link_access(db, current_user, attachment, case.proyecto_id)
    existing = await crud.get_paso_attachments(db, paso_id)
    other_count = sum(link.tipo not in REFERENCE_TYPES for link in existing)
    config = await crud.get_attachment_config(db)
    if other_count + len(desired) > int(config["max_files_per_step"]):
        raise HTTPException(status_code=400, detail="El paso supera el máximo de adjuntos permitido")
    try:
        await db.execute(delete(models.PasoAttachment).where(
            models.PasoAttachment.paso_id == paso_id, models.PasoAttachment.tipo.in_(REFERENCE_TYPES),
        ))
        db.add_all([models.PasoAttachment(paso_id=paso_id, attachment_id=aid, tipo=kind) for aid, kind in desired])
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=503, detail="No se pudieron guardar las referencias; se conservaron los vínculos anteriores") from exc
    return await crud.get_paso_attachments(db, paso_id)

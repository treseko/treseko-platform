from fastapi import APIRouter
from pydantic import BaseModel, Field

from ...main_context import *
from ...services.edition.entitlement_service import require_feature


router = APIRouter(tags=["Auditoria"], dependencies=[Depends(require_feature("audit.advanced"))])


class SecretRevealAuditRequest(BaseModel):
    run_id: Optional[UUID] = None
    variable: str = Field(min_length=1, max_length=160)
    context: Optional[str] = Field(default=None, max_length=120)

@router.get("/audit/logs/", response_model=List[schemas.AuditLog])
async def read_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    usuario_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_role([models.Rol.ADMIN]))
):
    logs = await crud.get_audit_logs(db, skip=skip, limit=limit, usuario_id=usuario_id)
    user_ids = {log.usuario_id for log in logs if log.usuario_id}
    users_by_id = {}
    if user_ids:
        result = await db.execute(select(models.Usuario).where(models.Usuario.id.in_(user_ids)))
        users_by_id = {user.id: user for user in result.scalars().all()}
    return [
        schemas.AuditLog(
            id=log.id,
            usuario_id=log.usuario_id,
            usuario_email=users_by_id.get(log.usuario_id).email if log.usuario_id in users_by_id else None,
            usuario_nombre=users_by_id.get(log.usuario_id).display_name
            or users_by_id.get(log.usuario_id).nombre_completo
            if log.usuario_id in users_by_id
            else None,
            accion=log.accion,
            recurso=log.recurso,
            recurso_id=log.recurso_id,
            detalles=log.detalles,
            ip_address=log.ip_address,
            fecha=log.fecha,
        )
        for log in logs
    ]


@router.post("/audit/secret-reveals/")
async def audit_secret_reveal(
    request: Request,
    payload: SecretRevealAuditRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_role([models.Rol.ADMIN])),
):
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="SECRET_REVEAL",
        recurso="run_frozen_variable",
        recurso_id=payload.run_id,
        detalles={
            "variable": payload.variable,
            "context": payload.context or "run_detail",
            "value": "[redacted]",
        },
        ip_address=request.client.host if request.client else None,
    )
    return {"ok": True}

# --- ENDPOINTS ORGANIZACIONES ---

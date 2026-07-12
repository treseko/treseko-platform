from fastapi import APIRouter

from ...main_context import *
from ...services.edition.entitlement_service import require_feature


router = APIRouter(tags=["Auditoria"], dependencies=[Depends(require_feature("audit.advanced"))])

@router.get("/audit/logs/", response_model=List[schemas.AuditLog])
async def read_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    usuario_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_role([models.Rol.ADMIN]))
):
    return await crud.get_audit_logs(db, skip=skip, limit=limit, usuario_id=usuario_id)

# --- ENDPOINTS ORGANIZACIONES ---

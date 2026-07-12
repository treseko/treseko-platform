from fastapi import APIRouter
from typing import Annotated

from ...main_context import *


router = APIRouter(tags=["Roles"])

def _require_global_admin_for_role_mutation(current_user: models.Usuario):
    if current_user.rol != models.Rol.ADMIN:
        raise HTTPException(status_code=403, detail="Solo un administrador global puede modificar roles personalizados")

@router.get("/roles/", response_model=List[schemas.RolPersonalizado])
async def read_roles_personalizados(
    include_inactive: bool = False,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.roles", "read"))
):
    return await crud.get_roles_personalizados(db, include_inactive=include_inactive, skip=skip, limit=limit)


@router.post("/roles/", response_model=schemas.RolPersonalizado)
async def create_rol_personalizado(
    request: Request,
    role: schemas.RolPersonalizadoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.roles", "edit"))
):
    _require_global_admin_for_role_mutation(current_user)
    existing = await crud.get_rol_personalizado_by_name(db, role.nombre)
    if existing:
        raise HTTPException(status_code=400, detail="El rol ya existe")
    new_role = await crud.create_rol_personalizado(db, role=role)
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="rol_personalizado",
        recurso_id=new_role.id,
        detalles={"nombre": role.nombre},
        ip_address=client_ip
    )
    
    return new_role


@router.patch("/roles/{role_id}", response_model=schemas.RolPersonalizado)
async def update_rol_personalizado(
    request: Request,
    role_id: UUID,
    role: schemas.RolPersonalizadoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.roles", "edit"))
):
    _require_global_admin_for_role_mutation(current_user)
    updated = await crud.update_rol_personalizado(db=db, role_id=role_id, role_update=role)
    if not updated:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE",
        recurso="rol_personalizado",
        recurso_id=role_id,
        detalles=role.model_dump(exclude_unset=True),
        ip_address=client_ip
    )
    await notification_event_service.emit_event(
        db=db,
        event_type="role.permissions_changed",
        actor_user_id=current_user.id,
        entity_type="role",
        entity_id=role_id,
        severity="info",
        payload={"role": {"id": str(role_id), "nombre": updated.nombre}, "actor": {"email": current_user.email}, "message": "Permisos de rol actualizados"},
        dedupe_key=f"role.permissions_changed:{role_id}:{utc_now().strftime('%Y%m%d%H%M')}",
    )
    
    return updated


@router.delete("/roles/{role_id}", response_model=schemas.RolPersonalizado)
async def deactivate_rol_personalizado(
    request: Request,
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.roles", "edit"))
):
    _require_global_admin_for_role_mutation(current_user)
    updated = await crud.deactivate_rol_personalizado(db=db, role_id=role_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="DEACTIVATE",
        recurso="rol_personalizado",
        recurso_id=role_id,
        ip_address=client_ip
    )
    await notification_event_service.emit_event(
        db=db,
        event_type="role.permissions_changed",
        actor_user_id=current_user.id,
        entity_type="role",
        entity_id=role_id,
        severity="warning",
        payload={"role": {"id": str(role_id), "nombre": updated.nombre}, "actor": {"email": current_user.email}, "message": "Rol desactivado"},
        dedupe_key=f"role.permissions_changed:{role_id}:deactivated",
    )
    
    return updated

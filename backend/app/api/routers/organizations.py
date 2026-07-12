from fastapi import APIRouter
from sqlalchemy import func

from ...main_context import *
from ...services.edition.entitlement_service import enforce_limit


router = APIRouter(tags=["Organizaciones"])

@router.post("/organizaciones/", response_model=schemas.Organizacion)
async def create_organizacion(
    org: schemas.OrganizacionCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("clientes", "edit"))
):
    count_result = await db.execute(
        select(func.count()).select_from(models.Organizacion).filter(models.Organizacion.activo.is_(True))
    )
    await enforce_limit(db, "max_organizations", int(count_result.scalar() or 0))
    try:
        return await crud.create_organizacion(db=db, org=org)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.get("/organizaciones/", response_model=List[schemas.Organizacion])
async def read_organizaciones(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("clientes", "read"))
):
    if include_inactive and current_user.rol != models.Rol.ADMIN:
        raise HTTPException(status_code=403, detail="Solo ADMIN puede listar soluciones inactivas")
    if current_user.rol != models.Rol.ADMIN:
        result = await db.execute(
            select(models.Organizacion)
            .join(models.OrganizacionMiembro)
            .filter(
                models.OrganizacionMiembro.usuario_id == current_user.id,
                models.Organizacion.activo.is_(True),
            )
            .order_by(models.Organizacion.nombre)
            .offset(skip)
            .limit(limit)
        )
        return result.scalars().all()
    return await crud.get_organizaciones(db, skip=skip, limit=limit, include_inactive=include_inactive)

@router.patch("/organizaciones/{org_id}", response_model=schemas.Organizacion)
async def update_organizacion(
    org_id: UUID,
    org: schemas.OrganizacionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("clientes", "edit"))
):
    await access_control.require_organization_access(
        db,
        current_user,
        org_id,
        "manage",
        allow_inactive_for_admin=True,
    )
    if org.activo is True and current_user.rol != models.Rol.ADMIN:
        raise HTTPException(status_code=403, detail="Solo ADMIN puede reactivar soluciones")
    try:
        db_org = await crud.update_organizacion(db=db, org_id=org_id, org_update=org)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if db_org is None:
        raise HTTPException(status_code=404, detail="Organización no encontrada")
    return db_org

@router.get("/organizaciones/{org_id}/miembros/", response_model=List[schemas.OrganizacionMiembro])
async def read_organizacion_miembros(
    org_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("clientes", "read"))
):
    await access_control.require_organization_access(db, current_user, org_id, "read")
    return await crud.get_organizacion_miembros(db=db, org_id=org_id, skip=skip, limit=limit)

@router.post("/organizaciones/{org_id}/miembros/", response_model=schemas.OrganizacionMiembro)
async def add_organizacion_miembro(
    org_id: UUID,
    miembro: schemas.OrganizacionMiembroCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("clientes", "edit"))
):
    await access_control.require_organization_access(db, current_user, org_id, "manage")
    user = await crud.get_user(db, miembro.usuario_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    existing_member = await db.execute(
        select(models.OrganizacionMiembro.id).filter(
            models.OrganizacionMiembro.organizacion_id == org_id,
            models.OrganizacionMiembro.usuario_id == miembro.usuario_id,
        )
    )
    if not existing_member.scalar_one_or_none():
        count_result = await db.execute(
            select(func.count())
            .select_from(models.OrganizacionMiembro)
            .filter(models.OrganizacionMiembro.organizacion_id == org_id)
        )
        await enforce_limit(
            db,
            "max_users",
            int(count_result.scalar() or 0),
            tenant_id=str(org_id),
        )
    return await crud.add_organizacion_miembro(db=db, org_id=org_id, miembro=miembro)

@router.delete("/organizaciones/{org_id}/miembros/{usuario_id}")
async def delete_organizacion_miembro(
    org_id: UUID,
    usuario_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("clientes", "edit"))
):
    await access_control.require_organization_access(db, current_user, org_id, "manage")
    deleted = await crud.delete_organizacion_miembro(db=db, org_id=org_id, usuario_id=usuario_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Miembro de organización no encontrado")
    return {"ok": True}

# --- ENDPOINTS PROYECTOS (PROTEGIDOS) ---

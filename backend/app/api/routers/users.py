from fastapi import APIRouter
from typing import Annotated

from ...main_context import *
from ...services.auth_ad import ldap_service
from ...services.auth_ad import user_sync_service


router = APIRouter(tags=["Users"])

CONTROL_PLANE_PERMISSION_MODULES = {
    "clientes",
    "configuracion",
    "integraciones",
    "plugins",
    "notificaciones",
}

def _admin_boundary_forbidden():
    raise HTTPException(status_code=403, detail="Solo un administrador global puede gestionar cuentas ADMIN")


async def _get_user_or_404(db: AsyncSession, usuario_id: UUID):
    db_user = await crud.get_user(db, usuario_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return db_user


def _ensure_admin_boundary(
    current_user: models.Usuario,
    *,
    target_user: Optional[models.Usuario] = None,
    requested_role: Optional[models.Rol] = None,
):
    if current_user.rol == models.Rol.ADMIN:
        return
    if requested_role == models.Rol.ADMIN:
        _admin_boundary_forbidden()
    if target_user and target_user.rol == models.Rol.ADMIN:
        _admin_boundary_forbidden()


def _requested_control_plane_permissions(payload) -> bool:
    data = payload.model_dump(exclude_unset=True)
    if data.get("rol_custom_id"):
        return True
    modules = set(data.get("modulos") or [])
    permission_modules = set((data.get("permisos") or {}).keys())
    capability_modules = {
        str(capability).split(".", 1)[0]
        for capability in (data.get("permisos_detallados") or {}).keys()
    }
    return bool((modules | permission_modules | capability_modules) & CONTROL_PLANE_PERMISSION_MODULES)


def _ensure_control_plane_permission_boundary(current_user: models.Usuario, payload) -> None:
    if current_user.rol == models.Rol.ADMIN:
        return
    if _requested_control_plane_permissions(payload):
        raise HTTPException(
            status_code=403,
            detail="Solo un administrador global puede asignar permisos de configuracion o integraciones",
        )


async def _lookup_ad_user_or_error(db: AsyncSession, identifier: str) -> dict:
    config = await notification_config_service.get_auth_ad_oidc_config(db)
    if not config.get("enabled") or config.get("mode") != "ldap":
        raise HTTPException(status_code=400, detail="Active Directory LDAP no esta habilitado para validar usuarios")
    try:
        found = await ldap_service.find_user(config, identifier)
    except ldap_service.LdapLookupUnavailableError as exc:
        raise HTTPException(status_code=400, detail="No se puede validar usuarios AD: falta configurar cuenta tecnica LDAP de lectura") from exc
    except ldap_service.LdapLookupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not found:
        raise HTTPException(status_code=400, detail="El usuario no existe en Active Directory/LDAP")
    return found


async def _ensure_ad_user_exists(db: AsyncSession, identifier: str) -> None:
    await _lookup_ad_user_or_error(db, identifier)

@router.get("/users/me/preferences", response_model=schemas.UserPreferences)
async def read_my_preferences(current_user: models.Usuario = Depends(auth.check_capability("configuracion.preferencias", "read"))):
    return schemas.UserPreferences(
        personal_theme=current_user.personal_theme or "system",
        profile_settings=current_user.profile_settings or {},
        project_theme_overrides=current_user.project_theme_overrides or {},
    )


@router.patch("/users/me/preferences", response_model=schemas.UserPreferences)
async def update_my_preferences(
    preferences: schemas.UserPreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.preferencias", "edit"))
):
    try:
        return await crud.update_my_preferences(db, current_user, preferences)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/users/me/password", response_model=schemas.UserPreferences)
async def change_my_password(
    payload: schemas.UserPasswordChange,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    if current_user.auth_provider != "local":
        raise HTTPException(status_code=400, detail="La contraseña solo puede cambiarse para cuentas locales.")
    if not auth.verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta.")
    if auth.verify_password(payload.new_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="La nueva contraseña debe ser distinta a la actual.")
    return await crud.change_my_password(db, current_user, auth.get_password_hash(payload.new_password))


@router.patch("/users/me/profile", response_model=schemas.Usuario)
async def update_my_profile(
    profile: schemas.UserProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.perfil", "edit"))
):
    try:
        updated = await crud.update_my_profile(db, current_user, profile)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    updated.permisos = auth.effective_permissions_for_user(updated)
    updated.modulos = auth.effective_modules_for_user(updated)
    updated.permisos_detallados = auth.effective_capabilities_for_user(updated)
    return updated


@router.post("/users/me/api-keys/", response_model=schemas.ApiKeyCreated)
async def create_my_api_key(
    request: Request,
    payload: schemas.ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.api_keys", "edit"))
):
    try:
        db_key, raw_key = await crud.create_api_key(db, current_user.id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="api_key",
        recurso_id=db_key.id,
        detalles={
            "nombre": db_key.nombre,
            "key_prefix": db_key.key_prefix,
        },
        ip_address=client_ip,
    )
    return schemas.ApiKeyCreated(
        id=db_key.id,
        nombre=db_key.nombre,
        key_prefix=db_key.key_prefix,
        activo=db_key.activo,
        fecha_creacion=db_key.fecha_creacion,
        ultimo_uso=db_key.ultimo_uso,
        api_key=raw_key,
    )


@router.get("/users/me/api-keys/", response_model=List[schemas.ApiKey])
async def list_my_api_keys(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.api_keys", "read"))
):
    return await crud.get_api_keys_for_user(db, current_user.id)


@router.delete("/users/me/api-keys/{api_key_id}/", response_model=schemas.ApiKey)
async def revoke_my_api_key(
    request: Request,
    api_key_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.api_keys", "edit"))
):
    db_key = await crud.revoke_api_key(db, current_user.id, api_key_id)
    if not db_key:
        raise HTTPException(status_code=404, detail="API key no encontrada")
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="REVOKE",
        recurso="api_key",
        recurso_id=db_key.id,
        detalles={
            "nombre": db_key.nombre,
            "key_prefix": db_key.key_prefix,
        },
        ip_address=client_ip,
    )
    return db_key


@router.get("/usuarios/", response_model=List[schemas.Usuario])
async def read_usuarios(
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.usuarios", "read"))
):
    users = await crud.get_users(db, skip=skip, limit=limit)
    for user in users:
        user.permisos = auth.effective_permissions_for_user(user)
        user.modulos = auth.effective_modules_for_user(user)
        user.permisos_detallados = auth.effective_capabilities_for_user(user)
    return users


@router.post("/usuarios/ad/lookup/", response_model=schemas.UsuarioAdLookupResponse)
async def lookup_ad_usuario(
    request: Request,
    payload: schemas.UsuarioAdLookupRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.usuarios", "edit"))
):
    config = await notification_config_service.get_auth_ad_oidc_config(db)
    if not config.get("enabled") or config.get("mode") != "ldap":
        raise HTTPException(status_code=400, detail="Active Directory LDAP no esta habilitado para validar usuarios")
    try:
        found = await ldap_service.find_user(config, payload.query)
        candidates = await ldap_service.search_users(config, payload.query, payload.limit) if len(payload.query) >= 2 else []
    except ldap_service.LdapLookupUnavailableError as exc:
        error_detail = "No se puede validar usuarios AD: falta configurar cuenta tecnica LDAP de lectura"
        await crud.create_audit_log(
            db=db,
            usuario_id=current_user.id,
            accion="AD_USER_LOOKUP_FAILED",
            recurso="usuario",
            detalles={"query": payload.query, "error": error_detail},
            ip_address=request.client.host if request.client else "unknown",
        )
        raise HTTPException(status_code=400, detail=error_detail) from exc
    except ldap_service.LdapLookupError as exc:
        await crud.create_audit_log(
            db=db,
            usuario_id=current_user.id,
            accion="AD_USER_LOOKUP_FAILED",
            recurso="usuario",
            detalles={"query": payload.query, "error": str(exc)},
            ip_address=request.client.host if request.client else "unknown",
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not found and not candidates:
        error_detail = "El usuario no existe en Active Directory/LDAP"
        await crud.create_audit_log(
            db=db,
            usuario_id=current_user.id,
            accion="AD_USER_LOOKUP_FAILED",
            recurso="usuario",
            detalles={"query": payload.query, "error": error_detail},
            ip_address=request.client.host if request.client else "unknown",
        )
        raise HTTPException(status_code=400, detail=error_detail)
    result_items = [
        schemas.UsuarioAdLookupItem(
            email=item.get("email"),
            name=item.get("name"),
            username=item.get("preferred_username"),
            upn=item.get("upn"),
            groups=item.get("groups") or [],
        )
        for item in candidates
    ]
    primary = found or (candidates[0] if len(candidates) == 1 else None) or {}
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="AD_USER_LOOKUP",
        recurso="usuario",
        detalles={"query": payload.query, "email": primary.get("email"), "result_count": len(result_items)},
        ip_address=request.client.host if request.client else "unknown",
    )
    return schemas.UsuarioAdLookupResponse(
        found=bool(found),
        email=primary.get("email") if found else None,
        name=primary.get("name") if found else None,
        username=primary.get("preferred_username") if found else None,
        upn=primary.get("upn") if found else None,
        groups=primary.get("groups") or [] if found else [],
        results=result_items,
    )


@router.post("/usuarios/ad/sync/", response_model=schemas.UsuarioAdSyncResponse)
async def sync_ad_usuarios(
    request: Request,
    payload: schemas.UsuarioAdSyncRequest = schemas.UsuarioAdSyncRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.usuarios", "edit"))
):
    try:
        sync_results = await user_sync_service.sync_ad_users(
            db,
            deactivate_missing=payload.deactivate_missing,
            limit=payload.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    items = [
        schemas.UsuarioAdSyncItem(
            user_id=item.user_id,
            email=item.email,
            status=item.status,
            previous_email=item.previous_email,
            new_email=item.new_email,
            previous_name=item.previous_name,
            new_name=item.new_name,
            groups=item.groups or [],
            error=item.error,
        )
        for item in sync_results
    ]
    summary = {
        "total": len(items),
        "ok": sum(1 for item in items if item.status == "ok"),
        "updated": sum(1 for item in items if item.status == "updated"),
        "missing": sum(1 for item in items if item.status in {"missing", "missing_deactivated"}),
        "errors": sum(1 for item in items if item.status == "error"),
        "deactivated": sum(1 for item in items if item.status == "missing_deactivated"),
    }
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="AD_USER_SYNC",
        recurso="usuario",
        detalles=summary,
        ip_address=request.client.host if request.client else "unknown",
    )
    return schemas.UsuarioAdSyncResponse(results=items, **summary)


@router.post("/usuarios/", response_model=schemas.Usuario)
async def create_usuario_admin(
    request: Request,
    user: schemas.UsuarioAdminCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.usuarios", "edit"))
):
    _ensure_admin_boundary(current_user, requested_role=user.rol)
    _ensure_control_plane_permission_boundary(current_user, user)
    db_user = await crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="El email ya esta registrado")
    hashed_password = None
    if user.auth_provider.lower() == "local":
        if not user.password:
            raise HTTPException(status_code=400, detail="La autenticación local requiere contraseña")
        hashed_password = auth.get_password_hash(user.password)
    elif user.auth_provider.lower() == "ad":
        await _ensure_ad_user_exists(db, user.email)
    if not user.modulos:
        user.modulos = auth.default_modules_for_role(user.rol)
    if not user.permisos:
        user.permisos = auth.default_permissions_for_role(user.rol)
    try:
        new_user = await crud.create_user_admin(db, user=user, hashed_password=hashed_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="usuario",
        recurso_id=new_user.id,
        detalles={"email": user.email, "rol": user.rol.value},
        ip_address=client_ip
    )
    await notification_event_service.emit_event(
        db=db,
        event_type="user.created",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=new_user.id,
        severity="info",
        payload={"user": {"id": str(new_user.id), "email": new_user.email, "rol": new_user.rol.value}, "actor": {"email": current_user.email}, "message": f"Usuario creado: {new_user.email}"},
        dedupe_key=f"user.created:{new_user.id}",
    )
    
    return new_user


@router.patch("/usuarios/{usuario_id}", response_model=schemas.Usuario)
async def update_usuario_admin(
    request: Request,
    usuario_id: UUID,
    user: schemas.UsuarioUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.usuarios", "edit"))
):
    target_user = await _get_user_or_404(db, usuario_id)
    _ensure_admin_boundary(current_user, target_user=target_user, requested_role=user.rol)
    _ensure_control_plane_permission_boundary(current_user, user)
    next_auth_provider = (user.auth_provider or target_user.auth_provider or "local").lower()
    next_email = user.email or target_user.email
    if next_auth_provider == "ad" and (user.auth_provider is not None or user.email is not None):
        await _ensure_ad_user_exists(db, next_email)
    hashed_password = auth.get_password_hash(user.password) if user.password else None
    try:
        updated = await crud.update_user(db=db, user_id=usuario_id, user_update=user, hashed_password=hashed_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE",
        recurso="usuario",
        recurso_id=usuario_id,
        detalles={k: v for k, v in user.model_dump(exclude_unset=True).items() if k != "password"},
        ip_address=client_ip
    )
    if (
        getattr(user, "rol", None) is not None
        or getattr(user, "modulos", None) is not None
        or getattr(user, "permisos", None) is not None
        or getattr(user, "permisos_detallados", None) is not None
    ):
        await notification_event_service.emit_event(
            db=db,
            event_type="user.role_changed",
            actor_user_id=current_user.id,
            entity_type="user",
            entity_id=usuario_id,
            severity="info",
            payload={"user": {"id": str(updated.id), "email": updated.email, "rol": updated.rol.value}, "actor": {"email": current_user.email}, "message": "Rol o permisos de usuario actualizados"},
            dedupe_key=f"user.role_changed:{usuario_id}:{utc_now().strftime('%Y%m%d%H%M')}",
        )
    
    return updated

@router.delete("/usuarios/{usuario_id}", response_model=schemas.Usuario)
async def deactivate_usuario_admin(
    request: Request,
    usuario_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.usuarios", "edit"))
):
    if usuario_id == current_user.id:
        raise HTTPException(status_code=400, detail="No puedes inactivar tu propia cuenta")
    target_user = await _get_user_or_404(db, usuario_id)
    _ensure_admin_boundary(current_user, target_user=target_user)
    updated = await crud.deactivate_user(db=db, user_id=usuario_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="DEACTIVATE",
        recurso="usuario",
        recurso_id=usuario_id,
        detalles={},
        ip_address=client_ip
    )
    await notification_event_service.emit_event(
        db=db,
        event_type="user.disabled",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=usuario_id,
        severity="warning",
        payload={"user": {"id": str(updated.id), "email": updated.email, "rol": updated.rol.value}, "actor": {"email": current_user.email}, "message": f"Usuario desactivado: {updated.email}"},
        dedupe_key=f"user.disabled:{usuario_id}",
    )
    
    return updated
# --- ENDPOINTS AUDITORIA ---

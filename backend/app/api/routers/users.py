from fastapi import APIRouter

from ...main_context import *
from ...main_context import _issue_auth_tokens
from . import users_admin


router = APIRouter(tags=["Users"])

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

@router.patch("/users/me/language", response_model=schemas.UserPreferences)
async def update_my_language(
    payload: schemas.UserLanguageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    return await crud.update_my_language(db, current_user, payload.language)


@router.patch("/users/me/password", response_model=schemas.UserPasswordChangeResponse)
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
    preferences = await crud.change_my_password(
        db,
        current_user,
        auth.get_password_hash(payload.new_password),
    )
    token_payload = await _issue_auth_tokens(db, current_user)
    return schemas.UserPasswordChangeResponse(
        **preferences.model_dump(),
        **token_payload,
    )


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

router.include_router(users_admin.router)

# Compatibilidad temporal para imports internos y pruebas que aún usan users.py.
_ensure_control_plane_permission_boundary = users_admin._ensure_control_plane_permission_boundary
create_usuario_admin = users_admin.create_usuario_admin
update_usuario_admin = users_admin.update_usuario_admin
deactivate_usuario_admin = users_admin.deactivate_usuario_admin

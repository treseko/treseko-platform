from fastapi import APIRouter

from ...main_context import *
from ...main_context import _issue_auth_tokens
from ...schema_sections.auth import _normalize_email, _validate_password


router = APIRouter(tags=["Auth"])


def _normalize_login_credentials(username: str, password: str) -> tuple[str, str]:
    try:
        normalized_username = _normalize_email(username)
        normalized_password = _validate_password(password)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not normalized_username or not normalized_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return normalized_username, normalized_password


@router.post("/auth/register/", response_model=schemas.Usuario)
async def register(user: schemas.UsuarioCreate, request: Request = None, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request and request.client else "unknown"
    rate_limit_key = f"register:{client_ip}:{_normalize_email(user.email)}"
    if auth.login_rate_limiter.is_rate_limited(rate_limit_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de registro. Intenta de nuevo en 15 minutos.",
        )
    auth.login_rate_limiter.record_failure(rate_limit_key)
    db_user = await crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="El email ya esta registrado")
    public_user = schemas.UsuarioCreate(
        email=user.email,
        password=user.password,
        nombre_completo=user.nombre_completo,
        rol=models.Rol.TESTER,
        rol_custom_id=None,
        auth_provider="local",
        modulos=auth.default_modules_for_role(models.Rol.TESTER),
        permisos=auth.default_permissions_for_role(models.Rol.TESTER),
        permisos_detallados={},
    )
    hashed_password = auth.get_password_hash(public_user.password)
    try:
        created = await crud.create_user(db, user=public_user, hashed_password=hashed_password)
        await notification_event_service.emit_event(
            db=db,
            event_type="user.created",
            actor_user_id=created.id,
            entity_type="user",
            entity_id=created.id,
            severity="info",
            payload={"user": {"id": str(created.id), "email": created.email, "rol": created.rol.value}, "message": f"Usuario creado: {created.email}"},
            dedupe_key=f"user.created:{created.id}",
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@router.post("/auth/login/", response_model=schemas.Token)
async def login_for_access_token(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(), 
    db: AsyncSession = Depends(get_db)
):
    client_ip = request.client.host if request.client else "unknown"
    username, password = _normalize_login_credentials(form_data.username, form_data.password)
    rate_limit_key = f"{username}_{client_ip}"
    
    if auth.login_rate_limiter.is_rate_limited(rate_limit_key):
        await notification_event_service.emit_event(
            db=db,
            event_type="auth.login_failed_many",
            entity_type="auth",
            severity="warning",
            payload={"email": username, "ip_address": client_ip, "message": "Demasiados intentos de login local"},
            dedupe_key=f"auth.login_failed_many:{username}:{client_ip}",
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de login. Intenta de nuevo en 15 minutos.",
        )
    
    user = await crud.get_user_by_email(db, email=username)
    password_valid = bool(user and auth.verify_password(password, user.hashed_password))

    if not user or not password_valid:
        auth.login_rate_limiter.record_failure(rate_limit_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.activo:
        auth.login_rate_limiter.record_failure(rate_limit_key)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo",
        )
    
    auth.login_rate_limiter.clear(rate_limit_key)
    token_payload = await _issue_auth_tokens(db, user)
    
    await crud.create_audit_log(
        db=db,
        usuario_id=user.id,
        accion="LOGIN",
        recurso="auth",
        ip_address=client_ip
    )
    
    return token_payload

@router.post("/auth/logout/")
async def logout(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user)
):
    client_ip = request.client.host if request.client else "unknown"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="LOGOUT",
        recurso="auth",
        ip_address=client_ip
    )
    
    return {"detail": "Sesión cerrada correctamente"}

@router.get("/users/me/", response_model=schemas.Usuario)
async def read_users_me(current_user: models.Usuario = Depends(auth.get_current_active_user)):
    current_user.permisos = auth.effective_permissions_for_user(current_user)
    current_user.modulos = auth.effective_modules_for_user(current_user)
    current_user.permisos_detallados = auth.effective_capabilities_for_user(current_user)
    return current_user

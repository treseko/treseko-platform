from fastapi import APIRouter
import hashlib
from urllib.parse import urlparse

from ...main_context import *
from ...main_context import _issue_auth_tokens
from ...services.auth_ad import ldap_service
from ...services.error_sanitizer import sanitize_external_error
from ...services.edition.entitlement_service import is_feature_enabled, require_feature


router = APIRouter(tags=["Auth AD"])
MAX_OIDC_QUERY_VALUE_LENGTH = 512
DEFAULT_FRONTEND_REDIRECT_BASE = "http://localhost:5173"


def _auth_ad_config_requests_admin_role(payload: schemas.AuthAdOidcConfigUpdate) -> bool:
    data = payload.model_dump(exclude_unset=True)
    if str(data.get("default_role") or "").upper() == models.Rol.ADMIN.value:
        return True
    for item in data.get("group_role_map") or []:
        if isinstance(item, dict) and str(item.get("role") or "").upper() == models.Rol.ADMIN.value:
            return True
    return False


def _safe_frontend_redirect_base(value: str | None) -> str:
    candidate = str(value or "").strip().rstrip("/")
    if not candidate or any(char.isspace() for char in candidate) or "\x00" in candidate:
        return DEFAULT_FRONTEND_REDIRECT_BASE
    parsed = urlparse(candidate)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return DEFAULT_FRONTEND_REDIRECT_BASE
    if parsed.username or parsed.password:
        return DEFAULT_FRONTEND_REDIRECT_BASE
    return candidate


def _auth_ad_failure_dedupe_key(state: str, safe_error: str) -> str:
    state_digest = hashlib.sha256(str(state or "").encode("utf-8")).hexdigest()[:16]
    return f"auth.ad_login_failed:{state_digest}:{safe_error[:80]}"


def _client_ip(request: Request = None) -> str | None:
    return request.client.host if request and request.client else None


def _auth_ad_config_audit_summary(config: dict | None) -> dict:
    data = dict(config or {})
    default_permissions = data.get("default_permissions") or {}
    group_role_map = data.get("group_role_map") or []
    return {
        "enabled": bool(data.get("enabled")),
        "mode": data.get("mode") or "oidc",
        "provider_label": data.get("provider_label"),
        "issuer_configured": bool(data.get("issuer")),
        "discovery_url_configured": bool(data.get("discovery_url")),
        "client_id_configured": bool(data.get("client_id")),
        "redirect_path": data.get("redirect_path"),
        "scope_count": len(data.get("scopes") or []),
        "allowed_domain_count": len(data.get("allowed_domains") or []),
        "auto_provision": bool(data.get("auto_provision")),
        "default_role": data.get("default_role"),
        "default_modules": sorted(data.get("default_modules") or []),
        "default_permission_count": len(default_permissions) if isinstance(default_permissions, dict) else 0,
        "group_role_map_count": len(group_role_map) if isinstance(group_role_map, list) else 0,
        "group_role_targets": sorted(
            {
                str(item.get("role"))
                for item in group_role_map
                if isinstance(item, dict) and item.get("role")
            }
        ),
        "require_email_verified": bool(data.get("require_email_verified")),
        "sync_profile_on_login": bool(data.get("sync_profile_on_login")),
        "client_secret_configured": bool(data.get("client_secret_configured")),
        "ldap_url_configured": bool(data.get("ldap_url")),
        "ldap_base_dn_configured": bool(data.get("ldap_base_dn")),
    }


@router.get("/auth/session-config", response_model=schemas.AuthSessionConfig)
@router.get("/auth/session-config/", response_model=schemas.AuthSessionConfig, include_in_schema=False)
async def get_auth_session_config(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.sesion", "read")),
):
    return await crud.get_auth_session_config(db)

@router.put("/auth/session-config", response_model=schemas.AuthSessionConfig)
@router.put("/auth/session-config/", response_model=schemas.AuthSessionConfig, include_in_schema=False)
async def update_auth_session_config(
    payload: schemas.AuthSessionConfig,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.sesion", "edit")),
):
    return await crud.update_auth_session_config(db, payload)

@router.get("/auth/ad/config/public/", response_model=schemas.AuthAdOidcPublicConfig)
async def read_auth_ad_public_config(db: AsyncSession = Depends(get_db)):
    config = await notification_config_service.get_auth_ad_oidc_config(db)
    sso_enabled = await is_feature_enabled(db, "auth.sso")
    return {
        "enabled": bool(config.get("enabled")) and sso_enabled,
        "provider_label": config.get("provider_label") or "Active Directory",
        "login_url": "/auth/ad/login/",
        "mode": config.get("mode") or "oidc",
    }

@router.get("/auth/ad/login/", dependencies=[Depends(require_feature("auth.sso"))])
async def auth_ad_login(
    request: Request,
    return_to: str = Query(default="/", max_length=MAX_OIDC_QUERY_VALUE_LENGTH),
    db: AsyncSession = Depends(get_db),
):
    try:
        url = await oidc_service.build_authorization_url(
            db,
            base_url=str(request.base_url).rstrip("/"),
            return_to=return_to,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        return RedirectResponse(url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=sanitize_external_error(exc))

@router.get("/auth/ad/callback/", dependencies=[Depends(require_feature("auth.sso"))])
async def auth_ad_callback(
    request: Request,
    code: str = Query(min_length=1, max_length=MAX_OIDC_QUERY_VALUE_LENGTH),
    state: str = Query(min_length=1, max_length=MAX_OIDC_QUERY_VALUE_LENGTH),
    db: AsyncSession = Depends(get_db),
):
    frontend_base = _safe_frontend_redirect_base(os.getenv("NOTIFICATIONS_PUBLIC_BASE_URL"))
    try:
        exchange_code, user = await oidc_service.handle_callback(db, base_url=str(request.base_url).rstrip("/"), code=code, state=state)
        await crud.create_audit_log(db, usuario_id=user.id, accion="AD_LOGIN", recurso="auth", ip_address=request.client.host if request.client else None)
        return RedirectResponse(f"{frontend_base}/?ad_exchange_code={exchange_code}")
    except Exception as exc:
        safe_error = sanitize_external_error(exc)
        await crud.create_audit_log(db, usuario_id=None, accion="AD_LOGIN_FAILED", recurso="auth", detalles={"error": safe_error}, ip_address=request.client.host if request.client else None)
        await notification_event_service.emit_event(
            db=db,
            event_type="auth.ad_login_failed",
            entity_type="auth",
            severity="warning",
            payload={"message": "Fallo de login Active Directory/OIDC", "error": safe_error},
            dedupe_key=_auth_ad_failure_dedupe_key(state, safe_error),
        )
        return RedirectResponse(f"{frontend_base}/?ad_error=login_failed")

@router.post("/auth/ad/exchange/", response_model=schemas.Token, dependencies=[Depends(require_feature("auth.sso"))])
async def auth_ad_exchange(request: Request, payload: schemas.AuthAdExchangeRequest, db: AsyncSession = Depends(get_db)):
    try:
        user = await oidc_service.consume_exchange_code(db, payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    token_payload = await _issue_auth_tokens(db, user)
    await crud.create_audit_log(db, usuario_id=user.id, accion="AD_TOKEN_EXCHANGE", recurso="auth", ip_address=request.client.host if request.client else None)
    return token_payload

@router.post("/auth/ad/password-login/", response_model=schemas.Token, dependencies=[Depends(require_feature("auth.sso"))])
async def auth_ad_password_login(
    request: Request,
    payload: schemas.AuthAdPasswordLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    config = await notification_config_service.get_auth_ad_oidc_config(db)
    if not config.get("enabled") or config.get("mode") != "ldap":
        raise HTTPException(status_code=400, detail="Active Directory LDAP no esta habilitado")
    client_ip = request.client.host if request.client else "unknown"
    rate_limit_key = f"ad_ldap:{payload.username.strip().lower()}:{client_ip}"
    if auth.login_rate_limiter.is_rate_limited(rate_limit_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Demasiados intentos de login AD. Intenta de nuevo en 15 minutos.")
    try:
        claims = await ldap_service.authenticate(config, payload.username, payload.password)
        user = await oidc_service.provision_or_sync_user(db, config, claims)
        auth.login_rate_limiter.clear(rate_limit_key)
        token_payload = await _issue_auth_tokens(db, user)
        await crud.create_audit_log(db, usuario_id=user.id, accion="AD_LDAP_LOGIN", recurso="auth", ip_address=client_ip)
        return token_payload
    except ldap_service.LdapAuthenticationError as exc:
        auth.login_rate_limiter.record_failure(rate_limit_key)
        await crud.create_audit_log(db, usuario_id=None, accion="AD_LDAP_LOGIN_FAILED", recurso="auth", detalles={"error": sanitize_external_error(exc)}, ip_address=client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario o contrasena AD invalidos")
    except Exception as exc:
        await crud.create_audit_log(db, usuario_id=None, accion="AD_LDAP_LOGIN_FAILED", recurso="auth", detalles={"error": sanitize_external_error(exc)}, ip_address=client_ip)
        raise HTTPException(status_code=400, detail=sanitize_external_error(exc))

@router.get("/auth/ad/config/", response_model=schemas.AuthAdOidcConfig, dependencies=[Depends(require_feature("auth.sso"))])
async def read_auth_ad_config(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.sesion", "read")),
):
    return await notification_config_service.get_auth_ad_oidc_config(db)

@router.patch("/auth/ad/config/", response_model=schemas.AuthAdOidcConfig, dependencies=[Depends(require_feature("auth.sso"))])
async def update_auth_ad_config(
    payload: schemas.AuthAdOidcConfigUpdate,
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.sesion", "edit")),
):
    if current_user.rol != models.Rol.ADMIN and _auth_ad_config_requests_admin_role(payload):
        raise HTTPException(
            status_code=403,
            detail="Solo un administrador global puede configurar aprovisionamiento AD/OIDC con rol ADMIN",
        )
    previous = await notification_config_service.get_auth_ad_oidc_config(db) if db is not None else {}
    updated = await notification_config_service.update_auth_ad_oidc_config(db, payload)
    if db is not None:
        await crud.create_audit_log(
            db=db,
            usuario_id=getattr(current_user, "id", None),
            accion="UPDATE",
            recurso="auth_ad_oidc_config",
            detalles={
                "changed_fields": sorted(payload.model_dump(exclude_unset=True).keys()),
                "old_value": _auth_ad_config_audit_summary(previous),
                "new_value": _auth_ad_config_audit_summary(updated),
            },
            ip_address=_client_ip(request),
        )
    return updated

@router.post("/auth/ad/test-config/", response_model=schemas.AuthAdTestResponse, dependencies=[Depends(require_feature("auth.sso"))])
async def test_auth_ad_config(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.sesion", "edit")),
):
    try:
        config = await notification_config_service.get_auth_ad_oidc_config(db)
        if config.get("mode") == "ldap":
            return schemas.AuthAdTestResponse(ok=True, message="Configuracion LDAP disponible. La validacion de credenciales se realiza al iniciar sesion.")
        return await oidc_service.test_config(db)
    except Exception as exc:
        return schemas.AuthAdTestResponse(ok=False, message=sanitize_external_error(exc))

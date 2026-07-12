import hashlib
import ipaddress
import os
import secrets
from datetime import timedelta
from email.utils import parseaddr
from typing import Any
from urllib.parse import urlparse, urlencode

import httpx
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import auth, models, schemas
from ...time_utils import utc_now
from ..notifications.config_service import get_auth_ad_oidc_config
from ..notifications import event_service


MAX_OIDC_RETURN_TO_LENGTH = 512


def hash_exchange_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def safe_return_to(value: str | None) -> str:
    target = (value or "/").strip()
    parsed = urlparse(target)
    if (
        not target
        or len(target) > MAX_OIDC_RETURN_TO_LENGTH
        or not target.startswith("/")
        or target.startswith("//")
        or parsed.scheme
        or parsed.netloc
        or any(char in target for char in ("\x00", "\r", "\n", "\t"))
    ):
        return "/"
    return target


def _private_oidc_endpoints_allowed() -> bool:
    return (os.getenv("AUTH_AD_OIDC_ALLOW_PRIVATE_ENDPOINTS") or "").strip().lower() in {"1", "true", "yes"}


def validate_oidc_https_url(url: str | None, label: str) -> str:
    value = (url or "").strip()
    parsed = urlparse(value)
    allow_private = _private_oidc_endpoints_allowed()
    if parsed.scheme.lower() not in {"https", "http"} or not parsed.netloc or not parsed.hostname:
        raise ValueError(f"{label} debe ser una URL HTTP/HTTPS absoluta")
    if parsed.scheme.lower() == "http" and not allow_private:
        raise ValueError(f"{label} debe usar HTTPS")
    hostname = parsed.hostname.strip().lower()
    if (hostname == "localhost" or hostname.endswith(".localhost")) and not allow_private:
        raise ValueError(f"{label} no puede apuntar a localhost")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ) and not allow_private:
        raise ValueError(f"{label} no puede apuntar a una direccion privada o local")
    return value


def safe_redirect_path(value: str | None) -> str:
    path = (value or "/auth/ad/callback/").strip()
    parsed = urlparse(path)
    if not path.startswith("/") or path.startswith("//") or parsed.scheme or parsed.netloc or any(char in path for char in ("\r", "\n", "\t")):
        raise ValueError("Redirect path OIDC debe ser una ruta local absoluta")
    return path


def validate_discovery_metadata(config: dict[str, Any], discovery: dict[str, Any]) -> dict[str, Any]:
    expected_issuer = validate_oidc_https_url(config.get("issuer"), "Issuer OIDC")
    discovered_issuer = validate_oidc_https_url(discovery.get("issuer"), "Issuer discovery OIDC")
    if discovered_issuer.rstrip("/") != expected_issuer.rstrip("/"):
        raise ValueError("Issuer discovery OIDC no coincide con el issuer configurado")
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        validate_oidc_https_url(discovery.get(key), f"{key} OIDC")
    return discovery


async def fetch_discovery(config: dict[str, Any]) -> dict[str, Any]:
    discovery_url = validate_oidc_https_url(config.get("discovery_url"), "Discovery URL OIDC")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(discovery_url)
        response.raise_for_status()
        return validate_discovery_metadata(config, response.json())


async def create_login_state(
    db: AsyncSession,
    return_to: str | None,
    ip_address: str | None,
    user_agent: str | None,
) -> models.AuthAdLoginState:
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    db_state = models.AuthAdLoginState(
        state=state,
        nonce=nonce,
        return_to=safe_return_to(return_to),
        expires_at=utc_now() + timedelta(minutes=10),
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(db_state)
    await db.commit()
    await db.refresh(db_state)
    return db_state


async def build_authorization_url(db: AsyncSession, base_url: str, return_to: str | None, ip_address: str | None, user_agent: str | None) -> str:
    config = await get_auth_ad_oidc_config(db)
    if not config.get("enabled"):
        raise ValueError("Active Directory/OIDC no esta habilitado")
    discovery = validate_discovery_metadata(config, await fetch_discovery(config))
    state = await create_login_state(db, return_to, ip_address, user_agent)
    redirect_uri = f"{base_url.rstrip('/')}{safe_redirect_path(config.get('redirect_path'))}"
    params = {
        "client_id": config["client_id"],
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": " ".join(config.get("scopes") or ["openid", "profile", "email"]),
        "state": state.state,
        "nonce": state.nonce,
        "response_mode": "query",
    }
    return f"{discovery['authorization_endpoint']}?{urlencode(params)}"


async def _get_valid_state(db: AsyncSession, state: str) -> models.AuthAdLoginState:
    result = await db.execute(select(models.AuthAdLoginState).filter(models.AuthAdLoginState.state == state))
    db_state = result.scalar_one_or_none()
    if not db_state or db_state.used_at or db_state.expires_at < utc_now():
        raise ValueError("State OIDC invalido o expirado")
    return db_state


async def _exchange_code_for_tokens(config: dict[str, Any], discovery: dict[str, Any], code: str, redirect_uri: str) -> dict[str, Any]:
    client_secret = os.getenv("AD_OIDC_CLIENT_SECRET")
    if not client_secret:
        raise ValueError("AD_OIDC_CLIENT_SECRET no esta configurado")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(validate_oidc_https_url(discovery.get("token_endpoint"), "token_endpoint OIDC"), data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": config["client_id"],
            "client_secret": client_secret,
        }, headers={"Content-Type": "application/x-www-form-urlencoded"})
        response.raise_for_status()
        return response.json()


async def _validate_id_token(config: dict[str, Any], discovery: dict[str, Any], id_token: str, nonce: str) -> dict[str, Any]:
    header = jwt.get_unverified_header(id_token)
    if header.get("alg") != "RS256":
        raise ValueError("Algoritmo id_token no permitido")
    kid = header.get("kid")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(validate_oidc_https_url(discovery.get("jwks_uri"), "jwks_uri OIDC"))
        response.raise_for_status()
        jwks = response.json()
    key = next((item for item in jwks.get("keys", []) if item.get("kid") == kid), None)
    if not key:
        raise ValueError("No se encontro la clave JWKS del id_token")
    claims = jwt.decode(
        id_token,
        key,
        algorithms=["RS256"],
        audience=config["client_id"],
        issuer=config["issuer"],
    )
    if claims.get("nonce") != nonce:
        raise ValueError("Nonce OIDC invalido")
    if config.get("require_email_verified") and claims.get("email_verified") is False:
        raise ValueError("Email no verificado por el proveedor")
    return claims


def _email_from_claims(claims: dict[str, Any]) -> str:
    raw_email = str(claims.get("email") or claims.get("preferred_username") or claims.get("upn") or "").strip().lower()
    parsed_name, parsed_email = parseaddr(raw_email)
    if (
        not raw_email
        or parsed_name
        or parsed_email != raw_email
        or "@" not in parsed_email
        or any(char in raw_email for char in ("\r", "\n", "\t", ",", ";", " "))
    ):
        raise ValueError("El proveedor no devolvio un email valido")
    return parsed_email


def _validate_domain(email: str, allowed_domains: list[str]) -> None:
    if not allowed_domains:
        return
    domain = email.split("@", 1)[1].lower()
    if domain not in {item.lower().lstrip("@") for item in allowed_domains}:
        raise ValueError("Dominio no permitido para login AD/OIDC")


def _role_from_claims(config: dict[str, Any], claims: dict[str, Any]) -> models.Rol:
    groups = claims.get("groups") or []
    for item in config.get("group_role_map") or []:
        claim_values = claims.get(item.get("claim") or "groups") or groups
        if not isinstance(claim_values, list):
            claim_values = [claim_values]
        if item.get("value") in claim_values:
            return models.Rol(item.get("role") or config.get("default_role") or "TESTER")
    return models.Rol(config.get("default_role") or "TESTER")


async def provision_or_sync_user(db: AsyncSession, config: dict[str, Any], claims: dict[str, Any]) -> models.Usuario:
    email = _email_from_claims(claims)
    _validate_domain(email, config.get("allowed_domains") or [])
    result = await db.execute(select(models.Usuario).filter(models.Usuario.email == email))
    user = result.scalar_one_or_none()
    if user and not user.activo:
        raise ValueError("Usuario inactivo")
    if user and user.auth_provider != "ad":
        raise ValueError("Usuario local existente no vinculado a Active Directory")
    role = _role_from_claims(config, claims)
    name = claims.get("name") or claims.get("given_name") or email
    was_provisioned = False
    if not user:
        if not config.get("auto_provision"):
            raise ValueError("Usuario no provisionado y auto_provision esta deshabilitado")
        was_provisioned = True
        user = models.Usuario(
            email=email,
            hashed_password=None,
            nombre_completo=name,
            rol=role,
            auth_provider="ad",
            modulos=config.get("default_modules") or auth.default_modules_for_role(role),
            permisos=config.get("default_permissions") or auth.default_permissions_for_role(role),
            permisos_detallados={},
            activo=True,
        )
        db.add(user)
        await db.flush()
    elif config.get("sync_profile_on_login") and user.auth_provider == "ad":
        user.nombre_completo = name
        user.rol = role
        user.modulos = config.get("default_modules") or user.modulos
        user.permisos = config.get("default_permissions") or user.permisos
    await db.commit()
    await db.refresh(user)
    setattr(user, "_ad_was_provisioned", was_provisioned)
    return user


async def create_exchange_code(db: AsyncSession, user: models.Usuario, metadata: dict[str, Any] | None = None) -> str:
    code = secrets.token_urlsafe(32)
    db.add(models.AuthAdExchangeCode(
        code_hash=hash_exchange_code(code),
        usuario_id=user.id,
        expires_at=utc_now() + timedelta(minutes=5),
        metadata_json=metadata or {},
    ))
    await db.commit()
    return code


async def handle_callback(db: AsyncSession, base_url: str, code: str, state: str) -> tuple[str, models.Usuario]:
    config = await get_auth_ad_oidc_config(db)
    discovery = validate_discovery_metadata(config, await fetch_discovery(config))
    db_state = await _get_valid_state(db, state)
    redirect_uri = f"{base_url.rstrip('/')}{safe_redirect_path(config.get('redirect_path'))}"
    tokens = await _exchange_code_for_tokens(config, discovery, code, redirect_uri)
    claims = await _validate_id_token(config, discovery, tokens["id_token"], db_state.nonce)
    user = await provision_or_sync_user(db, config, claims)
    db_state.used_at = utc_now()
    if getattr(user, "_ad_was_provisioned", False):
        await event_service.emit_event(
            db=db,
            event_type="auth.ad_user_provisioned",
            actor_user_id=user.id,
            entity_type="user",
            entity_id=user.id,
            severity="info",
            payload={
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "nombre": user.nombre_completo or user.email,
                    "rol": user.rol.value if hasattr(user.rol, "value") else str(user.rol),
                    "auth_provider": user.auth_provider,
                },
                "message": f"Usuario AD provisionado: {user.email}",
            },
            dedupe_key=f"auth.ad_user_provisioned:{user.id}",
        )
    exchange_code = await create_exchange_code(db, user, {"provider": "ad", "claims_email": _email_from_claims(claims)})
    return exchange_code, user


async def consume_exchange_code(db: AsyncSession, code: str) -> models.Usuario:
    result = await db.execute(select(models.AuthAdExchangeCode).filter(models.AuthAdExchangeCode.code_hash == hash_exchange_code(code)))
    db_code = result.scalar_one_or_none()
    if not db_code or db_code.used_at or db_code.expires_at < utc_now():
        raise ValueError("Codigo de intercambio invalido o expirado")
    result = await db.execute(select(models.Usuario).filter(models.Usuario.id == db_code.usuario_id))
    user = result.scalar_one_or_none()
    if not user or not user.activo:
        raise ValueError("Usuario no valido")
    db_code.used_at = utc_now()
    await db.commit()
    return user


async def test_config(db: AsyncSession) -> schemas.AuthAdTestResponse:
    config = await get_auth_ad_oidc_config(db)
    discovery = validate_discovery_metadata(config, await fetch_discovery(config))
    return schemas.AuthAdTestResponse(
        ok=True,
        message="Discovery OIDC disponible.",
        discovery_issuer=discovery.get("issuer"),
    )

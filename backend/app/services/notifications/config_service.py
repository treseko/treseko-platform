import os
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from ... import models, schemas
from ...frontend_url import frontend_public_url


EMAIL_SMTP_CONFIG_KEY = "email_smtp_config"
AUTH_AD_OIDC_CONFIG_KEY = "auth_ad_oidc_config"


DEFAULT_EMAIL_SMTP_CONFIG: dict[str, Any] = {
    "enabled": False,
    "provider": "smtp",
    "host": "",
    "port": 587,
    "use_starttls": True,
    "use_ssl": False,
    "username": "",
    "from_email": os.getenv("NOTIFICATIONS_DEFAULT_FROM_EMAIL", ""),
    "from_name": "Treseko",
    "reply_to": "",
    "timeout_seconds": 20,
    "max_attempts": 5,
    "default_locale": "es",
    "base_url": frontend_public_url(),
    "daily_send_limit": 500,
    "test_mode": False,
}

DEFAULT_AD_OIDC_CONFIG: dict[str, Any] = {
    "enabled": False,
    "provider_label": "Active Directory",
    "mode": "oidc",
    "issuer": "",
    "discovery_url": "",
    "client_id": "",
    "redirect_path": "/auth/ad/callback/",
    "scopes": ["openid", "profile", "email"],
    "allowed_domains": [],
    "auto_provision": True,
    "default_role": "TESTER",
    "default_modules": ["dashboard", "ejecutar", "crear_pruebas", "proyectos", "bugs", "historial"],
    "default_permissions": {
        "dashboard": "read",
        "ejecutar": "edit",
        "crear_pruebas": "edit",
        "proyectos": "read",
        "bugs": "edit",
        "historial": "read",
    },
    "group_role_map": [],
    "require_email_verified": False,
    "sync_profile_on_login": True,
    "ldap_url": "",
    "ldap_base_dn": "",
    "ldap_user_attribute": "sAMAccountName",
    "ldap_bind_pattern": "{username}@{domain}",
}


async def _get_setting(db: AsyncSession, key: str) -> dict[str, Any]:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == key))
    setting = result.scalar_one_or_none()
    return dict(setting.value or {}) if setting else {}


async def _upsert_setting(db: AsyncSession, key: str, value: dict[str, Any]) -> dict[str, Any]:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == key))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        db.add(models.AppSetting(key=key, value=value))
    await db.commit()
    return value


def _notification_smtp_password() -> str:
    """Return only the platform-notification secret.

    It intentionally does not fall back to a generic SMTP_PASSWORD: that
    value may belong to the license/verification server. The returned value
    is never persisted or returned from an API.
    """
    path = str(os.getenv("NOTIFICATIONS_SMTP_PASSWORD_FILE") or "").strip()
    if path:
        try:
            return open(path, "r", encoding="utf-8").read().strip()
        except OSError:
            return ""
    return str(os.getenv("NOTIFICATIONS_SMTP_PASSWORD") or "")


def _with_smtp_secret_state(config: dict[str, Any]) -> dict[str, Any]:
    public = dict(config)
    public["password_configured"] = bool(_notification_smtp_password())
    public["credential_source"] = "configured" if public["password_configured"] else "missing"
    public.pop("password", None)
    return public


def smtp_config_with_secret(config: dict[str, Any]) -> dict[str, Any]:
    merged = {**DEFAULT_EMAIL_SMTP_CONFIG, **(config or {})}
    merged["password"] = _notification_smtp_password()
    return merged


async def get_email_smtp_config(db: AsyncSession) -> dict[str, Any]:
    return _with_smtp_secret_state({**DEFAULT_EMAIL_SMTP_CONFIG, **await _get_setting(db, EMAIL_SMTP_CONFIG_KEY)})


async def update_email_smtp_config(db: AsyncSession, payload: schemas.EmailSmtpConfigUpdate) -> dict[str, Any]:
    current = {**DEFAULT_EMAIL_SMTP_CONFIG, **await _get_setting(db, EMAIL_SMTP_CONFIG_KEY)}
    updates = payload.model_dump(exclude_unset=True)
    value = {**current, **updates}
    # Validate the merged configuration too: an update that only turns on SSL
    # must still be checked against a previously stored STARTTLS setting.
    value = schemas.EmailSmtpConfig(**value).model_dump(exclude={"password_configured"})
    await _upsert_setting(db, EMAIL_SMTP_CONFIG_KEY, value)
    return _with_smtp_secret_state(value)


async def get_auth_ad_oidc_config(db: AsyncSession) -> dict[str, Any]:
    config = {**DEFAULT_AD_OIDC_CONFIG, **await _get_setting(db, AUTH_AD_OIDC_CONFIG_KEY)}
    config["client_secret_configured"] = bool(os.getenv("AD_OIDC_CLIENT_SECRET"))
    return config


async def update_auth_ad_oidc_config(db: AsyncSession, payload: schemas.AuthAdOidcConfigUpdate) -> dict[str, Any]:
    current = {**DEFAULT_AD_OIDC_CONFIG, **await _get_setting(db, AUTH_AD_OIDC_CONFIG_KEY)}
    updates = payload.model_dump(exclude_unset=True)
    value = {**current, **updates}
    if value.get("mode") not in {"oidc", "ldap"}:
        value["mode"] = "oidc"
    await _upsert_setting(db, AUTH_AD_OIDC_CONFIG_KEY, value)
    value["client_secret_configured"] = bool(os.getenv("AD_OIDC_CLIENT_SECRET"))
    return value

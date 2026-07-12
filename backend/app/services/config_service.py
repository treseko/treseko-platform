import os
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from .. import models, schemas

AUTH_SESSION_CONFIG_KEY = "auth_session"
WORKSPACE_BRANDING_KEY = "workspace_branding"
SYSTEM_TIME_SETTINGS_KEY = "system_time_settings"
FIRST_RUN_ONBOARDING_KEY = "first_run_onboarding"
DEFAULT_SYSTEM_TIMEZONE = "America/Argentina/Buenos_Aires"

DEFAULT_BRANDING = {
    "brand_name": "Treseko",
    "logo_url": "/gecko-community-icon.png?v=3",
    "enabled": False,
}


def _default_session_timeout_minutes() -> int:
    try:
        return int(os.getenv("SESSION_TIMEOUT_MINUTES", "480"))
    except (TypeError, ValueError):
        return 480


DEFAULT_AUTH_SESSION_CONFIG = {
    "session_timeout_minutes": _default_session_timeout_minutes(),
}

DEFAULT_SYSTEM_TIME_SETTINGS = {
    "timezone": DEFAULT_SYSTEM_TIMEZONE,
}

DEFAULT_FIRST_RUN_ONBOARDING = {
    "completed": False,
    "completed_at": None,
    "completed_by_user_id": None,
    "completion_source": None,
    "survey": None,
    "terms_accepted": False,
    "terms_version": None,
    "telemetry_opt_in": False,
}


def normalize_session_timeout_minutes(value: Any) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        minutes = DEFAULT_AUTH_SESSION_CONFIG["session_timeout_minutes"]
    return max(15, min(minutes, 43200))


async def get_auth_session_config(db: AsyncSession):
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AUTH_SESSION_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    value = setting.value if setting else {}
    merged = {**DEFAULT_AUTH_SESSION_CONFIG, **(value or {})}
    merged["session_timeout_minutes"] = normalize_session_timeout_minutes(merged.get("session_timeout_minutes"))
    return merged


async def update_auth_session_config(db: AsyncSession, config: schemas.AuthSessionConfig):
    value = {
        "session_timeout_minutes": normalize_session_timeout_minutes(config.session_timeout_minutes),
    }
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AUTH_SESSION_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        db.add(models.AppSetting(key=AUTH_SESSION_CONFIG_KEY, value=value))
    await db.commit()
    return value


def normalize_system_timezone(value: Any) -> str:
    candidate = str(value or DEFAULT_SYSTEM_TIMEZONE).strip()
    try:
        ZoneInfo(candidate)
    except ZoneInfoNotFoundError:
        return DEFAULT_SYSTEM_TIMEZONE
    return candidate


async def get_system_time_settings(db: AsyncSession) -> dict[str, Any]:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == SYSTEM_TIME_SETTINGS_KEY))
    setting = result.scalar_one_or_none()
    raw = setting.value if setting else {}
    return {"timezone": normalize_system_timezone((raw or {}).get("timezone"))}


async def update_system_time_settings(db: AsyncSession, settings: schemas.SystemTimeSettings) -> dict[str, Any]:
    value = {"timezone": normalize_system_timezone(settings.timezone)}
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == SYSTEM_TIME_SETTINGS_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        db.add(models.AppSetting(key=SYSTEM_TIME_SETTINGS_KEY, value=value))
    await db.commit()
    return value


def normalize_first_run_onboarding(value: dict[str, Any] | None) -> dict[str, Any]:
    raw = value or {}
    return {
        **DEFAULT_FIRST_RUN_ONBOARDING,
        **raw,
        "completed": bool(raw.get("completed")),
        "terms_accepted": bool(raw.get("terms_accepted")),
        "telemetry_opt_in": bool(raw.get("telemetry_opt_in")),
    }


async def get_first_run_onboarding(db: AsyncSession) -> dict[str, Any]:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == FIRST_RUN_ONBOARDING_KEY))
    setting = result.scalar_one_or_none()
    return normalize_first_run_onboarding(setting.value if setting else {})


async def update_first_run_onboarding(db: AsyncSession, value: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_first_run_onboarding(value)
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == FIRST_RUN_ONBOARDING_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = normalized
    else:
        db.add(models.AppSetting(key=FIRST_RUN_ONBOARDING_KEY, value=normalized))
    await db.commit()
    return normalized


def normalize_branding_value(value: dict[str, Any] | None) -> dict[str, Any]:
    raw = value or {}
    brand_name = " ".join(str(raw.get("brand_name") or DEFAULT_BRANDING["brand_name"]).strip().split())
    if not brand_name:
        brand_name = DEFAULT_BRANDING["brand_name"]
    logo_url = str(raw.get("logo_url") or "").strip()
    if not logo_url.startswith("/static/branding/"):
        logo_url = ""
    return {
        "brand_name": brand_name[:80],
        "logo_url": logo_url or None,
        "enabled": bool(raw.get("enabled")),
    }


def branding_response(value: dict[str, Any] | None, *, edition: str, can_customize: bool) -> dict[str, Any]:
    normalized = normalize_branding_value(value)
    custom_active = bool(can_customize and normalized["enabled"] and normalized["brand_name"])
    effective_brand_name = normalized["brand_name"] if custom_active else DEFAULT_BRANDING["brand_name"]
    effective_logo_url = normalized["logo_url"] if custom_active and normalized["logo_url"] else DEFAULT_BRANDING["logo_url"]
    return {
        "edition": "premium" if edition == "premium" else "community",
        "can_customize": bool(can_customize),
        "brand_name": normalized["brand_name"] if can_customize else DEFAULT_BRANDING["brand_name"],
        "logo_url": normalized["logo_url"] if can_customize else None,
        "enabled": bool(normalized["enabled"] if can_customize else False),
        "effective_brand_name": effective_brand_name,
        "effective_logo_url": effective_logo_url,
        "custom_branding_active": custom_active,
    }


async def get_workspace_branding(db: AsyncSession) -> dict[str, Any]:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == WORKSPACE_BRANDING_KEY))
    setting = result.scalar_one_or_none()
    return normalize_branding_value(setting.value if setting else {})


async def update_workspace_branding(db: AsyncSession, branding: schemas.SystemBrandingUpdate) -> dict[str, Any]:
    value = normalize_branding_value(branding.model_dump())
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == WORKSPACE_BRANDING_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        db.add(models.AppSetting(key=WORKSPACE_BRANDING_KEY, value=value))
    await db.commit()
    return value

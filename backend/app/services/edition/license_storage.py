"""Persistence boundary for the installed license and its online snapshot."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


LICENSE_SETTING_KEY = "treseko_license"
LICENSE_ONLINE_STATE_SETTING_KEY = "treseko_license_online_state"


async def get_installed_license(db: AsyncSession) -> dict[str, Any] | None:
    from ... import models

    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == LICENSE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    return setting.value if setting else None


async def get_online_license_state(db: AsyncSession) -> dict[str, Any] | None:
    from ... import models

    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == LICENSE_ONLINE_STATE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    return setting.value if setting else None


async def save_online_license_state(db: AsyncSession, state: dict[str, Any]) -> dict[str, Any]:
    from ... import models

    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == LICENSE_ONLINE_STATE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = state
    else:
        db.add(models.AppSetting(key=LICENSE_ONLINE_STATE_SETTING_KEY, value=state))
    await db.commit()
    return state


async def install_license(db: AsyncSession, license_data: dict[str, Any]) -> dict[str, Any]:
    """Persist a verified Premium document without duplicating license policy."""
    from ... import models
    from .license_manager import LicenseError, evaluate_license, normalize_license_payload

    normalized = normalize_license_payload(license_data)
    if normalized["edition"] != "premium":
        raise LicenseError("Solo se pueden instalar licencias Premium firmadas; Community no requiere archivo de licencia")
    state = evaluate_license(normalized)
    if state["state"] not in {"active", "revoked"}:
        raise LicenseError(state["reason"] or "La licencia Premium no es valida")
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == LICENSE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = normalized
    else:
        db.add(models.AppSetting(key=LICENSE_SETTING_KEY, value=normalized))
    await db.commit()
    return evaluate_license(normalized)

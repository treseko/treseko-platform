from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...time_utils import utc_now
from ..notifications.config_service import get_auth_ad_oidc_config
from . import ldap_service


@dataclass
class AdUserSyncResult:
    user_id: str
    email: str
    status: str
    previous_email: str | None = None
    new_email: str | None = None
    previous_name: str | None = None
    new_name: str | None = None
    groups: list[str] | None = None
    error: str | None = None


def _sync_metadata(status: str, claims: dict[str, Any] | None = None, error: str | None = None) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "last_sync_at": utc_now().isoformat(),
        "last_sync_status": status,
    }
    if claims:
        metadata.update({
            "upn": claims.get("upn"),
            "username": claims.get("preferred_username"),
            "groups": claims.get("groups") or [],
        })
    if error:
        metadata["last_sync_error"] = error
    else:
        metadata.pop("last_sync_error", None)
    return metadata


def _merge_auth_ad_profile_settings(user: models.Usuario, metadata: dict[str, Any]) -> None:
    profile_settings = dict(user.profile_settings or {})
    auth_ad = dict(profile_settings.get("auth_ad") or {})
    auth_ad.update(metadata)
    profile_settings["auth_ad"] = auth_ad
    user.profile_settings = profile_settings


async def sync_ad_users(db: AsyncSession, *, deactivate_missing: bool = True, limit: int = 500) -> list[AdUserSyncResult]:
    config = await get_auth_ad_oidc_config(db)
    if not config.get("enabled") or config.get("mode") != "ldap":
        raise ValueError("Active Directory LDAP no esta habilitado")

    result = await db.execute(
        select(models.Usuario)
        .where(models.Usuario.auth_provider == "ad")
        .order_by(models.Usuario.email)
        .limit(limit)
    )
    users = result.scalars().all()
    sync_results: list[AdUserSyncResult] = []

    for user in users:
        identifier = user.email
        try:
            claims = await ldap_service.find_user(config, identifier)
        except ldap_service.LdapLookupError as exc:
            _merge_auth_ad_profile_settings(user, _sync_metadata("error", error=str(exc)))
            sync_results.append(AdUserSyncResult(
                user_id=str(user.id),
                email=user.email,
                status="error",
                error=str(exc),
            ))
            continue

        if not claims:
            if deactivate_missing and user.activo:
                user.activo = False
            _merge_auth_ad_profile_settings(user, _sync_metadata("missing", error="Usuario no encontrado en LDAP"))
            sync_results.append(AdUserSyncResult(
                user_id=str(user.id),
                email=user.email,
                status="missing_deactivated" if deactivate_missing else "missing",
                error="Usuario no encontrado en LDAP",
            ))
            continue

        previous_email = user.email
        previous_name = user.nombre_completo
        new_email = str(claims.get("email") or user.email).lower()
        new_name = claims.get("name") or user.nombre_completo

        if new_email and new_email != user.email:
            existing = await db.execute(
                select(models.Usuario).where(models.Usuario.email == new_email, models.Usuario.id != user.id)
            )
            if existing.scalar_one_or_none():
                _merge_auth_ad_profile_settings(user, _sync_metadata("error", claims, "Email LDAP ya esta registrado en otro usuario"))
                sync_results.append(AdUserSyncResult(
                    user_id=str(user.id),
                    email=user.email,
                    status="error",
                    error="Email LDAP ya esta registrado en otro usuario",
                ))
                continue
            user.email = new_email
        if new_name:
            user.nombre_completo = str(new_name)
        if not user.activo:
            user.activo = True
        _merge_auth_ad_profile_settings(user, _sync_metadata("ok", claims))
        sync_results.append(AdUserSyncResult(
            user_id=str(user.id),
            email=user.email,
            status="updated" if previous_email != user.email or previous_name != user.nombre_completo else "ok",
            previous_email=previous_email,
            new_email=user.email,
            previous_name=previous_name,
            new_name=user.nombre_completo,
            groups=claims.get("groups") or [],
        ))

    await db.commit()
    return sync_results

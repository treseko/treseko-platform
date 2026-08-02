from __future__ import annotations

import hashlib
import os
import sys
from datetime import timedelta
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import ValidationError

from ...database import get_db
from ... import access_control, auth, crud, models, schemas
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from ...content_type_validation import content_matches_declared_type
from ...services import config_service
from ...services.edition.catalog import feature_catalog_response
from ...services.edition.entitlement_provider import get_entitlement_provider
from ...services.edition.entitlement_service import require_feature
from ...services.edition.license_manager import (
    LicenseError,
    get_installed_license,
    get_license_state,
    get_online_license_state,
    install_license,
    license_keyring_status,
    save_online_license_state,
)
from ...services.premium_runtime.verification_client import (
    PremiumVerificationError,
    activate_license_online,
    fetch_latest_premium_update_manifest,
    heartbeat_license_online,
    offline_grace_from_cached_state,
    server_response_keyring_status,
)
from ...services.edition.update_manager import (
    COMMUNITY_UPDATE_CHANNELS,
    PREMIUM_UPDATE_CHANNELS,
    UpdateManifestError,
    update_keyring_status,
    prepare_update_download_grant_request,
    request_premium_download_grant,
    validate_update_manifest,
)
from ...services.updater import configured_community_update_channel, get_update_service, version_gt
from ...services.edition.usage_limits import WEEKLY_USAGE_WINDOW_DAYS, count_weekly_executions
from ...time_utils import utc_now
from ...version import COMMUNITY_RELEASE_TAG, PRODUCT_EDITION_BASE, PRODUCT_NAME, PRODUCT_VERSION, RELEASE_CHANNEL
from .system_support import (
    branding_state as _branding_state,
    database_schema_revision as _database_schema_revision,
    first_run_state as _first_run_state,
    request_client_ip as _request_client_ip,
)



updates_router = APIRouter(tags=["system"])
UPDATE_MANIFEST_CACHE_SETTING_KEY = "treseko_update_manifest_cache"
_SYSTEM_DEPENDENCY_DEFAULTS = {
    name: globals()[name]
    for name in (
        "get_entitlement_provider",
        "get_update_service",
        "validate_update_manifest",
        "prepare_update_download_grant_request",
        "fetch_latest_premium_update_manifest",
        "request_premium_download_grant",
        "get_installed_license",
    )
}


def _system_dependency(name: str, fallback: Any) -> Any:
    """Keep the split router compatible with the public system-router facade."""
    local = globals().get(name, fallback)
    if local is not _SYSTEM_DEPENDENCY_DEFAULTS.get(name, fallback):
        return local
    facade = sys.modules.get(f"{__package__}.system")
    return getattr(facade, name, fallback) if facade else fallback

@updates_router.get("/system/updates/channels", response_model=schemas.SystemUpdateChannelsResponse)
async def read_system_update_channels(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await _system_dependency("get_entitlement_provider", get_entitlement_provider)().get_state(db)
    enabled_features = set(state.get("enabled_features") or [])
    premium_allowed = state.get("edition") == "premium" and "updates.premium" in enabled_features
    channels = []
    for channel in sorted(COMMUNITY_UPDATE_CHANNELS):
        channels.append({"id": channel, "edition": "community", "allowed": True, "reason": None})
    for channel in sorted(PREMIUM_UPDATE_CHANNELS):
        channels.append({
            "id": channel,
            "edition": "premium",
            "allowed": premium_allowed,
            "reason": None if premium_allowed else "Requiere licencia Premium activa con updates.premium",
        })
    return {
        "edition": state["edition"],
        "state": state["state"],
        "active_channel": state["update_channel"],
        "channels": channels,
    }


def _premium_updates_enabled(state: dict) -> bool:
    enabled_features = set(state.get("enabled_features") or [])
    return state.get("edition") == "premium" and "updates.premium" in enabled_features


def _manifest_cache_key(license_data: dict | None, channel: str) -> str:
    license_id = str((license_data or {}).get("license_id") or "community").strip()
    return f"{license_id}:{channel}"


async def _read_update_manifest_cache(db: AsyncSession) -> dict:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == UPDATE_MANIFEST_CACHE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    return dict(setting.value) if setting and isinstance(setting.value, dict) else {}


async def _write_update_manifest_cache(db: AsyncSession, cache: dict) -> None:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == UPDATE_MANIFEST_CACHE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = dict(cache)
    else:
        db.add(models.AppSetting(key=UPDATE_MANIFEST_CACHE_SETTING_KEY, value=cache))
    await db.commit()


def _latest_update_response_from_manifest(
    *,
    state: dict,
    manifest: dict | None,
    validation: dict | None = None,
    last_checked_at: str | None = None,
    error: str | None = None,
    reason: str | None = None,
) -> dict:
    manifest = manifest if isinstance(manifest, dict) else None
    latest_version = str(
        (validation or {}).get("version")
        or (manifest or {}).get("version")
        or (manifest or {}).get("latest_version")
        or ""
    ).strip()
    return {
        "edition": "premium" if state.get("edition") == "premium" else "community",
        "state": str(state.get("state") or ""),
        "update_channel": str(state.get("update_channel") or "community-stable"),
        "current_version": PRODUCT_VERSION,
        "updates_enabled": _premium_updates_enabled(state),
        "available": bool(latest_version and version_gt(latest_version, PRODUCT_VERSION)),
        "latest_version": latest_version or None,
        "version": latest_version or None,
        "channel": (validation or {}).get("channel") or (manifest or {}).get("channel"),
        "artifact": (validation or {}).get("artifact") or (manifest or {}).get("artifact"),
        "artifact_type": (validation or {}).get("artifact_type") or (manifest or {}).get("artifact_type"),
        "package_size_bytes": (validation or {}).get("package_size_bytes") or (manifest or {}).get("package_size_bytes"),
        "checksum_sha256": (validation or {}).get("checksum_sha256") or (manifest or {}).get("checksum_sha256"),
        "changelog": (manifest or {}).get("changelog"),
        "published_at": (manifest or {}).get("published_at") or (manifest or {}).get("released_at"),
        "requires_migration": bool((manifest or {}).get("requires_migration")),
        "min_backend_version": (manifest or {}).get("min_backend_version"),
        "manifest": manifest,
        "last_checked_at": last_checked_at,
        "error": error,
        "reason": reason,
    }


async def _cached_latest_premium_manifest(db: AsyncSession, state: dict) -> dict | None:
    license_data = state.get("license") if isinstance(state.get("license"), dict) else await _system_dependency(
        "get_installed_license", get_installed_license
    )(db)
    channel = str(state.get("update_channel") or (license_data or {}).get("update_channel") or "").strip()
    if not license_data or not channel:
        return None
    cache = await _read_update_manifest_cache(db)
    entry = cache.get(_manifest_cache_key(license_data, channel))
    return entry if isinstance(entry, dict) else None


async def _latest_community_update_response(state: dict) -> dict:
    checked_at = utc_now().isoformat()
    try:
        result = await _system_dependency("get_update_service", get_update_service)().check_community_update(
            str(state.get("update_channel") or "")
        )
    except Exception as exc:
        return _latest_update_response_from_manifest(
            state=state,
            manifest=None,
            last_checked_at=checked_at,
            error=str(exc),
            reason="No se pudo consultar el canal Community.",
        )
    manifest = result.get("manifest") if isinstance(result.get("manifest"), dict) else None
    return {
        **_latest_update_response_from_manifest(
            state=state,
            manifest=manifest or result,
            last_checked_at=checked_at,
            reason="community_synced" if result.get("latest_version") or result.get("version") else "No hay update Community publicado.",
        ),
        "edition": "community",
        "updates_enabled": True,
        "available": bool(result.get("available")),
        "latest_version": result.get("latest_version") or result.get("version"),
        "version": result.get("version") or result.get("latest_version"),
        "channel": result.get("channel") or (manifest or {}).get("channel") or "community-stable",
        "checksum_sha256": result.get("checksum_sha256") or (manifest or {}).get("checksum_sha256"),
        "package_size_bytes": result.get("package_size_bytes") or (manifest or {}).get("package_size_bytes"),
        "changelog": result.get("changelog") or (manifest or {}).get("changelog"),
        "published_at": result.get("published_at") or (manifest or {}).get("published_at") or (manifest or {}).get("released_at"),
        "requires_migration": bool(result.get("requires_migration") or (manifest or {}).get("requires_migration")),
        "min_backend_version": result.get("min_backend_version") or (manifest or {}).get("min_backend_version"),
        "manifest": manifest or result.get("manifest"),
        "error": result.get("error"),
    }


@updates_router.get("/system/updates/latest", response_model=schemas.SystemLatestUpdateResponse)
async def read_system_latest_update(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await _system_dependency("get_entitlement_provider", get_entitlement_provider)().get_state(db)
    if not _premium_updates_enabled(state):
        return await _latest_community_update_response(state)
    entry = await _cached_latest_premium_manifest(db, state)
    if not entry:
        return _latest_update_response_from_manifest(
            state=state,
            manifest=None,
            reason="Busca actualizaciones para consultar el canal Premium habilitado.",
        )
    return _latest_update_response_from_manifest(
        state=state,
        manifest=entry.get("manifest"),
        validation=entry.get("validation") if isinstance(entry.get("validation"), dict) else None,
        last_checked_at=entry.get("checked_at"),
        error=entry.get("error"),
        reason=entry.get("status"),
    )


@updates_router.post("/system/updates/sync-premium", response_model=schemas.SystemLatestUpdateResponse)
async def sync_system_premium_update_manifest(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await _system_dependency("get_entitlement_provider", get_entitlement_provider)().get_state(db)
    if not _premium_updates_enabled(state):
        raise HTTPException(status_code=403, detail="Las actualizaciones Premium requieren licencia activa con updates.premium.")
    license_data = state.get("license") if isinstance(state.get("license"), dict) else await _system_dependency(
        "get_installed_license", get_installed_license
    )(db)
    if not license_data:
        raise HTTPException(status_code=400, detail="No hay licencia Premium instalada.")
    channel = str(state.get("update_channel") or license_data.get("update_channel") or "").strip()
    cache = await _read_update_manifest_cache(db)
    cache_key = _manifest_cache_key(license_data, channel)
    checked_at = utc_now().isoformat()
    try:
        manifest = await _system_dependency(
            "fetch_latest_premium_update_manifest", fetch_latest_premium_update_manifest
        )(license_data, current_version=PRODUCT_VERSION)
        validation = _system_dependency("validate_update_manifest", validate_update_manifest)(manifest, state)
    except PremiumVerificationError as exc:
        if "No hay version Premium posterior aplicable" in str(exc):
            cache[cache_key] = {
                "status": "no_update",
                "checked_at": checked_at,
                "error": None,
                "license_id": license_data.get("license_id"),
                "channel": channel,
            }
            await _write_update_manifest_cache(db, cache)
            return _latest_update_response_from_manifest(
                state=state,
                manifest=None,
                last_checked_at=checked_at,
                reason="No hay una version Premium posterior aplicable para este canal.",
            )
        cache[cache_key] = {
            "status": "error",
            "checked_at": checked_at,
            "error": str(exc),
            "license_id": license_data.get("license_id"),
            "channel": channel,
        }
        await _write_update_manifest_cache(db, cache)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (PremiumVerificationError, UpdateManifestError) as exc:
        cache[cache_key] = {
            "status": "error",
            "checked_at": checked_at,
            "error": str(exc),
            "license_id": license_data.get("license_id"),
            "channel": channel,
        }
        await _write_update_manifest_cache(db, cache)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    cache[cache_key] = {
        "status": "synced",
        "checked_at": checked_at,
        "error": None,
        "license_id": license_data.get("license_id"),
        "channel": validation.get("channel") or channel,
        "version": validation.get("version"),
        "checksum_sha256": validation.get("checksum_sha256"),
        "manifest": manifest,
        "validation": validation,
    }
    await _write_update_manifest_cache(db, cache)
    return _latest_update_response_from_manifest(
        state=state,
        manifest=manifest,
        validation=validation,
        last_checked_at=checked_at,
        reason="synced",
    )


@updates_router.post("/system/updates/check", response_model=schemas.SystemUpdateCheckResponse)
async def check_system_update_manifest(
    payload: schemas.SystemUpdateCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await _system_dependency("get_entitlement_provider", get_entitlement_provider)().get_state(db)
    try:
        return _system_dependency("validate_update_manifest", validate_update_manifest)(payload.manifest.model_dump(), state)
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@updates_router.post("/system/updates/download-grant-request", response_model=schemas.SystemUpdateDownloadGrantPrepareResponse)
async def prepare_system_update_download_grant_request(
    payload: schemas.SystemUpdateDownloadGrantPrepareRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await _system_dependency("get_entitlement_provider", get_entitlement_provider)().get_state(db)
    try:
        return _system_dependency("prepare_update_download_grant_request", prepare_update_download_grant_request)(
            payload.manifest.model_dump(), state
        )
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@updates_router.get("/system/updates/check-community", response_model=schemas.SystemCommunityUpdateCheckResponse)
async def check_system_community_update(
    force: bool = Query(default=False, description="Ignora la cache para consultar el canal remoto."),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    try:
        return await _system_dependency("get_update_service", get_update_service)().check_community_update(force_refresh=force)
    except Exception as exc:
        return {
            "available": False,
            "current_version": PRODUCT_VERSION,
            "latest_version": None,
            "error": str(exc),
        }


@updates_router.post("/system/updates/check-premium", response_model=schemas.SystemPremiumUpdateCheckResponse)
async def check_system_premium_update(
    payload: schemas.SystemPremiumUpdateCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    manifest = payload.manifest.model_dump()
    state = await _system_dependency("get_entitlement_provider", get_entitlement_provider)().get_state(db)
    try:
        result = _system_dependency("validate_update_manifest", validate_update_manifest)(manifest, state)
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if result["edition"] != "premium":
        raise HTTPException(status_code=400, detail="El manifest no corresponde a un canal Premium.")
    latest_version = str(result.get("version") or manifest.get("version") or manifest.get("latest_version") or "").strip()
    return {
        "available": bool(latest_version and version_gt(latest_version, PRODUCT_VERSION)),
        "current_version": PRODUCT_VERSION,
        "latest_version": latest_version or None,
        "version": latest_version or None,
        "channel": result["channel"],
        "edition": "premium",
        "artifact": result.get("artifact"),
        "artifact_type": result.get("artifact_type"),
        "package_size_bytes": result.get("package_size_bytes"),
        "checksum_sha256": result.get("checksum_sha256"),
        "download_grant_required": True,
        "update_server_path": result.get("update_server_path"),
        "changelog": manifest.get("changelog"),
        "published_at": manifest.get("published_at") or manifest.get("released_at"),
        "requires_migration": bool(manifest.get("requires_migration")),
        "min_backend_version": manifest.get("min_backend_version"),
        "manifest": manifest,
    }


@updates_router.post("/system/updates/apply", response_model=schemas.SystemUpdateApplyResponse)
async def apply_system_update(
    payload: schemas.SystemUpdateApplyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "edit")),
):
    channel = str(payload.channel or "").strip()
    if channel == "community":
        channel = configured_community_update_channel()
    manifest = payload.manifest
    if payload.confirmation != "APPLY_UPDATE":
        raise HTTPException(status_code=400, detail="Confirma la actualizacion con APPLY_UPDATE.")
    if channel in COMMUNITY_UPDATE_CHANNELS and manifest is None:
        check_result = await _system_dependency("get_update_service", get_update_service)().check_community_update(channel)
        if not check_result.get("available"):
            raise HTTPException(status_code=400, detail="No hay actualizacion Community disponible.")
        manifest = check_result.get("manifest") or check_result
    if channel in PREMIUM_UPDATE_CHANNELS:
        state = await _system_dependency("get_entitlement_provider", get_entitlement_provider)().get_state(db)
        if manifest is None:
            entry = await _cached_latest_premium_manifest(db, state)
            manifest = entry.get("manifest") if entry else None
            if not manifest:
                raise HTTPException(status_code=400, detail="No hay manifest Premium sincronizado. Busca actualizaciones antes de aplicar.")
        try:
            grant_result = await _system_dependency(
                "request_premium_download_grant", request_premium_download_grant
            )(
                manifest,
                state,
                current_version=PRODUCT_VERSION,
            )
        except UpdateManifestError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except PremiumVerificationError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        manifest = grant_result["manifest"]
    elif channel in COMMUNITY_UPDATE_CHANNELS:
        state = await _system_dependency("get_entitlement_provider", get_entitlement_provider)().get_state(db)
        try:
            _system_dependency("validate_update_manifest", validate_update_manifest)(manifest or {}, state)
            _system_dependency("get_update_service", get_update_service)().validate_update_request(
                channel=channel, manifest=manifest or {}
            )
        except UpdateManifestError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif channel not in COMMUNITY_UPDATE_CHANNELS:
        raise HTTPException(status_code=400, detail="Canal de actualizacion no soportado.")
    try:
        task_id = await _system_dependency("get_update_service", get_update_service)().apply_update(
            channel=channel,
            manifest=manifest,
            force=payload.force,
            initiated_by_user_id=str(current_user.id),
            initiated_by_email=current_user.email,
            initiated_from_ip=_request_client_ip(request),
            apply_confirmation=payload.confirmation,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await crud.create_audit_log(
        db,
        usuario_id=current_user.id,
        accion="UPDATE_APPLY_APPROVED",
        recurso="system_updates",
        detalles={
            "task_id": task_id,
            "channel": channel,
            "version": str((manifest or {}).get("version") or (manifest or {}).get("latest_version") or ""),
            "confirmation": payload.confirmation,
            "force_restart": bool(payload.force),
            "edition": str((manifest or {}).get("edition") or ""),
        },
        ip_address=_request_client_ip(request),
    )
    return {"task_id": task_id, "status": "queued"}



from .system_update_tasks import tasks_router
updates_router.include_router(tasks_router)

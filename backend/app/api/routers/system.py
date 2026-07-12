from __future__ import annotations

import hashlib
import os
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


router = APIRouter(tags=["system"])
UPDATE_MANIFEST_CACHE_SETTING_KEY = "treseko_update_manifest_cache"

BRANDING_LOGO_MIME_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_BRANDING_LOGO_BYTES = 2 * 1024 * 1024


def _request_client_ip(request: Request) -> str | None:
    forwarded_for = (request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    if forwarded_for:
        return forwarded_for
    return request.client.host if request.client else None


@router.get("/health")
async def read_health():
    return {"status": "ok", "service": "backend", "version": PRODUCT_VERSION}


async def _database_schema_revision(db: AsyncSession) -> str | None:
    try:
        result = await db.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
        revision = result.scalar_one_or_none()
        return str(revision) if revision else None
    except Exception:
        return None


@router.get("/system/version")
async def read_system_version(db: AsyncSession = Depends(get_db)):
    return {
        "product": PRODUCT_NAME,
        "version": PRODUCT_VERSION,
        "edition_base": PRODUCT_EDITION_BASE,
        "release_channel": RELEASE_CHANNEL,
        "community_release_tag": COMMUNITY_RELEASE_TAG,
        "database_revision": await _database_schema_revision(db),
    }


@router.get("/system/edition", response_model=schemas.SystemEditionResponse)
async def read_system_edition(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    state = await get_entitlement_provider().get_state(db)
    return {
        "edition": state["edition"],
        "state": state["state"],
        "update_channel": state["update_channel"],
        "limits": state["limits"],
        "plan_id": state.get("plan_id"),
        "plan_name": state.get("plan_name"),
        "plan_version": state.get("plan_version"),
        "plan_custom": bool(state.get("plan_custom")),
    }


@router.get("/system/features", response_model=schemas.SystemFeaturesResponse)
async def read_system_features(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    state = await get_entitlement_provider().get_state(db)
    return {
        "edition": state["edition"],
        "state": state["state"],
        "features": feature_catalog_response(set(state.get("enabled_features") or [])),
        "limits": state["limits"],
    }


async def _branding_state(db: AsyncSession) -> dict[str, Any]:
    entitlement_state = await get_entitlement_provider().get_state(db)
    enabled_features = set(entitlement_state.get("enabled_features") or [])
    can_customize = entitlement_state.get("edition") == "premium" and "branding.custom" in enabled_features
    value = await config_service.get_workspace_branding(db)
    return config_service.branding_response(
        value,
        edition=str(entitlement_state.get("edition") or "community"),
        can_customize=can_customize,
    )


@router.get("/system/branding/public", response_model=schemas.SystemBrandingPublicResponse)
async def read_public_system_branding(
    db: AsyncSession = Depends(get_db),
):
    state = await _branding_state(db)
    return {
        "edition": state["edition"],
        "effective_brand_name": state["effective_brand_name"],
        "effective_logo_url": state["effective_logo_url"],
        "custom_branding_active": state["custom_branding_active"],
    }


@router.get("/system/branding", response_model=schemas.SystemBrandingState)
async def read_system_branding(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.preferencias", "read")),
):
    return await _branding_state(db)


@router.patch("/system/branding", response_model=schemas.SystemBrandingState)
async def update_system_branding(
    branding: schemas.SystemBrandingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.preferencias", "edit")),
    _branding_feature: None = Depends(require_feature("branding.custom")),
):
    await config_service.update_workspace_branding(db, branding)
    return await _branding_state(db)


@router.get("/system/time-settings", response_model=schemas.SystemTimeSettings)
async def read_system_time_settings(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.preferencias", "read")),
):
    return await config_service.get_system_time_settings(db)


@router.patch("/system/time-settings", response_model=schemas.SystemTimeSettings)
async def update_system_time_settings(
    payload: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.preferencias", "edit")),
):
    try:
        settings = schemas.SystemTimeSettings.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail="Zona horaria invalida") from exc
    return await config_service.update_system_time_settings(db, settings)


async def _installation_data_counts(db: AsyncSession) -> dict[str, int]:
    counts: dict[str, int] = {}
    for key, model in (
        ("organizations", models.Organizacion),
        ("projects", models.Proyecto),
        ("cases", models.CasoPrueba),
    ):
        result = await db.execute(select(func.count()).select_from(model))
        counts[key] = int(result.scalar() or 0)
    return counts


async def _first_run_state(db: AsyncSession, current_user: models.Usuario | None = None) -> dict[str, Any]:
    setting = await config_service.get_first_run_onboarding(db)
    counts = await _installation_data_counts(db)
    installation_has_data = any(counts.values())
    completed = bool(setting.get("completed"))

    if not completed and installation_has_data:
        setting = await config_service.update_first_run_onboarding(db, {
            **setting,
            "completed": True,
            "completed_at": utc_now().isoformat(),
            "completed_by_user_id": str(current_user.id) if current_user else None,
            "completion_source": "existing_installation_data",
            "terms_accepted": bool(setting.get("terms_accepted")),
        })
        completed = True

    return {
        "completed": completed,
        "requires_onboarding": not completed and not installation_has_data,
        "installation_has_data": installation_has_data,
        "completion_source": setting.get("completion_source"),
        "completed_at": setting.get("completed_at"),
        "completed_by_user_id": setting.get("completed_by_user_id"),
        "terms_version": setting.get("terms_version"),
    }


@router.get("/system/first-run", response_model=schemas.SystemFirstRunState)
async def read_system_first_run(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    return await _first_run_state(db, current_user)


@router.post("/system/first-run", response_model=schemas.SystemFirstRunState)
async def complete_system_first_run(
    payload: schemas.SystemFirstRunCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.preferencias", "edit")),
):
    existing = await _first_run_state(db, current_user)
    if existing["completed"]:
        return existing
    if not payload.terms_accepted:
        raise HTTPException(status_code=400, detail="Debes aceptar los terminos y condiciones para completar la configuracion inicial.")

    await config_service.update_first_run_onboarding(db, {
        "completed": True,
        "completed_at": utc_now().isoformat(),
        "completed_by_user_id": str(current_user.id),
        "completion_source": "first_run_survey",
        "survey": payload.survey,
        "terms_accepted": True,
        "terms_version": payload.terms_version,
        "telemetry_opt_in": payload.telemetry_opt_in,
        "telemetry_status": payload.telemetry_status,
        "telemetry_endpoint": payload.telemetry_endpoint,
        "telemetry_last_error": payload.telemetry_last_error,
    })
    return await _first_run_state(db, current_user)


@router.post("/system/branding/logo")
async def upload_system_branding_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.preferencias", "edit")),
    _branding_feature: None = Depends(require_feature("branding.custom")),
):
    content_type = (file.content_type or "application/octet-stream").split(";", 1)[0].strip().lower()
    if content_type not in BRANDING_LOGO_MIME_TYPES:
        raise HTTPException(status_code=400, detail="El logo debe ser PNG, JPG, WEBP o GIF.")
    content = await file.read(MAX_BRANDING_LOGO_BYTES + 1)
    if len(content) > MAX_BRANDING_LOGO_BYTES:
        raise HTTPException(status_code=400, detail="El logo no puede superar 2 MB.")
    if not content_matches_declared_type(content_type, content):
        raise HTTPException(status_code=400, detail="El contenido del logo no coincide con el tipo declarado.")
    digest = hashlib.sha256(content).hexdigest()
    ext = BRANDING_LOGO_MIME_TYPES[content_type]
    target_dir = os.path.join("app", "static", "branding")
    os.makedirs(target_dir, exist_ok=True)
    filename = f"{digest}.{ext}"
    target_path = os.path.join(target_dir, filename)
    if not os.path.exists(target_path):
        with open(target_path, "wb") as output:
            output.write(content)
    return {
        "logo_url": f"/static/branding/{filename}",
        "content_type": content_type,
        "size": len(content),
    }


@router.get("/system/license", response_model=schemas.SystemLicenseState)
async def read_system_license(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.licencia", "read")),
):
    return await get_license_state(db)


def _usage_item(used: float, limit: int | None) -> dict:
    percent = 0.0
    if limit and limit > 0:
        percent = max(0.0, min(100.0, (float(used) / float(limit)) * 100.0))
    return {"used": float(used), "limit": limit, "percent": round(percent, 2)}


async def _count_weekly_executions_any_solution(
    db: AsyncSession,
    modes: tuple[models.ExecutionMode, ...],
) -> int:
    since = utc_now() - timedelta(days=WEEKLY_USAGE_WINDOW_DAYS)
    result = await db.execute(
        select(func.count())
        .select_from(models.EjecucionCaso)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .join(models.Proyecto, models.Proyecto.id == models.TestRun.proyecto_id)
        .join(models.Organizacion, models.Organizacion.id == models.Proyecto.organizacion_id)
        .filter(
            models.Organizacion.activo.is_(True),
            models.EjecucionCaso.execution_mode.in_(list(modes)),
            models.EjecucionCaso.fecha_ejecucion >= since,
        )
    )
    return int(result.scalar() or 0)


@router.get("/system/license/usage", response_model=schemas.SystemLicenseUsageResponse)
async def read_system_license_usage(
    organization_id: Optional[UUID] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.licencia", "read")),
):
    state = await get_entitlement_provider().get_state(db)
    limits = state.get("limits") or {}
    if organization_id:
        await access_control.require_organization_access(db, current_user, organization_id, "read")

    org_count = int(
        (
            await db.execute(
                select(func.count()).select_from(models.Organizacion).filter(models.Organizacion.activo.is_(True))
            )
        ).scalar()
        or 0
    )
    if organization_id:
        users_count = int(
            (
                await db.execute(
                    select(func.count()).select_from(models.OrganizacionMiembro).filter(models.OrganizacionMiembro.organizacion_id == organization_id)
                )
            ).scalar()
            or 0
        )
        projects_count = int(
            (
                await db.execute(
                    select(func.count()).select_from(models.Proyecto).filter(models.Proyecto.organizacion_id == organization_id)
                    .filter(models.Proyecto.activo.is_(True))
                )
            ).scalar()
            or 0
        )
        workers_count = int(
            (
                await db.execute(
                    select(func.count()).select_from(models.AutomationRunner).filter(
                        models.AutomationRunner.organizacion_id == organization_id,
                        models.AutomationRunner.activo.is_(True),
                    )
                )
            ).scalar()
            or 0
        )
        automated_count = await count_weekly_executions(
            db,
            (models.ExecutionMode.AUTOMATIZADA, models.ExecutionMode.EXTERNA),
            solution_id=organization_id,
        )
        ai_count = await count_weekly_executions(db, (models.ExecutionMode.IA,), solution_id=organization_id)
        storage_bytes = int(
            (
                await db.execute(
                    select(func.coalesce(func.sum(models.Attachment.size), 0)).filter(models.Attachment.organizacion_id == organization_id)
                )
            ).scalar()
            or 0
        )
    else:
        users_count = int((await db.execute(select(func.count()).select_from(models.Usuario))).scalar() or 0)
        projects_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(models.Proyecto)
                    .join(models.Organizacion, models.Organizacion.id == models.Proyecto.organizacion_id)
                    .filter(
                        models.Organizacion.activo.is_(True),
                        models.Proyecto.activo.is_(True),
                    )
                )
            ).scalar()
            or 0
        )
        workers_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(models.AutomationRunner)
                    .join(models.Organizacion, models.Organizacion.id == models.AutomationRunner.organizacion_id)
                    .filter(
                        models.AutomationRunner.activo.is_(True),
                        models.Organizacion.activo.is_(True),
                    )
                )
            ).scalar()
            or 0
        )
        automated_count = await _count_weekly_executions_any_solution(
            db,
            (models.ExecutionMode.AUTOMATIZADA, models.ExecutionMode.EXTERNA),
        )
        ai_count = await _count_weekly_executions_any_solution(db, (models.ExecutionMode.IA,))
        storage_bytes = int((await db.execute(select(func.coalesce(func.sum(models.Attachment.size), 0)))).scalar() or 0)

    storage_mb = round(storage_bytes / (1024 * 1024), 2)
    usage = {
        "max_organizations": _usage_item(org_count, limits.get("max_organizations")),
        "max_users": _usage_item(users_count, limits.get("max_users")),
        "max_projects": _usage_item(projects_count, limits.get("max_projects")),
        "max_workers": _usage_item(workers_count, limits.get("max_workers")),
        "max_automated_runs_per_week": _usage_item(automated_count, limits.get("max_automated_runs_per_week")),
        "max_ai_runs_per_week": _usage_item(ai_count, limits.get("max_ai_runs_per_week")),
        "max_storage_mb": _usage_item(storage_mb, limits.get("max_storage_mb")),
    }
    return {"organization_id": str(organization_id) if organization_id else None, "usage": usage}


@router.get("/system/trust", response_model=schemas.SystemTrustResponse)
async def read_system_trust(
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.licencia", "read")),
):
    return {
        "license_keyring": license_keyring_status(),
        "server_response_keyring": server_response_keyring_status(),
        "update_keyring": update_keyring_status(),
    }


@router.post("/system/license/install", response_model=schemas.SystemLicenseState)
async def install_system_license(
    payload: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.licencia", "edit")),
):
    try:
        state = await install_license(db, payload)
        license_data = state.get("license") or {}
        if license_data.get("verification_server"):
            try:
                online_state = await activate_license_online(license_data)
            except PremiumVerificationError:
                return state
            return await save_online_license_state(db, online_state)
        return state
    except LicenseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/system/license/activate", response_model=schemas.SystemLicenseState)
async def activate_system_license_online(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.licencia", "edit")),
):
    license_data = await get_installed_license(db)
    if not license_data:
        raise HTTPException(status_code=400, detail="No hay licencia Premium instalada")
    try:
        state = await activate_license_online(license_data)
    except PremiumVerificationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return await save_online_license_state(db, state)


@router.post("/system/license/heartbeat", response_model=schemas.SystemLicenseState)
async def heartbeat_system_license_online(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.licencia", "read")),
):
    license_data = await get_installed_license(db)
    if not license_data:
        raise HTTPException(status_code=400, detail="No hay licencia Premium instalada")
    try:
        state = await heartbeat_license_online(license_data)
    except PremiumVerificationError as exc:
        cached_state = await get_online_license_state(db)
        state = offline_grace_from_cached_state(cached_state, license_data)
        if state is None:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    return await save_online_license_state(db, state)


@router.get("/system/updates/channels", response_model=schemas.SystemUpdateChannelsResponse)
async def read_system_update_channels(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await get_entitlement_provider().get_state(db)
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
    license_data = state.get("license") if isinstance(state.get("license"), dict) else await get_installed_license(db)
    channel = str(state.get("update_channel") or (license_data or {}).get("update_channel") or "").strip()
    if not license_data or not channel:
        return None
    cache = await _read_update_manifest_cache(db)
    entry = cache.get(_manifest_cache_key(license_data, channel))
    return entry if isinstance(entry, dict) else None


async def _latest_community_update_response(state: dict) -> dict:
    checked_at = utc_now().isoformat()
    try:
        result = await get_update_service().check_community_update(str(state.get("update_channel") or ""))
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


@router.get("/system/updates/latest", response_model=schemas.SystemLatestUpdateResponse)
async def read_system_latest_update(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await get_entitlement_provider().get_state(db)
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


@router.post("/system/updates/sync-premium", response_model=schemas.SystemLatestUpdateResponse)
async def sync_system_premium_update_manifest(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await get_entitlement_provider().get_state(db)
    if not _premium_updates_enabled(state):
        raise HTTPException(status_code=403, detail="Las actualizaciones Premium requieren licencia activa con updates.premium.")
    license_data = state.get("license") if isinstance(state.get("license"), dict) else await get_installed_license(db)
    if not license_data:
        raise HTTPException(status_code=400, detail="No hay licencia Premium instalada.")
    channel = str(state.get("update_channel") or license_data.get("update_channel") or "").strip()
    cache = await _read_update_manifest_cache(db)
    cache_key = _manifest_cache_key(license_data, channel)
    checked_at = utc_now().isoformat()
    try:
        manifest = await fetch_latest_premium_update_manifest(license_data, current_version=PRODUCT_VERSION)
        validation = validate_update_manifest(manifest, state)
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


@router.post("/system/updates/check", response_model=schemas.SystemUpdateCheckResponse)
async def check_system_update_manifest(
    payload: schemas.SystemUpdateCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await get_entitlement_provider().get_state(db)
    try:
        return validate_update_manifest(payload.manifest.model_dump(), state)
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/system/updates/download-grant-request", response_model=schemas.SystemUpdateDownloadGrantPrepareResponse)
async def prepare_system_update_download_grant_request(
    payload: schemas.SystemUpdateDownloadGrantPrepareRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await get_entitlement_provider().get_state(db)
    try:
        return prepare_update_download_grant_request(payload.manifest.model_dump(), state)
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/system/updates/check-community", response_model=schemas.SystemCommunityUpdateCheckResponse)
async def check_system_community_update(
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    try:
        return await get_update_service().check_community_update()
    except Exception as exc:
        return {
            "available": False,
            "current_version": PRODUCT_VERSION,
            "latest_version": None,
            "error": str(exc),
        }


@router.post("/system/updates/check-premium", response_model=schemas.SystemPremiumUpdateCheckResponse)
async def check_system_premium_update(
    payload: schemas.SystemPremiumUpdateCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    manifest = payload.manifest.model_dump()
    state = await get_entitlement_provider().get_state(db)
    try:
        result = validate_update_manifest(manifest, state)
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


@router.post("/system/updates/apply", response_model=schemas.SystemUpdateApplyResponse)
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
        check_result = await get_update_service().check_community_update(channel)
        if not check_result.get("available"):
            raise HTTPException(status_code=400, detail="No hay actualizacion Community disponible.")
        manifest = check_result.get("manifest") or check_result
    if channel in PREMIUM_UPDATE_CHANNELS:
        state = await get_entitlement_provider().get_state(db)
        if manifest is None:
            entry = await _cached_latest_premium_manifest(db, state)
            manifest = entry.get("manifest") if entry else None
            if not manifest:
                raise HTTPException(status_code=400, detail="No hay manifest Premium sincronizado. Busca actualizaciones antes de aplicar.")
        try:
            grant_result = await request_premium_download_grant(
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
        state = await get_entitlement_provider().get_state(db)
        try:
            validate_update_manifest(manifest or {}, state)
            get_update_service().validate_update_request(channel=channel, manifest=manifest or {})
        except UpdateManifestError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif channel not in COMMUNITY_UPDATE_CHANNELS:
        raise HTTPException(status_code=400, detail="Canal de actualizacion no soportado.")
    try:
        task_id = await get_update_service().apply_update(
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


@router.get("/system/updates/status", response_model=schemas.SystemUpdateStatusResponse)
async def read_system_update_status(
    task_id: Optional[str] = Query(default=None),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    return await get_update_service().get_update_status(task_id)


@router.get("/system/updates/status/{task_id}", response_model=schemas.SystemUpdateStatusResponse)
async def read_system_update_status_by_id(
    task_id: str,
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    status = await get_update_service().get_update_status(task_id)
    if not status.get("task_id"):
        raise HTTPException(status_code=404, detail="Tarea de actualizacion no encontrada.")
    return status


@router.get("/system/updates/history", response_model=schemas.SystemUpdateHistoryResponse)
async def read_system_update_history(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    return {"tasks": await get_update_service().get_update_history(limit)}


@router.post("/system/updates/report-failure/{task_id}")
async def report_system_update_failure(
    task_id: str,
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    status_payload = await get_update_service().get_update_status(task_id)
    if not status_payload.get("task_id"):
        raise HTTPException(status_code=404, detail="Tarea de actualizacion no encontrada.")
    if status_payload.get("status") != "failed":
        raise HTTPException(status_code=400, detail="Solo se reportan tareas fallidas.")
    reported = await get_update_service().report_failure(task_id)
    if not reported:
        raise HTTPException(status_code=404, detail="Tarea fallida no encontrada.")
    return {"status": "reported", "task_id": task_id}


@router.post("/system/updates/rollback/{task_id}", response_model=schemas.SystemUpdateStatusResponse)
async def rollback_system_update(
    task_id: str,
    request: Request,
    payload: schemas.SystemUpdateRollbackRequest = Body(default_factory=schemas.SystemUpdateRollbackRequest),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "edit")),
):
    try:
        result = await get_update_service().rollback(
            task_id,
            restore_database=payload.restore_database,
            confirmation=payload.confirmation,
            requested_by_user_id=str(current_user.id),
            requested_by_email=current_user.email,
            requested_from_ip=_request_client_ip(request),
        )
    except ValueError as exc:
        status_code = 404 if "No existe una tarea" in str(exc) else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    await crud.create_audit_log(
        db,
        usuario_id=current_user.id,
        accion="UPDATE_ROLLBACK_APPROVED",
        recurso="system_updates",
        detalles={
            "task_id": task_id,
            "restore_database": bool(payload.restore_database),
            "confirmation": payload.confirmation,
            "result_stage": result.get("stage"),
            "result_status": result.get("status"),
        },
        ip_address=_request_client_ip(request),
    )
    return result

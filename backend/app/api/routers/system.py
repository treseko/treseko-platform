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
from .system_support import (
    branding_state as _branding_state,
    database_schema_revision as _database_schema_revision,
    first_run_state as _first_run_state,
    request_client_ip as _request_client_ip,
)
from .system_updates import (
    apply_system_update,
    check_system_community_update,
    check_system_premium_update,
    check_system_update_manifest,
    prepare_system_update_download_grant_request,
    read_system_update_channels,
    updates_router,
)
from .system_update_tasks import (
    read_system_update_history,
    read_system_update_status,
    read_system_update_status_by_id,
    rollback_system_update,
)
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
@router.get("/health")
async def read_health():
    return {"status": "ok", "service": "backend", "version": PRODUCT_VERSION}
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
        "effective_primary_color": state["effective_primary_color"],
        "effective_accent_color": state["effective_accent_color"],
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
@router.get("/system/evidence-sanitization-policy", response_model=schemas.SystemEvidenceSanitizationPolicy)
async def read_system_evidence_sanitization_policy(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.adjuntos", "read")),
):
    return await config_service.get_evidence_sanitization_policy(db)
@router.patch("/system/evidence-sanitization-policy", response_model=schemas.SystemEvidenceSanitizationPolicy)
async def update_system_evidence_sanitization_policy(
    request: Request,
    payload: schemas.SystemEvidenceSanitizationPolicyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("settings.evidence_sanitization.manage", "edit")),
):
    previous = await config_service.get_evidence_sanitization_policy(db)
    updated = await config_service.update_evidence_sanitization_policy(db, payload.model_dump(exclude_none=True))
    client_ip = _request_client_ip(request) or "unknown"
    action = "EVIDENCE_SANITIZATION_ENABLED" if updated["sanitization_enabled"] else "EVIDENCE_SANITIZATION_DISABLED"
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion=action,
        recurso="evidence_sanitization_policy",
        detalles={
            "old_value": previous,
            "new_value": updated,
        },
        ip_address=client_ip,
    )
    return updated
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
        ai_case_generation_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(models.CasoGeneracion)
                    .join(models.Proyecto, models.Proyecto.id == models.CasoGeneracion.proyecto_id)
                    .filter(
                        models.Proyecto.organizacion_id == organization_id,
                        models.CasoGeneracion.fecha_creacion >= utc_now() - timedelta(days=WEEKLY_USAGE_WINDOW_DAYS),
                    )
                )
            ).scalar()
            or 0
        )
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
        ai_case_generation_count = int(
            (
                await db.execute(
                    select(func.count())
                    .select_from(models.CasoGeneracion)
                    .join(models.Proyecto, models.Proyecto.id == models.CasoGeneracion.proyecto_id)
                    .join(models.Organizacion, models.Organizacion.id == models.Proyecto.organizacion_id)
                    .filter(
                        models.Organizacion.activo.is_(True),
                        models.CasoGeneracion.fecha_creacion >= utc_now() - timedelta(days=WEEKLY_USAGE_WINDOW_DAYS),
                    )
                )
            ).scalar()
            or 0
        )
        storage_bytes = int((await db.execute(select(func.coalesce(func.sum(models.Attachment.size), 0)))).scalar() or 0)
    storage_mb = round(storage_bytes / (1024 * 1024), 2)
    usage = {
        "max_organizations": _usage_item(org_count, limits.get("max_organizations")),
        "max_users": _usage_item(users_count, limits.get("max_users")),
        "max_projects": _usage_item(projects_count, limits.get("max_projects")),
        "max_workers": _usage_item(workers_count, limits.get("max_workers")),
        "max_automated_runs_per_week": _usage_item(automated_count, limits.get("max_automated_runs_per_week")),
        "max_ai_runs_per_week": _usage_item(ai_count, limits.get("max_ai_runs_per_week")),
        "max_ai_case_generations_per_week": _usage_item(
            ai_case_generation_count,
            limits.get("max_ai_case_generations_per_week"),
        ),
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
            except PremiumVerificationError as exc:
                # La firma local ya fue validada y la licencia quedó instalada,
                # pero no debemos presentar la activación online como confirmada.
                return {
                    **state,
                    "online_status": "pending",
                    "online_reason": f"No se pudo confirmar la activación online: {exc}",
                }
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
router.include_router(updates_router)

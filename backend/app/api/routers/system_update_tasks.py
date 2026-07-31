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




tasks_router = APIRouter(tags=["system"])

@tasks_router.post("/system/updates/restart/{task_id}", response_model=schemas.SystemUpdateStatusResponse)
async def restart_prepared_system_update(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "edit")),
):
    try:
        result = await get_update_service().restart_prepared_update(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await crud.create_audit_log(
        db,
        usuario_id=current_user.id,
        accion="UPDATE_RESTART_APPROVED",
        recurso="system_updates",
        detalles={"task_id": task_id, "version": result.get("version")},
    )
    return result


@tasks_router.get("/system/updates/status", response_model=schemas.SystemUpdateStatusResponse)
async def read_system_update_status(
    task_id: Optional[str] = Query(default=None),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    return await get_update_service().get_update_status(task_id)


@tasks_router.get("/system/updates/status/{task_id}", response_model=schemas.SystemUpdateStatusResponse)
async def read_system_update_status_by_id(
    task_id: str,
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    status = await get_update_service().get_update_status(task_id)
    if not status.get("task_id"):
        raise HTTPException(status_code=404, detail="Tarea de actualizacion no encontrada.")
    return status


@tasks_router.get("/system/updates/history", response_model=schemas.SystemUpdateHistoryResponse)
async def read_system_update_history(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    return {"tasks": await get_update_service().get_update_history(limit)}


@tasks_router.post("/system/updates/report-failure/{task_id}")
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


@tasks_router.post("/system/updates/rollback/{task_id}", response_model=schemas.SystemUpdateStatusResponse)
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

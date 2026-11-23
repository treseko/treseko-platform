"""Worker-authenticated update state API."""
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from pathlib import Path

from ... import models
from ...main_context import *
from ...services.automation_worker_updates import (
    create_worker_update_archive,
    current_worker_build_id,
    worker_source_directory,
    worker_source_build_id,
    worker_update_status,
)
from ...version import PRODUCT_VERSION
from .automation import get_current_automation_runner

router = APIRouter(tags=["Automatizacion"])


@router.get("/automation-runners/me/update-status")
async def get_current_runner_update_status(
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
):
    """Expose the release target to the authenticated Worker host agent."""
    return worker_update_status(
        runner.capabilities,
        desired_version=PRODUCT_VERSION,
        desired_build_id=current_worker_build_id(),
    )


@router.get("/automation-runners/me/update-package")
async def download_current_worker_update(
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
):
    """Deliver the platform's active Worker code to this authenticated stale runner."""
    try:
        source = worker_source_directory()
        desired_build_id = worker_source_build_id(source)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"code": str(exc)}) from exc
    status = worker_update_status(
        runner.capabilities,
        desired_version=PRODUCT_VERSION,
        desired_build_id=desired_build_id,
    )
    if status["status"] != "update_required":
        raise HTTPException(status_code=409, detail={
            "error_code": "WORKER_UPDATE_NOT_AVAILABLE",
            "message": "Este Worker ya tiene la versión y build actuales.",
        })
    archive_path: Path | None = None
    try:
        archive_path, checksum = create_worker_update_archive(source, desired_version=PRODUCT_VERSION)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"code": str(exc)}) from exc
    return FileResponse(
        archive_path,
        media_type="application/gzip",
        filename=f"treseko-automation-worker-{PRODUCT_VERSION}.tar.gz",
        headers={
            "X-Worker-Update-Version": PRODUCT_VERSION,
            "X-Worker-Update-SHA256": checksum,
            "X-Worker-Update-Build-ID": desired_build_id,
            "Cache-Control": "no-store",
        },
        background=BackgroundTask(archive_path.unlink, missing_ok=True),
    )


@router.post("/automation-runners/me/update-lock")
async def acquire_current_runner_update_lock(
    x_runner_update_lock: str | None = Header(default=None),
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
    db: AsyncSession = Depends(get_db),
):
    """Atomically pause job assignment while a legacy Worker is replaced."""
    lock_token = (x_runner_update_lock or "").strip() or secrets.token_urlsafe(32)
    try:
        _, created = await crud.acquire_automation_runner_update_lock(db, runner.id, lock_token)
    except ValueError as exc:
        code = str(exc)
        status_code = status.HTTP_409_CONFLICT if code in {
            "worker_update_busy", "worker_update_already_locked",
        } else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail={"code": code}) from exc
    return {"locked": True, "created": created, "lock_token": lock_token}


@router.delete("/automation-runners/me/update-lock")
async def release_current_runner_update_lock(
    x_runner_update_lock: str = Header(...),
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
    db: AsyncSession = Depends(get_db),
):
    try:
        _, released = await crud.release_automation_runner_update_lock(db, runner.id, x_runner_update_lock.strip())
    except ValueError as exc:
        code = str(exc)
        status_code = status.HTTP_409_CONFLICT if code == "worker_update_lock_token_mismatch" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail={"code": code}) from exc
    return {"locked": False, "released": released}

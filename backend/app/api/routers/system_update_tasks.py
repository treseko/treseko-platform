from __future__ import annotations

import sys
from typing import Any
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from ...database import get_db
from ... import auth, crud, models, schemas
from sqlalchemy.ext.asyncio import AsyncSession
from ...services.updater import get_update_service
from .system_support import (
    request_client_ip as _request_client_ip,
)




tasks_router = APIRouter(tags=["system"])
_DEFAULT_UPDATE_SERVICE = get_update_service


def _update_service() -> Any:
    """Use a locally patched service before consulting the system facade."""
    if get_update_service is not _DEFAULT_UPDATE_SERVICE:
        return get_update_service()
    facade = sys.modules.get(f"{__package__}.system")
    factory = getattr(facade, "get_update_service", get_update_service) if facade else get_update_service
    return factory()

@tasks_router.post("/system/updates/restart/{task_id}", response_model=schemas.SystemUpdateStatusResponse)
async def restart_prepared_system_update(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "edit")),
):
    try:
        result = await _update_service().restart_prepared_update(task_id)
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
    return await _update_service().get_update_status(task_id)


@tasks_router.get("/system/updates/status/{task_id}", response_model=schemas.SystemUpdateStatusResponse)
async def read_system_update_status_by_id(
    task_id: str,
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    status = await _update_service().get_update_status(task_id)
    if not status.get("task_id"):
        raise HTTPException(status_code=404, detail="Tarea de actualizacion no encontrada.")
    return status


@tasks_router.get("/system/updates/history", response_model=schemas.SystemUpdateHistoryResponse)
async def read_system_update_history(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    return {"tasks": await _update_service().get_update_history(limit)}


@tasks_router.post("/system/updates/report-failure/{task_id}")
async def report_system_update_failure(
    task_id: str,
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    status_payload = await _update_service().get_update_status(task_id)
    if not status_payload.get("task_id"):
        raise HTTPException(status_code=404, detail="Tarea de actualizacion no encontrada.")
    if status_payload.get("status") != "failed":
        raise HTTPException(status_code=400, detail="Solo se reportan tareas fallidas.")
    reported = await _update_service().report_failure(task_id)
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
        result = await _update_service().rollback(
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

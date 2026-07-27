from __future__ import annotations

import base64
from uuid import UUID
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import access_control, auth, models
from ...database import get_db
from ...repositories.scheduled_runs_audit import create_audit_log
from ...services import case_portability
from ...services.case_portability_examples import build_tcases_example

router = APIRouter(prefix="/case-portability", tags=["case-portability"])

class ImportPayload(BaseModel):
    profile_id: str = Field(max_length=100)
    content_base64: str = Field(min_length=1, max_length=30_000_000)
    file_name: str | None = Field(default=None, max_length=255)
    selected_external_ids: list[str] | None = None
    component_id: UUID | None = None
    build_id: UUID | None = None

def _capability(user: models.Usuario, level: str) -> None:
    if not auth.has_capability_permission(user, "plugins.provider.case_portability.importar_casos", level):
        raise HTTPException(status_code=403, detail="No tienes permisos para portabilidad de casos")

def _decode(value: str) -> bytes:
    try: return base64.b64decode(value, validate=True)
    except Exception as exc: raise HTTPException(status_code=422, detail="El archivo codificado no es válido") from exc

@router.get("/profiles")
async def read_profiles(current_user: models.Usuario = Depends(auth.get_current_active_user)):
    _capability(current_user, "read")
    return {"profiles": case_portability.profiles(), "export_format": case_portability.FORMAT_ID}

@router.get("/templates/tcases-example")
async def download_tcases_example(request: Request, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_active_user)):
    _capability(current_user, "read")
    data = build_tcases_example(case_portability.FORMAT_ID)
    await create_audit_log(db, current_user.id, "case_portability.template_downloaded", "case_portability_template", detalles={"format": case_portability.FORMAT_ID, "template": "tcases-example"}, ip_address=request.client.host if request.client else None)
    return Response(data, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="ejemplo-migracion-treseko.tcases"'})

@router.get("/projects/{project_id}/export")
async def export_cases(project_id: UUID, component_id: UUID, suite_ids: List[UUID] | None = None, case_ids: List[UUID] | None = None, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_active_user)):
    _capability(current_user, "read"); await access_control.require_project_access(db, current_user, project_id, "read")
    component = await access_control.require_component_access(db, current_user, component_id, "read")
    if component.proyecto_id != project_id:
        raise HTTPException(status_code=404, detail="Componente no encontrado para el proyecto")
    if suite_ids:
        suites = (await db.execute(select(models.Suite).where(models.Suite.id.in_(suite_ids), models.Suite.proyecto_id == project_id, models.Suite.componente_id == component_id))).scalars().all()
        if len(suites) != len(set(suite_ids)): raise HTTPException(status_code=400, detail="Una o más suites no pertenecen al componente seleccionado")
    if case_ids:
        cases = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.id.in_(case_ids), models.CasoPrueba.proyecto_id == project_id, models.CasoPrueba.componente_id == component_id))).scalars().all()
        if len(cases) != len(set(case_ids)): raise HTTPException(status_code=400, detail="Uno o más casos no pertenecen al componente seleccionado")
    data = await case_portability.export_tcases(db, project_id, component_id, suite_ids, case_ids)
    await create_audit_log(db, current_user.id, "case_portability.exported", "case_portability", detalles={"project_id": str(project_id), "component_id": str(component_id), "format": case_portability.FORMAT_ID})
    return Response(data, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="treseko-cases.tcases"'})

@router.post("/projects/{project_id}/preview")
async def preview_cases(project_id: UUID, payload: ImportPayload, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_active_user)):
    _capability(current_user, "edit"); await access_control.require_project_access(db, current_user, project_id, "edit")
    try:
        case_portability.validate_file_extension(payload.profile_id, payload.file_name)
        return await case_portability.preview_import(db, project_id, payload.profile_id, _decode(payload.content_base64))
    except case_portability.PortabilityError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc

@router.post("/projects/{project_id}/import")
async def import_cases(project_id: UUID, payload: ImportPayload, request: Request, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_active_user)):
    _capability(current_user, "edit"); await access_control.require_project_access(db, current_user, project_id, "edit")
    if not payload.component_id: raise HTTPException(status_code=422, detail="Seleccioná un componente destino antes de importar")
    component = await db.get(models.Componente, payload.component_id)
    if not component or component.proyecto_id != project_id: raise HTTPException(status_code=422, detail="El componente destino no pertenece al proyecto")
    if payload.build_id:
        build = await db.get(models.Build, payload.build_id)
        if not build or build.proyecto_id != project_id or build.componente_id != component.id: raise HTTPException(status_code=422, detail="La build destino no pertenece al componente seleccionado")
    try:
        case_portability.validate_file_extension(payload.profile_id, payload.file_name)
        batch = await case_portability.commit_import(db, project_id, payload.profile_id, _decode(payload.content_base64), payload.file_name, current_user.id, payload.selected_external_ids, payload.component_id, payload.build_id)
    except case_portability.PortabilityError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
    await create_audit_log(db, current_user.id, "case_portability.imported", "case_import_batch", batch.id, {"project_id": str(project_id), "component_id": str(payload.component_id), "build_id": str(payload.build_id) if payload.build_id else None, "source": batch.source_tool, "version": batch.source_version, "summary": batch.summary_json}, request.client.host if request.client else None)
    return {"batch_id": str(batch.id), "status": batch.status, "summary": batch.summary_json, "items": batch.item_results}

@router.get("/projects/{project_id}/batches")
async def read_batches(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_active_user)):
    _capability(current_user, "read"); await access_control.require_project_access(db, current_user, project_id, "read")
    rows = (await db.execute(select(models.CaseImportBatch).where(models.CaseImportBatch.proyecto_id == project_id).order_by(models.CaseImportBatch.created_at.desc()).limit(100))).scalars().all()
    batches = []
    for row in rows:
        rollback_available, _, rollback_expires_at = await case_portability.rollback_eligibility(db, row)
        batches.append({"id": str(row.id), "source_tool": row.source_tool, "source_version": row.source_version, "file_name": row.file_name, "status": row.status, "summary": row.summary_json, "created_at": row.created_at, "rolled_back_at": row.rolled_back_at, "rollback_available": rollback_available, "rollback_expires_at": rollback_expires_at})
    return batches

@router.post("/batches/{batch_id}/rollback")
async def rollback_import(batch_id: UUID, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.get_current_active_user)):
    _capability(current_user, "edit"); batch = await db.get(models.CaseImportBatch, batch_id)
    if not batch: raise HTTPException(status_code=404, detail="Lote de importación no encontrado")
    await access_control.require_project_access(db, current_user, batch.proyecto_id, "edit")
    try: batch = await case_portability.rollback_batch(db, batch, current_user.id)
    except case_portability.PortabilityError as exc: raise HTTPException(status_code=409, detail=str(exc)) from exc
    await create_audit_log(db, current_user.id, "case_portability.rolled_back", "case_import_batch", batch.id, {"project_id": str(batch.proyecto_id)})
    return {"batch_id": str(batch.id), "status": batch.status}

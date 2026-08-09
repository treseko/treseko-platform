import asyncio
import re
import os
import shutil
import tempfile
from typing import Any

from fastapi import APIRouter, Path

from ...main_context import *
from ...main_context import _shared_report_quality_gate_failed
from ...services.edition.entitlement_service import require_feature
from .report_rendering import *


router = APIRouter(tags=["reports"])
from .reports_shared import (
    SAFE_REPORT_THUMBNAIL_SVG,
    SHARED_REPORT_TOKEN_PATH,
    REPORT_SLUG_PATH,
    REPORT_TYPE_PATH,
    _enforce_public_shared_report_rate_limit,
    _request_ip,
    _report_pretty_path,
    _shared_report_audit_details,
    _safe_public_thumbnail_svg,
    _shared_report_html_response,
    _safe_download_filename,
    _safe_report_download_filename,
    _shared_report_markdown_response,
    _shared_report_csv_response,
    _shared_report_pdf_response,
)

@router.get("/proyectos/{proyecto_id}/metrics/")
async def read_project_metrics(
    proyecto_id: UUID,
    build_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if build_id:
        db_build = await access_control.require_build_access(db, current_user, build_id, "read")
        if db_build.proyecto_id != proyecto_id:
            raise HTTPException(status_code=404, detail="Build no encontrado para el proyecto")
    return await crud.get_project_metrics(db, proyecto_id=proyecto_id, build_id=build_id)


@router.get("/proyectos/{proyecto_id}/quality-intelligence/health", response_model=schemas.QualityHealthResponse)
async def read_quality_intelligence_health(
    proyecto_id: UUID,
    classification: Optional[str] = Query(None, max_length=40),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_quality_health(
        db,
        proyecto_id,
        classification=classification,
        limit=limit,
    )


@router.get(
    "/proyectos/{proyecto_id}/quality-intelligence/fingerprints",
    response_model=schemas.QualityFailureFingerprintResponse,
)
async def read_quality_intelligence_fingerprints(
    proyecto_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_quality_failure_fingerprints(db, proyecto_id, limit=limit)


@router.get(
    "/proyectos/{proyecto_id}/quality-intelligence/observations",
    response_model=schemas.QualityExecutionObservationResponse,
)
async def read_quality_intelligence_observations(
    proyecto_id: UUID,
    suite_id: Optional[UUID] = None,
    build_id: Optional[UUID] = None,
    entorno_id: Optional[UUID] = None,
    runner_id: Optional[UUID] = None,
    case_master_id: Optional[UUID] = None,
    resultado: Optional[str] = Query(None, max_length=30),
    observed_from: Optional[datetime] = None,
    observed_to: Optional[datetime] = None,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if build_id:
        build = await access_control.require_build_access(db, current_user, build_id, "read")
        if build.proyecto_id != proyecto_id:
            raise HTTPException(status_code=404, detail="Build no encontrado para el proyecto")
    return await crud.get_quality_execution_observations(
        db,
        proyecto_id,
        suite_id=suite_id,
        build_id=build_id,
        entorno_id=entorno_id,
        runner_id=runner_id,
        case_master_id=case_master_id,
        resultado=resultado,
        observed_from=observed_from,
        observed_to=observed_to,
        limit=limit,
    )


@router.post(
    "/proyectos/{proyecto_id}/quality-intelligence/diagnoses",
    response_model=schemas.QualityDiagnosisResponse,
)
async def create_quality_intelligence_diagnosis(
    proyecto_id: UUID,
    payload: schemas.QualityDiagnosisCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.configurar", "edit")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    try:
        diagnosis = await crud.create_quality_diagnosis(db, proyecto_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    await crud.create_audit_log(db, usuario_id=current_user.id, accion="CREATE", recurso="quality_diagnosis", recurso_id=diagnosis["id"], detalles={"project_id": str(proyecto_id), "status": diagnosis["status"]}, ip_address=_request_ip(request), commit=False)
    await db.commit()
    return diagnosis


@router.get(
    "/proyectos/{proyecto_id}/quality-intelligence/diagnoses",
    response_model=schemas.QualityDiagnosisListResponse,
)
async def read_quality_intelligence_diagnoses(
    proyecto_id: UUID,
    limit: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_quality_diagnoses(db, proyecto_id, limit=limit)


@router.post(
    "/proyectos/{proyecto_id}/quality-intelligence/diagnoses/{diagnosis_id}/review",
    response_model=schemas.QualityDiagnosisResponse,
)
async def review_project_quality_intelligence_diagnosis(
    proyecto_id: UUID,
    diagnosis_id: UUID,
    payload: schemas.QualityDiagnosisReview,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capabilities(
        ("bugs.ver", "read"), ("bugs.crear", "edit")
    )),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    try:
        diagnosis = await crud.review_quality_diagnosis(db, proyecto_id, diagnosis_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if diagnosis is None:
        raise HTTPException(status_code=404, detail="Diagnóstico no encontrado")
    await crud.create_audit_log(db, usuario_id=current_user.id, accion=payload.status, recurso="quality_diagnosis", recurso_id=diagnosis_id, detalles={"project_id": str(proyecto_id)}, ip_address=_request_ip(request), commit=False)
    await db.commit()
    return diagnosis


@router.patch(
    "/proyectos/{proyecto_id}/quality-intelligence/diagnoses/{diagnosis_id}",
    response_model=schemas.QualityDiagnosisResponse,
)
async def edit_project_quality_intelligence_diagnosis(
    proyecto_id: UUID,
    diagnosis_id: UUID,
    payload: schemas.QualityDiagnosisEdit,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capabilities(
        ("bugs.ver", "read"), ("bugs.crear", "edit")
    )),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    try:
        diagnosis = await crud.edit_quality_diagnosis(db, proyecto_id, diagnosis_id, payload, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if diagnosis is None:
        raise HTTPException(status_code=404, detail="Diagnóstico no encontrado")
    await crud.create_audit_log(
        db, usuario_id=current_user.id, accion="EDIT_VERSION", recurso="quality_diagnosis",
        recurso_id=diagnosis["id"], detalles={"project_id": str(proyecto_id), "supersedes_diagnosis_id": str(diagnosis_id)},
        ip_address=_request_ip(request), commit=False,
    )
    await db.commit()
    return diagnosis


@router.get(
    "/proyectos/{proyecto_id}/quality-intelligence/diagnoses/{diagnosis_id}/bug-draft",
    response_model=schemas.QualityDiagnosisBugDraftResponse,
)
async def read_quality_intelligence_diagnosis_bug_draft(
    proyecto_id: UUID,
    diagnosis_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capabilities(
        ("bugs.ver", "read"), ("bugs.crear", "edit")
    )),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    try:
        draft = await crud.get_quality_diagnosis_bug_draft(db, proyecto_id, diagnosis_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if draft is None:
        raise HTTPException(status_code=404, detail="Diagnóstico no encontrado")
    return draft


@router.get(
    "/proyectos/{proyecto_id}/quality-intelligence/summary",
    response_model=schemas.QualityIntelligenceSummary,
)
async def read_quality_intelligence_summary(
    proyecto_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    return await crud.get_quality_intelligence_summary(db, proyecto_id)


@router.post(
    "/proyectos/{proyecto_id}/quality-intelligence/release-risk/evaluate",
    response_model=schemas.ReleaseRiskEvaluationResponse,
)
async def evaluate_project_release_risk(
    proyecto_id: UUID,
    payload: schemas.ReleaseRiskEvaluateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.configurar", "edit")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    try:
        evaluation = await crud.evaluate_release_risk(db, proyecto_id, payload.build_id, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    await crud.create_audit_log(
        db, usuario_id=current_user.id, accion="EVALUATE", recurso="release_risk",
        recurso_id=evaluation["id"], detalles={"project_id": str(proyecto_id), "build_id": str(payload.build_id), "score": evaluation["score"], "recommendation": evaluation["recommendation"]}, ip_address=_request_ip(request), commit=False,
    )
    await db.commit()
    return evaluation


@router.get(
    "/proyectos/{proyecto_id}/quality-intelligence/release-risk",
    response_model=schemas.ReleaseRiskEvaluationResponse,
)
async def read_project_release_risk(
    proyecto_id: UUID,
    build_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    build = await access_control.require_build_access(db, current_user, build_id, "read")
    if build.proyecto_id != proyecto_id:
        raise HTTPException(status_code=404, detail="Build no encontrada para el proyecto")
    evaluation = await crud.get_latest_release_risk(db, proyecto_id, build_id)
    if evaluation is None:
        raise HTTPException(status_code=404, detail="Todavía no hay una evaluación de riesgo para esta build")
    return evaluation


@router.post(
    "/proyectos/{proyecto_id}/quality-intelligence/release-risk/{evaluation_id}/accept",
    response_model=schemas.ReleaseRiskEvaluationResponse,
)
async def accept_project_release_risk(
    proyecto_id: UUID,
    evaluation_id: UUID,
    payload: schemas.ReleaseRiskAcceptanceRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.configurar", "edit")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    try:
        evaluation = await crud.accept_release_risk(db, proyecto_id, evaluation_id, payload.note, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if evaluation is None:
        raise HTTPException(status_code=404, detail="Evaluación de riesgo no encontrada")
    await crud.create_audit_log(
        db, usuario_id=current_user.id, accion="ACCEPT", recurso="release_risk",
        recurso_id=evaluation_id, detalles={"project_id": str(proyecto_id), "note": evaluation["acceptance_note"]}, ip_address=_request_ip(request), commit=False,
    )
    await db.commit()
    return evaluation


@router.post(
    "/proyectos/{proyecto_id}/quality-intelligence/rebuild",
    response_model=schemas.QualityIntelligenceRebuildResponse,
)
async def rebuild_project_quality_intelligence(
    proyecto_id: UUID,
    payload: schemas.QualityIntelligenceRebuildRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.configurar", "edit")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    result = await crud.rebuild_quality_intelligence(
        db,
        proyecto_id,
        window_size=payload.window_size,
        commit=False,
    )
    if result["status"] == "NOT_FOUND":
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    await crud.create_audit_log(
        db,
        usuario_id=current_user.id,
        accion="REBUILD",
        recurso="quality_intelligence",
        recurso_id=proyecto_id,
        detalles={
            "project_id": str(proyecto_id),
            "window_size": payload.window_size,
            "observations": result["observations"],
            "health_records": result["health_records"],
            "algorithm_version": result["algorithm_version"],
        },
        ip_address=_request_ip(request),
        commit=False,
    )
    await db.commit()
    return result

@router.get("/proyectos/{proyecto_id}/report-settings", response_model=schemas.ProjectReportSettings)
async def read_project_report_settings(
    proyecto_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.configurar", "read")),
    _premium_reports: None = Depends(require_feature("reports.advanced")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    settings = await crud.get_project_report_settings(db, proyecto_id)
    if settings is None:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return settings

@router.patch("/proyectos/{proyecto_id}/report-settings", response_model=schemas.ProjectReportSettings)
async def update_project_report_settings(
    proyecto_id: UUID,
    settings: schemas.ProjectReportSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.configurar", "edit")),
    _premium_reports: None = Depends(require_feature("reports.advanced")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    updated = await crud.update_project_report_settings(db, proyecto_id, settings.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return updated

@router.get("/dashboard/summary")
async def read_dashboard_summary(
    proyecto_id: UUID,
    build_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_module("dashboard", "read"))
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    if build_id:
        await access_control.require_build_access(db, current_user, build_id, "read")
    if component_id:
        await access_control.require_component_access(db, current_user, component_id, "read")
    return await crud.get_dashboard_summary(
        db,
        proyecto_id=proyecto_id,
        current_user=current_user,
        build_id=build_id,
        component_id=component_id,
        date_from=date_from,
        date_to=date_to,
    )

def _shared_report_response(snapshot: models.SharedReportSnapshot, request: Request, has_new_values: bool = False):
    data = schemas.SharedReportSnapshotResponse.model_validate(snapshot).model_dump()
    data["public_url"] = str(request.base_url).rstrip("/") + _report_pretty_path(snapshot)
    data["has_new_values"] = has_new_values
    return data

def _snapshot_report_type(snapshot: models.SharedReportSnapshot) -> str:
    payload = snapshot.payload or {}
    report_type = _report_type_from_payload(payload)
    return report_type if report_type in {"executive", "development", "internal"} else "executive"

def _is_public_shared_report(snapshot: models.SharedReportSnapshot) -> bool:
    return _snapshot_report_type(snapshot) != "internal"

def _snapshot_url(snapshot: models.SharedReportSnapshot, request: Request) -> str:
    return str(request.base_url).rstrip("/") + _report_pretty_path(snapshot)

def _shared_report_bundle_response(bundle: dict, request: Request):
    snapshots = sorted(bundle.get("snapshots") or [], key=lambda item: _snapshot_report_type(item))
    links = {_snapshot_report_type(snapshot): _snapshot_url(snapshot, request) for snapshot in snapshots}
    tokens = {_snapshot_report_type(snapshot): snapshot.token for snapshot in snapshots}
    executive = next((snapshot for snapshot in snapshots if _snapshot_report_type(snapshot) == "executive"), None)
    response_snapshots = []
    for snapshot in snapshots:
        data = schemas.SharedReportSnapshotResponse.model_validate(snapshot).model_dump()
        data["public_url"] = _snapshot_url(snapshot, request)
        data["has_new_values"] = False
        response_snapshots.append(data)
    created_at = min((snapshot.created_at for snapshot in snapshots), default=utc_now())
    expires_at = next((snapshot.expires_at for snapshot in snapshots if snapshot.expires_at), None)
    metadata = ((snapshots[0].payload or {}).get("metadata") or {}) if snapshots else {}
    return {
        "snapshot_group_id": bundle.get("snapshot_group_id") or "",
        "metrics_hash": bundle.get("metrics_hash") or "",
        "reused": bool(bundle.get("reused")),
        "created_at": created_at,
        "expires_at": expires_at,
        "activo": any(snapshot.activo for snapshot in snapshots),
        "public_url": links.get("executive") or (_snapshot_url(executive, request) if executive else None),
        "links": links,
        "tokens": tokens,
        "snapshots": response_snapshots,
        "requested_report_type": metadata.get("requested_report_type"),
        "build_definition": metadata.get("build_definition"),
        "qa_comment": metadata.get("qa_comment"),
        "definition_responsible_id": metadata.get("definition_responsible_id"),
        "definition_at": metadata.get("definition_at"),
    }

@router.post("/reports/share", response_model=schemas.SharedReportBundleResponse)
async def create_shared_report(
    payload: schemas.SharedReportSnapshotCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.compartir", "edit")),
    _premium_snapshots: None = Depends(require_feature("reports.snapshots")),
):
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "edit")
    if payload.build_id:
        db_build = await access_control.require_build_access(db, current_user, payload.build_id, "read")
        if db_build.proyecto_id != payload.proyecto_id:
            raise HTTPException(status_code=404, detail="Build no encontrado para el proyecto")
    if payload.componente_id:
        db_component = await access_control.require_component_access(db, current_user, payload.componente_id, "read")
        if db_component.proyecto_id != payload.proyecto_id:
            raise HTTPException(status_code=404, detail="Componente no encontrado para el proyecto")
    requested_type = str(payload.requested_report_type or "all").lower()
    if requested_type not in {"all", "executive", "development", "internal"}:
        raise HTTPException(status_code=422, detail="Tipo de informe invalido")
    definition = str(payload.build_definition or "").strip()
    if not definition:
        raise HTTPException(status_code=422, detail="Debes seleccionar una definicion QA para el paquete de informes")
    comment_required = definition.upper() in {
        "RECHAZADA",
        "BLOQUEADA",
        "APROBADA_CON_OBSERVACIONES",
        "PENDIENTE_DE_VALIDACION",
    }
    if comment_required and not str(payload.qa_comment or "").strip():
        raise HTTPException(status_code=422, detail="Debes agregar comentario QA para esta definicion de build")
    bundle = await crud.create_shared_report_bundle(db, payload, current_user.id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    primary_snapshot = (bundle.get("snapshots") or [None])[0] if bundle.get("snapshots") else None
    primary_snapshot_id = primary_snapshot.id if primary_snapshot else None
    report_title = primary_snapshot.title if primary_snapshot else "Informe QA"
    await notification_event_service.emit_event(
        db=db,
        event_type="report.generated",
        actor_user_id=current_user.id,
        proyecto_id=payload.proyecto_id,
        entity_type="shared_report",
        entity_id=primary_snapshot_id,
        severity="info",
        payload={
            "report": {
                "title": report_title,
                "build_id": str(payload.build_id) if payload.build_id else None,
                "componente_id": str(payload.componente_id) if payload.componente_id else None,
            },
            "actor": {"id": str(current_user.id), "email": current_user.email, "nombre": current_user.nombre_completo or current_user.email},
            "message": f"Reporte generado: {report_title}",
        },
        dedupe_key=f"report.generated:{payload.proyecto_id}:{payload.build_id}:{utc_now().strftime('%Y%m%d%H%M')}",
    )
    await notification_event_service.emit_event(
        db=db,
        event_type="report.shared",
        actor_user_id=current_user.id,
        proyecto_id=payload.proyecto_id,
        entity_type="shared_report",
        entity_id=primary_snapshot_id,
        severity="info",
        payload={
            "report": {
                "title": report_title,
                "build_id": str(payload.build_id) if payload.build_id else None,
                "componente_id": str(payload.componente_id) if payload.componente_id else None,
                "snapshot_group_id": bundle.get("snapshot_group_id"),
                "types": [_snapshot_report_type(snapshot) for snapshot in bundle.get("snapshots", [])],
            },
            "actor": {"id": str(current_user.id), "email": current_user.email, "nombre": current_user.nombre_completo or current_user.email},
            "message": f"Reporte compartido: {report_title}",
        },
        dedupe_key=f"report.shared:{payload.proyecto_id}:{payload.build_id}:{utc_now().strftime('%Y%m%d%H%M')}",
    )
    await notification_event_service.emit_event(
        db=db,
        event_type="report.exported",
        actor_user_id=current_user.id,
        proyecto_id=payload.proyecto_id,
        entity_type="shared_report",
        entity_id=primary_snapshot_id,
        severity="info",
        payload={
            "report": {"title": report_title, "build_id": str(payload.build_id) if payload.build_id else None},
            "actor": {"id": str(current_user.id), "email": current_user.email, "nombre": current_user.nombre_completo or current_user.email},
            "message": f"Reporte exportado: {report_title}",
        },
        dedupe_key=f"report.exported:{payload.proyecto_id}:{payload.build_id}:{utc_now().strftime('%Y%m%d%H%M')}",
    )
    quality_failed, quality_context = _shared_report_quality_gate_failed(primary_snapshot)
    if quality_failed:
        qa_summary = quality_context.get("qa_summary") or {}
        stats = quality_context.get("stats") or {}
        await notification_event_service.emit_event(
            db=db,
            event_type="report.quality_gate_failed",
            actor_user_id=current_user.id,
            proyecto_id=payload.proyecto_id,
            entity_type="shared_report",
            entity_id=primary_snapshot_id,
            severity="warning",
            payload={
                "report": {
                    "title": report_title,
                    "build_id": str(payload.build_id) if payload.build_id else None,
                    "componente_id": str(payload.componente_id) if payload.componente_id else None,
                    "decision": qa_summary.get("decision"),
                    "risk": qa_summary.get("risk"),
                    "fallados": stats.get("fallados"),
                    "bloqueados": stats.get("bloqueados"),
                },
                "proyecto": {"id": str(payload.proyecto_id)},
                "actor": {"id": str(current_user.id), "email": current_user.email, "nombre": current_user.nombre_completo or current_user.email},
                "message": f"Quality gate fallido: {report_title}",
            },
            dedupe_key=f"report.quality_gate_failed:{payload.proyecto_id}:{payload.build_id}:{utc_now().strftime('%Y%m%d%H%M')}",
        )
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="shared_report_bundle",
        recurso_id=primary_snapshot_id,
        detalles=_shared_report_audit_details(bundle, payload),
        ip_address=_request_ip(request),
    )
    await realtime_event_bus.publish(
        payload.proyecto_id,
        "report.share.created",
        actor_id=current_user.id,
        component_id=payload.componente_id,
        build_id=payload.build_id,
        payload={
            "report": {
                "title": report_title,
                "snapshot_group_id": bundle.get("snapshot_group_id"),
                "types": [_snapshot_report_type(snapshot) for snapshot in bundle.get("snapshots", [])],
            },
        },
    )
    return _shared_report_bundle_response(bundle, request)

@router.get("/reports/share/history", response_model=List[schemas.SharedReportBundleHistoryItem])
async def read_shared_report_history(
    request: Request,
    proyecto_id: UUID = Query(...),
    build_id: Optional[UUID] = Query(None),
    componente_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.compartir", "read")),
    _premium_snapshots: None = Depends(require_feature("reports.snapshots")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    history = await crud.list_shared_report_bundle_history(db, proyecto_id, build_id, componente_id)
    items = []
    for item in history:
        snapshots = item.pop("snapshots", [])
        links = {_snapshot_report_type(snapshot): _snapshot_url(snapshot, request) for snapshot in snapshots}
        tokens = {_snapshot_report_type(snapshot): snapshot.token for snapshot in snapshots}
        items.append({**item, "links": links, "tokens": tokens})
    return items

@router.get("/reports/share/{token}/status", response_model=schemas.SharedReportStatus)
async def read_shared_report_status(
    request: Request,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.compartir", "read")),
    _premium_snapshots: None = Depends(require_feature("reports.snapshots")),
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Informe compartido no encontrado")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "read")
    expired = crud.shared_report_is_expired(snapshot)
    latest = await crud.get_latest_equivalent_shared_report(db, snapshot)
    return schemas.SharedReportStatus(
        token=token,
        activo=snapshot.activo,
        expired=expired,
        has_new_values=await crud.shared_report_has_new_values(db, snapshot),
        created_at=snapshot.created_at,
        expires_at=snapshot.expires_at,
        report_type=_snapshot_report_type(snapshot),
        snapshot_group_id=(snapshot.payload or {}).get("metadata", {}).get("snapshot_group_id"),
        latest_url=_snapshot_url(latest, request) if latest else None,
        latest_token=latest.token if latest else None,
    )

@router.delete("/reports/share/{token}")
async def delete_shared_report(
    request: Request,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.compartir", "edit")),
    _premium_snapshots: None = Depends(require_feature("reports.snapshots")),
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Informe compartido no encontrado")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "edit")
    snapshot_group_id = (snapshot.payload or {}).get("metadata", {}).get("snapshot_group_id")
    report_type = _snapshot_report_type(snapshot)
    await crud.revoke_shared_report(db, token)
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="REVOKE",
        recurso="shared_report",
        recurso_id=snapshot.id,
        detalles={
            "snapshot_group_id": snapshot_group_id,
            "report_type": report_type,
            "project_id": str(snapshot.proyecto_id),
            "build_id": str(snapshot.build_id) if snapshot.build_id else None,
            "component_id": str(snapshot.componente_id) if snapshot.componente_id else None,
        },
        ip_address=_request_ip(request),
    )
    await realtime_event_bus.publish(
        snapshot.proyecto_id,
        "report.share.revoked",
        actor_id=current_user.id,
        component_id=snapshot.componente_id,
        build_id=snapshot.build_id,
        payload={
            "report": {
                "id": str(snapshot.id),
                "report_type": report_type,
                "snapshot_group_id": snapshot_group_id,
            },
        },
    )
    return {"ok": True}

from .reports_public import router as reports_public_router
from .reports_public import (
    public_shared_report_markdown,
    pretty_public_shared_report_markdown,
    public_shared_report_csv,
    pretty_public_shared_report_csv,
    public_shared_report_pdf,
    pretty_public_shared_report_pdf,
    public_shared_report_v2,
    pretty_public_shared_report,
    internal_shared_report_markdown,
    pretty_internal_shared_report_markdown,
    internal_shared_report_csv,
    pretty_internal_shared_report_csv,
    internal_shared_report_pdf,
    pretty_internal_shared_report_pdf,
    internal_shared_report,
    pretty_internal_shared_report,
    public_shared_report,
    public_shared_report_thumbnail,
    pretty_public_shared_report_thumbnail,
)

router.routes.extend(reports_public_router.routes)

router.export_symbols = {
    "read_project_metrics": read_project_metrics,
    "read_dashboard_summary": read_dashboard_summary,
    "create_shared_report": create_shared_report,
    "read_shared_report_history": read_shared_report_history,
    "read_shared_report_status": read_shared_report_status,
    "delete_shared_report": delete_shared_report,
    "public_shared_report_markdown": public_shared_report_markdown,
    "public_shared_report_v2": public_shared_report_v2,
    "internal_shared_report_markdown": internal_shared_report_markdown,
    "internal_shared_report": internal_shared_report,
    "public_shared_report": public_shared_report,
    "public_shared_report_thumbnail": public_shared_report_thumbnail,
    "_shared_report_response": _shared_report_response,
    "_snapshot_report_type": _snapshot_report_type,
    "_is_public_shared_report": _is_public_shared_report,
    "_snapshot_url": _snapshot_url,
    "_shared_report_bundle_response": _shared_report_bundle_response,
    "_report_public_url": _report_public_url,
    "_flatten_report_cases": _flatten_report_cases,
    "_report_badge_class": _report_badge_class,
    "_render_report_evidence": _render_report_evidence,
    "_render_report_distribution": _render_report_distribution,
    "_render_report_trend": _render_report_trend,
    "_render_report_cases": _render_report_cases,
    "_render_report_failed_steps": _render_report_failed_steps,
    "_render_report_bugs": _render_report_bugs,
    "_report_type_from_payload": _report_type_from_payload,
    "_report_common_css": _report_common_css,
    "_report_context_html": _report_context_html,
    "_render_executive_issues": _render_executive_issues,
    "_render_bug_severity_summary": _render_bug_severity_summary,
    "_render_development_failures": _render_development_failures,
    "_render_bug_tracking": _render_bug_tracking,
    "_render_development_actions": _render_development_actions,
    "_shared_report_html": _shared_report_html,
    "_md": _md,
    "_markdown_evidence": _markdown_evidence,
    "_shared_report_markdown": _shared_report_markdown,
}

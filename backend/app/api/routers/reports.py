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

SHARED_REPORT_TOKEN_PATH = Path(
    ...,
    min_length=1,
    max_length=schemas.MAX_SHARED_REPORT_TOKEN_LENGTH,
    pattern=r"^[A-Za-z0-9_-]+$",
)
REPORT_SLUG_PATH = Path(..., min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
REPORT_TYPE_PATH = Path(..., min_length=1, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")

SAFE_REPORT_THUMBNAIL_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0f172a"/>
  <rect x="48" y="48" width="1104" height="534" rx="28" fill="#ffffff"/>
  <text x="92" y="145" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#0f172a">Informe QA</text>
  <text x="92" y="210" font-family="Arial, sans-serif" font-size="28" fill="#475569">Miniatura no disponible</text>
</svg>"""

UNSAFE_SVG_PATTERN = re.compile(
    r"(?is)(<\s*script\b|<\s*foreignObject\b|<\s*iframe\b|<\s*object\b|<\s*embed\b|"
    r"\bon[a-z0-9_-]+\s*=|javascript\s*:|data\s*:|xlink:href\s*=|href\s*=\s*['\"]\s*https?://|"
    r"<\s*image\b|<\s*use\b)"
)

REPORT_HTML_SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; "
        "script-src 'none'; "
        "style-src 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'none'; "
        "connect-src 'none'; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "form-action 'none'; "
        "frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}

REPORT_MARKDOWN_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}

public_shared_report_rate_limiter = auth.LoginRateLimiter(max_attempts=120, window_minutes=1)


def _request_ip(request: Request | None) -> str:
    return request.client.host if request and request.client else "unknown"


def _enforce_public_shared_report_rate_limit(request: Request, token: str) -> None:
    key = f"shared-report:{_request_ip(request)}:{token}"
    if public_shared_report_rate_limiter.is_rate_limited(key):
        raise HTTPException(status_code=429, detail="Demasiadas solicitudes. Intenta nuevamente en unos minutos.")
    public_shared_report_rate_limiter.record_failure(key)


def _shared_report_audit_details(bundle: dict, payload: schemas.SharedReportSnapshotCreate) -> dict:
    snapshots = bundle.get("snapshots") or []
    return {
        "snapshot_group_id": bundle.get("snapshot_group_id"),
        "metrics_hash": bundle.get("metrics_hash"),
        "reused": bool(bundle.get("reused")),
        "project_id": str(payload.proyecto_id),
        "build_id": str(payload.build_id) if payload.build_id else None,
        "component_id": str(payload.componente_id) if payload.componente_id else None,
        "report_types": [_snapshot_report_type(snapshot) for snapshot in snapshots],
        "snapshot_count": len(snapshots),
        "build_definition": payload.build_definition,
    }


def _safe_public_thumbnail_svg(value: Any) -> str:
    text = str(value or "").replace("\x00", "").strip()
    if not text or len(text) > 200_000:
        return SAFE_REPORT_THUMBNAIL_SVG
    if not re.match(r"(?is)^<\s*svg\b", text):
        return SAFE_REPORT_THUMBNAIL_SVG
    if UNSAFE_SVG_PATTERN.search(text):
        return SAFE_REPORT_THUMBNAIL_SVG
    return text


def _shared_report_html_response(content: str) -> HTMLResponse:
    return HTMLResponse(content=content, headers=REPORT_HTML_SECURITY_HEADERS)


def _safe_download_filename(filename: str, fallback: str = "informe-qa.md") -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", str(filename or "").strip())
    value = value.strip("._-")
    if not value:
        value = fallback
    if not value.lower().endswith(".md"):
        value = f"{value}.md"
    return value[:120]

def _safe_report_download_filename(filename: str, extension: str, fallback_stem: str = "informe-qa") -> str:
    ext = extension.strip(".").lower() or "txt"
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", str(filename or "").strip()).strip("._-")
    if not value:
        value = fallback_stem
    value = re.sub(r"\.[A-Za-z0-9]+$", "", value)
    return f"{value[:100]}.{ext}"

def _report_slug(value: Any, fallback: str) -> str:
    text = str(value or fallback).strip().lower()
    replacements = {
        "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n",
        "Á": "a", "É": "e", "Í": "i", "Ó": "o", "Ú": "u", "Ñ": "n",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    text = re.sub(r"-+", "-", text)
    return (text or fallback)[:60].strip("-") or fallback

def _report_pretty_path(snapshot: models.SharedReportSnapshot) -> str:
    metadata = (snapshot.payload or {}).get("metadata") or {}
    report_type = _snapshot_report_type(snapshot)
    solution = _report_slug(metadata.get("organizacion"), "solucion")
    project = _report_slug(metadata.get("proyecto"), "proyecto")
    build = _report_slug(metadata.get("build") or metadata.get("build_code"), "build")
    if report_type == "internal":
        return f"/informes-internos/{solution}/{project}/{build}/{snapshot.token}"
    return f"/informes/{solution}/{project}/{build}/{report_type}/{snapshot.token}"


def _shared_report_markdown_response(content: str, filename: str) -> Response:
    safe_filename = _safe_download_filename(filename)
    headers = {
        **REPORT_MARKDOWN_SECURITY_HEADERS,
        "Content-Disposition": f'attachment; filename="{safe_filename}"',
    }
    return Response(content=content, media_type="text/markdown; charset=utf-8", headers=headers)

def _shared_report_csv_response(content: str, filename: str) -> Response:
    safe_filename = _safe_report_download_filename(filename, "csv")
    headers = {
        **REPORT_MARKDOWN_SECURITY_HEADERS,
        "Content-Disposition": f'attachment; filename="{safe_filename}"',
    }
    return Response(content=content, media_type="text/csv; charset=utf-8", headers=headers)

async def _shared_report_pdf_response(snapshot: models.SharedReportSnapshot, request: Request, has_new_values: bool, latest_url: str | None = None) -> Response:
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    if not chrome:
        raise HTTPException(status_code=503, detail="Exportacion PDF no disponible en este entorno")
    html_content = _shared_report_html(snapshot, request, has_new_values, latest_url)
    safe_filename = _safe_report_download_filename(snapshot.title or snapshot.token, "pdf")
    with tempfile.TemporaryDirectory(prefix="treseko-report-") as tmp_dir:
        html_path = os.path.join(tmp_dir, "report.html")
        pdf_path = os.path.join(tmp_dir, "report.pdf")
        with open(html_path, "w", encoding="utf-8") as handle:
            handle.write(html_content)
        command = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--no-pdf-header-footer",
            "--print-to-pdf-no-header",
            f"--print-to-pdf={pdf_path}",
            f"file://{html_path}",
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=30)
            if process.returncode != 0:
                raise RuntimeError((stderr or stdout or b"").decode("utf-8", errors="replace")[:1000])
            with open(pdf_path, "rb") as handle:
                content = handle.read()
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.wait()
            raise HTTPException(status_code=504, detail="La generacion del PDF demoro demasiado") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail="No se pudo generar el PDF") from exc
    headers = {
        **REPORT_MARKDOWN_SECURITY_HEADERS,
        "Content-Disposition": f'attachment; filename="{safe_filename}"',
    }
    return Response(content=content, media_type="application/pdf", headers=headers)

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

@router.get("/s/reports/{token}.md", name="public_shared_report_markdown")
async def public_shared_report_markdown(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    content = _shared_report_markdown(snapshot, await crud.shared_report_has_new_values(db, snapshot))
    filename = f"{snapshot.token}.md"
    return _shared_report_markdown_response(content, filename)

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}.md", name="pretty_public_shared_report_markdown")
async def pretty_public_shared_report_markdown(
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_markdown(request=request, token=token, db=db)

@router.get("/s/reports/{token}.csv", name="public_shared_report_csv")
async def public_shared_report_csv(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    return _shared_report_csv_response(_shared_report_csv(snapshot), f"{snapshot.token}.csv")

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}.csv", name="pretty_public_shared_report_csv")
async def pretty_public_shared_report_csv(
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_csv(request=request, token=token, db=db)

@router.get("/s/reports/{token}.pdf", name="public_shared_report_pdf")
async def public_shared_report_pdf(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    latest = await crud.get_latest_equivalent_shared_report(db, snapshot) if has_new_values else None
    latest_url = _snapshot_url(latest, request) if latest else None
    return await _shared_report_pdf_response(snapshot, request, has_new_values, latest_url)

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}.pdf", name="pretty_public_shared_report_pdf")
async def pretty_public_shared_report_pdf(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_pdf(request=request, token=token, db=db)

@router.get("/s/reports/{token}", response_class=HTMLResponse, name="public_shared_report")
async def public_shared_report_v2(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    latest = await crud.get_latest_equivalent_shared_report(db, snapshot) if has_new_values else None
    latest_url = _snapshot_url(latest, request) if latest else None
    return _shared_report_html_response(_shared_report_html(snapshot, request, has_new_values, latest_url))

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}", response_class=HTMLResponse, name="pretty_public_shared_report")
async def pretty_public_shared_report(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_v2(request=request, token=token, db=db)

@router.get("/reports/internal/{token}.md", name="internal_shared_report_markdown")
async def internal_shared_report_markdown(
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "read")
    if _snapshot_report_type(snapshot) != "internal":
        raise HTTPException(status_code=404, detail="Informe interno no encontrado")
    content = _shared_report_markdown(snapshot, await crud.shared_report_has_new_values(db, snapshot))
    filename = f"{snapshot.token}-interno.md"
    return _shared_report_markdown_response(content, filename)

@router.get("/informes-internos/{solution}/{project}/{build}/{token}.md", name="pretty_internal_shared_report_markdown")
async def pretty_internal_shared_report_markdown(
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    return await internal_shared_report_markdown(token=token, db=db, current_user=current_user)

@router.get("/reports/internal/{token}.csv", name="internal_shared_report_csv")
async def internal_shared_report_csv(
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "read")
    if _snapshot_report_type(snapshot) != "internal":
        raise HTTPException(status_code=404, detail="Informe interno no encontrado")
    return _shared_report_csv_response(_shared_report_csv(snapshot), f"{snapshot.token}-interno.csv")

@router.get("/informes-internos/{solution}/{project}/{build}/{token}.csv", name="pretty_internal_shared_report_csv")
async def pretty_internal_shared_report_csv(
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    return await internal_shared_report_csv(token=token, db=db, current_user=current_user)

@router.get("/reports/internal/{token}.pdf", name="internal_shared_report_pdf")
async def internal_shared_report_pdf(
    request: Request,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "read")
    if _snapshot_report_type(snapshot) != "internal":
        raise HTTPException(status_code=404, detail="Informe interno no encontrado")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    latest = await crud.get_latest_equivalent_shared_report(db, snapshot) if has_new_values else None
    latest_url = _snapshot_url(latest, request) if latest else None
    return await _shared_report_pdf_response(snapshot, request, has_new_values, latest_url)

@router.get("/informes-internos/{solution}/{project}/{build}/{token}.pdf", name="pretty_internal_shared_report_pdf")
async def pretty_internal_shared_report_pdf(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    return await internal_shared_report_pdf(request=request, token=token, db=db, current_user=current_user)

@router.get("/reports/internal/{token}", response_class=HTMLResponse, name="internal_shared_report")
async def internal_shared_report(
    request: Request,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    await access_control.require_project_access(db, current_user, snapshot.proyecto_id, "read")
    if _snapshot_report_type(snapshot) != "internal":
        raise HTTPException(status_code=404, detail="Informe interno no encontrado")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    latest = await crud.get_latest_equivalent_shared_report(db, snapshot) if has_new_values else None
    latest_url = _snapshot_url(latest, request) if latest else None
    return _shared_report_html_response(_shared_report_html(snapshot, request, has_new_values, latest_url))

@router.get("/informes-internos/{solution}/{project}/{build}/{token}", response_class=HTMLResponse, name="pretty_internal_shared_report")
async def pretty_internal_shared_report(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("reportes.ver", "read"))
):
    return await internal_shared_report(request=request, token=token, db=db, current_user=current_user)

@router.get("/s/reports/{token}", response_class=HTMLResponse, name="public_shared_report_legacy")
async def public_shared_report(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Informe no disponible")
    has_new_values = await crud.shared_report_has_new_values(db, snapshot)
    payload = snapshot.payload or {}
    meta = payload.get("metadata") or {}
    metrics = payload.get("metrics") or {}
    stats = metrics.get("stats") or {}
    title = html.escape(snapshot.title)
    description = html.escape(snapshot.description or "")
    image_url = str(request.url_for("public_shared_report_thumbnail", token=token))
    banner = (
        "<div class='banner'>Hay nuevos resultados disponibles desde que se compartio este informe.</div>"
        if has_new_values else ""
    )
    body = f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content="{description}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{description}" />
  <meta property="og:image" content="{html.escape(image_url)}" />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{description}" />
  <meta name="twitter:image" content="{html.escape(image_url)}" />
  <style>
    body {{ margin: 0; font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; }}
    main {{ max-width: 980px; margin: 40px auto; padding: 0 20px; }}
    .card {{ background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px; box-shadow: 0 10px 35px rgba(15,23,42,.08); }}
    .banner {{ background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; padding: 12px 16px; border-radius: 10px; margin-bottom: 18px; font-weight: 700; }}
    .grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 24px; }}
    .metric {{ border-radius: 12px; padding: 20px; }}
    .ok {{ background: #dcfce7; color: #166534; }}
    .fail {{ background: #fee2e2; color: #991b1b; }}
    .blocked {{ background: #dbeafe; color: #1e3a8a; }}
    .value {{ font-size: 42px; font-weight: 800; display: block; }}
    .label {{ font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }}
    .meta {{ color: #64748b; line-height: 1.7; }}
  </style>
</head>
<body>
  <main>
    {banner}
    <section class="card">
      <h1>{title}</h1>
      <p class="meta">
        Organizacion: {html.escape(str(meta.get("organizacion") or "N/D"))}<br/>
        Componente: {html.escape(str(meta.get("componente") or "N/D"))}<br/>
        Plataforma: {html.escape(str(meta.get("plataforma") or "N/D"))}<br/>
        Fecha snapshot: {html.escape(str(meta.get("snapshot_at") or snapshot.created_at))}
      </p>
      <div class="grid">
        <div class="metric ok"><span class="label">Pasadas</span><span class="value">{stats.get("pasados", 0)}</span></div>
        <div class="metric fail"><span class="label">Fallidas</span><span class="value">{stats.get("fallados", 0)}</span></div>
        <div class="metric blocked"><span class="label">Bloqueadas</span><span class="value">{stats.get("bloqueados", 0)}</span></div>
      </div>
      <p class="meta">Cobertura: {metrics.get("cobertura_porcentaje", 0)}% · Ejecutadas: {metrics.get("total_ejecutados", 0)} / {metrics.get("total_casos_asignados", 0)}</p>
    </section>
  </main>
</body>
</html>"""
    return _shared_report_html_response(body)

@router.get("/s/reports/{token}/thumbnail.svg", name="public_shared_report_thumbnail")
async def public_shared_report_thumbnail(request: Request, token: str = SHARED_REPORT_TOKEN_PATH, db: AsyncSession = Depends(get_db)):
    _enforce_public_shared_report_rate_limit(request, token)
    snapshot = await crud.get_shared_report_by_token(db, token)
    if not snapshot or not snapshot.activo or crud.shared_report_is_expired(snapshot):
        raise HTTPException(status_code=404, detail="Miniatura no disponible")
    if not _is_public_shared_report(snapshot):
        raise HTTPException(status_code=404, detail="Miniatura no disponible")
    return Response(
        content=_safe_public_thumbnail_svg(snapshot.thumbnail_svg),
        media_type="image/svg+xml",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; img-src 'none'; style-src 'unsafe-inline'",
        },
    )

@router.get("/informes/{solution}/{project}/{build}/{report_type}/{token}/preview.svg", name="pretty_public_shared_report_thumbnail")
async def pretty_public_shared_report_thumbnail(
    request: Request,
    solution: str = REPORT_SLUG_PATH,
    project: str = REPORT_SLUG_PATH,
    build: str = REPORT_SLUG_PATH,
    report_type: str = REPORT_TYPE_PATH,
    token: str = SHARED_REPORT_TOKEN_PATH,
    db: AsyncSession = Depends(get_db),
):
    return await public_shared_report_thumbnail(request=request, token=token, db=db)

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

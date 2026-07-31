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

from __future__ import annotations

import hashlib
import hmac
import json
import shutil
import tarfile
import tempfile
import re
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy.ext.asyncio import AsyncSession

from ... import auth, models, schemas
from ...database import get_db
from ...services.edition.entitlement_provider import get_entitlement_provider
from ...services.edition.update_manager import (
    UpdateManifestError,
    prepare_update_download_grant_request,
    request_premium_download_grant,
    validate_update_manifest,
)
from ...services.premium_runtime.verification_client import PremiumVerificationError
from ...services.updater import version_gt
from ...version import PRODUCT_VERSION
from ...services.update_artifact_transfer import MAX_PACKAGE_BYTES
from ...services.update_legacy_host_migration import PROTOCOL as LEGACY_MIGRATION_PROTOCOL


router = APIRouter(tags=["system"])


def _migration_bundle_name(version: str) -> str:
    return f"treseko-update-v{version}-single-file.tar"


async def _download_verified_package(download_url: str, destination: Path, *,
                                    expected_size: int, expected_sha256: str) -> None:
    digest = hashlib.sha256()
    downloaded = 0
    try:
        async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
            async with client.stream("GET", download_url) as upstream:
                upstream.raise_for_status()
                with destination.open("xb") as target:
                    async for chunk in upstream.aiter_bytes(1024 * 1024):
                        downloaded += len(chunk)
                        if downloaded > expected_size:
                            raise ValueError("package_size_mismatch")
                        digest.update(chunk)
                        target.write(chunk)
    except (httpx.HTTPError, OSError) as exc:
        raise ValueError("package_download_failed") from exc
    if downloaded != expected_size:
        raise ValueError("package_size_mismatch")
    if not hmac.compare_digest(digest.hexdigest(), expected_sha256.lower()):
        raise ValueError("package_checksum_mismatch")


def _write_single_file_bundle(package: Path, manifest: dict, destination: Path) -> None:
    artifact = str(manifest.get("artifact") or "").strip()
    if not artifact or Path(artifact).name != artifact or artifact in {".", ".."}:
        raise ValueError("package_artifact_invalid")
    manifest_path = destination.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")),
                             encoding="utf-8")
    try:
        with tarfile.open(destination, "w:") as bundle:
            bundle.add(manifest_path, arcname="manifest.json", recursive=False)
            bundle.add(package, arcname=artifact, recursive=False)
    finally:
        manifest_path.unlink(missing_ok=True)


@router.post(
    "/system/updates/download-grant-request",
    response_model=schemas.SystemUpdateDownloadGrantPrepareResponse,
)
async def prepare_system_update_download_grant_request(
    payload: schemas.SystemUpdateDownloadGrantPrepareRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    state = await get_entitlement_provider().get_state(db)
    try:
        return prepare_update_download_grant_request(payload.manifest.model_dump(exclude_unset=True), state)
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post(
    "/system/updates/download-package",
    response_model=schemas.SystemUpdatePackageDownloadResponse,
)
async def create_system_update_package_download(
    payload: schemas.SystemUpdateDownloadGrantPrepareRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    """Resolve a short-lived Premium package URL without exposing license data."""
    state = await get_entitlement_provider().get_state(db)
    manifest = payload.manifest.model_dump(exclude_unset=True)
    try:
        validation = validate_update_manifest(manifest, state)
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if validation.get("edition") != "premium":
        raise HTTPException(status_code=400, detail="La descarga directa requiere un manifest Premium.")
    version = str(validation.get("version") or "").strip()
    if not version or not version_gt(version, PRODUCT_VERSION):
        raise HTTPException(status_code=400, detail="No hay una actualización Premium posterior para descargar.")
    try:
        grant = await request_premium_download_grant(
            manifest,
            state,
            current_version=PRODUCT_VERSION,
        )
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except PremiumVerificationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    resolved_manifest = grant.get("manifest") if isinstance(grant.get("manifest"), dict) else {}
    download_url = str(grant.get("package_url") or "").strip()
    if not download_url:
        raise HTTPException(status_code=502, detail="El servidor Premium no devolvió una URL temporal de descarga.")
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return {
        "download_url": download_url,
        "expires_at": grant.get("expires_at"),
        "version": version,
        "artifact": resolved_manifest.get("artifact") or validation.get("artifact"),
        "package_size_bytes": validation.get("package_size_bytes"),
        "checksum_sha256": validation["checksum_sha256"],
    }


@router.post("/system/updates/download-migration-bundle")
async def download_system_update_migration_bundle(
    payload: schemas.SystemUpdateDownloadGrantPrepareRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("configuracion.actualizaciones", "read")),
):
    """Stream one signed OTA plus its detached manifest for a host bootstrap."""
    state = await get_entitlement_provider().get_state(db)
    manifest = payload.manifest.model_dump(exclude_unset=True)
    try:
        validation = validate_update_manifest(manifest, state)
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if validation.get("edition") != "premium":
        raise HTTPException(status_code=400, detail="La migración host-side requiere un manifest Premium.")
    deployment = manifest.get("deployment") if isinstance(manifest.get("deployment"), dict) else {}
    if (deployment.get("mode") != "complete-source"
            or manifest.get("host_bridge_bootstrap_verified") is not True
            or manifest.get("bootstrap_protocol") != LEGACY_MIGRATION_PROTOCOL):
        raise HTTPException(status_code=409, detail="El paquete no declara un bootstrap host-side verificado.")
    version = str(validation.get("version") or "").strip()
    if not version or not version_gt(version, PRODUCT_VERSION):
        raise HTTPException(status_code=400, detail="No hay una actualización Premium posterior para descargar.")
    try:
        grant = await request_premium_download_grant(manifest, state, current_version=PRODUCT_VERSION)
    except UpdateManifestError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except PremiumVerificationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    download_url = str(grant.get("package_url") or "").strip()
    expected_size = validation.get("package_size_bytes")
    expected_checksum = str(validation.get("checksum_sha256") or "").strip().lower()
    if (not download_url or type(expected_size) is not int
            or not 0 < expected_size <= MAX_PACKAGE_BYTES
            or not re.fullmatch(r"[0-9a-f]{64}", expected_checksum)):
        raise HTTPException(status_code=502, detail="El servidor Premium devolvió un grant incompleto.")

    required_free_bytes = expected_size * 2 + 32 * 1024 * 1024
    if shutil.disk_usage(tempfile.gettempdir()).free < required_free_bytes:
        raise HTTPException(status_code=507, detail="No hay espacio suficiente para preparar el bundle de migración.")

    temporary_root = Path(tempfile.mkdtemp(prefix="treseko-migration-download-"))
    artifact = str(validation.get("artifact") or manifest.get("artifact") or "").strip()
    if not artifact or Path(artifact).name != artifact or artifact in {".", ".."}:
        shutil.rmtree(temporary_root, ignore_errors=True)
        raise HTTPException(status_code=502, detail="El manifest Premium tiene un nombre de artefacto inválido.")
    package_path = temporary_root / artifact
    bundle_path = temporary_root / _migration_bundle_name(version)
    try:
        await _download_verified_package(download_url, package_path,
                                         expected_size=expected_size,
                                         expected_sha256=expected_checksum)
        _write_single_file_bundle(package_path, manifest, bundle_path)
    except ValueError as exc:
        shutil.rmtree(temporary_root, ignore_errors=True)
        detail = str(exc)
        status_code = 502 if detail == "package_download_failed" else 422
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except OSError as exc:
        shutil.rmtree(temporary_root, ignore_errors=True)
        raise HTTPException(status_code=507, detail="No hay espacio para preparar el bundle de migración.") from exc
    except Exception:
        shutil.rmtree(temporary_root, ignore_errors=True)
        raise

    return FileResponse(
        bundle_path,
        media_type="application/x-tar",
        filename=bundle_path.name,
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
            "X-Treseko-OTA-Version": version,
            "X-Treseko-OTA-SHA256": expected_checksum,
        },
        background=BackgroundTask(shutil.rmtree, temporary_root, ignore_errors=True),
    )

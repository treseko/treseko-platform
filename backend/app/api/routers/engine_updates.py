"""Private Engine-host pull API; authenticated with the existing Engine token."""
from __future__ import annotations

import os
from pathlib import Path
import secrets

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ...services.engine_updates import (
    create_engine_update_archive, engine_source_build_id, engine_source_directory,
    engine_update_status,
)
from ...version import PRODUCT_VERSION

router = APIRouter(tags=["Engine updates"])


def _expected_token() -> str:
    token = os.getenv("AI_ENGINE_INTERNAL_TOKEN", "").strip()
    token_file = os.getenv("AI_ENGINE_INTERNAL_TOKEN_FILE", "").strip()
    if not token and token_file:
        try:
            token = Path(token_file).read_text(encoding="utf-8").strip()
        except OSError:
            return ""
    return token


def _authorize(supplied: str | None) -> None:
    expected = _expected_token()
    if not expected or not supplied or not secrets.compare_digest(expected, supplied.strip()):
        raise HTTPException(status_code=401, detail="Token interno inválido")


@router.get("/engine-updates/me/status")
async def get_engine_update_status(
    version: str = "", build_id: str = "",
    x_engine_internal_token: str | None = Header(None),
):
    _authorize(x_engine_internal_token)
    try:
        source = engine_source_directory()
        digest = engine_source_build_id(source)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"code": str(exc)}) from exc
    return engine_update_status(version, build_id, desired_version=PRODUCT_VERSION,
                                desired_build_id=digest)


@router.get("/engine-updates/me/package")
async def download_engine_update(
    version: str = "", build_id: str = "",
    x_engine_internal_token: str | None = Header(None),
):
    _authorize(x_engine_internal_token)
    try:
        source = engine_source_directory()
        desired_build_id = engine_source_build_id(source)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"code": str(exc)}) from exc
    status = engine_update_status(version, build_id, desired_build_id=desired_build_id)
    if status["status"] != "update_required":
        raise HTTPException(status_code=409, detail={"error_code": "ENGINE_UPDATE_NOT_AVAILABLE"})
    archive: Path | None = None
    try:
        archive, checksum = create_engine_update_archive(source)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"code": str(exc)}) from exc
    return FileResponse(
        archive, media_type="application/gzip",
        filename=f"treseko-engine-{PRODUCT_VERSION}.tar.gz",
        headers={"X-Engine-Update-Version": PRODUCT_VERSION,
                 "X-Engine-Update-SHA256": checksum,
                 "X-Engine-Update-Build-ID": desired_build_id,
                 "Cache-Control": "no-store"},
        background=BackgroundTask(archive.unlink, missing_ok=True),
    )

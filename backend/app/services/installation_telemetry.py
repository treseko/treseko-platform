from __future__ import annotations

import asyncio
import os
import platform
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.services.premium_runtime.verification_client import get_or_create_instance_id


INSTALLATION_PING_SETTING_KEY = "treseko_installation_ping"
INSTALLATION_PING_ENDPOINT = os.getenv("TRESEKO_INSTALLATION_PING_ENDPOINT", "https://verify.treseko.com/api/phone-home")
INSTALLATION_PING_DISABLED = str(os.getenv("TRESEKO_DISABLE_INSTALLATION_PING") or "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


def _read_version() -> str:
    candidates = [
        Path(os.getenv("TRESEKO_VERSION_FILE") or ""),
        Path("/app/VERSION"),
        Path(__file__).resolve().parents[3] / "VERSION",
        Path(__file__).resolve().parents[3] / "frontend" / "package.json",
    ]
    for path in candidates:
        if not str(path):
            continue
        try:
            if path.name == "package.json":
                import json

                return str(json.loads(path.read_text(encoding="utf-8")).get("version") or "unknown")
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return value
        except Exception:
            continue
    return os.getenv("TRESEKO_VERSION") or "unknown"


async def _setting_value(db: AsyncSession) -> dict[str, Any] | None:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == INSTALLATION_PING_SETTING_KEY))
    setting = result.scalar_one_or_none()
    return setting.value if setting else None


async def _save_setting(db: AsyncSession, value: dict[str, Any]) -> None:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == INSTALLATION_PING_SETTING_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        db.add(models.AppSetting(key=INSTALLATION_PING_SETTING_KEY, value=value))
    await db.commit()


async def send_installation_ping_once(db: AsyncSession, *, timeout_seconds: float = 2.0) -> None:
    if INSTALLATION_PING_DISABLED:
        return
    existing = await _setting_value(db)
    if isinstance(existing, dict) and existing.get("status") == "sent":
        return
    payload = {
        "event": "treseko_installation_started",
        "instance_id": get_or_create_instance_id(),
        "version": _read_version(),
        "app_version": _read_version(),
        "edition": "community",
        "os": f"{platform.system()} {platform.release()}".strip(),
        "runtime": "backend",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(INSTALLATION_PING_ENDPOINT, json=payload)
            response.raise_for_status()
        await _save_setting(db, {"status": "sent", "endpoint": INSTALLATION_PING_ENDPOINT, "payload": payload})
    except Exception as exc:
        await _save_setting(db, {"status": "pending_retry", "endpoint": INSTALLATION_PING_ENDPOINT, "last_error": str(exc)[:500]})


def schedule_installation_ping(db: AsyncSession) -> None:
    async def _run() -> None:
        await send_installation_ping_once(db)

    asyncio.create_task(_run())

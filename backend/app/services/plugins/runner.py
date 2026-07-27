"""Broker client for the isolated plugin runner; never loads plugin code locally."""
from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx


RUNNER_URL = (os.getenv("TRESEKO_PLUGIN_RUNNER_URL") or "http://plugin-runner:3020").rstrip("/")
_semaphore = asyncio.Semaphore(2)
_open_until: datetime | None = None
_failures = 0


class PluginRunnerError(ValueError):
    pass


async def invoke_declarative_junit() -> dict:
    global _open_until, _failures
    now = datetime.now(UTC)
    if _open_until and now < _open_until:
        raise PluginRunnerError("El runner de plugins está temporalmente bloqueado tras errores recientes")
    payload = {"invocation_id": str(uuid4()), "kind": "declarative", "entrypoint": "junit_xml.import_results"}
    try:
        async with _semaphore:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=1.0)) as client:
                response = await client.post(f"{RUNNER_URL}/invoke", json=payload)
        if response.status_code != 200:
            raise PluginRunnerError("El runner rechazó la invocación del plugin")
        result = response.json()
        if result.get("invocation_id") != payload["invocation_id"] or result.get("status") != "accepted":
            raise PluginRunnerError("El runner devolvió una respuesta inválida")
        _failures = 0
        _open_until = None
        return result
    except (httpx.HTTPError, ValueError) as exc:
        _failures += 1
        if _failures >= 3:
            _open_until = now + timedelta(seconds=30)
        raise PluginRunnerError("No se pudo invocar el runner aislado") from exc

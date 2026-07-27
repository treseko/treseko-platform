"""Read-only client for the official store; no browser credentials are forwarded."""
from __future__ import annotations

import os
from typing import Any

import httpx


PLUGIN_STORE_URL = (os.getenv("TRESEKO_PLUGIN_STORE_URL") or "https://app.treseko.com/api/plugins").rstrip("/")


class PluginStoreClientError(ValueError):
    pass


async def fetch_official_catalog() -> list[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0), follow_redirects=False) as client:
            response = await client.get(f"{PLUGIN_STORE_URL}/catalog", headers={"accept": "application/json"})
        if response.status_code != 200:
            raise PluginStoreClientError("La tienda oficial no respondió con un catálogo disponible")
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        if isinstance(exc, PluginStoreClientError):
            raise
        raise PluginStoreClientError("No se pudo consultar la tienda oficial de Treseko") from exc
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise PluginStoreClientError("La tienda oficial devolvió un catálogo inválido")
    return items

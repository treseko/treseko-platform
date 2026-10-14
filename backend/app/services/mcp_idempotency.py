"""Durable idempotency primitives for governed MCP mutations."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .. import models


async def reserve(db, project_id, key: str, fingerprint: str):
    """Atomically reserve ``project_id``/``key`` and replay completed results."""
    reservation = models.McpImportIdempotency(
        proyecto_id=project_id,
        idempotency_key=key,
        fingerprint=fingerprint,
        status="PENDING",
    )
    try:
        async with db.begin_nested():
            db.add(reservation)
            await db.flush()
        return reservation, None
    except IntegrityError:
        existing = await db.scalar(
            select(models.McpImportIdempotency).where(
                models.McpImportIdempotency.proyecto_id == project_id,
                models.McpImportIdempotency.idempotency_key == key,
            )
        )
        if existing is None or existing.fingerprint != fingerprint:
            raise ValueError("idempotency_key reutilizada con otra operación")
        if existing.status == "COMPLETED" and isinstance(existing.result_json, dict):
            return existing, dict(existing.result_json)
        # PENDING and FAILED are intentionally not silently retried. A caller
        # must inspect the previous outcome before retrying with the same key rather than risk executing an unknown mutation.
        raise ValueError("idempotency_key está siendo procesada")


async def complete(db, reservation, result: dict[str, Any]) -> None:
    reservation.status = "COMPLETED"
    reservation.result_json = dict(result)
    await db.commit()


def fingerprint(tool_name: str, project_id, arguments: dict[str, Any], actor_id=None) -> str:
    payload = {
        "tool": tool_name,
        "project_id": str(project_id),
        "arguments": arguments,
        "actor_id": str(actor_id) if actor_id is not None else None,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


async def reserve_workspace(db, namespace: str, key: str, fingerprint: str):
    reservation = models.McpWorkspaceReceipt(namespace=namespace, idempotency_key=key, fingerprint=fingerprint, status="PENDING")
    try:
        async with db.begin_nested():
            db.add(reservation)
            await db.flush()
        return reservation, None
    except IntegrityError:
        existing = await db.get(models.McpWorkspaceReceipt, (namespace, key))
        if existing is None or existing.fingerprint != fingerprint:
            raise ValueError("idempotency_key reutilizada con otra operación")
        if existing.status == "COMPLETED" and isinstance(existing.result_json, dict):
            return existing, dict(existing.result_json)
        raise ValueError("idempotency_key está siendo procesada")

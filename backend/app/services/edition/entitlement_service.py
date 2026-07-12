from __future__ import annotations

from typing import Any, Callable

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from .entitlement_provider import get_entitlement_provider


PREMIUM_REQUIRED_MESSAGE = "Esta funcion esta disponible en Treseko Premium."


async def is_feature_enabled(db: AsyncSession, feature_id: str) -> bool:
    return await get_entitlement_provider().is_feature_enabled(db, feature_id)


async def ensure_feature_enabled(db: AsyncSession, feature_id: str) -> None:
    if not await is_feature_enabled(db, feature_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=PREMIUM_REQUIRED_MESSAGE,
        )


def require_feature(feature_id: str) -> Callable:
    async def dependency(db: AsyncSession = Depends(get_db)) -> None:
        await ensure_feature_enabled(db, feature_id)

    return dependency


async def check_limit(
    db: AsyncSession,
    limit_id: str,
    current_value: int,
    *,
    increment: int = 1,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    return await get_entitlement_provider().check_limit(
        db,
        limit_id,
        current_value,
        increment=increment,
        tenant_id=tenant_id,
    )


async def enforce_limit(
    db: AsyncSession,
    limit_id: str,
    current_value: int,
    *,
    increment: int = 1,
    tenant_id: str | None = None,
) -> None:
    result = await check_limit(db, limit_id, current_value, increment=increment, tenant_id=tenant_id)
    if not result["allowed"]:
        if result.get("reason"):
            detail = str(result["reason"])
        elif result.get("limit") is None:
            detail = f"Limite de Treseko no disponible para {limit_id}"
        else:
            label = str(result.get("label") or limit_id)
            detail = (
                f"Limite de Treseko {result['edition']} alcanzado para {label} "
                f"({limit_id}): actual {result['current']}, solicitado {result['requested']}, "
                f"limite {result['limit']}."
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from .entitlement_service import enforce_limit


# PostgreSQL advisory locks are transaction-scoped and serialize concurrent
# account creation checks without introducing a mutable counter table.
USER_CAPACITY_LOCK_KEY = 8_472_031


async def count_active_registered_users(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(models.Usuario)
        .where(models.Usuario.activo.is_(True))
    )
    return int(result.scalar() or 0)


async def enforce_active_user_limit(db: AsyncSession) -> int:
    """Reserve one active registered-user seat before inserting a new user."""
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        await db.execute(select(func.pg_advisory_xact_lock(USER_CAPACITY_LOCK_KEY)))
    current_users = await count_active_registered_users(db)
    await enforce_limit(db, "max_users", current_users)
    return current_users

"""Internal data helpers shared by the system router subdomains."""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...services import config_service
from ...services.edition.entitlement_provider import get_entitlement_provider
from ...time_utils import utc_now


def request_client_ip(request: Any) -> str | None:
    forwarded_for = (request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    return forwarded_for or (request.client.host if request.client else None)


async def database_schema_revision(db: AsyncSession) -> str | None:
    try:
        result = await db.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
        revision = result.scalar_one_or_none()
        return str(revision) if revision else None
    except Exception:
        return None


async def branding_state(db: AsyncSession) -> dict[str, Any]:
    entitlement_state = await get_entitlement_provider().get_state(db)
    enabled_features = set(entitlement_state.get("enabled_features") or [])
    can_customize = entitlement_state.get("edition") == "premium" and "branding.custom" in enabled_features
    value = await config_service.get_workspace_branding(db)
    return config_service.branding_response(
        value,
        edition=str(entitlement_state.get("edition") or "community"),
        can_customize=can_customize,
    )


async def installation_data_counts(db: AsyncSession) -> dict[str, int]:
    counts: dict[str, int] = {}
    for key, model in (("organizations", models.Organizacion), ("projects", models.Proyecto), ("cases", models.CasoPrueba)):
        result = await db.execute(select(func.count()).select_from(model))
        counts[key] = int(result.scalar() or 0)
    return counts


async def first_run_state(db: AsyncSession, current_user: models.Usuario | None = None) -> dict[str, Any]:
    setting = await config_service.get_first_run_onboarding(db)
    counts = await installation_data_counts(db)
    installation_has_data = any(counts.values())
    completed = bool(setting.get("completed"))
    if not completed and installation_has_data:
        setting = await config_service.update_first_run_onboarding(db, {
            **setting,
            "completed": True,
            "completed_at": utc_now().isoformat(),
            "completed_by_user_id": str(current_user.id) if current_user else None,
            "completion_source": "existing_installation_data",
            "terms_accepted": bool(setting.get("terms_accepted")),
        })
        completed = True
    return {
        "completed": completed,
        "requires_onboarding": not completed and not installation_has_data,
        "installation_has_data": installation_has_data,
        "completion_source": setting.get("completion_source"),
        "completed_at": setting.get("completed_at"),
        "completed_by_user_id": setting.get("completed_by_user_id"),
        "terms_version": setting.get("terms_version"),
    }

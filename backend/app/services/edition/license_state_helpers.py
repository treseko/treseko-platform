from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .catalog import community_feature_ids

def _plan_state(license_data: dict[str, Any] | None, *, edition: str) -> dict[str, Any]:
    if not license_data:
        return {
            "plan_id": "community",
            "plan_name": "Community",
            "plan_version": None,
            "plan_custom": False,
        }
    return {
        "plan_id": license_data.get("plan_id") or ("premium" if edition == "premium" else "community"),
        "plan_name": license_data.get("plan_name") or ("Premium" if edition == "premium" else "Community"),
        "plan_version": license_data.get("plan_version"),
        "plan_custom": bool(license_data.get("plan_custom")),
    }


def _license_dates_state(license_data: dict[str, Any] | None) -> dict[str, Any]:
    if not license_data:
        return {
            "issued_at": None,
            "valid_until": None,
            "activated_at": None,
            "last_check_at": None,
            "next_check_at": None,
            "grace_until": None,
            "verification_interval_days": None,
            "grace_period_days": None,
        }
    return {
        "issued_at": license_data.get("issued_at"),
        "valid_until": license_data.get("expires_at") or license_data.get("valid_until"),
        "activated_at": license_data.get("activated_at"),
        "last_check_at": None,
        "next_check_at": None,
        "grace_until": None,
        "verification_interval_days": license_data.get("verification_interval_days"),
        "grace_period_days": license_data.get("grace_period_days"),
    }

async def get_installed_license(db: AsyncSession) -> dict[str, Any] | None:
    from .license_storage import get_installed_license as read_installed_license

    return await read_installed_license(db)


async def get_online_license_state(db: AsyncSession) -> dict[str, Any] | None:
    from .license_storage import get_online_license_state as read_online_license_state

    return await read_online_license_state(db)


async def save_online_license_state(db: AsyncSession, state: dict[str, Any]) -> dict[str, Any]:
    from .license_storage import save_online_license_state as persist_online_license_state

    return await persist_online_license_state(db, state)


async def get_license_state(db: AsyncSession) -> dict[str, Any]:
    # Import lazily to avoid the license_manager -> license_state_helpers cycle.
    from .license_manager import evaluate_license

    local_state = evaluate_license(await get_installed_license(db))
    online_state = await get_online_license_state(db)
    if isinstance(online_state, dict) and online_state.get("license"):
        online_license_id = (online_state.get("license") or {}).get("license_id")
        local_license_id = (local_state.get("license") or {}).get("license_id")
        if online_license_id and online_license_id == local_license_id:
            # An online verification snapshot can outlive a product update.
            # Community capabilities are always additive, so keep Premium
            # licenses compatible with newly shipped Community features without
            # granting any Premium capability or changing signed limits.
            return {
                **online_state,
                "online_status": "verified",
                "enabled_features": sorted(
                    set(online_state.get("enabled_features") or []) | community_feature_ids()
                ),
            }
    if local_state.get("edition") == "premium" and (local_state.get("license") or {}).get("verification_server"):
        return {**local_state, "online_status": "pending", "online_reason": "La licencia está validada localmente; falta confirmar la activación con el servidor Premium."}
    return local_state


async def install_license(db: AsyncSession, license_data: dict[str, Any]) -> dict[str, Any]:
    """Install a Premium document; Community no requiere archivo de licencia."""
    from .license_storage import install_license as persist_license

    return await persist_license(db, license_data)

from __future__ import annotations

import os
import json
from abc import ABC, abstractmethod
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from sqlalchemy.ext.asyncio import AsyncSession

from .catalog import COMMUNITY_LIMITS, LIMIT_CATALOG, all_feature_ids, all_limit_ids, canonical_feature_id, community_feature_ids, normalize_feature_ids
from ..updater import configured_community_update_channel
from .license_manager import PREMIUM_UPDATE_CHANNELS, get_license_state


ENTITLEMENT_MODE_ENV = "TRESEKO_ENTITLEMENT_PROVIDER"
SAAS_ENTITLEMENT_URL_ENV = "TRESEKO_SAAS_ENTITLEMENT_URL"
SAAS_ENTITLEMENT_TOKEN_ENV = "TRESEKO_SAAS_ENTITLEMENT_TOKEN"
SAAS_ENTITLEMENT_TIMEOUT_ENV = "TRESEKO_SAAS_ENTITLEMENT_TIMEOUT_SECONDS"


class EntitlementProvider(ABC):
    @abstractmethod
    async def get_state(self, db: AsyncSession, *, tenant_id: str | None = None) -> dict[str, Any]:
        raise NotImplementedError

    async def is_feature_enabled(self, db: AsyncSession, feature_id: str, *, tenant_id: str | None = None) -> bool:
        state = await self.get_state(db, tenant_id=tenant_id)
        return canonical_feature_id(feature_id) in set(state.get("enabled_features") or [])

    async def check_limit(
        self,
        db: AsyncSession,
        limit_id: str,
        current_value: int,
        *,
        increment: int = 1,
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        limit_meta = LIMIT_CATALOG.get(limit_id) or {}
        limit_label = str(limit_meta.get("label") or limit_id)
        if limit_id not in all_limit_ids():
            return {
                "allowed": False,
                "limit_id": limit_id,
                "label": limit_label,
                "limit": None,
                "current": current_value,
                "requested": current_value + increment,
                "edition": "unknown",
                "source": self.source,
                "reason": f"Limite comercial desconocido: {limit_id}",
            }
        state = await self.get_state(db, tenant_id=tenant_id)
        limits = state.get("limits") or {}
        max_value = limits.get(limit_id)
        allowed = max_value is None or current_value + increment <= int(max_value)
        return {
            "allowed": allowed,
            "limit_id": limit_id,
            "label": limit_label,
            "limit": max_value,
            "current": current_value,
            "requested": current_value + increment,
            "edition": state.get("edition"),
            "source": state.get("source") or self.source,
        }

    @property
    @abstractmethod
    def source(self) -> str:
        raise NotImplementedError


class LicenseEntitlementProvider(EntitlementProvider):
    @property
    def source(self) -> str:
        return "self_hosted_license"

    async def get_state(self, db: AsyncSession, *, tenant_id: str | None = None) -> dict[str, Any]:
        state = await get_license_state(db)
        return {**state, "source": self.source}


class TenantSubscriptionEntitlementProvider(EntitlementProvider):
    @property
    def source(self) -> str:
        return "saas_subscription"

    async def get_state(self, db: AsyncSession, *, tenant_id: str | None = None) -> dict[str, Any]:
        return self._fetch_state(tenant_id=tenant_id)

    def _community_fallback(self, reason: str) -> dict[str, Any]:
        return {
            "edition": "community",
            "state": "unavailable",
            "valid": False,
            "reason": reason,
            "license": None,
            "limits": dict(COMMUNITY_LIMITS),
            "enabled_features": sorted(community_feature_ids()),
            "update_channel": configured_community_update_channel(),
            "source": self.source,
        }

    def _fetch_state(self, *, tenant_id: str | None = None) -> dict[str, Any]:
        url = str(os.getenv(SAAS_ENTITLEMENT_URL_ENV) or "").strip()
        if not url:
            return self._community_fallback("Servicio SaaS de entitlements no configurado")
        timeout_raw = str(os.getenv(SAAS_ENTITLEMENT_TIMEOUT_ENV) or "3").strip()
        try:
            timeout = max(1.0, min(float(timeout_raw), 30.0))
        except ValueError:
            timeout = 3.0
        query = urlencode({"tenant_id": tenant_id}) if tenant_id else ""
        request_url = f"{url}?{query}" if query else url
        headers = {"Accept": "application/json"}
        token = str(os.getenv(SAAS_ENTITLEMENT_TOKEN_ENV) or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(request_url, headers=headers, method="GET")
        try:
            with urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            return self._community_fallback(f"Servicio SaaS de entitlements no disponible: {exc}")
        return self._normalize_remote_state(payload, expected_tenant_id=tenant_id)

    def _normalize_limits(self, value: Any) -> dict[str, int]:
        normalized = dict(COMMUNITY_LIMITS)
        if not isinstance(value, dict):
            return normalized
        for key in COMMUNITY_LIMITS:
            if value.get(key) is None:
                continue
            try:
                candidate = int(value[key])
            except (TypeError, ValueError):
                continue
            if candidate >= 0:
                normalized[key] = candidate
        return normalized

    def _normalize_features(self, value: Any) -> list[str]:
        known_features = all_feature_ids()
        remote_features = {feature_id for feature_id in normalize_feature_ids(value) if feature_id in known_features}
        return sorted(remote_features | community_feature_ids())

    def _normalize_update_channel(self, value: Any) -> str:
        channel = str(value or "premium-stable").strip()
        return channel if channel in PREMIUM_UPDATE_CHANNELS else "premium-stable"

    def _normalize_remote_state(self, payload: dict[str, Any], *, expected_tenant_id: str | None = None) -> dict[str, Any]:
        if not isinstance(payload, dict):
            return self._community_fallback("Respuesta SaaS de entitlements invalida")
        if expected_tenant_id:
            response_tenant_id = str(payload.get("tenant_id") or payload.get("tenant") or "").strip()
            if not response_tenant_id:
                return self._community_fallback("Respuesta SaaS de entitlements no declara el tenant solicitado")
            if response_tenant_id and response_tenant_id != expected_tenant_id:
                return self._community_fallback("Respuesta SaaS de entitlements no coincide con el tenant solicitado")
        edition = str(payload.get("edition") or "community").strip().lower()
        state = str(payload.get("state") or ("active" if edition == "premium" else "community")).strip().lower()
        if edition != "premium" or state not in {"active", "trialing"}:
            return {
                "edition": "community",
                "state": state or "community",
                "valid": False,
                "reason": payload.get("reason") or "Suscripcion SaaS sin Premium activo",
                "license": None,
                "limits": self._normalize_limits(payload.get("limits")),
                "enabled_features": sorted(community_feature_ids()),
                "update_channel": configured_community_update_channel(),
                "source": self.source,
            }
        features = self._normalize_features(payload.get("enabled_features"))
        limits = self._normalize_limits(payload.get("limits"))
        return {
            "edition": "premium",
            "state": state,
            "valid": True,
            "reason": payload.get("reason"),
            "license": None,
            "limits": limits,
            "enabled_features": features,
            "update_channel": self._normalize_update_channel(payload.get("update_channel")),
            "source": self.source,
        }


def get_entitlement_provider() -> EntitlementProvider:
    mode = os.getenv(ENTITLEMENT_MODE_ENV, "license").strip().lower()
    if mode in {"license", "self-hosted", "self_hosted"}:
        return LicenseEntitlementProvider()
    if mode in {"saas", "subscription", "tenant"}:
        return TenantSubscriptionEntitlementProvider()
    return LicenseEntitlementProvider()

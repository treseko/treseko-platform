from __future__ import annotations

import base64
import hashlib
import json
import os
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...time_utils import utc_now
from .catalog import COMMUNITY_LIMITS, accepted_feature_ids, all_limit_ids, community_feature_ids, normalize_feature_ids, premium_feature_ids


LICENSE_SETTING_KEY = "treseko_license"
LICENSE_ONLINE_STATE_SETTING_KEY = "treseko_license_online_state"
VALID_EDITIONS = {"community", "premium"}
COMMUNITY_UPDATE_CHANNELS = {"community-stable", "community-beta", "community-smoke"}
PREMIUM_UPDATE_CHANNELS = {"premium-stable", "premium-beta"}
LICENSE_PUBLIC_KEY_ENV = "TRESEKO_LICENSE_PUBLIC_KEY"
LICENSE_DEV_PUBLIC_KEY_OVERRIDE_ENV = "TRESEKO_ALLOW_DEV_LICENSE_PUBLIC_KEY"
LICENSE_SIGNATURE_ALGORITHM = "ed25519"
EMBEDDED_LICENSE_PUBLIC_KEY = ""
EMBEDDED_LICENSE_PUBLIC_KEYS: tuple[str, ...] = ("4J76WRigKKrKfp1C0rPvOA1iXa6j5j6WLWQSMEHP3EE",)
SIGNED_LICENSE_PAYLOAD_FIELD = "signed_payload"
LICENSE_DOCUMENT_BASE_FIELDS = {
    "product",
    "edition",
    "license_id",
    "customer_id",
    "customer_name",
    "plan_id",
    "plan_name",
    "plan_version",
    "plan_custom",
    "instance_policy",
    "instance_id",
    "key_id",
    "issued_at",
    "expires_at",
    "revoked_at",
    "enabled_features",
    "features",
    "limits",
    "update_channel",
    "verification_server",
    "update_server",
    "fallback_verification_servers",
    "fallback_update_servers",
    "activation_token",
    "verification_interval_days",
    "grace_period_days",
    "signature",
}
LICENSE_ENVELOPE_FIELDS = {"payload", "signature"}


class LicenseError(ValueError):
    pass


def _parse_datetime(value: Any) -> datetime | None:
    if value in {None, ""}:
        return None
    if isinstance(value, datetime):
        candidate = value
    else:
        try:
            candidate = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError as exc:
            raise LicenseError(f"Fecha de licencia invalida: {value}") from exc
    if candidate.tzinfo is None:
        candidate = candidate.replace(tzinfo=timezone.utc)
    return candidate.astimezone(timezone.utc)


def _canonical_license_payload(license_data: dict[str, Any]) -> bytes:
    payload = {key: value for key, value in license_data.items() if key != "signature"}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def unpack_license_document(license_data: dict[str, Any] | None) -> tuple[dict[str, Any] | None, str | None]:
    if not license_data:
        return None, None
    if not isinstance(license_data, dict):
        raise LicenseError("La licencia debe ser un objeto JSON")
    if "payload" in license_data or set(license_data).issubset(LICENSE_ENVELOPE_FIELDS):
        if set(license_data) != LICENSE_ENVELOPE_FIELDS:
            raise LicenseError("license.treseko debe contener solo payload y signature")
        payload = license_data.get("payload")
        if not isinstance(payload, dict):
            raise LicenseError("payload debe ser un objeto")
        return deepcopy(payload), str(license_data.get("signature") or "").strip()
    payload = deepcopy(license_data)
    signature = str(payload.pop("signature", "") or "").strip()
    return payload, signature


def _b64_decode_key(value: str) -> bytes:
    compact = "".join(str(value).strip().split())
    padding = "=" * (-len(compact) % 4)
    try:
        return base64.urlsafe_b64decode((compact + padding).encode("ascii"))
    except Exception as exc:
        raise LicenseError("La clave de licencia no esta codificada correctamente") from exc


def _load_ed25519_public_key(value: str) -> Ed25519PublicKey:
    raw_value = str(value or "").strip()
    if not raw_value:
        raise LicenseError("No hay clave publica de licencias Treseko configurada")
    if "BEGIN PUBLIC KEY" in raw_value:
        try:
            key = serialization.load_pem_public_key(raw_value.encode("utf-8"))
        except ValueError as exc:
            raise LicenseError("La clave publica de licencia no es valida") from exc
        if not isinstance(key, Ed25519PublicKey):
            raise LicenseError("La clave publica de licencia debe ser Ed25519")
        return key
    raw_key = _b64_decode_key(raw_value)
    if len(raw_key) != 32:
        raise LicenseError("La clave publica Ed25519 debe tener 32 bytes")
    return Ed25519PublicKey.from_public_bytes(raw_key)


def _public_key_fingerprint(public_key: Ed25519PublicKey) -> str:
    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return f"ed25519:sha256:{hashlib.sha256(raw).hexdigest()[:24]}"


def _env_flag_enabled(name: str) -> bool:
    return str(os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _configured_license_public_keys() -> tuple[str, ...]:
    """
    Returns the trusted vendor public keyring.

    Production builds must embed Treseko's public keys. Environment overrides are
    intentionally development-only so a self-hosted install cannot trust a
    customer-generated public key and accept self-signed Premium licenses.
    """
    if _env_flag_enabled(LICENSE_DEV_PUBLIC_KEY_OVERRIDE_ENV):
        value = str(os.getenv(LICENSE_PUBLIC_KEY_ENV) or "").strip()
        return (value,) if value else ()
    embedded = tuple(key.strip() for key in EMBEDDED_LICENSE_PUBLIC_KEYS if str(key).strip())
    legacy_single = str(EMBEDDED_LICENSE_PUBLIC_KEY or "").strip()
    if legacy_single:
        embedded = (*embedded, legacy_single)
    return embedded


def _verify_signature(license_data: dict[str, Any]) -> tuple[bool, str | None]:
    signature = str(license_data.get("signature") or "").strip()
    if not signature:
        return False, "La licencia no incluye firma"
    try:
        algorithm, encoded_signature = signature.split(":", 1)
    except ValueError:
        return False, "El formato de firma de licencia no es valido"
    if algorithm != LICENSE_SIGNATURE_ALGORITHM:
        return False, "El algoritmo de firma de licencia no es soportado"
    public_key_values = _configured_license_public_keys()
    if not public_key_values:
        return False, "La clave publica de licencias Treseko no esta configurada"
    raw_signature = _b64_decode_key(encoded_signature)
    if len(raw_signature) != 64:
        return False, "La firma Ed25519 debe tener 64 bytes"
    key_errors: list[str] = []
    requested_key_id = str(license_data.get("key_id") or "").strip()
    key_id_seen = False
    try:
        payload = _canonical_license_payload(license_data)
        for public_key_value in public_key_values:
            try:
                public_key = _load_ed25519_public_key(public_key_value)
                if requested_key_id:
                    if _public_key_fingerprint(public_key) != requested_key_id:
                        continue
                    key_id_seen = True
                public_key.verify(raw_signature, payload)
                return True, None
            except LicenseError as exc:
                key_errors.append(str(exc))
            except InvalidSignature:
                continue
    except LicenseError as exc:
        return False, str(exc)
    if key_errors and len(key_errors) == len(public_key_values):
        return False, "; ".join(key_errors)
    if requested_key_id and not key_id_seen:
        return False, "El key_id de licencia no existe en el keyring publico de Treseko"
    return False, "La firma de licencia no es valida"


def license_keyring_status() -> dict[str, Any]:
    public_key_values = _configured_license_public_keys()
    dev_override_enabled = _env_flag_enabled(LICENSE_DEV_PUBLIC_KEY_OVERRIDE_ENV)
    source = "development_override" if dev_override_enabled else "embedded"
    fingerprints: list[str] = []
    errors: list[str] = []
    seen: set[str] = set()
    for index, public_key_value in enumerate(public_key_values, start=1):
        try:
            fingerprint = _public_key_fingerprint(_load_ed25519_public_key(public_key_value))
        except LicenseError as exc:
            errors.append(f"license_key[{index}]: {exc}")
            continue
        if fingerprint in seen:
            errors.append(f"license_key[{index}]: key_id duplicado {fingerprint}")
            continue
        seen.add(fingerprint)
        fingerprints.append(fingerprint)
    return {
        "kind": "license",
        "algorithm": LICENSE_SIGNATURE_ALGORITHM,
        "configured": bool(public_key_values) and not errors,
        "source": source,
        "development_override_enabled": dev_override_enabled,
        "key_count": len(public_key_values),
        "fingerprints": fingerprints,
        "errors": errors,
    }


def normalize_license_payload(value: dict[str, Any]) -> dict[str, Any]:
    payload, signature = unpack_license_document(value)
    if payload is None:
        raise LicenseError("La licencia debe ser un objeto JSON")
    stored_signed_payload = payload.get(SIGNED_LICENSE_PAYLOAD_FIELD)
    if isinstance(stored_signed_payload, dict):
        payload, stored_signature = unpack_license_document(stored_signed_payload)
        if payload is None:
            raise LicenseError("signed_payload debe contener un objeto de licencia")
        signature = stored_signature or signature
    value = payload
    if not isinstance(value, dict):
        raise LicenseError("La licencia debe ser un objeto JSON")
    signed_payload = deepcopy(value)
    if signature:
        signed_payload["signature"] = signature
    edition = str(value.get("edition") or "").strip().lower()
    if edition not in VALID_EDITIONS:
        raise LicenseError("La licencia debe indicar edition community o premium")
    allowed_fields = LICENSE_DOCUMENT_BASE_FIELDS | all_limit_ids()
    unknown_fields = sorted(str(key) for key in value if str(key) not in allowed_fields)
    if unknown_fields:
        raise LicenseError(f"La licencia contiene campos desconocidos: {', '.join(unknown_fields)}")
    normalized = deepcopy(value)
    if signature:
        normalized["signature"] = signature
    normalized["product"] = str(value.get("product") or "treseko").strip().lower()
    if normalized["product"] != "treseko":
        raise LicenseError("product debe ser treseko")
    normalized["edition"] = edition
    normalized["plan_id"] = str(value.get("plan_id") or ("premium" if edition == "premium" else "community")).strip()
    normalized["plan_name"] = str(value.get("plan_name") or ("Premium" if edition == "premium" else "Community")).strip()
    normalized["plan_version"] = str(value.get("plan_version") or "").strip() or None
    normalized["plan_custom"] = bool(value.get("plan_custom") or normalized["plan_id"] == "custom")
    raw_features = value.get("enabled_features")
    if raw_features is None:
        raw_features = value.get("features")
    normalized["enabled_features"] = normalize_feature_ids(raw_features or [])
    normalized.pop("features", None)
    unknown_features = sorted(set(normalized["enabled_features"]) - accepted_feature_ids())
    if unknown_features:
        raise LicenseError(f"enabled_features contiene features desconocidas: {', '.join(unknown_features)}")
    if edition == "community":
        premium_features = sorted(set(normalized["enabled_features"]) & premium_feature_ids())
        if premium_features:
            raise LicenseError(f"Una licencia Community no puede habilitar features Premium: {', '.join(premium_features)}")
    normalized["update_channel"] = str(value.get("update_channel") or ("premium-stable" if edition == "premium" else "community-stable")).strip()
    allowed_channels = PREMIUM_UPDATE_CHANNELS if edition == "premium" else COMMUNITY_UPDATE_CHANNELS
    if normalized["update_channel"] not in allowed_channels:
        raise LicenseError(f"update_channel no es valido para edition {edition}")
    if "limits" in value:
        if not isinstance(value.get("limits"), dict):
            raise LicenseError("limits debe ser un objeto")
        for limit_key, limit_value in (value.get("limits") or {}).items():
            normalized[str(limit_key)] = limit_value
        normalized.pop("limits", None)
    unknown_limit_fields = sorted(key for key in normalized if str(key).startswith("max_") and key not in all_limit_ids())
    if unknown_limit_fields:
        raise LicenseError(f"La licencia contiene limites desconocidos: {', '.join(unknown_limit_fields)}")
    for field in COMMUNITY_LIMITS:
        if normalized.get(field) is not None:
            try:
                normalized[field] = int(normalized[field])
            except (TypeError, ValueError) as exc:
                raise LicenseError(f"{field} debe ser numerico") from exc
            if normalized[field] < 0:
                raise LicenseError(f"{field} no puede ser negativo")
    for field in ("license_id", "customer_id"):
        if not str(normalized.get(field) or "").strip():
            raise LicenseError(f"{field} es obligatorio")
        normalized[field] = str(normalized[field]).strip()
    for field in ("customer_name", "instance_policy"):
        if normalized.get(field) is not None:
            normalized[field] = str(normalized.get(field) or "").strip() or None
    for field in ("instance_id", "verification_server", "update_server", "activation_token"):
        if normalized.get(field) is not None:
            normalized[field] = str(normalized.get(field) or "").strip() or None
    for field in ("fallback_verification_servers", "fallback_update_servers"):
        raw_values = normalized.get(field) or []
        if not isinstance(raw_values, (list, tuple)):
            raise LicenseError(f"{field} debe ser una lista")
        normalized[field] = [str(item).strip() for item in raw_values if str(item).strip()]
    for field in ("verification_interval_days", "grace_period_days"):
        if normalized.get(field) is not None:
            try:
                normalized[field] = int(normalized[field])
            except (TypeError, ValueError) as exc:
                raise LicenseError(f"{field} debe ser numerico") from exc
            if normalized[field] < 1:
                raise LicenseError(f"{field} debe ser mayor a cero")
    if normalized.get("key_id") is not None:
        normalized["key_id"] = str(normalized.get("key_id") or "").strip() or None
    for field in ("issued_at", "expires_at", "revoked_at"):
        parsed = _parse_datetime(normalized.get(field))
        normalized[field] = parsed.isoformat() if parsed else None
    if edition == "premium":
        if not str(normalized.get("key_id") or "").strip():
            raise LicenseError("key_id es obligatorio para licencias Premium")
        for field in ("license_id", "customer_id", "activation_token", "verification_server", "update_server"):
            if not str(normalized.get(field) or "").strip():
                raise LicenseError(f"{field} es obligatorio para licencias Premium")
        issued_at = _parse_datetime(normalized.get("issued_at"))
        expires_at = _parse_datetime(normalized.get("expires_at"))
        if issued_at is None:
            raise LicenseError("issued_at es obligatorio para licencias Premium")
        if expires_at is None:
            raise LicenseError("expires_at es obligatorio para licencias Premium")
        if issued_at > utc_now() + timedelta(minutes=5):
            raise LicenseError("issued_at no puede estar en el futuro")
        if expires_at <= issued_at:
            raise LicenseError("expires_at debe ser posterior a issued_at")
    normalized[SIGNED_LICENSE_PAYLOAD_FIELD] = signed_payload
    return normalized


def _signed_license_payload(value: dict[str, Any]) -> dict[str, Any]:
    payload, signature = unpack_license_document(value)
    if payload is None:
        raise LicenseError("La licencia debe ser un objeto JSON")
    stored_signed_payload = payload.get(SIGNED_LICENSE_PAYLOAD_FIELD)
    if isinstance(stored_signed_payload, dict):
        payload, stored_signature = unpack_license_document(stored_signed_payload)
        if payload is None:
            raise LicenseError("signed_payload debe contener un objeto de licencia")
        signature = stored_signature or signature
    signed_payload = deepcopy(payload)
    if signature:
        signed_payload["signature"] = signature
    return signed_payload


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


def evaluate_license(license_data: dict[str, Any] | None) -> dict[str, Any]:
    if not license_data:
        return {
            "edition": "community",
            "state": "community",
            "valid": False,
            "reason": "Sin licencia Premium instalada",
            "license": None,
            "limits": deepcopy(COMMUNITY_LIMITS),
            "enabled_features": sorted(community_feature_ids()),
            "update_channel": "community-stable",
            **_plan_state(None, edition="community"),
            **_license_dates_state(None),
        }
    try:
        normalized = normalize_license_payload(license_data)
    except LicenseError as exc:
        return {
            "edition": "community",
            "state": "invalid",
            "valid": False,
            "reason": str(exc),
            "license": license_data,
            "limits": deepcopy(COMMUNITY_LIMITS),
            "enabled_features": sorted(community_feature_ids()),
            "update_channel": "community-stable",
            **_plan_state(None, edition="community"),
            **_license_dates_state(None),
        }
    try:
        signed_payload = _signed_license_payload(license_data)
    except LicenseError:
        signed_payload = normalized
    signature_ok, signature_error = _verify_signature(signed_payload)
    if not signature_ok:
        legacy_signature_ok, legacy_signature_error = _verify_signature(normalized)
        if legacy_signature_ok:
            signature_ok = True
            signature_error = None
        elif signature_error == "La firma de licencia no es valida":
            signature_error = legacy_signature_error or signature_error
    expires_at = _parse_datetime(normalized.get("expires_at"))
    revoked_at = _parse_datetime(normalized.get("revoked_at"))
    expired = bool(expires_at and expires_at < utc_now())
    revoked = bool(revoked_at and revoked_at <= utc_now())
    if normalized["edition"] != "premium":
        return {
            "edition": "community",
            "state": "community",
            "valid": True,
            "reason": None,
            "license": normalized,
            "limits": deepcopy(COMMUNITY_LIMITS),
            "enabled_features": sorted(community_feature_ids()),
            "update_channel": normalized.get("update_channel") or "community-stable",
            **_plan_state(normalized, edition="community"),
            **_license_dates_state(normalized),
        }
    if not signature_ok:
        state = "invalid"
        reason = signature_error
    elif revoked:
        state = "revoked"
        reason = "La licencia Premium fue revocada"
    elif expired:
        state = "expired"
        reason = "La licencia Premium esta vencida"
    else:
        state = "active"
        reason = None
    if state != "active":
        return {
            "edition": "community",
            "state": state,
            "valid": False,
            "reason": reason,
            "license": normalized,
            "limits": deepcopy(COMMUNITY_LIMITS),
            "enabled_features": sorted(community_feature_ids()),
            "update_channel": "community-stable",
            **_plan_state(normalized, edition="community"),
            **_license_dates_state(normalized),
        }
    limits = deepcopy(COMMUNITY_LIMITS)
    for field in COMMUNITY_LIMITS:
        if normalized.get(field) is not None:
            limits[field] = int(normalized[field])
    enabled = community_feature_ids() | (set(normalized.get("enabled_features") or []) & premium_feature_ids())
    return {
        "edition": "premium",
        "state": "active",
        "valid": True,
        "reason": None,
        "license": normalized,
        "limits": limits,
        "enabled_features": sorted(enabled),
        "update_channel": normalized.get("update_channel") or "premium-stable",
        **_plan_state(normalized, edition="premium"),
        **_license_dates_state(normalized),
    }


async def get_installed_license(db: AsyncSession) -> dict[str, Any] | None:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == LICENSE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    return setting.value if setting else None


async def get_online_license_state(db: AsyncSession) -> dict[str, Any] | None:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == LICENSE_ONLINE_STATE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    return setting.value if setting else None


async def save_online_license_state(db: AsyncSession, state: dict[str, Any]) -> dict[str, Any]:
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == LICENSE_ONLINE_STATE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = state
    else:
        db.add(models.AppSetting(key=LICENSE_ONLINE_STATE_SETTING_KEY, value=state))
    await db.commit()
    return state


async def get_license_state(db: AsyncSession) -> dict[str, Any]:
    local_state = evaluate_license(await get_installed_license(db))
    online_state = await get_online_license_state(db)
    if isinstance(online_state, dict) and online_state.get("license"):
        online_license_id = (online_state.get("license") or {}).get("license_id")
        local_license_id = (local_state.get("license") or {}).get("license_id")
        if online_license_id and online_license_id == local_license_id:
            return online_state
    return local_state


async def install_license(db: AsyncSession, license_data: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_license_payload(license_data)
    if normalized["edition"] != "premium":
        raise LicenseError("Solo se pueden instalar licencias Premium firmadas; Community no requiere archivo de licencia")
    state = evaluate_license(normalized)
    if normalized["edition"] == "premium" and state["state"] not in {"active", "revoked"}:
        raise LicenseError(state["reason"] or "La licencia Premium no es valida")
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == LICENSE_SETTING_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = normalized
    else:
        db.add(models.AppSetting(key=LICENSE_SETTING_KEY, value=normalized))
    await db.commit()
    return evaluate_license(normalized)

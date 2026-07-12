from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.services.edition.catalog import COMMUNITY_LIMITS, all_feature_ids, community_feature_ids, normalize_feature_ids
from app.services.edition.license_manager import evaluate_license


ONLINE_PREMIUM_STATES = {"active", "past_due", "grace_period", "offline_grace"}
SERVER_RESPONSE_PUBLIC_KEY_ENV = "TRESEKO_LICENSE_SERVER_PUBLIC_KEY"
SERVER_RESPONSE_DEV_PUBLIC_KEY_ENV = "TRESEKO_ALLOW_DEV_LICENSE_SERVER_PUBLIC_KEY"
EMBEDDED_SERVER_RESPONSE_PUBLIC_KEY = ""
EMBEDDED_SERVER_RESPONSE_PUBLIC_KEYS: tuple[str, ...] = ("4J76WRigKKrKfp1C0rPvOA1iXa6j5j6WLWQSMEHP3EE",)
INSTANCE_ID_ENV = "TRESEKO_INSTANCE_ID"
INSTANCE_ID_FILE_ENV = "TRESEKO_INSTANCE_ID_FILE"


class PremiumVerificationError(RuntimeError):
    pass


def _canonical_payload(value: dict[str, Any]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _b64_decode(value: str) -> bytes:
    compact = "".join(str(value).strip().split())
    padding = "=" * (-len(compact) % 4)
    return base64.urlsafe_b64decode((compact + padding).encode("ascii"))


def _load_public_key(value: str) -> Ed25519PublicKey:
    raw_value = str(value or "").strip()
    if "BEGIN PUBLIC KEY" in raw_value:
        key = serialization.load_pem_public_key(raw_value.encode("utf-8"))
        if not isinstance(key, Ed25519PublicKey):
            raise PremiumVerificationError("La clave publica del servidor debe ser Ed25519")
        return key
    raw = _b64_decode(raw_value)
    if len(raw) != 32:
        raise PremiumVerificationError("La clave publica del servidor debe tener 32 bytes")
    return Ed25519PublicKey.from_public_bytes(raw)


def _public_key_fingerprint(public_key: Ed25519PublicKey) -> str:
    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return f"ed25519:sha256:{hashlib.sha256(raw).hexdigest()[:24]}"


def _server_public_keys() -> tuple[str, ...]:
    dev_override_enabled = str(os.getenv(SERVER_RESPONSE_DEV_PUBLIC_KEY_ENV) or "").strip().lower() in {"1", "true", "yes", "on"}
    if dev_override_enabled:
        value = str(os.getenv(SERVER_RESPONSE_PUBLIC_KEY_ENV) or "").strip()
        return (value,) if value else ()
    embedded = tuple(key.strip() for key in EMBEDDED_SERVER_RESPONSE_PUBLIC_KEYS if str(key).strip())
    legacy_single = str(EMBEDDED_SERVER_RESPONSE_PUBLIC_KEY or "").strip()
    if legacy_single:
        embedded = (*embedded, legacy_single)
    return embedded


def server_response_keyring_status() -> dict[str, Any]:
    public_key_values = _server_public_keys()
    dev_override_enabled = str(os.getenv(SERVER_RESPONSE_DEV_PUBLIC_KEY_ENV) or "").strip().lower() in {"1", "true", "yes", "on"}
    source = "development_override" if dev_override_enabled else "embedded"
    fingerprints: list[str] = []
    errors: list[str] = []
    seen: set[str] = set()
    for index, public_key_value in enumerate(public_key_values, start=1):
        try:
            fingerprint = _public_key_fingerprint(_load_public_key(public_key_value))
        except Exception as exc:
            errors.append(f"license_server_key[{index}]: {exc}")
            continue
        if fingerprint in seen:
            errors.append(f"license_server_key[{index}]: key_id duplicado {fingerprint}")
            continue
        seen.add(fingerprint)
        fingerprints.append(fingerprint)
    return {
        "kind": "license_server",
        "algorithm": "ed25519",
        "configured": bool(public_key_values) and not errors,
        "source": source,
        "development_override_enabled": dev_override_enabled,
        "key_count": len(public_key_values),
        "fingerprints": fingerprints,
        "errors": errors,
    }


def _parse_datetime(value: Any) -> datetime | None:
    if value in {None, ""}:
        return None
    candidate = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if candidate.tzinfo is None:
        candidate = candidate.replace(tzinfo=timezone.utc)
    return candidate.astimezone(timezone.utc)


def get_or_create_instance_id() -> str:
    configured = str(os.getenv(INSTANCE_ID_ENV) or "").strip()
    if configured:
        return configured
    path = Path(os.getenv(INSTANCE_ID_FILE_ENV) or Path.home() / ".treseko" / "instance_id")
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value
    path.parent.mkdir(parents=True, exist_ok=True)
    value = f"inst_{uuid.uuid4().hex}"
    path.write_text(value, encoding="utf-8")
    return value


def _license_url(base_url: str, path: str) -> str:
    server = str(base_url).strip().rstrip("/")
    if server.endswith("/licenses"):
        return f"{server}/{path.lstrip('/')}"
    if server.endswith("/api"):
        return f"{server}/licenses/{path.lstrip('/')}"
    return f"{server}/api/licenses/{path.lstrip('/')}"


def _headers(activation_token: str) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {activation_token}",
    }


def _update_download_grant_url(update_server: str) -> str:
    server = str(update_server or "").strip().rstrip("/")
    if not server:
        raise PremiumVerificationError("La licencia Premium no tiene servidor de updates configurado")
    return f"{server}/download-grant" if server.endswith("/updates") else f"{server}/updates/download-grant"


def _update_latest_url(update_server: str) -> str:
    server = str(update_server or "").strip().rstrip("/")
    if not server:
        raise PremiumVerificationError("La licencia Premium no tiene servidor de updates configurado")
    return f"{server}/premium/latest" if server.endswith("/updates") else f"{server}/updates/premium/latest"


def _remote_license_payload(license_data: dict[str, Any]) -> dict[str, Any]:
    signed_payload = (license_data or {}).get("signed_payload")
    if isinstance(signed_payload, dict):
        if set(signed_payload) == {"payload", "signature"} and isinstance(signed_payload.get("payload"), dict):
            source = signed_payload["payload"]
        else:
            source = signed_payload
    else:
        source = license_data or {}
    return {key: value for key, value in source.items() if key not in {"signature", "signed_payload"}}


def _license_signature(license_data: dict[str, Any]) -> str:
    signed_payload = (license_data or {}).get("signed_payload")
    if isinstance(signed_payload, dict):
        signature = str(signed_payload.get("signature") or "").strip()
        if signature:
            return signature
    return str((license_data or {}).get("signature") or "").strip()


def _payload_from_license(license_data: dict[str, Any], *, current_version: str = "lab", nonce: str) -> dict[str, Any]:
    limits = {
        key: int(value)
        for key, value in (license_data or {}).items()
        if str(key).startswith("max_") and value is not None
    }
    return {
        "license_payload": _remote_license_payload(license_data),
        "license_id": license_data.get("license_id"),
        "customer_id": license_data.get("customer_id"),
        "instance_id": get_or_create_instance_id(),
        "current_version": current_version,
        "edition": "premium",
        "activation_token": license_data.get("activation_token"),
        "features": license_data.get("enabled_features") or [],
        "limits": limits,
        "update_channel": license_data.get("update_channel") or "premium-stable",
        "nonce": nonce,
        "usage": {},
    }


def verify_signed_server_response(
    envelope: dict[str, Any],
    license_data: dict[str, Any],
    *,
    expected_nonce: str,
) -> dict[str, Any]:
    if not isinstance(envelope, dict) or set(envelope) != {"payload", "signature"}:
        raise PremiumVerificationError("La respuesta del servidor debe estar firmada")
    payload = envelope.get("payload")
    signature = str(envelope.get("signature") or "").strip()
    if not isinstance(payload, dict) or not signature.startswith("ed25519:"):
        raise PremiumVerificationError("La respuesta firmada del servidor no es valida")
    raw_signature = _b64_decode(signature.split(":", 1)[1])
    if len(raw_signature) != 64:
        raise PremiumVerificationError("La firma del servidor no tiene formato Ed25519")
    keys = _server_public_keys()
    if not keys:
        raise PremiumVerificationError("No hay keyring publico de respuestas Premium configurado")
    verified = False
    requested_key_id = str(payload.get("key_id") or "").strip()
    key_id_seen = False
    for key_value in keys:
        try:
            public_key = _load_public_key(key_value)
            if requested_key_id:
                if _public_key_fingerprint(public_key) != requested_key_id:
                    continue
                key_id_seen = True
            public_key.verify(raw_signature, _canonical_payload(payload))
            verified = True
            break
        except (InvalidSignature, ValueError, PremiumVerificationError):
            continue
    if requested_key_id and not key_id_seen:
        raise PremiumVerificationError("El key_id de respuesta Premium no existe en el keyring publico de Treseko")
    if not verified:
        raise PremiumVerificationError("La firma de respuesta Premium no es valida")
    if payload.get("license_id") != license_data.get("license_id"):
        raise PremiumVerificationError("La respuesta pertenece a otra licencia")
    if payload.get("customer_id") != license_data.get("customer_id"):
        raise PremiumVerificationError("La respuesta pertenece a otro cliente")
    if payload.get("instance_id") != get_or_create_instance_id():
        raise PremiumVerificationError("La respuesta pertenece a otra instancia")
    if payload.get("nonce") != expected_nonce:
        raise PremiumVerificationError("La respuesta Premium no coincide con el nonce enviado")
    if str(payload.get("status") or "").lower() not in {"active", "past_due", "grace_period", "offline_grace", "expired", "revoked", "invalid", "instance_mismatch"}:
        raise PremiumVerificationError("La respuesta Premium contiene un estado desconocido")
    now = datetime.now(timezone.utc)
    issued_at = _parse_datetime(payload.get("issued_at"))
    valid_until = _parse_datetime(payload.get("valid_until"))
    if issued_at and issued_at > now + timedelta(minutes=5):
        raise PremiumVerificationError("La respuesta Premium fue emitida en el futuro")
    if valid_until and valid_until < now and payload.get("status") in ONLINE_PREMIUM_STATES:
        raise PremiumVerificationError("La respuesta Premium esta vencida")
    return payload


def normalize_verification_state(remote: dict[str, Any], license_data: dict[str, Any]) -> dict[str, Any]:
    status = str(remote.get("status") or "invalid").strip().lower()
    edition = "premium" if status in ONLINE_PREMIUM_STATES else "community"
    raw_features = remote.get("features") if isinstance(remote.get("features"), list) else license_data.get("enabled_features")
    known_features = all_feature_ids()
    enabled = {feature for feature in normalize_feature_ids(raw_features or []) if feature in known_features}
    raw_limits = remote.get("limits") if isinstance(remote.get("limits"), dict) else {}
    limits = dict(COMMUNITY_LIMITS)
    for key, value in raw_limits.items():
        if key in COMMUNITY_LIMITS:
            try:
                limits[key] = int(value)
            except (TypeError, ValueError):
                continue
    if edition != "premium":
        enabled = set()
        limits = dict(COMMUNITY_LIMITS)
    checked_at = datetime.now().astimezone().isoformat()
    return {
        "edition": edition,
        "state": status,
        "valid": edition == "premium",
        "reason": remote.get("message"),
        "license": license_data,
        "limits": limits,
        "enabled_features": sorted(enabled | community_feature_ids()),
        "update_channel": str(remote.get("update_channel") or ("premium-stable" if edition == "premium" else "community-stable")),
        "plan_id": remote.get("plan_id") or license_data.get("plan_id") or ("premium" if edition == "premium" else "community"),
        "plan_name": remote.get("plan_name") or license_data.get("plan_name") or ("Premium" if edition == "premium" else "Community"),
        "plan_version": remote.get("plan_version") or license_data.get("plan_version"),
        "plan_custom": bool(remote.get("plan_custom") or license_data.get("plan_custom")),
        "issued_at": license_data.get("issued_at"),
        "valid_until": remote.get("valid_until") or license_data.get("expires_at"),
        "activated_at": remote.get("activated_at") or license_data.get("activated_at"),
        "last_check_at": checked_at,
        "next_check_at": remote.get("next_check_at"),
        "grace_until": remote.get("grace_until"),
        "verification_interval_days": license_data.get("verification_interval_days"),
        "grace_period_days": license_data.get("grace_period_days"),
        "remote": {
            "checked_at": checked_at,
            "valid_until": remote.get("valid_until"),
            "next_check_at": remote.get("next_check_at"),
            "grace_until": remote.get("grace_until"),
            "activated_at": remote.get("activated_at"),
            "status": status,
        },
    }


async def activate_license_online(license_data: dict[str, Any], *, timeout_seconds: float = 5.0) -> dict[str, Any]:
    local_state = evaluate_license(license_data)
    if local_state.get("edition") != "premium" or local_state.get("state") != "active":
        raise PremiumVerificationError(local_state.get("reason") or "La licencia local no es valida")
    server = str(license_data.get("verification_server") or "").strip()
    token = str(license_data.get("activation_token") or "").strip()
    if not server or not token:
        raise PremiumVerificationError("La licencia no tiene servidor de verificacion o activation_token")
    nonce = secrets.token_urlsafe(32)
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(_license_url(server, "activate"), json=_payload_from_license(license_data, nonce=nonce), headers=_headers(token))
    except httpx.HTTPError as exc:
        raise PremiumVerificationError(f"No se pudo contactar el Verification Server Premium: {exc}") from exc
    if response.status_code >= 400:
        raise PremiumVerificationError(f"Activacion Premium rechazada ({response.status_code}): {response.text}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise PremiumVerificationError("El Verification Server no devolvio JSON valido") from exc
    return normalize_verification_state(verify_signed_server_response(payload, license_data, expected_nonce=nonce), license_data)


async def heartbeat_license_online(license_data: dict[str, Any], *, timeout_seconds: float = 5.0) -> dict[str, Any]:
    local_state = evaluate_license(license_data)
    if local_state.get("edition") != "premium" or local_state.get("state") != "active":
        raise PremiumVerificationError(local_state.get("reason") or "La licencia local no es valida")
    server = str(license_data.get("verification_server") or "").strip()
    token = str(license_data.get("activation_token") or "").strip()
    if not server or not token:
        raise PremiumVerificationError("La licencia no tiene servidor de verificacion o activation_token")
    nonce = secrets.token_urlsafe(32)
    payload = _payload_from_license(license_data, nonce=nonce)
    payload.pop("activation_token", None)
    payload["features_local"] = license_data.get("enabled_features") or []
    payload["usage"] = {}
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(_license_url(server, "heartbeat"), json=payload, headers=_headers(token))
    except httpx.HTTPError as exc:
        raise PremiumVerificationError(f"No se pudo contactar el Verification Server Premium: {exc}") from exc
    if response.status_code >= 400:
        raise PremiumVerificationError(f"Heartbeat Premium rechazado ({response.status_code}): {response.text}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise PremiumVerificationError("El Verification Server no devolvio JSON valido") from exc
    return normalize_verification_state(verify_signed_server_response(payload, license_data, expected_nonce=nonce), license_data)


async def request_update_download_grant(
    license_data: dict[str, Any],
    manifest: dict[str, Any],
    *,
    current_version: str,
    update_server_url: str | None = None,
    timeout_seconds: float = 20.0,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    activation_token = str((license_data or {}).get("activation_token") or "").strip()
    if not activation_token:
        raise PremiumVerificationError("La licencia Premium no tiene activation_token para updates")
    update_server = str(
        update_server_url
        or (license_data or {}).get("update_server")
        or os.getenv("TRESEKO_UPDATE_SERVER_URL")
        or ""
    ).strip()
    grant_url = _update_download_grant_url(update_server)
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds, connect=5.0),
            transport=transport,
        ) as client:
            response = await client.post(
                grant_url,
                json={
                    "manifest": manifest,
                    "license": _remote_license_payload(license_data),
                    "license_signature": _license_signature(license_data) or None,
                    "instance_id": get_or_create_instance_id(),
                    "current_version": current_version,
                },
                headers=_headers(activation_token),
            )
            response.raise_for_status()
            grant_payload = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500] if exc.response is not None else str(exc)
        raise PremiumVerificationError(f"Update Server rechazo el download grant: {detail}") from exc
    except httpx.HTTPError as exc:
        raise PremiumVerificationError(f"No se pudo contactar el Update Server Premium: {exc}") from exc
    if not isinstance(grant_payload, dict) or not str(grant_payload.get("package_url") or "").strip():
        raise PremiumVerificationError("El Update Server no devolvio una URL de paquete valida")
    return grant_payload


async def fetch_latest_premium_update_manifest(
    license_data: dict[str, Any],
    *,
    current_version: str,
    update_server_url: str | None = None,
    timeout_seconds: float = 10.0,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    activation_token = str((license_data or {}).get("activation_token") or "").strip()
    if not activation_token:
        raise PremiumVerificationError("La licencia Premium no tiene activation_token para updates")
    update_server = str(
        update_server_url
        or (license_data or {}).get("update_server")
        or os.getenv("TRESEKO_UPDATE_SERVER_URL")
        or ""
    ).strip()
    latest_url = _update_latest_url(update_server)
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds, connect=5.0),
            transport=transport,
        ) as client:
            response = await client.post(
                latest_url,
                json={
                    "license": _remote_license_payload(license_data),
                    "license_signature": _license_signature(license_data) or None,
                    "instance_id": get_or_create_instance_id(),
                    "current_version": current_version,
                    "update_key_id": None,
                },
                headers=_headers(activation_token),
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500] if exc.response is not None else str(exc)
        raise PremiumVerificationError(f"Update Server rechazo la consulta Premium: {detail}") from exc
    except httpx.HTTPError as exc:
        raise PremiumVerificationError(f"No se pudo contactar el Update Server Premium: {exc}") from exc
    manifest = payload.get("manifest") if isinstance(payload, dict) else None
    if isinstance(payload, dict) and payload.get("available") is False:
        raise PremiumVerificationError(str(payload.get("reason") or "No hay version Premium posterior aplicable"))
    if not isinstance(manifest, dict):
        raise PremiumVerificationError("El Update Server no devolvio un manifest Premium valido")
    return manifest


def offline_grace_from_cached_state(cached_state: dict[str, Any] | None, license_data: dict[str, Any]) -> dict[str, Any] | None:
    local_state = evaluate_license(license_data)
    if local_state.get("edition") != "premium" or local_state.get("state") != "active":
        return None
    if not isinstance(cached_state, dict) or not cached_state.get("valid"):
        return None
    if (cached_state.get("license") or {}).get("license_id") != license_data.get("license_id"):
        return None
    remote = cached_state.get("remote") or {}
    grace_until = _parse_datetime(remote.get("grace_until"))
    if not grace_until or grace_until < datetime.now(timezone.utc):
        return None
    state = dict(cached_state)
    state["state"] = "offline_grace"
    state["edition"] = "premium"
    state["valid"] = True
    state["reason"] = "Servidor Premium no disponible; usando grace firmado previo"
    checked_at = datetime.now(timezone.utc).isoformat()
    state["last_check_at"] = checked_at
    state["grace_until"] = remote.get("grace_until") or state.get("grace_until")
    state["remote"] = {**remote, "status": "offline_grace", "checked_at": checked_at}
    return state

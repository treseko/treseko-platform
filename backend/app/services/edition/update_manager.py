from __future__ import annotations

import base64
import hashlib
import json
import os
from collections.abc import Awaitable, Callable
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from ...version import PRODUCT_VERSION


UPDATE_PUBLIC_KEY_ENV = "TRESEKO_UPDATE_PUBLIC_KEY"
UPDATE_DEV_PUBLIC_KEY_OVERRIDE_ENV = "TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY"
UPDATE_SIGNATURE_ALGORITHM = "ed25519"
EMBEDDED_UPDATE_PUBLIC_KEY = ""
EMBEDDED_UPDATE_PUBLIC_KEYS: tuple[str, ...] = ("MZGc3IcJLB7odG-lG8ykLdOwo_cmKxlBTg1VwmopC0I",)
COMMUNITY_UPDATE_CHANNELS = {"community-stable", "community-beta", "community-smoke"}
PREMIUM_UPDATE_CHANNELS = {"premium-stable", "premium-beta"}
VALID_UPDATE_CHANNELS = COMMUNITY_UPDATE_CHANNELS | PREMIUM_UPDATE_CHANNELS
DIRECT_PACKAGE_URL_PREFIXES = ("http://", "https://")


class UpdateManifestError(ValueError):
    pass


UpdateGrantClient = Callable[..., Awaitable[dict[str, Any]]]


def _canonical_manifest_payload(manifest: dict[str, Any]) -> bytes:
    payload = {key: value for key, value in manifest.items() if key != "signature"}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _b64_decode(value: str) -> bytes:
    compact = "".join(str(value).strip().split())
    padding = "=" * (-len(compact) % 4)
    try:
        return base64.urlsafe_b64decode((compact + padding).encode("ascii"))
    except Exception as exc:
        raise UpdateManifestError("La clave o firma del manifest no esta codificada correctamente") from exc


def _load_public_key(value: str) -> Ed25519PublicKey:
    raw_value = str(value or "").strip()
    if not raw_value:
        raise UpdateManifestError("No hay clave publica de updates Treseko configurada")
    if "BEGIN PUBLIC KEY" in raw_value:
        try:
            key = serialization.load_pem_public_key(raw_value.encode("utf-8"))
        except ValueError as exc:
            raise UpdateManifestError("La clave publica de updates no es valida") from exc
        if not isinstance(key, Ed25519PublicKey):
            raise UpdateManifestError("La clave publica de updates debe ser Ed25519")
        return key
    raw_key = _b64_decode(raw_value)
    if len(raw_key) != 32:
        raise UpdateManifestError("La clave publica Ed25519 de updates debe tener 32 bytes")
    return Ed25519PublicKey.from_public_bytes(raw_key)


def _public_key_fingerprint(public_key: Ed25519PublicKey) -> str:
    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return f"ed25519:sha256:{hashlib.sha256(raw).hexdigest()[:24]}"


def _env_flag_enabled(name: str) -> bool:
    return str(os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _configured_update_public_keys() -> tuple[str, ...]:
    """
    Returns the trusted vendor public keyring for signed update manifests.

    Production builds must embed Treseko's update public keys. Environment
    overrides are development-only to prevent a self-hosted instance from
    trusting customer-signed Premium update manifests.
    """
    if _env_flag_enabled(UPDATE_DEV_PUBLIC_KEY_OVERRIDE_ENV):
        value = str(os.getenv(UPDATE_PUBLIC_KEY_ENV) or "").strip()
        return (value,) if value else ()
    embedded = tuple(key.strip() for key in EMBEDDED_UPDATE_PUBLIC_KEYS if str(key).strip())
    legacy_single = str(EMBEDDED_UPDATE_PUBLIC_KEY or "").strip()
    if legacy_single:
        embedded = (*embedded, legacy_single)
    return embedded


def verify_update_manifest_signature(manifest: dict[str, Any]) -> tuple[bool, str | None]:
    signature = str(manifest.get("signature") or "").strip()
    if not signature:
        return False, "El manifest no incluye firma"
    try:
        algorithm, encoded_signature = signature.split(":", 1)
    except ValueError:
        return False, "El formato de firma del manifest no es valido"
    if algorithm != UPDATE_SIGNATURE_ALGORITHM:
        return False, "El algoritmo de firma del manifest no es soportado"
    public_key_values = _configured_update_public_keys()
    if not public_key_values:
        return False, "La clave publica de updates Treseko no esta configurada"
    raw_signature = _b64_decode(encoded_signature)
    if len(raw_signature) != 64:
        return False, "La firma Ed25519 del manifest debe tener 64 bytes"
    key_errors: list[str] = []
    requested_key_id = str(manifest.get("key_id") or "").strip()
    if not requested_key_id:
        return False, "key_id es obligatorio en manifests firmados de update"
    key_id_seen = False
    try:
        payload = _canonical_manifest_payload(manifest)
        for public_key_value in public_key_values:
            try:
                public_key = _load_public_key(public_key_value)
                if requested_key_id:
                    if _public_key_fingerprint(public_key) != requested_key_id:
                        continue
                    key_id_seen = True
                public_key.verify(raw_signature, payload)
                return True, None
            except UpdateManifestError as exc:
                key_errors.append(str(exc))
            except InvalidSignature:
                continue
    except UpdateManifestError as exc:
        return False, str(exc)
    if key_errors and len(key_errors) == len(public_key_values):
        return False, "; ".join(key_errors)
    if requested_key_id and not key_id_seen:
        return False, "El key_id del manifest no existe en el keyring publico de Treseko"
    return False, "La firma del manifest no es valida"


def update_keyring_status() -> dict[str, Any]:
    public_key_values = _configured_update_public_keys()
    dev_override_enabled = _env_flag_enabled(UPDATE_DEV_PUBLIC_KEY_OVERRIDE_ENV)
    source = "development_override" if dev_override_enabled else "embedded"
    fingerprints: list[str] = []
    errors: list[str] = []
    seen: set[str] = set()
    for index, public_key_value in enumerate(public_key_values, start=1):
        try:
            fingerprint = _public_key_fingerprint(_load_public_key(public_key_value))
        except UpdateManifestError as exc:
            errors.append(f"update_key[{index}]: {exc}")
            continue
        if fingerprint in seen:
            errors.append(f"update_key[{index}]: key_id duplicado {fingerprint}")
            continue
        seen.add(fingerprint)
        fingerprints.append(fingerprint)
    return {
        "kind": "update",
        "algorithm": UPDATE_SIGNATURE_ALGORITHM,
        "configured": bool(public_key_values) and not errors,
        "source": source,
        "development_override_enabled": dev_override_enabled,
        "key_count": len(public_key_values),
        "fingerprints": fingerprints,
        "errors": errors,
    }


def validate_update_manifest(manifest: dict[str, Any], entitlement_state: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise UpdateManifestError("El manifest de update debe ser un objeto JSON")
    manifest = dict(manifest)
    if manifest.get("key_id") is not None:
        manifest["key_id"] = str(manifest.get("key_id") or "").strip() or None
    channel = str(manifest.get("channel") or "").strip()
    edition = str(manifest.get("edition") or "").strip().lower()
    version = str(manifest.get("version") or "").strip()
    previous_version = str(manifest.get("previous_version") or "").strip()
    from_versions = manifest.get("from_versions")
    artifact = str(manifest.get("artifact") or "").strip()
    artifact_type = str(manifest.get("artifact_type") or "").strip()
    package_url = str(manifest.get("package_url") or "").strip()
    checksum = str(manifest.get("checksum_sha256") or "").strip()
    package_size_raw = manifest.get("package_size_bytes")
    if channel not in VALID_UPDATE_CHANNELS:
        raise UpdateManifestError("El canal del manifest no es valido")
    expected_edition = "premium" if channel in PREMIUM_UPDATE_CHANNELS else "community"
    if edition != expected_edition:
        raise UpdateManifestError("La edicion del manifest no coincide con su canal")
    for field_name, field_value in {
        "version": version,
        "package_url": package_url,
        "checksum_sha256": checksum,
    }.items():
        if not field_value:
            raise UpdateManifestError(f"{field_name} es obligatorio en el manifest")
    if previous_version and previous_version != PRODUCT_VERSION:
        raise UpdateManifestError(
            f"El manifest requiere actualizar desde {previous_version}; esta instalacion tiene {PRODUCT_VERSION}"
        )
    if isinstance(from_versions, list) and from_versions:
        allowed_sources = {str(item).strip() for item in from_versions if str(item).strip()}
        if PRODUCT_VERSION not in allowed_sources:
            raise UpdateManifestError("Esta version instalada no esta habilitada como origen para el manifest")
    package_size_bytes: int | None = None
    if package_size_raw is not None:
        try:
            package_size_bytes = int(package_size_raw)
        except (TypeError, ValueError) as exc:
            raise UpdateManifestError("package_size_bytes debe ser un entero positivo") from exc
        if package_size_bytes <= 0:
            raise UpdateManifestError("package_size_bytes debe ser un entero positivo")
    if expected_edition == "premium" and package_url.lower().startswith(DIRECT_PACKAGE_URL_PREFIXES):
        raise UpdateManifestError(
            "Los manifests Premium no deben exponer URLs directas de paquete; usa una referencia opaca y DownloadGrant"
        )
    has_signature = bool(str(manifest.get("signature") or "").strip())
    if expected_edition == "premium" or has_signature:
        signature_ok, signature_error = verify_update_manifest_signature(manifest)
        if not signature_ok:
            raise UpdateManifestError(signature_error or "El manifest no pudo verificarse")
    enabled_features = set(entitlement_state.get("enabled_features") or [])
    premium_allowed = "updates.premium" in enabled_features and entitlement_state.get("edition") == "premium"
    if expected_edition == "premium" and not premium_allowed:
        raise UpdateManifestError("Los updates Premium requieren licencia Premium activa con updates.premium")
    active_channel = str(entitlement_state.get("update_channel") or "").strip()
    if active_channel and channel != active_channel:
        raise UpdateManifestError(
            f"El canal del manifest ({channel}) no coincide con el canal habilitado ({active_channel})"
        )
    return {
        "allowed": True,
        "edition": expected_edition,
        "channel": channel,
        "version": version,
        "artifact": artifact or None,
        "artifact_type": artifact_type or None,
        "package_size_bytes": package_size_bytes,
        "package_url": package_url if expected_edition == "community" else None,
        "checksum_sha256": checksum,
        "download_grant_required": expected_edition == "premium",
        "update_server_path": "/updates/download-grant" if expected_edition == "premium" else None,
    }


def prepare_update_download_grant_request(manifest: dict[str, Any], entitlement_state: dict[str, Any]) -> dict[str, Any]:
    """
    Prepara el request que el self-hosted enviaria al Update Server privado.

    No descarga paquetes. Para Premium exige licencia valida y conserva tanto la
    licencia firmada como el manifest firmado para que el Update Server autorice
    con contexto comercial completo.
    """
    result = validate_update_manifest(manifest, entitlement_state)
    if result["edition"] != "premium":
        return {
            "grant_required": False,
            "reason": "Los updates Community no requieren download grant Premium",
            "update_server_path": None,
            "license": None,
            "manifest": manifest,
            "artifact": result.get("artifact"),
            "artifact_type": result.get("artifact_type"),
            "package_size_bytes": result.get("package_size_bytes"),
            "checksum_sha256": result["checksum_sha256"],
        }
    license_payload = entitlement_state.get("license")
    if not entitlement_state.get("valid") or entitlement_state.get("state") != "active" or not license_payload:
        raise UpdateManifestError("La descarga Premium requiere licencia Premium activa")
    return {
        "grant_required": True,
        "reason": None,
        "update_server_path": "/updates/download-grant",
        "license": license_payload,
        "manifest": manifest,
        "artifact": result.get("artifact"),
        "artifact_type": result.get("artifact_type"),
        "package_size_bytes": result.get("package_size_bytes"),
        "checksum_sha256": result["checksum_sha256"],
    }


async def request_premium_download_grant(
    manifest: dict[str, Any],
    entitlement_state: dict[str, Any],
    *,
    current_version: str,
    grant_client: UpdateGrantClient | None = None,
) -> dict[str, Any]:
    """
    Valida un manifest Premium, solicita un DownloadGrant y devuelve el
    manifest listo para que `UpdateService` descargue el paquete temporal.
    """
    grant_request = prepare_update_download_grant_request(manifest, entitlement_state)
    if not grant_request.get("grant_required"):
        return {
            **grant_request,
            "manifest": manifest,
            "package_url": manifest.get("package_url"),
        }
    if grant_client is None:
        from app.services.premium_runtime.verification_client import request_update_download_grant

        grant_client = request_update_download_grant
    grant_payload = await grant_client(
        grant_request["license"],
        grant_request["manifest"],
        current_version=current_version,
    )
    package_url = str(grant_payload.get("package_url") or "").strip()
    if not package_url:
        raise UpdateManifestError("El DownloadGrant no incluyo package_url")
    grant_manifest = grant_payload.get("manifest") if isinstance(grant_payload.get("manifest"), dict) else {}
    resolved_manifest = {
        **manifest,
        **grant_manifest,
        "package_url": package_url,
    }
    return {
        **grant_request,
        "grant_required": True,
        "grant_token": grant_payload.get("grant_token"),
        "package_url": package_url,
        "expires_at": grant_payload.get("expires_at"),
        "manifest": resolved_manifest,
    }

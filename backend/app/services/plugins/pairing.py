"""Persistent, encrypted pairing state for the official plugin store."""
from __future__ import annotations

import base64
import json
import secrets
from typing import Any

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...services.secret_crypto import decrypt_secret_value, encrypt_secret_value
from ...time_utils import utc_now
from .manifest import PluginManifestError, validate_plugin_manifest
from .store_client import PLUGIN_STORE_URL, PluginStoreClientError, fetch_official_catalog


PAIRING_SETTING_KEY = "plugin_store_pairing"


async def pairing_status(db: AsyncSession) -> dict[str, Any]:
    setting = (await db.execute(select(models.AppSetting).where(models.AppSetting.key == PAIRING_SETTING_KEY))).scalar_one_or_none()
    value = dict(setting.value or {}) if setting else {}
    return {
        "paired": bool(value.get("installation_id") and value.get("private_key_encrypted")),
        "installation_id": value.get("installation_id"),
        "registered_at": value.get("registered_at"),
    }


async def pair_installation(db: AsyncSession) -> dict[str, Any]:
    existing = (await db.execute(select(models.AppSetting).where(models.AppSetting.key == PAIRING_SETTING_KEY))).scalar_one_or_none()
    previous = dict(existing.value or {}) if existing else {}
    private_key = Ed25519PrivateKey.generate()
    private_raw = private_key.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    public_raw = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    public_key = base64.urlsafe_b64encode(public_raw).decode("ascii").rstrip("=")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=2.0), follow_redirects=False) as client:
            if previous.get("installation_id") and previous.get("private_key_encrypted"):
                old_encoded = decrypt_secret_value(str(previous["private_key_encrypted"]))
                old_raw = base64.urlsafe_b64decode((old_encoded + "=" * (-len(old_encoded) % 4)).encode("ascii"))
                old_key = Ed25519PrivateKey.from_private_bytes(old_raw)
                issued_at = utc_now().isoformat()
                nonce = secrets.token_urlsafe(24)
                proof = old_key.sign(json.dumps({"installation_id": str(previous["installation_id"]), "issued_at": issued_at, "new_public_key": public_key, "nonce": nonce, "operation": "rotate"}, sort_keys=True, separators=(",", ":")).encode("utf-8"))
                response = await client.post(f"{PLUGIN_STORE_URL}/installations/rotate", json={"installation_id": str(previous["installation_id"]), "new_public_key": public_key, "nonce": nonce, "issued_at": issued_at, "signature": base64.urlsafe_b64encode(proof).decode("ascii").rstrip("=")})
            else:
                response = await client.post(f"{PLUGIN_STORE_URL}/installations/register", json={"public_key": public_key})
        payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
        if response.status_code != 201 or not payload.get("installation_id") or not payload.get("bootstrap_token"):
            raise PluginStoreClientError("La tienda oficial rechazó el registro de esta instalación")
    except httpx.HTTPError as exc:
        raise PluginStoreClientError("No se pudo registrar esta instalación en la tienda oficial") from exc
    value = {
        "installation_id": str(payload["installation_id"]),
        "public_key": public_key,
        "private_key_encrypted": encrypt_secret_value(base64.urlsafe_b64encode(private_raw).decode("ascii").rstrip("=")),
        "bootstrap_token_encrypted": encrypt_secret_value(str(payload["bootstrap_token"])),
        "registered_at": utc_now().isoformat(),
    }
    if existing:
        existing.value = value
    else:
        db.add(models.AppSetting(key=PAIRING_SETTING_KEY, value=value))
    await db.commit()
    return {"installation_id": value["installation_id"], "registered_at": value["registered_at"]}


def _canonical_grant_proof(*, installation_id: str, release_id: str, nonce: str, issued_at: str) -> bytes:
    return json.dumps({
        "installation_id": installation_id,
        "issued_at": issued_at,
        "nonce": nonce,
        "release_id": release_id,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


async def download_paired_release(
    db: AsyncSession,
    *,
    release_id: str,
    enabled_features: set[str],
) -> tuple[dict[str, Any], bytes]:
    """Obtain an official artifact using proof-of-possession of the local key.

    The catalog manifest is verified before requesting a grant, so a plugin that
    needs an unavailable entitlement is never downloaded. The artifact itself is
    verified again by the installer after the one-use download.
    """
    setting = (await db.execute(select(models.AppSetting).where(models.AppSetting.key == PAIRING_SETTING_KEY))).scalar_one_or_none()
    value = dict(setting.value or {}) if setting else {}
    if not setting or not value.get("installation_id") or not value.get("private_key_encrypted"):
        raise PluginStoreClientError("Esta instalación todavía no está vinculada a la tienda oficial")
    catalog = await fetch_official_catalog()
    item = next((candidate for candidate in catalog if str(candidate.get("release_id")) == release_id), None)
    manifest = item.get("manifest") if isinstance(item, dict) else None
    if not isinstance(manifest, dict):
        raise PluginStoreClientError("El release oficial solicitado no está disponible")
    try:
        validate_plugin_manifest(manifest)
    except PluginManifestError as exc:
        raise PluginStoreClientError(f"El manifest del release oficial fue rechazado: {exc}") from exc
    required_features = {str(feature) for feature in ((manifest.get("license") or {}).get("required_features") or [])}
    if not required_features.issubset(enabled_features):
        raise PluginStoreClientError("La licencia de esta instalación no habilita el plugin solicitado")
    try:
        encrypted_private_key = decrypt_secret_value(str(value["private_key_encrypted"]))
        private_raw = base64.urlsafe_b64decode(
            (encrypted_private_key + "=" * (-len(encrypted_private_key) % 4)).encode("ascii")
        )
        private_key = Ed25519PrivateKey.from_private_bytes(private_raw)
    except (ValueError, TypeError) as exc:
        raise PluginStoreClientError("La identidad local de la tienda no se puede usar; vuelve a vincular la instalación") from exc
    issued_at = utc_now().isoformat()
    nonce = secrets.token_urlsafe(24)
    installation_id = str(value["installation_id"])
    proof = private_key.sign(_canonical_grant_proof(installation_id=installation_id, release_id=release_id, nonce=nonce, issued_at=issued_at))
    request: dict[str, str] = {
        "installation_id": installation_id,
        "release_id": release_id,
        "nonce": nonce,
        "issued_at": issued_at,
        "signature": base64.urlsafe_b64encode(proof).decode("ascii").rstrip("="),
    }
    if value.get("bootstrap_token_encrypted"):
        request["bootstrap_token"] = decrypt_secret_value(str(value["bootstrap_token_encrypted"]))
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=2.0), follow_redirects=False) as client:
            grant_response = await client.post(f"{PLUGIN_STORE_URL}/download-grants", json=request)
            grant_payload = grant_response.json() if grant_response.headers.get("content-type", "").startswith("application/json") else {}
            if grant_response.status_code != 200 or not isinstance(grant_payload.get("grant"), str):
                raise PluginStoreClientError("La tienda oficial rechazó la descarga de este release")
            # The bootstrap secret has been consumed by the store after a valid
            # proof. Do not retain or retransmit it for later grants.
            if value.get("bootstrap_token_encrypted"):
                value.pop("bootstrap_token_encrypted", None)
                value["bootstrap_activated_at"] = utc_now().isoformat()
                setting.value = value
                await db.commit()
            artifact_response = await client.get(f"{PLUGIN_STORE_URL}/downloads/{grant_payload['grant']}")
        if artifact_response.status_code != 200:
            raise PluginStoreClientError("No se pudo descargar el artefacto oficial autorizado")
        encoded_manifest = artifact_response.headers.get("x-treseko-plugin-manifest")
        if not encoded_manifest:
            raise PluginStoreClientError("La descarga oficial no incluyó su manifest")
        downloaded_manifest = json.loads(base64.urlsafe_b64decode((encoded_manifest + "=" * (-len(encoded_manifest) % 4)).encode("ascii")))
        if downloaded_manifest != manifest:
            raise PluginStoreClientError("El manifest de la descarga no coincide con el release autorizado")
        return downloaded_manifest, bytes(artifact_response.content)
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        if isinstance(exc, PluginStoreClientError):
            raise
        raise PluginStoreClientError("No se pudo completar la descarga segura del plugin") from exc

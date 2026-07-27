"""Verification and policy enforcement for official Treseko plugin manifests.

This module intentionally validates metadata only. It never imports, extracts or
executes a downloaded artifact. Runtime execution belongs to the isolated plugin
runner introduced separately from the API process.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from ...version import PRODUCT_VERSION


PLUGIN_MANIFEST_SCHEMA = "treseko.plugin-manifest/v1"
PLUGIN_SIGNATURE_ALGORITHM = "ed25519"
PLUGIN_PUBLIC_KEY_ENV = "TRESEKO_PLUGIN_PUBLIC_KEY"
PLUGIN_DEV_PUBLIC_KEY_OVERRIDE_ENV = "TRESEKO_ALLOW_DEV_PLUGIN_PUBLIC_KEY"
# Release builds receive the official public keyring through the controlled
# release process. A self-hosted environment must never accept an arbitrary
# environment key unless the explicit development override is enabled.
EMBEDDED_PLUGIN_PUBLIC_KEYS: tuple[str, ...] = ()
ALLOWED_PLUGIN_KINDS = {"declarative", "wasm"}
ALLOWED_DECLARATIVE_ENTRYPOINTS = {"junit_xml.import_results", "case_portability.brokered"}
# The broker is intentionally narrower than the product RBAC catalog. These
# are capabilities a downloadable v1 artifact may request, not user roles.
ALLOWED_PLUGIN_PERMISSIONS = {"runs.write", "cases.read", "cases.write", "suites.write"}
PRIVATE_HOST_PATTERNS = (
    re.compile(r"^localhost$", re.I),
    re.compile(r"^127\."),
    re.compile(r"^0\."),
    re.compile(r"^10\."),
    re.compile(r"^192\.168\."),
    re.compile(r"^169\.254\."),
    re.compile(r"^172\.(1[6-9]|2\d|3[01])\."),
    re.compile(r"^\[::1\]$", re.I),
)


class PluginManifestError(ValueError):
    """A manifest did not satisfy Treseko's local trust policy."""


def _env_flag_enabled(name: str) -> bool:
    return str(os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _b64_decode(value: str) -> bytes:
    compact = "".join(str(value or "").strip().split())
    padding = "=" * (-len(compact) % 4)
    try:
        return base64.urlsafe_b64decode((compact + padding).encode("ascii"))
    except Exception as exc:  # pragma: no cover - exact stdlib failure varies
        raise PluginManifestError("La clave o firma del plugin no esta codificada correctamente") from exc


def _load_public_key(value: str) -> Ed25519PublicKey:
    raw = _b64_decode(value)
    if len(raw) != 32:
        raise PluginManifestError("La clave publica Ed25519 de plugins debe tener 32 bytes")
    return Ed25519PublicKey.from_public_bytes(raw)


def _key_id(public_key: Ed25519PublicKey) -> str:
    raw = public_key.public_bytes(encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    return f"ed25519:sha256:{hashlib.sha256(raw).hexdigest()[:24]}"


def _configured_plugin_public_keys() -> tuple[str, ...]:
    if _env_flag_enabled(PLUGIN_DEV_PUBLIC_KEY_OVERRIDE_ENV):
        key = str(os.getenv(PLUGIN_PUBLIC_KEY_ENV) or "").strip()
        return (key,) if key else ()
    return tuple(key.strip() for key in EMBEDDED_PLUGIN_PUBLIC_KEYS if str(key).strip())


def canonical_plugin_manifest_payload(manifest: dict[str, Any]) -> bytes:
    """Return the stable payload signed by the official publisher."""
    copy = json.loads(json.dumps(manifest, ensure_ascii=False, default=str))
    signature = copy.get("signature")
    if isinstance(signature, dict):
        signature = {key: value for key, value in signature.items() if key != "value"}
        copy["signature"] = signature
    else:
        copy.pop("signature", None)
    return json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def audit_manifest_snapshot(manifest: dict[str, Any]) -> dict[str, Any]:
    """Return the full signed manifest suitable for audit persistence.

    A manifest is public release metadata, not a secret envelope.  Keeping the
    signature lets an auditor identify exactly what was accepted.  If a future
    schema ever includes a secret by mistake, known secret-shaped keys are
    removed defensively before the generic audit redactor runs.
    """
    snapshot = json.loads(json.dumps(manifest, ensure_ascii=False, default=str))
    for key in ("bootstrap_token", "token", "authorization", "api_key", "client_secret", "password"):
        snapshot.pop(key, None)
    return snapshot


def installation_scope_key(*, organizacion_id=None, proyecto_id=None) -> str:
    """Canonical nullable-safe installation scope for database uniqueness."""
    if proyecto_id:
        return f"project:{proyecto_id}"
    if organizacion_id:
        return f"organization:{organizacion_id}"
    return "global"


def verify_plugin_manifest_signature(manifest: dict[str, Any]) -> None:
    signature = manifest.get("signature") if isinstance(manifest.get("signature"), dict) else {}
    if signature.get("algorithm") != PLUGIN_SIGNATURE_ALGORITHM:
        raise PluginManifestError("El algoritmo de firma del plugin no es soportado")
    key_id = str(signature.get("key_id") or "").strip()
    encoded_signature = str(signature.get("value") or "").strip()
    if not key_id or not encoded_signature:
        raise PluginManifestError("El manifest del plugin debe incluir key_id y firma")
    raw_signature = _b64_decode(encoded_signature)
    if len(raw_signature) != 64:
        raise PluginManifestError("La firma Ed25519 del plugin debe tener 64 bytes")
    configured = _configured_plugin_public_keys()
    if not configured:
        raise PluginManifestError("No hay keyring publico de plugins Treseko configurado")
    key_known = False
    payload = canonical_plugin_manifest_payload(manifest)
    for configured_key in configured:
        public_key = _load_public_key(configured_key)
        if _key_id(public_key) != key_id:
            continue
        key_known = True
        try:
            public_key.verify(raw_signature, payload)
            return
        except InvalidSignature as exc:
            raise PluginManifestError("La firma del manifest del plugin no es valida") from exc
    if not key_known:
        raise PluginManifestError("El key_id del plugin no existe en el keyring publico de Treseko")


def _version_tuple(value: str) -> tuple[int, int, int]:
    match = re.match(r"^(\d+)\.(\d+)(?:\.(\d+))?", str(value or ""))
    if not match:
        raise PluginManifestError("La compatibilidad del plugin usa una version Treseko invalida")
    return int(match.group(1)), int(match.group(2)), int(match.group(3) or 0)


def _version_is_compatible(current: str, lower: str, upper: str) -> bool:
    current_value = _version_tuple(current)
    if current_value < _version_tuple(lower):
        return False
    upper_value = str(upper or "").strip()
    if upper_value.endswith(".x"):
        return current_value[0] == int(upper_value.split(".", 1)[0])
    return current_value <= _version_tuple(upper_value)


def _validate_network_hosts(network: Any) -> list[str]:
    if not isinstance(network, dict):
        raise PluginManifestError("network debe ser un objeto")
    hosts = network.get("allowed_hosts") or []
    if not isinstance(hosts, list) or any(not isinstance(host, str) for host in hosts):
        raise PluginManifestError("allowed_hosts debe ser una lista de hosts")
    normalized = [host.strip().lower() for host in hosts if host.strip()]
    if len(normalized) != len(set(normalized)):
        raise PluginManifestError("allowed_hosts no puede contener hosts duplicados")
    for host in normalized:
        if "/" in host or ":" in host or any(pattern.match(host) for pattern in PRIVATE_HOST_PATTERNS):
            raise PluginManifestError("El plugin no puede autorizar hosts privados o locales")
    return normalized


def validate_plugin_manifest(manifest: dict[str, Any], *, verify_signature: bool = True) -> dict[str, Any]:
    """Validate a manifest without performing I/O or executing plugin code."""
    if not isinstance(manifest, dict):
        raise PluginManifestError("El manifest del plugin debe ser un objeto JSON")
    if manifest.get("schema_version") != PLUGIN_MANIFEST_SCHEMA:
        raise PluginManifestError("La version de contrato del plugin no es compatible")
    plugin_id = str(manifest.get("plugin_id") or "").strip()
    release_id = str(manifest.get("release_id") or "").strip()
    kind = str(manifest.get("kind") or "").strip()
    entrypoint = str(manifest.get("entrypoint") or "").strip()
    if not re.fullmatch(r"[a-z0-9]+(?:[._-][a-z0-9]+)+", plugin_id):
        raise PluginManifestError("plugin_id debe ser un identificador estable con namespace")
    if not release_id or not str(manifest.get("version") or "").strip():
        raise PluginManifestError("release_id y version son obligatorios")
    if kind not in ALLOWED_PLUGIN_KINDS:
        raise PluginManifestError("El tipo de plugin no esta permitido")
    if kind == "declarative" and entrypoint not in ALLOWED_DECLARATIVE_ENTRYPOINTS:
        raise PluginManifestError("El entrypoint declarativo del plugin no esta permitido")
    artifact = manifest.get("artifact")
    if not isinstance(artifact, dict):
        raise PluginManifestError("artifact debe ser un objeto")
    uri = str(artifact.get("uri") or "").strip()
    checksum = str(artifact.get("sha256") or "").strip().lower()
    try:
        size = int(artifact.get("size_bytes"))
    except (TypeError, ValueError) as exc:
        raise PluginManifestError("artifact.size_bytes debe ser un entero positivo") from exc
    if not uri.startswith("treseko-plugin://"):
        raise PluginManifestError("El artefacto debe usar una referencia opaca treseko-plugin://")
    if not re.fullmatch(r"[a-f0-9]{64}", checksum) or size <= 0:
        raise PluginManifestError("El artefacto debe incluir SHA-256 y tamaño positivo")
    compatibility = manifest.get("compatibility")
    if not isinstance(compatibility, dict) or not compatibility.get("api_version"):
        raise PluginManifestError("El plugin debe declarar compatibilidad con Treseko")
    if not _version_is_compatible(PRODUCT_VERSION, str(compatibility.get("treseko_min") or ""), str(compatibility.get("treseko_max") or "")):
        raise PluginManifestError("El plugin no es compatible con esta version de Treseko")
    permissions = manifest.get("permissions") or []
    if not isinstance(permissions, list) or any(not isinstance(item, str) or not item.strip() for item in permissions):
        raise PluginManifestError("permissions debe ser una lista de permisos no vacios")
    unknown_permissions = {item.strip() for item in permissions} - ALLOWED_PLUGIN_PERMISSIONS
    if unknown_permissions:
        raise PluginManifestError("El plugin solicita permisos fuera de la allowlist v1")
    hosts = _validate_network_hosts(manifest.get("network"))
    if kind == "declarative" and hosts:
        raise PluginManifestError("Los plugins declarativos v1 no pueden usar red directa")
    if verify_signature:
        verify_plugin_manifest_signature(manifest)
    return {
        "plugin_id": plugin_id,
        "release_id": release_id,
        "kind": kind,
        "entrypoint": entrypoint,
        "checksum_sha256": checksum,
        "size_bytes": size,
        "allowed_hosts": hosts,
        "permissions": sorted(set(permissions)),
        "manifest": manifest,
    }

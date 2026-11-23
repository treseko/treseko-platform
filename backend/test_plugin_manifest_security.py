import base64
import copy
import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from app.services.plugins import manifest as plugin_manifest  # noqa: E402


def _signed_manifest(monkeypatch):
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    public_raw = public_key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    key_id = plugin_manifest._key_id(public_key)
    monkeypatch.setenv(plugin_manifest.PLUGIN_DEV_PUBLIC_KEY_OVERRIDE_ENV, "true")
    monkeypatch.setenv(plugin_manifest.PLUGIN_PUBLIC_KEY_ENV, base64.urlsafe_b64encode(public_raw).decode().rstrip("="))
    manifest = {
        "schema_version": plugin_manifest.PLUGIN_MANIFEST_SCHEMA,
        "plugin_id": "com.treseko.junit-importer",
        "name": "Importador JUnit/XML",
        "publisher": "Treseko",
        "version": "1.0.0",
        "release_id": str(uuid4()),
        "kind": "declarative",
        "entrypoint": "junit_xml.import_results",
        "artifact": {
            "uri": "treseko-plugin://release/junit-importer-1",
            "sha256": "a" * 64,
            "size_bytes": 123,
        },
        "compatibility": {"treseko_min": "1.0.0", "treseko_max": "1.x", "api_version": "v1"},
        "permissions": ["runs.write"],
        "network": {"allowed_hosts": []},
        "configuration_schema": {},
        "secret_schema": {},
        "license": {"required_features": []},
        "signature": {"algorithm": "ed25519", "key_id": key_id, "value": ""},
    }
    manifest["signature"]["value"] = base64.urlsafe_b64encode(
        private_key.sign(plugin_manifest.canonical_plugin_manifest_payload(manifest))
    ).decode().rstrip("=")
    return manifest


def test_signed_declarative_plugin_manifest_is_accepted(monkeypatch):
    result = plugin_manifest.validate_plugin_manifest(_signed_manifest(monkeypatch))
    assert result["plugin_id"] == "com.treseko.junit-importer"
    assert result["kind"] == "declarative"


def test_tampered_plugin_manifest_is_rejected(monkeypatch):
    manifest = _signed_manifest(monkeypatch)
    manifest["artifact"]["sha256"] = "b" * 64
    with pytest.raises(plugin_manifest.PluginManifestError, match="firma"):
        plugin_manifest.validate_plugin_manifest(manifest)


def test_unknown_key_and_private_network_are_rejected(monkeypatch):
    manifest = _signed_manifest(monkeypatch)
    unknown = copy.deepcopy(manifest)
    unknown["signature"]["key_id"] = "ed25519:sha256:unknown"
    with pytest.raises(plugin_manifest.PluginManifestError, match="key_id"):
        plugin_manifest.validate_plugin_manifest(unknown)

    private_network = _signed_manifest(monkeypatch)
    private_network["network"]["allowed_hosts"] = ["127.0.0.1"]
    with pytest.raises(plugin_manifest.PluginManifestError, match="privados"):
        plugin_manifest.validate_plugin_manifest(private_network, verify_signature=False)


def test_permission_outside_broker_allowlist_is_rejected(monkeypatch):
    manifest = _signed_manifest(monkeypatch)
    manifest["permissions"] = ["filesystem.read"]
    with pytest.raises(plugin_manifest.PluginManifestError, match="allowlist"):
        plugin_manifest.validate_plugin_manifest(manifest, verify_signature=False)

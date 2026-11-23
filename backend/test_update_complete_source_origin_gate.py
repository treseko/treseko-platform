from __future__ import annotations

import pytest

from app.services.edition.update_manager import UpdateManifestError, validate_update_manifest
from app.services.updater import UpdateService
from app.version import PRODUCT_VERSION


def _manifest(**overrides):
    value = {
        "channel": "community-stable",
        "edition": "community",
        "version": "1.0.8",
        "artifact": "treseko-update-v1.0.8.tar.gz",
        "artifact_type": "tar.gz",
        "package_url": "https://updates.example.invalid/treseko-update-v1.0.8.tar.gz",
        "checksum_sha256": "a" * 64,
        "package_size_bytes": 1024,
        "deployment": {
            "mode": "complete-source",
            "path": "source-release",
            "compose_file": "docker-compose.prod.yml",
            "activation": "atomic-compose",
        },
    }
    value.update(overrides)
    return value


def test_update_catalog_rejects_complete_source_without_origin_chain():
    with pytest.raises(UpdateManifestError, match="from_versions"):
        validate_update_manifest(_manifest(from_versions=[]), {"edition": "community"})


def test_direct_apply_rejects_complete_source_without_origin_chain():
    with pytest.raises(ValueError, match="from_versions"):
        UpdateService._normalize_manifest(object(), _manifest(from_versions=[]))


def test_legacy_component_manifest_without_deployment_keeps_compatibility():
    manifest = _manifest(from_versions=[])
    manifest.pop("deployment")
    assert validate_update_manifest(manifest, {"edition": "community"})["allowed"] is True
    assert UpdateService._normalize_manifest(object(), manifest)["version"] == "1.0.8"


def test_complete_source_with_declared_current_origin_is_accepted():
    manifest = _manifest(from_versions=[PRODUCT_VERSION])
    assert validate_update_manifest(manifest, {"edition": "community"})["allowed"] is True
    assert UpdateService._normalize_manifest(object(), manifest)["from_versions"] == [PRODUCT_VERSION]

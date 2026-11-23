from __future__ import annotations

import asyncio
import hashlib
import io
import json
import shutil
import tarfile
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException, Response

from app.api.router import api_router
from app.api.routers import system_update_downloads as router


MANIFEST = {
    "edition": "premium",
    "key_id": "qa-key",
    "channel": "premium-stable",
    "version": "1.0.8",
    "artifact": "treseko-update-v1.0.8.tar.gz",
    "package_url": "treseko-update://premium-stable/1.0.8/treseko-update-v1.0.8.tar.gz",
    "checksum_sha256": "a" * 64,
    "signature": "ed25519:qa",
}


def test_download_and_component_update_routers_are_registered_together():
    def included_paths(router, visited=None):
        visited = visited or set()
        if id(router) in visited:
            return set()
        visited.add(id(router))
        paths = set()
        for route in router.routes:
            path = getattr(route, "path", None)
            if path:
                paths.add(path)
            nested = getattr(route, "original_router", None)
            if nested is not None:
                paths.update(included_paths(nested, visited))
        return paths

    paths = included_paths(api_router)
    assert "/system/updates/download-package" in paths
    assert "/engine-updates/me/status" in paths
    assert "/engine-updates/me/package" in paths


def _install_dependencies(monkeypatch, *, edition="premium"):
    calls = {}
    state = {"edition": "premium", "state": "active", "update_channel": "premium-stable",
             "enabled_features": ["updates.premium"]}

    class Provider:
        async def get_state(self, _db):
            return state

    async def grant(_manifest, _state, *, current_version):
        calls["current_version"] = current_version
        return {
            "package_url": "https://updates.treseko.com/api/updates/download/short-lived-token",
            "expires_at": "2026-11-19T19:00:00Z",
            "manifest": {"artifact": "treseko-update-v1.0.8.tar.gz"},
            "grant_token": "must-not-be-returned",
            "license": {"activation_token": "must-not-be-returned"},
        }

    monkeypatch.setattr(router, "get_entitlement_provider", lambda: Provider())
    monkeypatch.setattr(router, "validate_update_manifest", lambda _manifest, _state: {
        "allowed": True,
        "edition": edition,
        "version": "1.0.8",
        "artifact": "treseko-update-v1.0.8.tar.gz",
        "package_size_bytes": 1234,
        "checksum_sha256": "a" * 64,
    })
    monkeypatch.setattr(router, "request_premium_download_grant", grant)
    monkeypatch.setattr(router, "PRODUCT_VERSION", "1.0.7")
    return calls


def test_package_download_returns_only_temporary_url_and_public_metadata(monkeypatch):
    calls = _install_dependencies(monkeypatch)
    payload = router.schemas.SystemUpdateDownloadGrantPrepareRequest(manifest=MANIFEST)
    response = Response()
    result = asyncio.run(router.create_system_update_package_download(
        payload, response, db=object(), current_user=SimpleNamespace(id="qa-user")
    ))

    assert result == {
        "download_url": "https://updates.treseko.com/api/updates/download/short-lived-token",
        "expires_at": "2026-11-19T19:00:00Z",
        "version": "1.0.8",
        "artifact": "treseko-update-v1.0.8.tar.gz",
        "package_size_bytes": 1234,
        "checksum_sha256": "a" * 64,
    }
    assert response.headers["Cache-Control"] == "no-store, max-age=0"
    assert response.headers["Pragma"] == "no-cache"
    assert calls["current_version"] == "1.0.7"
    assert "license" not in result and "grant_token" not in result


def test_package_download_rejects_community_manifest_before_requesting_grant(monkeypatch):
    calls = _install_dependencies(monkeypatch, edition="community")
    payload = router.schemas.SystemUpdateDownloadGrantPrepareRequest(manifest=MANIFEST)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(router.create_system_update_package_download(
            payload, Response(), db=object(), current_user=SimpleNamespace(id="qa-user")
        ))
    assert caught.value.status_code == 400
    assert calls == {}


def test_migration_bundle_contains_one_verified_ota_and_its_signed_manifest(monkeypatch):
    package = b"complete-source OTA payload"
    manifest = {
        **MANIFEST,
        "from_versions": ["1.0.7"],
        "deployment": {"mode": "complete-source", "path": "source-release"},
        "host_bridge_bootstrap_verified": True,
        "bootstrap_protocol": "treseko-host-update-coordinator/v1",
        "package_size_bytes": len(package),
        "checksum_sha256": hashlib.sha256(package).hexdigest(),
    }
    calls = _install_dependencies(monkeypatch)
    monkeypatch.setattr(router, "validate_update_manifest", lambda *_: {
        "allowed": True, "edition": "premium", "version": "1.0.8",
        "artifact": manifest["artifact"], "package_size_bytes": len(package),
        "checksum_sha256": hashlib.sha256(package).hexdigest(),
    })
    calls.clear()
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=package))
    real_client = httpx.AsyncClient
    monkeypatch.setattr(router.httpx, "AsyncClient", lambda **kwargs:
                        real_client(transport=transport, **kwargs))

    payload = router.schemas.SystemUpdateDownloadGrantPrepareRequest(manifest=manifest)
    result = asyncio.run(router.download_system_update_migration_bundle(
        payload, db=object(), current_user=SimpleNamespace(id="qa-user")
    ))

    assert result.filename == "treseko-update-v1.0.8-single-file.tar"
    with tarfile.open(result.path, "r:") as bundle:
        assert set(bundle.getnames()) == {"manifest.json", manifest["artifact"]}
        embedded_manifest = json.load(bundle.extractfile("manifest.json"))
        assert embedded_manifest == manifest
        assert bundle.extractfile(manifest["artifact"]).read() == package
    shutil.rmtree(Path(result.path).parent, ignore_errors=True)


def test_migration_bundle_rejects_manifest_without_supported_bootstrap_protocol(monkeypatch):
    manifest = {
        **MANIFEST,
        "from_versions": ["1.0.7"],
        "deployment": {"mode": "complete-source", "path": "source-release"},
        "host_bridge_bootstrap_verified": True,
        "bootstrap_protocol": None,
    }
    calls = _install_dependencies(monkeypatch)
    payload = router.schemas.SystemUpdateDownloadGrantPrepareRequest(manifest=manifest)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(router.download_system_update_migration_bundle(
            payload, db=object(), current_user=SimpleNamespace(id="qa-user")
        ))

    assert caught.value.status_code == 409
    assert caught.value.detail == "El paquete no declara un bootstrap host-side verificado."
    assert calls == {}


def test_migration_bundle_rejects_corrupted_download(monkeypatch):
    package = b"tampered OTA"
    manifest = {
        **MANIFEST,
        "from_versions": ["1.0.7"],
        "deployment": {"mode": "complete-source", "path": "source-release"},
        "host_bridge_bootstrap_verified": True,
        "bootstrap_protocol": "treseko-host-update-coordinator/v1",
        "package_size_bytes": len(package),
        "checksum_sha256": "a" * 64,
    }
    _install_dependencies(monkeypatch)
    monkeypatch.setattr(router, "validate_update_manifest", lambda *_: {
        "allowed": True, "edition": "premium", "version": "1.0.8",
        "artifact": manifest["artifact"], "package_size_bytes": len(package),
        "checksum_sha256": "a" * 64,
    })
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=package))
    real_client = httpx.AsyncClient
    monkeypatch.setattr(router.httpx, "AsyncClient", lambda **kwargs:
                        real_client(transport=transport, **kwargs))
    payload = router.schemas.SystemUpdateDownloadGrantPrepareRequest(manifest=manifest)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(router.download_system_update_migration_bundle(
            payload, db=object(), current_user=SimpleNamespace(id="qa-user")
        ))
    assert caught.value.status_code == 422
    assert caught.value.detail == "package_checksum_mismatch"

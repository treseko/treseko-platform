"""Hermetic HTTP lifecycle for the official plugin-store administration API."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.routers import extensions as extensions_router
from app.database import engine
from app.main import app
from test_api_project_http_flow import _create_admin, _login


async def _catalog_fixture():
    return [{
        "release_id": "junit-importer-v1",
        "plugin_id": "com.treseko.junit-importer",
        "name": "JUnit XML Importer",
        "status": "published",
    }]


async def _pair_fixture(_db):
    return {"installation_id": "installation-controlled", "paired": True}


async def _status_fixture(_db):
    return {"paired": True, "installation_id": "installation-controlled"}


def test_admin_can_inspect_and_pair_the_official_plugin_store(monkeypatch):
    """Only the network adapter is substituted; HTTP authorization stays real."""
    monkeypatch.setenv("TRESEKO_PLUGIN_STORE_ENABLED", "true")
    monkeypatch.setattr(extensions_router, "fetch_official_catalog", _catalog_fixture)
    monkeypatch.setattr(extensions_router, "pair_installation", _pair_fixture)
    monkeypatch.setattr(extensions_router, "pairing_status", _status_fixture)

    async def fake_download(_db, *, release_id, enabled_features):
        assert release_id == "junit-importer-v1"
        return {
            "plugin_id": "com.treseko.junit-importer",
            "release_id": release_id,
            "version": "1.0.0",
        }, b"controlled-artifact"

    async def fake_install(db, *, manifest, artifact_b64, user, organizacion_id, proyecto_id):
        instance = extensions_router.models.IntegrationInstance(
            provider_id="com.treseko.junit-importer",
            scope_key="global",
            enabled=True,
            status="installed",
            config_json={"_treseko_store": {"manifest": manifest, "artifact_b64": artifact_b64}},
            secrets_configured={},
            organizacion_id=organizacion_id,
            proyecto_id=proyecto_id,
            created_by=user.id,
        )
        db.add(instance)
        await db.commit()
        await db.refresh(instance)
        return instance

    async def fake_invoke():
        return {"invocation_id": "controlled-junit-invocation"}

    monkeypatch.setattr(extensions_router, "download_paired_release", fake_download)
    monkeypatch.setattr(extensions_router, "install_official_plugin", fake_install)
    monkeypatch.setattr(extensions_router, "invoke_declarative_junit", fake_invoke)
    email = f"plugin-store-{uuid4().hex}@example.test"
    password = "PluginStorePassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        catalog = client.get("/plugins/store/catalog", headers=headers)
        assert catalog.status_code == 200, catalog.text
        assert catalog.json()["items"][0]["release_id"] == "junit-importer-v1"

        initial_connection = client.get("/plugins/store/connection", headers=headers)
        assert initial_connection.status_code == 200, initial_connection.text
        assert initial_connection.json()["paired"] is True

        paired = client.post("/plugins/store/register", headers=headers)
        assert paired.status_code == 200, paired.text
        assert paired.json()["installation_id"] == "installation-controlled"
        installed = client.post(
            "/plugins/store/releases/junit-importer-v1/install",
            headers=headers,
            json={},
        )
        assert installed.status_code == 200, installed.text
        instance_id = installed.json()["id"]
        invoked = client.post(f"/plugins/store/{instance_id}/invoke", headers=headers)
        assert invoked.status_code == 200, invoked.text
        assert invoked.json()["invocation_id"] == "controlled-junit-invocation"
        audit = client.get(f"/plugins/store/{instance_id}/audit", headers=headers)
        assert audit.status_code == 200, audit.text
        assert any(item["accion"] == "plugin.invoked" for item in audit.json())
        removed = client.delete(f"/plugins/store/{instance_id}", headers=headers)
        assert removed.status_code == 204, removed.text
        client.portal.call(engine.dispose)


def test_official_store_is_disabled_without_network_calls_by_default(monkeypatch):
    monkeypatch.setenv("TRESEKO_PLUGIN_STORE_ENABLED", "false")

    async def unexpected_network_call():
        raise AssertionError("disabled store must not make an upstream request")

    monkeypatch.setattr(extensions_router, "fetch_official_catalog", unexpected_network_call)
    email = f"plugin-store-disabled-{uuid4().hex}@example.test"
    password = "PluginStoreDisabled-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        catalog = client.get("/plugins/store/catalog", headers=headers)
        assert catalog.status_code == 200, catalog.text
        assert catalog.json() == {"available": False, "items": []}

        register = client.post("/plugins/store/register", headers=headers)
        assert register.status_code == 404, register.text
        client.portal.call(engine.dispose)

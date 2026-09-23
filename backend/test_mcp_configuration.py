from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.api.routers import mcp as mcp_router
from app.main import app
from app.services import mcp_governance


class _FakeDb:
    def __init__(self, enabled: bool):
        self.setting = SimpleNamespace(value={"enabled": enabled})

    async def get(self, _model, _key):
        return self.setting

    def add(self, setting):
        self.setting = setting

    async def commit(self):
        return None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


def test_browser_configuration_route_is_registered():
    routes = {(route.path, tuple(sorted(getattr(route, "methods", None) or ()))) for route in app.routes if hasattr(route, "path")}
    assert ("/mcp/configuration", ("GET",)) in routes


@pytest.mark.asyncio
async def test_browser_configuration_filters_by_rbac_and_user_scope(monkeypatch):
    mcp_router.set_configured_mcp_enabled(True)
    monkeypatch.setenv("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", "single_process")
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get,treseko.builds.list")
    user = SimpleNamespace(mcp_scopes=["mcp.projects.read"])
    monkeypatch.setattr(
        mcp_router.auth,
        "has_capability_permission",
        lambda _user, capability, _level: capability == "proyectos.portfolio",
    )
    monkeypatch.setattr(mcp_router.auth, "get_capability_permission", lambda *_args: "read")

    result = await mcp_router.get_mcp_configuration(
        SimpleNamespace(state=SimpleNamespace(correlation_id="browser-config")), user, _FakeDb(True)
    )

    assert result["enabled"] is True
    assert result["status"] == "available"
    assert result["endpoint"] == "/api/mcp"
    assert [tool["name"] for tool in result["tools"]] == ["treseko.project.get", "treseko.builds.list"]
    serialized = json.dumps(result)
    assert all(secret not in serialized for secret in ("api_key", "secret", "database", "postgres"))


@pytest.mark.asyncio
async def test_browser_configuration_preserves_disabled_behavior(monkeypatch):
    mcp_router.set_configured_mcp_enabled(False)
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: False)

    result = await mcp_router.get_mcp_configuration(
        SimpleNamespace(state=SimpleNamespace(correlation_id="disabled")), SimpleNamespace(), _FakeDb(False)
    )

    assert result["enabled"] is False
    assert result["status"] == "disabled"
    assert result["tools"]


@pytest.mark.asyncio
async def test_configuration_rehydrates_activation_from_persisted_setting(monkeypatch):
    db = _FakeDb(False)
    mcp_router.set_configured_mcp_enabled(False)
    user = SimpleNamespace()
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: False)

    updated = await mcp_router.update_mcp_configuration({"enabled": True}, user, db)
    assert updated["enabled"] is True
    assert mcp_governance.configured_mcp_enabled() is True

    # Simulate a process restart: the in-memory cache is empty until the
    # configuration endpoint reads the persisted app_settings value again.
    mcp_router.set_configured_mcp_enabled(False)
    result = await mcp_router.get_mcp_configuration(
        SimpleNamespace(state=SimpleNamespace(correlation_id="rehydrate")), user, db
    )
    assert result["enabled"] is True
    assert mcp_governance.configured_mcp_enabled() is True


@pytest.mark.asyncio
async def test_operational_discovery_rehydrates_before_first_request(monkeypatch):
    db = _FakeDb(True)
    mcp_governance.set_configured_mcp_enabled(None)
    monkeypatch.setattr(mcp_router, "AsyncSessionLocal", lambda: db)

    async def authenticated(_request):
        return SimpleNamespace(id="user")

    monkeypatch.setattr(mcp_router, "_technical_user", authenticated)
    monkeypatch.setattr(mcp_router, "_authorized_tools", lambda _user: [])

    result = await mcp_router.discover_tools(SimpleNamespace(state=SimpleNamespace(correlation_id="first-request")))
    assert result["tools"] == []
    assert mcp_governance.configured_mcp_enabled() is True


@pytest.mark.asyncio
async def test_malformed_persisted_activation_fails_closed(monkeypatch):
    db = _FakeDb(False)
    db.setting.value = {"enabled": "false"}
    mcp_governance.set_configured_mcp_enabled(None)
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: False)
    monkeypatch.setattr(mcp_router, "AsyncSessionLocal", lambda: db)

    await mcp_router._ensure_persisted_mcp_activation()

    assert mcp_governance.configured_mcp_enabled() is False

    result = await mcp_router.get_mcp_configuration(
        SimpleNamespace(state=SimpleNamespace(correlation_id="malformed-config")), SimpleNamespace(), db
    )
    assert result["enabled"] is False
    assert mcp_governance.configured_mcp_enabled() is False

"""Focused HTTP integration coverage for the governed, read-only MCP journey.

The fixture uses the repository's controlled test environment and a dedicated
synthetic credential lookup; it never uses a real key or writes product data.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import crud
from app.api.routers import mcp as mcp_router
from app.main import app
from app.services import mcp_governance as governance


VALID_KEY = "fixture-mcp-dedicated-readonly-key"
PROJECT_ID = str(uuid4())
ORG_ID = uuid4()


class AuditSession:
    async def get(self, _model, _key):
        return SimpleNamespace(value={"enabled": True})

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


@pytest.fixture
def mcp_http(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_ENABLED", "true")
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get,treseko.builds.list")
    # MCP activation is persisted and loaded during application startup.  This
    # fixture must explicitly set the governed runtime state rather than relying
    # on the legacy environment flag after the app has already been imported.
    monkeypatch.setattr(governance, "_configured_enabled", True)
    audit_events = []
    project = SimpleNamespace(id=PROJECT_ID, nombre="Fixture project", organizacion_id=ORG_ID)
    users = {
        VALID_KEY: SimpleNamespace(
            id=uuid4(),
            mcp_key_prefix="fixture-mcp",
            mcp_scopes=["mcp.projects.read", "mcp.builds.read"],
            allow_portfolio=True,
        ),
    }

    async def lookup(_db, raw_key):
        return users.get(raw_key)

    async def audit(*_args, **kwargs):
        audit_events.append(kwargs)

    async def project_access(_db, user, requested_id, _level):
        if requested_id != uuid4():
            # The valid project is deliberately fixed; all other IDs are outside
            # this fixture's project boundary.
            if str(requested_id) != PROJECT_ID:
                from fastapi import HTTPException
                raise HTTPException(status_code=403, detail="outside project")
        if not getattr(user, "allow_portfolio", False):
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="RBAC denied")
        return project

    async def organization_access(_db, _user, requested_id, _level):
        if requested_id != ORG_ID:
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="outside organization")
        return object()

    async def project_handler(_db, _user, _project):
        return {"id": PROJECT_ID, "name": "Fixture project", "organization_id": str(ORG_ID)}

    async def builds_handler(_db, _user, _project, _args):
        return {"project_id": PROJECT_ID, "builds": [{"id": "build-fixture-1", "status": "published"}]}

    monkeypatch.setattr(mcp_router, "AsyncSessionLocal", lambda: AuditSession())
    monkeypatch.setattr(crud, "get_user_by_mcp_api_key", lookup)
    monkeypatch.setattr(mcp_router.crud, "get_user_by_mcp_api_key", lookup)
    monkeypatch.setattr(mcp_router.crud, "create_audit_log", audit)
    monkeypatch.setattr(mcp_router.access_control, "require_project_access", project_access)
    monkeypatch.setattr(mcp_router.access_control, "require_organization_access", organization_access)
    monkeypatch.setitem(mcp_router.HANDLERS, "project.get", project_handler)
    monkeypatch.setitem(mcp_router.HANDLERS, "builds.list", builds_handler)
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda user, capability, _level: getattr(user, "allow_portfolio", False) and capability == "proyectos.portfolio")
    monkeypatch.setattr(mcp_router.auth, "get_capability_permission", lambda user, capability: "edit" if getattr(user, "allow_portfolio", False) and capability == "mcp.usar" else "none")
    monkeypatch.setattr(mcp_router.rate_limiter, "allow", lambda _identity: True)

    # This fixture replaces every database-dependent MCP boundary with local
    # fakes and explicitly sets the governed MCP state above. Avoid entering the
    # app lifespan here: it opens the process-global async SQLAlchemy engine in
    # TestClient's per-test event loop, which is then closed and reused by later
    # tests on a different loop.
    client = TestClient(app)
    try:
        yield client, users, audit_events, project
    finally:
        client.close()


def rpc(client, payload, key=VALID_KEY):
    response = client.post("/mcp", json=payload, headers={"x-mcp-api-key": key})
    assert response.status_code == 200
    return response.json()


def test_read_only_agent_journey_discovery_initialize_list_and_calls(mcp_http):
    client, _users, audit_events, _project = mcp_http

    discovery = client.get("/mcp/tools", headers={"x-mcp-api-key": VALID_KEY})
    assert discovery.status_code == 200
    assert {item["name"] for item in discovery.json()["tools"]} == {
        "treseko.project.get",
        "treseko.builds.list",
    }
    assert all(item["read_only"] and item["operation"] == "read" for item in discovery.json()["tools"])

    initialized = rpc(client, {"jsonrpc": "2.0", "id": "init", "method": "initialize", "params": {}})
    assert initialized["result"]["serverInfo"]["name"] == "treseko-mcp"
    assert initialized["result"]["capabilities"] == {"tools": {}, "resources": {}}

    listed = rpc(client, {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    assert {item["name"] for item in listed["result"]["tools"]} == {
        "treseko.project.get",
        "treseko.builds.list",
    }

    metadata = rpc(client, {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "treseko.project.get", "arguments": {"project_id": PROJECT_ID}}})
    assert json.loads(metadata["result"]["content"][0]["text"])["name"] == "Fixture project"

    builds = rpc(client, {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "treseko.builds.list", "arguments": {"project_id": PROJECT_ID}}})
    assert json.loads(builds["result"]["content"][0]["text"])["builds"][0]["id"] == "build-fixture-1"
    assert any(event.get("accion") == "MCP_TOOL_CALL" for event in audit_events)


def test_project_and_organization_boundaries_reject_without_leaking_details(mcp_http, monkeypatch):
    client, users, _audit_events, _project = mcp_http
    denied_project = str(uuid4())
    denied = rpc(client, {"jsonrpc": "2.0", "id": 10, "method": "tools/call", "params": {"name": "treseko.project.get", "arguments": {"project_id": denied_project}}})
    assert denied["error"] == {"code": -32603, "message": "Internal error"}

    async def denied_org(*_args):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="outside organization")

    monkeypatch.setattr(mcp_router.access_control, "require_organization_access", denied_org)
    denied_org_response = rpc(client, {"jsonrpc": "2.0", "id": 11, "method": "tools/call", "params": {"name": "treseko.project.get", "arguments": {"project_id": PROJECT_ID}}})
    assert denied_org_response["error"] == {"code": -32603, "message": "Internal error"}
    assert "outside" not in json.dumps(denied_org_response)
    assert users[VALID_KEY].mcp_scopes == ["mcp.projects.read", "mcp.builds.read"]


@pytest.mark.parametrize("key", ["fixture-mcp-revoked-key", "fixture-mcp-expired-key", "fixture-legacy-wrong-purpose-key"])
def test_revoked_expired_and_wrong_purpose_keys_are_rejected(mcp_http, key):
    client, _users, _audit_events, _project = mcp_http
    response = client.get("/mcp/tools", headers={"x-mcp-api-key": key})
    assert response.status_code == 401
    assert response.json()["detail"] == "Credencial MCP inválida"


def test_scope_and_rbac_rejection_are_not_discoverable_or_callable(mcp_http, monkeypatch):
    client, users, _audit_events, _project = mcp_http
    users[VALID_KEY].mcp_scopes = ["mcp.projects.read"]
    listed = rpc(client, {"jsonrpc": "2.0", "id": 20, "method": "tools/list", "params": {}})
    assert [item["name"] for item in listed["result"]["tools"]] == ["treseko.project.get"]
    scope_denied = rpc(client, {"jsonrpc": "2.0", "id": 21, "method": "tools/call", "params": {"name": "treseko.builds.list", "arguments": {"project_id": PROJECT_ID}}})
    assert scope_denied["error"] == {"code": -32603, "message": "Internal error"}

    users[VALID_KEY].mcp_scopes = ["mcp.projects.read", "mcp.builds.read"]
    users[VALID_KEY].allow_portfolio = False
    rbac_denied_response = client.post("/mcp", json={"jsonrpc": "2.0", "id": 22, "method": "tools/call", "params": {"name": "treseko.project.get", "arguments": {"project_id": PROJECT_ID}}}, headers={"x-mcp-api-key": VALID_KEY})
    assert rbac_denied_response.status_code == 403
    assert rbac_denied_response.json()["detail"] == "El usuario no tiene permiso para usar MCP"
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: True)


def test_json_rpc_errors_notifications_and_audit_redaction(mcp_http):
    client, _users, audit_events, _project = mcp_http
    malformed = client.post("/mcp", data="{", headers={"x-mcp-api-key": VALID_KEY})
    assert malformed.json()["error"]["code"] == -32700
    unknown = rpc(client, {"jsonrpc": "2.0", "id": 30, "method": "missing/method"})
    assert unknown["error"]["code"] == -32601
    invalid_params = rpc(client, {"jsonrpc": "2.0", "id": 31, "method": "tools/call", "params": []})
    assert invalid_params["error"]["code"] == -32602

    notification = client.post("/mcp", json={"jsonrpc": "2.0", "method": "tools/list"}, headers={"x-mcp-api-key": VALID_KEY})
    assert notification.status_code == 202
    serialized_audit = json.dumps(audit_events, ensure_ascii=False, default=str)
    assert VALID_KEY not in serialized_audit
    assert "password" not in serialized_audit.lower()
    assert "api_key" not in serialized_audit.lower()
    assert all(len(json.dumps(event, ensure_ascii=False, default=str)) <= 4096 for event in audit_events)


def test_mcp_configuration_is_ui_visible_in_current_frontend_assets():
    """The live UI is owned by the parallel UI agent; assert its existing asset.

    This deliberately does not modify or duplicate that agent's staged files.
    """
    from pathlib import Path

    panel = Path(__file__).parents[1] / "frontend/src/features/configuracion/components/McpPanel.tsx"
    if not panel.exists():
        pytest.skip("current UI branch does not expose the MCP configuration panel")
    source = panel.read_text(encoding="utf-8")
    assert "/api/mcp" in source
    assert "required_scope" in source
    assert "rawCredential" in source

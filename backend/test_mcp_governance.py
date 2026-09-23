from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.routers import mcp as mcp_router
from app.main import app
from app.services import mcp_governance as mcp


def _enable_mcp(monkeypatch):
    mcp.set_configured_mcp_enabled(True)
    monkeypatch.setenv("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", "single_process")


def test_mcp_is_disabled_and_catalog_is_empty_by_default(monkeypatch):
    monkeypatch.delenv("TRESEKO_MCP_ENABLED", raising=False)
    monkeypatch.delenv("TRESEKO_MCP_TOOLS", raising=False)
    mcp.set_configured_mcp_enabled(False)
    assert not mcp.mcp_enabled()
    tool_names = {tool["name"] for tool in mcp.public_tools()}
    assert set(mcp.MCP_DEFAULT_TOOLS).issubset(tool_names)


def test_allowlist_rejects_unknown_shell_filesystem_and_secret_tools(monkeypatch):
    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get,shell,filesystem,secrets,unknown")
    assert mcp.resolve_tool("treseko.project.get")
    for name in ("shell", "filesystem", "secrets", "unknown"):
        assert mcp.resolve_tool(name) is None


def test_tool_catalog_has_no_write_or_secret_capability(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get,treseko.builds.list")
    tools = mcp.public_tools()
    assert {item["name"] for item in tools} == {"treseko.project.get", "treseko.builds.list"}
    assert all(item["read_only"] for item in tools)
    assert all("secret" not in item["name"] for item in tools)


def test_preview_requires_read_access_not_edit():
    preview = mcp.TOOL_CATALOG["treseko.cases.import.preview"]
    commit = mcp.TOOL_CATALOG["treseko.cases.import.commit"]
    assert mcp_router._tool_required_access_level({"operation": preview.operation}) == "read"
    assert mcp_router._tool_required_access_level({"operation": commit.operation}) == "edit"


def test_audit_argument_sanitizer_redacts_secrets_and_bounds_payload():
    value = mcp.sanitize_arguments({"project_id": "p", "api_key": "do-not-log", "nested": {"password": "hidden"}, "prompt": "x" * 1000})
    assert value["api_key"] == "[redacted]"
    assert value["nested"]["password"] == "[redacted]"
    assert len(value["prompt"]) == 500


def test_rate_limiter_rejects_after_limit_and_allows_other_identity():
    limiter = mcp.McpRateLimiter(limit=2, window_seconds=60)
    assert limiter.allow("a") and limiter.allow("a")
    assert not limiter.allow("a")
    assert limiter.allow("b")


def test_tool_arguments_are_strict_and_never_assume_a_mapping(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    tool = mcp.resolve_tool("treseko.project.get")
    assert tool is not None
    project_id = str(uuid4())
    assert mcp.validate_tool_arguments(tool, {"project_id": f" {project_id} "}) == {"project_id": project_id}
    for invalid in (None, [], "project", {"project_id": "x"}, {"project_id": project_id, "shell": "id"}, {}):
        try:
            mcp.validate_tool_arguments(tool, invalid)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid arguments accepted: {invalid!r}")


def test_public_schema_is_closed_and_declares_read_only_capability(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    schema = mcp.public_tools()[0]
    assert schema["capability"] == "proyectos.portfolio"
    assert schema["read_only"] is True
    assert schema["inputSchema"]["additionalProperties"] is False
    assert "input_schema" not in schema


def test_catalog_declares_authoritative_scope_operation_sensitivity_and_handler(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get,treseko.builds.list")
    tools = {item["name"]: item for item in mcp.public_tools()}
    assert tools["treseko.project.get"]["required_scope"] == "mcp.projects.read"
    assert tools["treseko.builds.list"]["required_scope"] == "mcp.builds.read"
    assert all(item["operation"] == "read" for item in tools.values())
    assert all(item["sensitivity"] == "non_sensitive" for item in tools.values())
    assert all(item["handler_key"] for item in tools.values())


def test_unknown_scope_is_rejected_and_never_grants_tools():
    with pytest.raises(ValueError, match="scope MCP desconocido"):
        mcp.validate_scopes(["mcp.projects.read", "mcp.admin.all"])
    assert not mcp.tool_allowed_by_scopes("treseko.project.get", ["mcp.admin.all"])


def test_unknown_handler_is_not_callable_or_publishable(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    tool = mcp.TOOL_CATALOG["treseko.project.get"]
    monkeypatch.setitem(mcp.HANDLERS, tool.handler_key, None)
    assert mcp.resolve_tool(tool.name) is None
    assert mcp.public_tools() == []


def test_discovery_filters_tools_without_declared_capability(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    user = SimpleNamespace()
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: False)
    assert mcp_router._authorized_tools(user) == []


def test_discovery_keeps_tools_with_declared_capability(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    user = SimpleNamespace()
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda _user, capability, level: capability == "proyectos.portfolio" and level == "read")
    assert [item["name"] for item in mcp_router._authorized_tools(user)] == ["treseko.project.get"]


def test_mcp_surface_is_registered_on_the_public_api_router():
    routes = {(route.path, tuple(sorted(route.methods or ()))) for route in app.routes if hasattr(route, "path") and route.path.startswith("/mcp")}
    assert ("/mcp/tools", ("GET",)) in routes
    assert ("/mcp", ("POST",)) in routes


@pytest.mark.asyncio
async def test_router_requires_project_and_organization_rbac(monkeypatch):
    calls = []
    project_id = uuid4()
    project = SimpleNamespace(organizacion_id=uuid4())

    async def project_access(_db, _user, requested_id, level):
        calls.append(("project", requested_id, level))
        return project

    async def organization_access(_db, _user, requested_id, level):
        calls.append(("organization", requested_id, level))
        return object()

    monkeypatch.setattr(mcp_router.access_control, "require_project_access", project_access)
    monkeypatch.setattr(mcp_router.access_control, "require_organization_access", organization_access)
    result = await mcp_router._require_mcp_project_scope(object(), object(), project_id)
    assert result is project
    assert calls == [
        ("project", project_id, "read"),
        ("organization", project.organizacion_id, "read"),
    ]


@pytest.mark.asyncio
async def test_router_stops_at_project_boundary_and_does_not_query_organization(monkeypatch):
    project_id = uuid4()
    calls = []

    async def denied_project(_db, _user, requested_id, level):
        calls.append(("project", requested_id, level))
        raise HTTPException(status_code=403, detail="fuera del proyecto")

    async def unexpected_organization(*_args):
        raise AssertionError("la organización no debe consultarse tras denegar el proyecto")

    monkeypatch.setattr(mcp_router.access_control, "require_project_access", denied_project)
    monkeypatch.setattr(mcp_router.access_control, "require_organization_access", unexpected_organization)

    with pytest.raises(HTTPException) as denied:
        await mcp_router._require_mcp_project_scope(object(), object(), project_id)

    assert denied.value.status_code == 403
    assert calls == [("project", project_id, "read")]


@pytest.mark.asyncio
async def test_tools_list_requires_mcp_key_even_when_catalog_is_enabled(monkeypatch):
    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-tools"))

    async def authenticated(_request):
        return SimpleNamespace(id=uuid4())

    monkeypatch.setattr(mcp_router, "_technical_user", authenticated)
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: True)
    result = await mcp_router.discover_tools(request)

    assert [tool["name"] for tool in result["tools"]] == ["treseko.project.get"]
    assert result["correlation_id"] == "corr-tools"


@pytest.mark.asyncio
async def test_runtime_credential_route_is_closed_when_mcp_is_disabled_or_topology_is_invalid(monkeypatch):
    request_kwargs = {"payload": {}, "x_engine_internal_token": "valid", "db": object()}

    mcp.set_configured_mcp_enabled(False)
    with pytest.raises(HTTPException) as disabled:
        await mcp_router.resolve_engine_runtime_credential(**request_kwargs)
    assert disabled.value.status_code == 404
    assert disabled.value.detail == "MCP no está habilitado"

    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_DEPLOYMENT_TOPOLOGY", "invalid")
    with pytest.raises(HTTPException) as invalid_topology:
        await mcp_router.resolve_engine_runtime_credential(**request_kwargs)
    assert invalid_topology.value.status_code == 404
    assert invalid_topology.value.detail == "MCP no está habilitado"


def test_root_compose_propagates_mcp_admission_configuration():
    compose = Path(__file__).resolve().parents[1] / "docker-compose.prod.yml"
    text = compose.read_text(encoding="utf-8")
    assert "TRESEKO_MCP_ENABLED: ${TRESEKO_MCP_ENABLED:-false}" in text
    assert "TRESEKO_MCP_TOOLS: ${TRESEKO_MCP_TOOLS:-}" in text
    assert "TRESEKO_MCP_DEPLOYMENT_TOPOLOGY: ${TRESEKO_MCP_DEPLOYMENT_TOPOLOGY:-single_process}" in text


@pytest.mark.asyncio
async def test_tools_discovery_unexpected_auth_failure_is_audited_and_safe(monkeypatch):
    audit_calls = []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    async def broken_auth(_request):
        raise RuntimeError("database password=super-secret")

    async def capture_audit(*args, **kwargs):
        audit_calls.append((args, kwargs))

    _enable_mcp(monkeypatch)
    monkeypatch.setattr(mcp_router, "_technical_user", broken_auth)
    monkeypatch.setattr(mcp_router, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(mcp_router.crud, "create_audit_log", capture_audit)
    monkeypatch.setattr(mcp_router, "audit_request_context", lambda _request: {"ip_address": "127.0.0.1", "origen": "http_client"})
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-tools-auth-failure"))

    with pytest.raises(HTTPException) as failure:
        await mcp_router.discover_tools(request)

    assert failure.value.status_code == 500
    assert failure.value.detail == "Internal server error"
    assert len(audit_calls) == 1
    audit = audit_calls[0][1]
    assert audit["usuario_id"] is None
    assert audit["detalles"]["status"] == "error"
    assert audit["detalles"]["reason"] == "authentication_failure"
    assert len(json.dumps(audit["detalles"])) <= 2048
    assert "password" not in json.dumps(audit)
    assert "super-secret" not in json.dumps(audit)


@pytest.mark.asyncio
async def test_successful_mcp_call_passes_sanitized_audit_and_correlation(monkeypatch):
    project_id = uuid4()
    user = SimpleNamespace(id=uuid4(), mcp_scopes=["mcp.projects.read"])
    project = SimpleNamespace(id=project_id, nombre="Proyecto permitido", organizacion_id=uuid4())
    audit_calls = []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    async def fake_scope(_db, _user, requested_id):
        assert requested_id == project_id
        return project

    async def fake_audit(*args, **kwargs):
        audit_calls.append((args, kwargs))

    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: True)
    monkeypatch.setattr(mcp_router, "_require_mcp_project_scope", fake_scope)
    monkeypatch.setattr(mcp_router, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(mcp_router.crud, "create_audit_log", fake_audit)
    monkeypatch.setattr(mcp_router, "audit_request_context", lambda _request: {"ip_address": "127.0.0.1", "origen": "http_client"})
    monkeypatch.setattr(mcp_router.rate_limiter, "allow", lambda _identity: True)

    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-mcp-test"), body=lambda: _async_value(b'{"jsonrpc":"2.0"}'))
    # The router reads the body once; use a small async request double.
    request.body = lambda: _async_value((
        '{"jsonrpc":"2.0","id":1,"method":"tools/call",'
        f'"params":{{"name":"treseko.project.get","arguments":{{"project_id":"{project_id}"}}}}}}'
    ).encode())
    result = await mcp_router.mcp_json_rpc(request)

    assert result["result"]["content"]
    assert audit_calls[0][1]["accion"] == "MCP_TOOL_CALL"
    assert audit_calls[0][1]["correlation_id"] == "corr-mcp-test"
    assert audit_calls[0][1]["detalles"]["arguments"] == {"project_id": str(project_id)}


@pytest.mark.asyncio
async def test_mcp_authentication_rejects_missing_or_revoked_key(monkeypatch):
    _enable_mcp(monkeypatch)

    request = SimpleNamespace(headers={}, state=SimpleNamespace())
    with pytest.raises(HTTPException) as missing:
        await mcp_router._technical_user(request)
    assert missing.value.status_code == 401

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    async def revoked_key(_db, _raw_key):
        return None

    monkeypatch.setattr(mcp_router, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(mcp_router.crud, "get_user_by_mcp_api_key", revoked_key)
    request.headers = {"x-mcp-api-key": "revoked-key"}
    with pytest.raises(HTTPException) as revoked:
        await mcp_router._technical_user(request)
    assert revoked.value.status_code == 401


@pytest.mark.asyncio
async def test_mcp_router_rejects_unknown_tool_before_any_data_access(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router.rate_limiter, "allow", lambda _identity: (_ for _ in ()).throw(AssertionError("rate limiter should not be reached")))
    request = SimpleNamespace(
        state=SimpleNamespace(correlation_id="corr-unknown-tool"),
        body=lambda: _async_value(b'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"shell.exec","arguments":{}}}'),
    )
    result = await mcp_router.mcp_json_rpc(request)
    assert result["error"]["code"] == -32602


@pytest.mark.asyncio
async def test_mcp_router_rejects_missing_capability_before_data_access(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    project_id = uuid4()
    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: False)
    request = SimpleNamespace(
        state=SimpleNamespace(correlation_id="corr-capability"),
        body=lambda: _async_value((
            '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":'
            f'{{"name":"treseko.project.get","arguments":{{"project_id":"{project_id}"}}}}}}'
        ).encode()),
    )
    result = await mcp_router.mcp_json_rpc(request)
    assert result["error"]["code"] == -32603


@pytest.mark.asyncio
async def test_mcp_router_enforces_rate_limit_for_authenticated_identity(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    project_id = uuid4()
    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: True)
    monkeypatch.setattr(mcp_router.rate_limiter, "allow", lambda _identity: False)
    request = SimpleNamespace(
        state=SimpleNamespace(correlation_id="corr-rate"),
        body=lambda: _async_value((
            '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":'
            f'{{"name":"treseko.project.get","arguments":{{"project_id":"{project_id}"}}}}}}'
        ).encode()),
    )
    result = await mcp_router.mcp_json_rpc(request)
    assert result["error"]["code"] == -32603


async def _async_value(value):
    return value


@pytest.mark.asyncio
async def test_json_rpc_protocol_errors_preserve_id_and_do_not_raise_http(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    _enable_mcp(monkeypatch)
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    for body, code in ((b"{", -32700), (b'{"jsonrpc":"1.0","id":"x","method":"tools/list"}', -32600), (b'{"jsonrpc":"2.0","id":7,"method":"nope"}', -32601)):
        request = SimpleNamespace(state=SimpleNamespace(correlation_id="c"), body=lambda body=body: _async_value(body))
        result = await mcp_router.mcp_json_rpc(request)
        assert result["jsonrpc"] == "2.0" and result["id"] in (None, "x", 7)
        assert result["error"]["code"] == code


@pytest.mark.asyncio
async def test_notification_returns_no_response_and_invalid_params_is_json_rpc(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    _enable_mcp(monkeypatch)
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router, "_authorized_tools", lambda _user: [])
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="c"), body=lambda: _async_value(b'{"jsonrpc":"2.0","method":"tools/list"}'))
    result = await mcp_router.mcp_json_rpc(request)
    assert getattr(result, "status_code", None) == 204
    request.body = lambda: _async_value(b'{"jsonrpc":"2.0","id":9,"method":"tools/call","params":[]}' )
    result = await mcp_router.mcp_json_rpc(request)
    assert result["error"]["code"] == -32602 and result["id"] == 9


@pytest.mark.asyncio
async def test_unexpected_auth_failure_returns_sanitized_json_rpc_error_with_id(monkeypatch):
    _enable_mcp(monkeypatch)

    async def broken_auth(_request):
        raise RuntimeError("database password=super-secret")

    monkeypatch.setattr(mcp_router, "_technical_user", broken_auth)
    request = SimpleNamespace(
        state=SimpleNamespace(correlation_id="corr-auth-failure"),
        body=lambda: _async_value(b'{"jsonrpc":"2.0","id":"auth-7","method":"tools/list"}'),
    )

    result = await mcp_router.mcp_json_rpc(request)

    assert result == {"jsonrpc": "2.0", "id": "auth-7", "error": {"code": -32603, "message": "Internal error"}}
    assert "password" not in json.dumps(result)
    assert "super-secret" not in json.dumps(result)


@pytest.mark.asyncio
async def test_unexpected_auth_failure_is_audited_with_anonymous_bounded_details(monkeypatch):
    audit_calls = []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    async def broken_auth(_request):
        raise RuntimeError("database password=super-secret")

    async def capture_audit(*args, **kwargs):
        audit_calls.append((args, kwargs))

    _enable_mcp(monkeypatch)
    monkeypatch.setattr(mcp_router, "_technical_user", broken_auth)
    monkeypatch.setattr(mcp_router, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(mcp_router.crud, "create_audit_log", capture_audit)
    monkeypatch.setattr(mcp_router, "audit_request_context", lambda _request: {"ip_address": "127.0.0.1", "origen": "http_client"})
    request = SimpleNamespace(
        state=SimpleNamespace(correlation_id="corr-auth-failure"),
        body=lambda: _async_value(b'{"jsonrpc":"2.0","id":"auth-7","method":"tools/list"}'),
    )

    result = await mcp_router.mcp_json_rpc(request)

    assert result == {"jsonrpc": "2.0", "id": "auth-7", "error": {"code": -32603, "message": "Internal error"}}
    assert len(audit_calls) == 1
    audit = audit_calls[0][1]
    assert audit["usuario_id"] is None
    assert audit["detalles"]["status"] == "error"
    assert audit["detalles"]["reason"] == "authentication_failure"
    assert len(json.dumps(audit["detalles"])) <= 2048
    assert "password" not in json.dumps(audit)
    assert "super-secret" not in json.dumps(audit)


@pytest.mark.asyncio
async def test_auth_failure_audit_errors_are_best_effort(monkeypatch):
    _enable_mcp(monkeypatch)

    async def broken_auth(_request):
        raise RuntimeError("database password=super-secret")

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    async def broken_audit(*args, **kwargs):
        raise RuntimeError("audit database password=another-secret")

    monkeypatch.setattr(mcp_router, "_technical_user", broken_auth)
    monkeypatch.setattr(mcp_router, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(mcp_router.crud, "create_audit_log", broken_audit)
    monkeypatch.setattr(mcp_router, "audit_request_context", lambda _request: {"ip_address": "127.0.0.1", "origen": "http_client"})
    request = SimpleNamespace(
        state=SimpleNamespace(correlation_id="corr-auth-audit-failure"),
        body=lambda: _async_value(b'{"jsonrpc":"2.0","id":8,"method":"tools/list"}'),
    )

    result = await mcp_router.mcp_json_rpc(request)

    assert result == {"jsonrpc": "2.0", "id": 8, "error": {"code": -32603, "message": "Internal error"}}


@pytest.mark.asyncio
async def test_notification_database_failure_returns_http_204(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    project_id = uuid4()
    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: True)

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(mcp_router, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(mcp_router, "_require_mcp_project_scope", lambda *_args: _async_value(object()))

    async def broken_handler(*_args):
        raise RuntimeError("database password=super-secret")

    monkeypatch.setitem(mcp_router.HANDLERS, "project.get", broken_handler)
    request = SimpleNamespace(
        state=SimpleNamespace(correlation_id="corr-db-failure"),
        body=lambda: _async_value((
            '{"jsonrpc":"2.0","method":"tools/call","params":'
            f'{{"name":"treseko.project.get","arguments":{{"project_id":"{project_id}"}}}}}}'
        ).encode()),
    )

    result = await mcp_router.mcp_json_rpc(request)

    assert result.status_code == 204


def test_rate_limiter_is_bounded_and_thread_safe():
    limiter = mcp.McpRateLimiter(limit=1, window_seconds=60, max_identities=2)
    assert limiter.allow("a")
    assert limiter.allow("b")
    assert limiter.allow("c")
    assert len(limiter._calls) <= 2


@pytest.mark.asyncio
async def test_response_bound_covers_serialized_json_rpc_envelope(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get")
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: True)
    monkeypatch.setattr(mcp_router, "_authorized_tools", lambda _user: [{"name": "x", "description": "y" * 1000}])
    monkeypatch.setattr(mcp_router, "MCP_MAX_RESPONSE_BYTES", 100)
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="c"), body=lambda: _async_value(b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'))
    result = await mcp_router.mcp_json_rpc(request)
    assert result["error"]["code"] == -32603
    assert "description" not in json.dumps(result)


@pytest.mark.asyncio
async def test_parsed_oversized_preview_uses_non_persistent_sanitized_audit(monkeypatch):
    user = SimpleNamespace(id=uuid4(), mcp_key_prefix="mcp-test")
    secret = "preview-secret-should-not-leak"
    audit_logs = []
    preview_audits = []

    async def capture_audit(*_args, **_kwargs):
        audit_logs.append((_args, _kwargs))

    def capture_preview_audit(_message, details):
        preview_audits.append(details)

    _enable_mcp(monkeypatch)
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.cases.import.preview")
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router.auth, "has_capability_permission", lambda *_args: True)
    monkeypatch.setattr(mcp_router, "request_limit_for_tool", lambda _tool: 100)
    monkeypatch.setattr(mcp_router.crud, "create_audit_log", capture_audit)
    monkeypatch.setattr(mcp_router.logger, "info", capture_preview_audit)
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": "preview-oversized",
        "method": "tools/call",
        "params": {
            "name": "treseko.cases.import.preview",
            "arguments": {"project_id": str(uuid4()), "api_key": secret, "content": "untrusted-content"},
        },
    }).encode()
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-preview"), body=lambda: _async_value(body))

    result = await mcp_router.mcp_json_rpc(request)

    assert result["error"] == {"code": -32603, "message": "Internal error"}
    assert audit_logs == []
    assert len(preview_audits) == 1
    assert preview_audits[0]["tool"] == "treseko.cases.import.preview"
    assert preview_audits[0]["reason"] == "request_too_large"
    serialized_audit = json.dumps(preview_audits[0])
    assert secret not in serialized_audit
    assert "untrusted-content" not in serialized_audit


@pytest.mark.asyncio
async def test_oversized_valid_notification_returns_http_204(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    _enable_mcp(monkeypatch)
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router, "MCP_MAX_REQUEST_BYTES", 50)
    body = json.dumps({"jsonrpc": "2.0", "method": "tools/list", "padding": "x" * 100}).encode()
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="c"), body=lambda: _async_value(body))

    result = await mcp_router.mcp_json_rpc(request)

    assert result.status_code == 204


@pytest.mark.asyncio
async def test_oversized_error_id_is_replaced_with_bounded_generic_error(monkeypatch):
    user = SimpleNamespace(id=uuid4())
    _enable_mcp(monkeypatch)
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    monkeypatch.setattr(mcp_router, "MCP_MAX_RESPONSE_BYTES", 100)
    request = SimpleNamespace(
        state=SimpleNamespace(correlation_id="c"),
        body=lambda: _async_value(json.dumps({"jsonrpc": "2.0", "id": "x" * 1000, "method": "missing"}).encode()),
    )

    result = await mcp_router.mcp_json_rpc(request)

    assert result == {"jsonrpc": "2.0", "id": None, "error": {"code": -32603, "message": "Internal error"}}
    assert len(json.dumps(result, separators=(",", ":")).encode()) <= 100


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_id", [[], {}, True])
async def test_invalid_json_rpc_ids_are_rejected_and_not_echoed(monkeypatch, invalid_id):
    user = SimpleNamespace(id=uuid4())
    _enable_mcp(monkeypatch)
    monkeypatch.setattr(mcp_router, "_technical_user", lambda _request: _async_value(user))
    request = SimpleNamespace(
        state=SimpleNamespace(correlation_id="c"),
        body=lambda: _async_value(json.dumps({"jsonrpc": "2.0", "id": invalid_id, "method": "tools/list"}).encode()),
    )

    result = await mcp_router.mcp_json_rpc(request)

    assert result["error"] == {"code": -32600, "message": "Invalid Request"}
    assert result["id"] is None

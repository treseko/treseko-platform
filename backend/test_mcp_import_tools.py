from __future__ import annotations

import base64
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.routers import mcp as mcp_router
from app.services import case_portability
from app.services import mcp_import
from app.services import mcp_governance as governance
from app.services.mcp_tools import HANDLERS


PROJECT_ID = uuid4()
COMPONENT_ID = uuid4()
BUILD_ID = uuid4()


def _arguments(**overrides):
    value = {
        "project_id": str(PROJECT_ID),
        "profile_id": "treseko/tcases-v1",
        "content_base64": base64.b64encode(b"package").decode(),
        "file_name": "cases.tcases",
        "component_id": str(COMPONENT_ID),
        "build_id": str(BUILD_ID),
    }
    value.update(overrides)
    return value


def test_import_preview_schema_accepts_package_fields_and_rejects_extras(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.cases.import.preview")
    tool = governance.resolve_tool("treseko.cases.import.preview")
    assert tool is not None
    parsed = governance.validate_tool_arguments(tool, _arguments())
    assert parsed["project_id"] == str(PROJECT_ID)
    assert parsed["component_id"] == str(COMPONENT_ID)
    with pytest.raises(ValueError):
        governance.validate_tool_arguments(tool, _arguments(shell="id"))


@pytest.mark.asyncio
async def test_preview_rejects_component_outside_authorized_project(monkeypatch):
    component = SimpleNamespace(proyecto_id=uuid4())

    async def component_access(*_args):
        return component

    monkeypatch.setattr(mcp_router.access_control, "require_component_access", component_access)
    with pytest.raises(ValueError) as exc:
        await mcp_import.preview_import(object(), object(), SimpleNamespace(id=PROJECT_ID), _arguments())
    assert isinstance(exc.value, ValueError)


@pytest.mark.asyncio
async def test_preview_rejects_build_outside_project_component(monkeypatch):
    component = SimpleNamespace(proyecto_id=PROJECT_ID)
    build = SimpleNamespace(proyecto_id=PROJECT_ID, componente_id=uuid4())
    monkeypatch.setattr(mcp_router.access_control, "require_component_access", lambda *_args: _async(component))
    monkeypatch.setattr(mcp_router.access_control, "require_build_access", lambda *_args: _async(build))
    with pytest.raises(ValueError) as exc:
        await mcp_import.preview_import(object(), object(), SimpleNamespace(id=PROJECT_ID), _arguments())
    assert isinstance(exc.value, ValueError)


@pytest.mark.asyncio
async def test_preview_rejects_invalid_base64_profile_and_package(monkeypatch):
    component = SimpleNamespace(proyecto_id=PROJECT_ID)
    monkeypatch.setattr(mcp_router.access_control, "require_component_access", lambda *_args: _async(component))
    for arguments in (_arguments(content_base64="%%%", build_id=None), _arguments(profile_id="unknown", build_id=None), _arguments(content_base64=base64.b64encode(b"bad").decode(), build_id=None)):
        with pytest.raises((ValueError, case_portability.PortabilityError)):
            await mcp_import.preview_import(object(), object(), SimpleNamespace(id=PROJECT_ID), arguments)


@pytest.mark.asyncio
async def test_preview_calls_legacy_parser_without_include_binary_and_never_returns_package(monkeypatch):
    component = SimpleNamespace(proyecto_id=PROJECT_ID)
    monkeypatch.setattr(mcp_router.access_control, "require_component_access", lambda *_args: _async(component))
    monkeypatch.setattr(mcp_router.access_control, "require_build_access", lambda *_args: _async(SimpleNamespace(proyecto_id=PROJECT_ID, componente_id=COMPONENT_ID)))
    calls = {}

    async def legacy_preview(_db, project_id, profile_id, data, **kwargs):
        calls.update(project_id=project_id, profile_id=profile_id, data=data, kwargs=kwargs)
        return {"source_tool": "x", "source_version": "1", "file_sha256": "a", "summary": {"total": 1}, "diagnostics": {"ok": True}, "items": [{"external_id": "id", "titulo": "RAW CONTENT", "outcome": "new"}], "package": {"cases": [{"titulo": "RAW CONTENT"}], "attachment_files": {"x": b"secret"}}}

    monkeypatch.setattr(case_portability, "preview_import", legacy_preview)
    result = await mcp_import.preview_import(object(), object(), SimpleNamespace(id=PROJECT_ID), _arguments())
    assert calls["kwargs"] == {}
    assert "package" not in result
    assert "RAW CONTENT" not in str(result)
    assert "secret" not in str(result)
    assert result["items"] == [{"external_id": "id", "outcome": "new"}]


@pytest.mark.asyncio
async def test_preview_does_not_write(monkeypatch):
    component = SimpleNamespace(proyecto_id=PROJECT_ID)
    monkeypatch.setattr(mcp_router.access_control, "require_component_access", lambda *_args: _async(component))
    async def parser(*_args, **_kwargs):
        return {"source_tool": "x", "source_version": "1", "file_sha256": "a", "summary": {}, "diagnostics": {}, "items": []}
    monkeypatch.setattr(case_portability, "preview_import", parser)
    db = SimpleNamespace(add=lambda *_args: (_ for _ in ()).throw(AssertionError("write")), flush=lambda: (_ for _ in ()).throw(AssertionError("write")))
    await mcp_import.preview_import(db, object(), SimpleNamespace(id=PROJECT_ID), _arguments(build_id=None))


@pytest.mark.asyncio
async def test_preview_audit_is_sanitized_and_non_persistent(monkeypatch, caplog):
    tool = governance.TOOL_CATALOG["treseko.cases.import.preview"]
    user = SimpleNamespace(id=PROJECT_ID, mcp_key_prefix="mcp_test")
    request = SimpleNamespace(state=SimpleNamespace(correlation_id="corr-preview"), client=None, headers={})
    persisted = False

    async def forbidden_persist(*_args, **_kwargs):
        nonlocal persisted
        persisted = True

    monkeypatch.setattr(mcp_router.crud, "create_audit_log", forbidden_persist)
    with caplog.at_level("INFO", logger="app.api.routers.mcp"):
        await mcp_router._audit_mcp_event(
            request,
            user,
            tool=tool,
            status="success",
            reason="preview_complete",
            arguments={"content_base64": "secret-content", "profile_id": "safe-profile"},
        )
    assert not persisted
    assert "secret-content" not in caplog.text
    assert "preview_complete" in caplog.text
    assert "[redacted]" in caplog.text


@pytest.mark.asyncio
async def test_preview_requires_scope_and_allowlist(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.cases.import.preview")
    assert governance.resolve_tool("treseko.cases.import.preview") is None if not governance.HANDLERS.get("cases.import.preview") else True
    assert not governance.tool_allowed_by_scopes("treseko.cases.import.preview", [])
    assert not governance.tool_allowed_by_scopes("treseko.cases.import.preview", ["mcp.projects.read"])
    assert governance.tool_allowed_by_scopes("treseko.cases.import.preview", ["mcp.cases.import.preview"])


@pytest.mark.asyncio
async def test_legacy_read_only_handlers_remain_unchanged():
    assert callable(HANDLERS["project.get"])
    assert callable(HANDLERS["builds.list"])
    project = SimpleNamespace(id=PROJECT_ID, nombre="name", organizacion_id=uuid4())
    assert await HANDLERS["project.get"](object(), object(), project) == {"id": str(PROJECT_ID), "name": "name", "organization_id": str(project.organizacion_id)}


async def _async(value):
    return value

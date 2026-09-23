from __future__ import annotations

import pytest

from app.services import mcp_governance as mcp


IMPORT_TOOLS = {
    "treseko.cases.import.preview": "mcp.cases.import.preview",
    "treseko.cases.import.commit": "mcp.cases.import.commit",
}


def test_import_scopes_are_explicit_and_unknown_scopes_fail_closed():
    assert set(IMPORT_TOOLS.values()).issubset(mcp.SCOPE_TO_TOOLS)
    with pytest.raises(ValueError, match="scope MCP desconocido"):
        mcp.validate_scopes(["mcp.cases.import.preview", "mcp.cases.import.unknown"])
    assert not mcp.tool_allowed_by_scopes(
        "treseko.cases.import.preview", ["mcp.cases.import.unknown"]
    )


def test_scope_creation_rejects_capabilities_missing_from_user(monkeypatch):
    user = object()

    def capability_check(_user, capability, _level):
        return capability == "proyectos.portfolio"

    monkeypatch.setattr("app.auth.has_capability_permission", capability_check)
    assert mcp.validate_scopes_for_user(["mcp.projects.read"], user) == ["mcp.projects.read"]
    with pytest.raises(ValueError, match="no permitido"):
        mcp.validate_scopes_for_user(["mcp.cases.write"], user)


def test_import_tools_are_not_enabled_by_configuration_unless_explicitly_named(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.project.get,treseko.builds.list")
    assert not (set(IMPORT_TOOLS) & mcp.enabled_tool_names())

    monkeypatch.setenv("TRESEKO_MCP_TOOLS", ",".join(IMPORT_TOOLS))
    assert set(IMPORT_TOOLS).issubset(mcp.enabled_tool_names())


def test_import_catalog_metadata_is_write_operation_and_not_read_only():
    for tool_name, scope in IMPORT_TOOLS.items():
        tool = mcp.TOOL_CATALOG[tool_name]
        assert tool.required_scope == scope
        assert tool.operation in {"preview", "commit"}
        assert tool.read_only is False


def test_enabled_configuration_exposes_governed_catalog_without_deployment_tool_list(monkeypatch):
    monkeypatch.delenv("TRESEKO_MCP_TOOLS", raising=False)
    mcp.set_configured_mcp_enabled(True)
    try:
        assert "treseko.project.get" in mcp.enabled_tool_names()
        assert mcp.public_tools()
    finally:
        mcp.set_configured_mcp_enabled(False)


def test_public_discovery_never_exposes_undeclared_or_unimplemented_import_tools(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", ",".join(IMPORT_TOOLS))
    assert [tool["name"] for tool in mcp.public_tools()] == list(IMPORT_TOOLS)
    assert mcp.resolve_tool("treseko.cases.import.preview") is not None
    assert mcp.resolve_tool("treseko.cases.import.commit") is not None

    monkeypatch.setenv(
    "TRESEKO_MCP_TOOLS",
    "treseko.project.get," + ",".join(IMPORT_TOOLS) + ",treseko.cases.import.rollback",
    )
    assert [tool["name"] for tool in mcp.public_tools()] == ["treseko.project.get", *IMPORT_TOOLS, "treseko.cases.import.rollback"]


def test_preview_request_limit_admits_governed_package_plus_json_overhead():
    preview = mcp.TOOL_CATALOG["treseko.cases.import.preview"]
    ordinary = mcp.TOOL_CATALOG["treseko.project.get"]
    assert mcp.MCP_MAX_REQUEST_BYTES < 12_000_000
    assert mcp.request_limit_for_tool(preview) >= 12_000_000 + mcp.MCP_JSON_OVERHEAD_BYTES
    assert mcp.request_limit_for_tool(ordinary) == mcp.MCP_MAX_REQUEST_BYTES

from types import SimpleNamespace
from uuid import uuid4
import pytest
from app.services import mcp_governance as gov, mcp_tools

NAMES = {
    "treseko.cases.list", "treseko.cases.get",
    "treseko.test-runs.list", "treseko.test-runs.get",
    "treseko.test-results.list", "treseko.test-results.get",
    "treseko.bugs.list", "treseko.bugs.get", "treseko.quality.summary",
}

def test_read_catalog_has_dedicated_scopes_and_closed_schemas(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", ",".join(NAMES))
    tools = {x["name"]: x for x in gov.public_tools()}
    assert set(tools) == NAMES
    assert all(x["read_only"] and x["operation"] == "read" for x in tools.values())
    assert all(x["inputSchema"]["additionalProperties"] is False for x in tools.values())
    assert all(x["required_scope"].startswith("mcp.") for x in tools.values())
    assert len({x["required_scope"] for x in tools.values()}) == len(tools)

def test_read_arguments_bound_ids_limits_and_filters(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.cases.list,treseko.cases.get")
    listing = gov.resolve_tool("treseko.cases.list")
    detail = gov.resolve_tool("treseko.cases.get")
    project = str(uuid4())
    assert gov.validate_tool_arguments(listing, {"project_id": project, "limit": 10, "offset": 2})["limit"] == 10
    with pytest.raises(ValueError): gov.validate_tool_arguments(listing, {"project_id": project, "limit": 0})
    with pytest.raises(ValueError): gov.validate_tool_arguments(listing, {"project_id": project, "limit": 101})
    with pytest.raises(ValueError): gov.validate_tool_arguments(detail, {"project_id": project, "case_id": "bad"})

def test_bug_and_quality_schemas_are_closed_and_bounded(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.bugs.list,treseko.bugs.get,treseko.quality.summary")
    project, build = str(uuid4()), str(uuid4())
    listing = gov.resolve_tool("treseko.bugs.list")
    summary = gov.resolve_tool("treseko.quality.summary")
    assert listing.input_schema["required"] == ["project_id"]
    assert summary.input_schema["required"] == ["project_id", "build_id"]
    assert gov.validate_tool_arguments(listing, {"project_id": project, "build_id": build, "estado": "ABIERTO"})["build_id"] == build
    with pytest.raises(ValueError): gov.validate_tool_arguments(listing, {"project_id": project, "unexpected": 1})
    with pytest.raises(ValueError): gov.validate_tool_arguments(summary, {"project_id": project})

def test_bug_serializer_excludes_sensitive_fields():
    bug = SimpleNamespace(id=uuid4(), codigo="BUG-1", titulo="x", descripcion="d", severidad="ALTA", prioridad="MEDIA", estado="ABIERTO", criticidad="ALTA", bloquea_release=True, created_at=None, updated_at=None)
    result = mcp_tools._serialize_bug(bug)
    assert "stack_trace" not in result and "logs_relevantes" not in result and "external_payload_snapshot" not in result
    assert result["estado"] == "ABIERTO"

@pytest.mark.asyncio
async def test_case_list_is_project_filtered_and_bounded():
    class R:
        def all(self): return [(uuid4(), "C1", "title", "MEDIA", "ACTIVO", "MANUAL", "CLASICA", True)] * 101
    class DB:
        async def execute(self, statement): self.statement = statement; return R()
    out = await mcp_tools.list_project_cases(DB(), None, SimpleNamespace(id=uuid4()), {"limit": 100, "offset": 0})
    assert len(out["items"]) == 100 and out["truncated"] is True

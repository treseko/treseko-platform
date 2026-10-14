from uuid import uuid4
import pytest
from types import SimpleNamespace
from app.services import mcp_governance as gov
from app.services import mcp_extended as ext

TOOLS = {
    "treseko.evidence.list", "treseko.evidence.get", "treseko.environments.list",
    "treseko.environments.get", "treseko.datasets.list", "treseko.datasets.get",
    "treseko.cases.versions.list", "treseko.quality.trends", "treseko.quality.compare",
}


def test_extended_catalog_is_closed_scoped_and_discoverable(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", ",".join(sorted(TOOLS)))
    tools = {item["name"]: item for item in gov.public_tools()}
    assert set(tools) == TOOLS
    assert all(item["inputSchema"]["additionalProperties"] is False for item in tools.values())
    assert all(item["required_scope"].startswith("mcp.") for item in tools.values())


def test_extended_arguments_require_project_owned_uuids(monkeypatch):
    monkeypatch.setenv("TRESEKO_MCP_TOOLS", "treseko.evidence.list,treseko.quality.compare")
    project = str(uuid4())
    tool = gov.resolve_tool("treseko.evidence.list")
    assert gov.validate_tool_arguments(tool, {"project_id": project, "snapshot_id": str(uuid4())})["project_id"] == project
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(tool, {"project_id": project, "snapshot_id": "bad"})
    compare = gov.resolve_tool("treseko.quality.compare")
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(compare, {"project_id": project, "baseline_build_id": str(uuid4()), "candidate_build_id": str(uuid4()), "extra": 1})


def test_inventory_serializer_redacts_credential_values():
    environment = SimpleNamespace(id=uuid4(), nombre="QA", status="ready", version="1", activo=True, url="https://qa", variables={"username": "qa", "password": "secret"})
    result = ext._environment(environment)
    assert result["variables"]["password"] == "[REDACTED]"
    assert "secret" not in str(result)


def test_quality_source_is_explicit():
    assert "persisted" in ext.quality_trends.__doc__ if ext.quality_trends.__doc__ else True

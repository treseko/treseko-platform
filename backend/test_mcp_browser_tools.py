from uuid import uuid4

import pytest

from app.services import mcp_governance as gov


def test_web_tools_are_published_with_separate_read_and_action_scopes():
    tools = {item["name"]: item for item in gov.public_tools()}
    assert {"treseko.web.open", "treseko.web.inspect", "treseko.web.act", "treseko.web.close"} <= set(tools)
    assert tools["treseko.web.open"]["required_scope"] == "mcp.web.read"
    assert tools["treseko.web.act"]["required_scope"] == "mcp.web.act"
    assert tools["treseko.web.act"]["read_only"] is False
    assert "dato no confiable" in tools["treseko.web.open"]["description"]


def test_web_open_schema_requires_project_and_http_url():
    tool = gov.resolve_tool("treseko.web.open")
    project_id = str(uuid4())
    assert gov.validate_tool_arguments(tool, {"project_id": project_id, "url": "https://example.org"})["project_id"] == project_id
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(tool, {"project_id": project_id, "url": "javascript:alert(1)"})
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(tool, {"project_id": project_id, "url": "https://example.org", "headers": {"Authorization": "secret"}})


def test_web_fill_requires_versioned_observed_target_and_redacted_value_key():
    tool = gov.resolve_tool("treseko.web.act")
    project_id, browser_id = str(uuid4()), str(uuid4())
    args = {"project_id": project_id, "browser_id": browser_id, "snapshot_version": 1, "action": "fill", "target_id": "t1", "target_name": "Email", "secret_value": "ephemeral"}
    assert gov.validate_tool_arguments(tool, args)["secret_value"] == "ephemeral"
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(tool, {**args, "target_id": "body"})
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(tool, {key: value for key, value in args.items() if key != "snapshot_version"})


def test_web_select_requires_a_recent_observed_target_and_option_label():
    tool = gov.resolve_tool("treseko.web.act")
    args = {"project_id": str(uuid4()), "browser_id": str(uuid4()), "snapshot_version": 2, "action": "select", "target_id": "t3", "target_name": "Country", "option_label": "Argentina"}
    assert gov.validate_tool_arguments(tool, args)["option_label"] == "Argentina"
    with pytest.raises(ValueError):
        gov.validate_tool_arguments(tool, {**args, "option_label": ""})

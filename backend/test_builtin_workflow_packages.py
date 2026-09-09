from __future__ import annotations

import hashlib
import io
import json
import uuid
import zipfile

import pytest

from app.repositories.ai_builtin_workflows import (
    BUILTIN_WORKFLOW_SLUGS,
    CATALOG_PACKAGE_ROOT,
    build_builtin_workflow_package,
)
from app.repositories.ai_universal_agents import validate_universal_agent_contract
from app.repositories.ai_workflow_package_io import workflow_create_payload_from_portable_graph


EXPECTED_TOPOLOGY = {
    "test-execution": ("test_execution", 10, 14),
    "story-generation": ("story_generation", 4, 3),
    "test-case-generation": ("test_case_generation", 5, 4),
    "chatbot-evaluation": ("chatbot_evaluation", 6, 5),
}


def _assert_reachable(graph: dict) -> None:
    node_ids = {node["id"] for node in graph["nodes"]}
    incoming = {node_id: 0 for node_id in node_ids}
    adjacency = {node_id: set() for node_id in node_ids}
    for edge in graph["edges"]:
        assert edge["source_node_id"] in node_ids
        assert edge["target_node_id"] in node_ids
        incoming[edge["target_node_id"]] += 1
        adjacency[edge["source_node_id"]].add(edge["target_node_id"])
    starts = {node_id for node_id, count in incoming.items() if count == 0}
    assert starts
    visited = set(starts)
    pending = list(starts)
    while pending:
        for target in adjacency[pending.pop()]:
            if target not in visited:
                visited.add(target)
                pending.append(target)
    assert visited == node_ids


@pytest.mark.parametrize("slug", BUILTIN_WORKFLOW_SLUGS)
def test_builtin_workflow_package_is_deterministic_and_matches_checked_in_artifact(slug):
    first = build_builtin_workflow_package(slug)
    second = build_builtin_workflow_package(slug)

    assert first["bytes"] == second["bytes"]
    assert hashlib.sha256(first["bytes"]).hexdigest() == first["sha256"]
    assert (CATALOG_PACKAGE_ROOT / first["filename"]).read_bytes() == first["bytes"]


@pytest.mark.parametrize("slug", BUILTIN_WORKFLOW_SLUGS)
def test_builtin_workflow_package_is_self_contained_and_integral(slug):
    package = build_builtin_workflow_package(slug)
    with zipfile.ZipFile(io.BytesIO(package["bytes"])) as archive:
        names = archive.namelist()
        assert names == sorted(names)
        assert all(not name.startswith("/") and ".." not in name.split("/") for name in names)
        manifest = json.loads(archive.read("manifest.json"))
        workflow_bytes = archive.read("workflow.json")
        graph = json.loads(workflow_bytes)
        assert hashlib.sha256(workflow_bytes).hexdigest() == manifest["integrity"]["sha256"]
        for agent in graph["agents"]:
            contract = json.loads(archive.read(f"agents/{agent['version_id']}.json"))
            assert validate_universal_agent_contract(contract) == agent["contract"]
            assert agent["contract_hash"] == hashlib.sha256(
                json.dumps(contract, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()


@pytest.mark.parametrize("slug", BUILTIN_WORKFLOW_SLUGS)
def test_builtin_workflow_graph_preserves_purpose_topology_and_editability(slug):
    purpose, node_count, edge_count = EXPECTED_TOPOLOGY[slug]
    graph = build_builtin_workflow_package(slug)["graph"]
    assert graph["workflow"]["workflow_format"] == "universal_v2"
    assert graph["workflow"]["workflow_purpose"] == purpose
    assert len(graph["nodes"]) == node_count
    assert len(graph["edges"]) == edge_count
    _assert_reachable(graph)

    version_map = {
        agent["version_id"]: uuid.uuid4()
        for agent in graph["agents"]
    }
    imported = workflow_create_payload_from_portable_graph(graph, version_map)
    assert imported.status == "DRAFT"
    assert imported.workflow_purpose == purpose
    assert imported.name.endswith(" - importado")
    assert "catalog_key" not in imported.decision_policy_json
    assert all(node.locked is False for node in imported.nodes)
    imported.nodes[0].prompt_template += " Ajuste local controlado."
    assert imported.nodes[0].prompt_template.endswith("Ajuste local controlado.")
    assert {
        edge.source_node_id for edge in imported.edges
    }.issubset({node.id for node in imported.nodes})

    builtin = workflow_create_payload_from_portable_graph(
        graph,
        version_map,
        imported_name_suffix="",
        preserve_catalog_metadata=True,
    )
    assert builtin.decision_policy_json["catalog_key"] == slug


def test_portable_graph_rejects_missing_purpose():
    graph = build_builtin_workflow_package("story-generation")["graph"]
    graph["workflow"]["workflow_purpose"] = ""
    version_map = {agent["version_id"]: uuid.uuid4() for agent in graph["agents"]}
    with pytest.raises(ValueError, match="proposito"):
        workflow_create_payload_from_portable_graph(graph, version_map)

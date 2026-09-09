"""Compatibility-safe helpers for the graph-authoritative workflow migration.

This module is additive. It does not activate graph_native and does not replace the engine
compiler. The backend uses it to reject malformed drafts early and to preserve exact adapter
identity in serialized snapshots.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping
from uuid import UUID

GRAPH_RUNTIME_MODES = frozenset({"legacy", "graph_compat", "graph_native", "shadow_compare"})
SUPPORTED_CONDITION_OPERATORS = frozenset({
    "always", "all", "any", "not", "status_is", "output_port_is", "reason_code_is",
    "confidence_gte", "retry_count_lt", "pass_count_lt", "value_equals",
})

@dataclass(frozen=True)
class WorkflowContractIssue:
    severity: str
    code: str
    message: str
    path: str | None = None
    node_id: str | None = None
    edge_id: str | None = None


def remap_entry_node_policy(policy: Any, id_map: Mapping[Any, UUID]) -> dict[str, Any]:
    """Remap graph identity stored outside nodes/edges when cloning a workflow."""
    result = dict(policy) if isinstance(policy, dict) else {}
    entry = str(result.get("entry_node_id") or "").strip()
    if not entry:
        return result
    remapped = next((new_id for old_id, new_id in id_map.items() if str(old_id) == entry), None)
    if remapped is None:
        raise ValueError("El entry_node_id del workflow no referencia un nodo importado")
    result["entry_node_id"] = str(remapped)
    return result


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _nodes(snapshot: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    values = snapshot.get("nodes")
    if not isinstance(values, list):
        values = _mapping(snapshot.get("graph")).get("nodes")
    return [item for item in values or [] if isinstance(item, Mapping)]


def _edges(snapshot: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    values = snapshot.get("edges")
    if not isinstance(values, list):
        values = _mapping(snapshot.get("graph")).get("edges")
    return [item for item in values or [] if isinstance(item, Mapping)]


def extract_native_adapter(node: Mapping[str, Any]) -> str | None:
    universal = _mapping(node.get("universal_agent"))
    contract = _mapping(universal.get("contract"))
    implementation = _mapping(contract.get("implementation"))
    runtime = _mapping(node.get("runtime"))
    config = _mapping(node.get("config_json"))
    for value in (config.get("runtime_adapter"), implementation.get("native_adapter"), runtime.get("native_adapter"), node.get("native_adapter")):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _node_ports(node: Mapping[str, Any], direction: str) -> set[str]:
    universal = _mapping(node.get("universal_agent"))
    contract = _mapping(universal.get("contract"))
    ports = _mapping(contract.get("ports")).get(direction)
    if not isinstance(ports, list):
        return set()
    return {str(item).strip() for item in ports if isinstance(item, str) and item.strip()}


def _node_id(node: Mapping[str, Any]) -> str:
    value = node.get("id") or node.get("node_id") or node.get("key")
    return str(value).strip() if value is not None else ""


def _node_enabled(node: Mapping[str, Any]) -> bool:
    return node.get("enabled") is not False


def _validate_condition(value: Any, path: str, issues: list[WorkflowContractIssue]) -> None:
    if value is None:
        return
    if not isinstance(value, Mapping):
        issues.append(WorkflowContractIssue("error", "CONDITION_NOT_OBJECT", "Condition must be an object", path))
        return
    op = value.get("op")
    if op is not None:
        if op not in SUPPORTED_CONDITION_OPERATORS:
            issues.append(WorkflowContractIssue("error", "CONDITION_OPERATOR_UNSUPPORTED", f"Unsupported condition operator: {op}", path))
            return
        if op in {"all", "any"}:
            items = value.get("conditions")
            if not isinstance(items, list):
                issues.append(WorkflowContractIssue("error", "CONDITION_CHILDREN_INVALID", f"{op}.conditions must be a list", path))
            else:
                for index, child in enumerate(items):
                    _validate_condition(child, f"{path}.conditions[{index}]", issues)
        elif op == "not":
            _validate_condition(value.get("condition"), f"{path}.condition", issues)
        return
    # Legacy condition_json keys supported by the engine normalizer.
    known = {
        "status", "status_is", "output_port", "output_port_is", "reason", "reason_code",
        "reason_code_is", "confidence_gte", "min_confidence", "retry_count_lt",
        "max_retry_count", "pass_count_lt", "max_passes", "all", "any", "not",
    }
    unknown = sorted(set(value) - known)
    if unknown:
        issues.append(WorkflowContractIssue("warning", "CONDITION_KEYS_UNKNOWN", f"Unknown condition keys: {', '.join(unknown)}", path))


def validate_graph_contract(
    snapshot: Mapping[str, Any],
    *,
    known_adapters: Iterable[str] | None = None,
) -> list[WorkflowContractIssue]:
    issues: list[WorkflowContractIssue] = []
    workflow = _mapping(snapshot.get("workflow"))
    # The persisted workflow metadata is authoritative. A package-level
    # ``format`` field must not be able to downgrade V3 validation.
    workflow_format = workflow.get("workflow_format") or workflow.get("format") or snapshot.get("workflow_format") or snapshot.get("format")
    runtime_mode = snapshot.get("runtime_mode") or workflow.get("runtime_mode") or _mapping(workflow.get("decision_policy_json")).get("runtime_mode", "legacy")
    if runtime_mode not in GRAPH_RUNTIME_MODES:
        issues.append(WorkflowContractIssue("error", "RUNTIME_MODE_INVALID", f"Unknown runtime mode: {runtime_mode}", "runtime_mode"))
    adapter_allowlist = set(known_adapters) if known_adapters is not None else None
    nodes = _nodes(snapshot)
    edges = _edges(snapshot)
    node_ids: set[str] = set()
    nodes_by_id: dict[str, Mapping[str, Any]] = {}
    for index, node in enumerate(nodes):
        node_id = _node_id(node)
        if not node_id:
            issues.append(WorkflowContractIssue("error", "NODE_ID_MISSING", "Node ID is required", f"nodes[{index}]"))
            continue
        if node_id in node_ids:
            issues.append(WorkflowContractIssue("error", "NODE_ID_DUPLICATE", f"Duplicate node ID: {node_id}", node_id=node_id))
        node_ids.add(node_id)
        nodes_by_id[node_id] = node
        adapter = extract_native_adapter(node)
        if workflow_format in {"universal_v2", "universal_v3"} and not adapter:
            issues.append(WorkflowContractIssue("error", "NATIVE_ADAPTER_MISSING", f"{workflow_format} node requires contract.implementation.native_adapter", node_id=node_id))
        if adapter and adapter_allowlist is not None and adapter not in adapter_allowlist:
            issues.append(WorkflowContractIssue("error", "UNKNOWN_RUNTIME_ADAPTER", f"Unknown runtime adapter: {adapter}", node_id=node_id))
        if workflow_format == "universal_v3":
            universal = _mapping(node.get("universal_agent"))
            if not (node.get("universal_agent_version_id") or universal.get("version_id")):
                issues.append(WorkflowContractIssue("error", "V3_IMMUTABLE_AGENT_VERSION_REQUIRED", "Every universal_v3 node must reference an immutable universal agent version", node_id=node_id))

    enabled_ids = {node_id for node_id, node in nodes_by_id.items() if _node_enabled(node)}
    incoming = {node_id: 0 for node_id in enabled_ids}
    outgoing = {node_id: 0 for node_id in enabled_ids}
    for index, edge in enumerate(edges):
        edge_id = edge.get("id") or edge.get("edge_id") or f"edge-{index}"
        source = str(edge.get("source_node_id") or edge.get("source") or edge.get("from") or "")
        target = str(edge.get("target_node_id") or edge.get("target") or edge.get("to") or "")
        if source not in node_ids:
            issues.append(WorkflowContractIssue("error", "EDGE_SOURCE_UNKNOWN", f"Unknown source node: {source}", edge_id=str(edge_id)))
        if target not in node_ids:
            issues.append(WorkflowContractIssue("error", "EDGE_TARGET_UNKNOWN", f"Unknown target node: {target}", edge_id=str(edge_id)))
        if source in enabled_ids and target in enabled_ids:
            incoming[target] += 1
            outgoing[source] += 1
        _validate_condition(edge.get("condition_json", edge.get("condition")), f"edges[{index}].condition", issues)
        if workflow_format == "universal_v3":
            source_port = str(edge.get("source_handle") or edge.get("source_port") or "").strip()
            target_port = str(edge.get("target_handle") or edge.get("target_port") or "").strip()
            if not source_port:
                issues.append(WorkflowContractIssue("error", "V3_SOURCE_PORT_REQUIRED", "Every universal_v3 edge requires an explicit source port", edge_id=str(edge_id)))
            elif source in nodes_by_id and source_port not in _node_ports(nodes_by_id[source], "control_outputs"):
                issues.append(WorkflowContractIssue("error", "UNDECLARED_OUTPUT_PORT", f"Source port is not declared by node {source}: {source_port}", edge_id=str(edge_id)))
            if not target_port:
                issues.append(WorkflowContractIssue("error", "V3_TARGET_PORT_REQUIRED", "Every universal_v3 edge requires an explicit target port", edge_id=str(edge_id)))
            elif target in nodes_by_id and target_port not in _node_ports(nodes_by_id[target], "control_inputs"):
                issues.append(WorkflowContractIssue("error", "UNDECLARED_INPUT_PORT", f"Target port is not declared by node {target}: {target_port}", edge_id=str(edge_id)))
            if edge.get("condition_type") not in {"output_port", "decision_is"}:
                issues.append(WorkflowContractIssue("error", "V3_TYPED_EDGE_REQUIRED", "Every universal_v3 edge must select a typed output", edge_id=str(edge_id)))
            for mapping_index, mapping in enumerate(edge.get("data_mapping_json") or []):
                valid = isinstance(mapping, Mapping) and str(mapping.get("source") or "").startswith("outputs.") and str(mapping.get("target") or "").startswith("inputs.")
                if not valid:
                    issues.append(WorkflowContractIssue("error", "INVALID_DATA_MAPPING", "V3 mappings must map outputs.* to inputs.*", f"edges[{index}].data_mapping_json[{mapping_index}]", edge_id=str(edge_id)))
    if workflow_format == "universal_v3":
        policy = _mapping(workflow.get("decision_policy_json"))
        if policy.get("runtime_mode") != "graph_native":
            issues.append(WorkflowContractIssue("error", "V3_REQUIRES_GRAPH_NATIVE", "universal_v3 requires runtime_mode graph_native", "workflow.decision_policy_json.runtime_mode"))
        if policy.get("source_of_truth") != "persisted_graph" or policy.get("legacy_step_runner_allowed") is not False:
            issues.append(WorkflowContractIssue("error", "V3_GRAPH_NOT_AUTHORITATIVE", "universal_v3 must use the persisted graph exclusively", "workflow.decision_policy_json"))
        entry_node_id = str(policy.get("entry_node_id") or "")
        starts = [node_id for node_id, count in incoming.items() if count == 0]
        terminals = [node_id for node_id, count in outgoing.items() if count == 0]
        if not entry_node_id:
            issues.append(WorkflowContractIssue("error", "V3_ENTRY_NODE_REQUIRED", "universal_v3 requires explicit entry_node_id", "workflow.decision_policy_json.entry_node_id"))
        elif entry_node_id not in enabled_ids:
            issues.append(WorkflowContractIssue("error", "V3_ENTRY_NODE_INVALID", "entry_node_id must reference an enabled graph node", "workflow.decision_policy_json.entry_node_id"))
        elif len(starts) == 1 and entry_node_id != starts[0]:
            issues.append(WorkflowContractIssue("error", "V3_ENTRY_NODE_MISMATCH", "entry_node_id must match the structural graph entry", "workflow.decision_policy_json.entry_node_id"))
        if len(starts) != 1:
            issues.append(WorkflowContractIssue("error", "INVALID_START_NODE", "universal_v3 requires exactly one enabled start node"))
        if not terminals:
            issues.append(WorkflowContractIssue("error", "NO_TERMINAL_NODE", "universal_v3 requires at least one enabled terminal node"))
        for node_id in terminals:
            node = nodes_by_id[node_id]
            terminal_ports = _mapping(node.get("config_json")).get("terminal_ports")
            declared_outputs = _node_ports(node, "control_outputs")
            if not isinstance(terminal_ports, list) or not terminal_ports:
                issues.append(WorkflowContractIssue("error", "V3_TERMINAL_PORT_REQUIRED", "Every terminal V3 node must declare terminal_ports", node_id=node_id))
                continue
            invalid_ports = [str(port) for port in terminal_ports if not isinstance(port, str) or port not in declared_outputs]
            if invalid_ports:
                issues.append(WorkflowContractIssue("error", "V3_TERMINAL_PORT_UNDECLARED", f"Terminal ports are not declared outputs: {', '.join(invalid_ports)}", node_id=node_id))
    return issues


def normalize_node_result(value: Mapping[str, Any]) -> dict[str, Any]:
    status = value.get("status")
    output_port = value.get("output_port")
    reason_code = value.get("reason_code")
    if status not in {"SUCCESS", "FAILED", "BLOCKED", "RETRYABLE", "SKIPPED", "CANCELLED"}:
        raise ValueError(f"Invalid workflow node status: {status}")
    if not isinstance(output_port, str) or not output_port:
        raise ValueError("output_port is required")
    if not isinstance(reason_code, str) or not reason_code:
        raise ValueError("reason_code is required")
    data = value.get("data", {})
    if not isinstance(data, Mapping):
        raise ValueError("data must be an object")
    return {
        "status": status,
        "output_port": output_port,
        "reason_code": reason_code,
        "message": value.get("message"),
        "data": dict(data),
        "state_patch": list(value.get("state_patch") or []),
        "metrics": dict(value.get("metrics") or {}),
        "artifacts": list(value.get("artifacts") or []),
        "diagnostics": dict(value.get("diagnostics") or {}),
    }

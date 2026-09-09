"""Private topology gate for the existing-installation orchestration.

The generic controller intentionally accepts partial inventories for tests and
for standalone participants.  This module is the stricter gate used only by
the existing-installation wrapper.  Roles are declared by bindings; names are
never interpreted as roles and release manifests remain legacy-compatible.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from typing import Any, Mapping

from .update_runtime_host_inventory import COMPONENTS as RUNTIME_COMPONENTS
from .update_transaction import TransactionFailure
from .update_transport import IDENTIFIER, ProcessParticipant

SCHEMA = 1
REQUIRED_COMPONENTS = frozenset({"backend", "frontend", "engine", "automation_worker", "db"})
TOPOLOGY_KEYS = {"schema", "scope", "required_components", "hosts", "bindings", "required_gates"}


class InstallationTopologyError(TransactionFailure):
    """The existing installation cannot be safely addressed as a whole."""


def validate(config: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and return the private topology without contacting hosts."""
    if not isinstance(config, Mapping):
        raise InstallationTopologyError("Installation configuration is required")
    topology = config.get("installation_topology")
    if not isinstance(topology, Mapping) or set(topology) != TOPOLOGY_KEYS:
        raise InstallationTopologyError("A complete private installation topology is required")
    if type(topology.get("schema")) is not int or topology["schema"] != SCHEMA:
        raise InstallationTopologyError("Invalid installation topology schema")
    scope = topology.get("scope")
    if not isinstance(scope, str) or not scope.strip() or "\x00" in scope:
        raise InstallationTopologyError("Installation topology scope is required")
    components = topology.get("required_components")
    if (not isinstance(components, list) or len(components) != len(REQUIRED_COMPONENTS)
            or set(components) != REQUIRED_COMPONENTS):
        raise InstallationTopologyError("The topology must declare all five fixed components")

    participants = config.get("participants")
    if not isinstance(participants, list) or not participants:
        raise InstallationTopologyError("A participant inventory is required")
    participant_ids = _participant_ids(participants)
    runtime_hosts = config.get("runtime_hosts")
    if not isinstance(runtime_hosts, list) or not runtime_hosts:
        raise InstallationTopologyError("A complete runtime host inventory is required")
    runtime_ids = _runtime_host_ids(runtime_hosts)
    runtime_map = {host["id"]: host for host in runtime_hosts}

    hosts = topology.get("hosts")
    if not isinstance(hosts, list) or not hosts:
        raise InstallationTopologyError("Topology hosts are required")
    host_map: dict[str, Mapping[str, Any]] = {}
    for host in hosts:
        if not isinstance(host, Mapping) or set(host) not in (
                {"id", "kind", "runtime_host"}, {"id", "kind", "participant"}):
            raise InstallationTopologyError("Topology host fields are invalid")
        host_id, kind = host.get("id"), host.get("kind")
        if (not isinstance(host_id, str) or not IDENTIFIER.fullmatch(host_id)
                or host_id in host_map or kind not in {"runtime", "participant"}):
            raise InstallationTopologyError("Topology host identity is invalid")
        if kind == "runtime":
            if set(host) != {"id", "kind", "runtime_host"} or host["runtime_host"] not in runtime_ids:
                raise InstallationTopologyError("Topology runtime host is not in runtime inventory")
        else:
            if set(host) != {"id", "kind", "participant"} or host["participant"] not in participant_ids:
                raise InstallationTopologyError("Topology participant host is not in participant inventory")
        host_map[host_id] = host
    if {host["runtime_host"] for host in host_map.values() if host["kind"] == "runtime"} != runtime_ids:
        raise InstallationTopologyError("Every runtime host must be explicitly mapped")

    bindings = topology.get("bindings")
    if not isinstance(bindings, list) or not bindings:
        raise InstallationTopologyError("Topology bindings are required")
    seen: set[tuple[str, str, str]] = set()
    bound_participants: set[str] = set()
    bound_hosts: set[str] = set()
    component_hosts: dict[str, set[str]] = {component: set() for component in REQUIRED_COMPONENTS}
    for binding in bindings:
        if not isinstance(binding, Mapping) or set(binding) != {"participant", "host", "component"}:
            raise InstallationTopologyError("Topology binding fields are invalid")
        participant, host, component = (binding.get("participant"), binding.get("host"),
                                        binding.get("component"))
        key = (participant, host, component)
        if (not isinstance(participant, str) or participant not in participant_ids
                or not isinstance(host, str) or host not in host_map
                or component not in REQUIRED_COMPONENTS or key in seen):
            raise InstallationTopologyError("Topology binding is invalid")
        seen.add(key)
        bound_participants.add(participant)
        bound_hosts.add(host)
        component_hosts[component].add(host)
        if component in RUNTIME_COMPONENTS and host_map[host]["kind"] != "runtime":
            raise InstallationTopologyError("Runtime component must bind to a runtime host")
        if (component in RUNTIME_COMPONENTS
                and component not in runtime_map[host_map[host]["runtime_host"]].get("components", [])):
            raise InstallationTopologyError("Runtime host does not declare the bound component")
        if component == "db" and host_map[host]["kind"] != "participant":
            raise InstallationTopologyError("Database must bind to an explicit participant host")
    if bound_participants != participant_ids:
        raise InstallationTopologyError("Every participant must be explicitly bound")
    participant_counts = {participant: 0 for participant in participant_ids}
    for binding in bindings:
        participant_counts[binding["participant"]] += 1
    if any(count != 1 for count in participant_counts.values()):
        raise InstallationTopologyError("Each participant must bind exactly one component")
    if bound_hosts != set(host_map):
        raise InstallationTopologyError("Every topology host must have an explicit binding")
    if any(not component_hosts[component] for component in REQUIRED_COMPONENTS):
        raise InstallationTopologyError("Every fixed component must be present on a host")

    _validate_gates(topology["required_gates"], config.get("admission_gates"), scope)
    participant_endpoints, runtime_endpoints = _endpoint_bindings(participants, runtime_hosts)
    _validate_endpoint_pairs(bindings, host_map, participant_endpoints, runtime_endpoints)
    value = json.loads(json.dumps(dict(topology), sort_keys=True))
    value["endpoint_bindings"] = {"participants": participant_endpoints,
                                   "runtime_hosts": runtime_endpoints}
    value["participant_ids"] = sorted(participant_ids)
    value["digest"] = _digest(value)
    return value


def controller_config(config: Mapping[str, Any]) -> dict[str, Any]:
    """Remove the wrapper-only topology before calling the generic controller."""
    result = dict(config)
    result.pop("installation_topology", None)
    return result


def digest(topology: Mapping[str, Any]) -> str:
    value = dict(topology)
    value.pop("digest", None)
    return _digest(value)


def validate_runtime_receipt_coverage(topology: Mapping[str, Any], prepared: Mapping[str, Any]) -> None:
    """Require every declared runtime role to have the existing host receipt."""
    hosts = prepared.get("hosts") if isinstance(prepared, Mapping) else None
    if not isinstance(hosts, Mapping):
        raise InstallationTopologyError("Runtime preparation host receipts are missing")
    runtime_host_ids = {
        item["runtime_host"] for item in topology["hosts"] if item["kind"] == "runtime"
    }
    if set(hosts) != runtime_host_ids:
        raise InstallationTopologyError("Runtime preparation does not cover all runtime hosts")
    for binding in topology["bindings"]:
        if binding["component"] not in RUNTIME_COMPONENTS:
            continue
        host_id = next(item["runtime_host"] for item in topology["hosts"]
                        if item["id"] == binding["host"])
        receipt = hosts[host_id]
        if receipt.get("status") != "prepared":
            raise InstallationTopologyError("Runtime host preparation is incomplete")
        host_receipt = receipt.get("receipts")
        if not isinstance(host_receipt, Mapping):
            raise InstallationTopologyError("Runtime host receipt is missing")
        images = host_receipt.get("images")
        if not isinstance(images, Mapping) or binding["component"] not in images:
            raise InstallationTopologyError("Runtime component receipt is missing")


def validate_terminal_result(result: Mapping[str, Any], participant_ids: set[str]) -> str:
    """Validate the controller summary without inventing database receipts."""
    if not isinstance(result, Mapping):
        raise InstallationTopologyError("Controller result is invalid")
    status, decision = result.get("status"), result.get("decision")
    if status not in {"complete", "rolled_back"} or decision not in {"commit", "rollback"}:
        raise InstallationTopologyError("Controller result is not terminal")
    if (status == "complete" and decision != "commit") or (status == "rolled_back" and decision != "rollback"):
        raise InstallationTopologyError("Controller result status and decision differ")
    participants = result.get("participants")
    allowed_operations = {"prepare", "quiesce", "snapshot", "apply", "start", "verify",
                          "activate", "finalize", "rollback", "verify_rollback"}
    if (not isinstance(participants, list) or len(participants) != len(participant_ids)
            or any(not isinstance(item, Mapping) or not isinstance(item.get("id"), str)
                   or item.get("pending") is not None
                   or not isinstance(item.get("completed"), list)
                   or any(operation not in allowed_operations for operation in item["completed"])
                   for item in participants)
            or {item["id"] for item in participants} != participant_ids):
        raise InstallationTopologyError("Controller result omits a participant")
    required = {"prepare", "quiesce", "snapshot", "apply", "start", "verify", "activate", "finalize"}
    if status == "complete":
        for item in participants:
            if not isinstance(item, Mapping) or not required <= set(item.get("completed", [])):
                raise InstallationTopologyError("Controller result has incomplete participant receipts")
    else:
        recovery = {"rollback", "start", "verify_rollback", "activate", "finalize"}
        for item in participants:
            completed = set(item["completed"])
            if completed and not recovery <= completed:
                raise InstallationTopologyError("Controller rollback evidence is incomplete")
    return status


def _participant_ids(participants: list[Any]) -> set[str]:
    ids: set[str] = set()
    for node in participants:
        if not isinstance(node, Mapping) or not isinstance(node.get("id"), str) or not IDENTIFIER.fullmatch(node["id"]):
            raise InstallationTopologyError("Participant identity is invalid")
        if node["id"] in ids:
            raise InstallationTopologyError("Participant IDs must be unique")
        ids.add(node["id"])
    return ids


def _runtime_host_ids(hosts: list[Any]) -> set[str]:
    ids: set[str] = set()
    for host in hosts:
        if not isinstance(host, Mapping) or not isinstance(host.get("id"), str) or host["id"] in ids:
            raise InstallationTopologyError("Runtime host identity is invalid")
        ids.add(host["id"])
    return ids


def _validate_gates(required: Any, configured: Any, scope: str) -> None:
    if not isinstance(required, list) or not required or not isinstance(configured, list):
        raise InstallationTopologyError("A non-empty admission gate binding is required")
    configured_ids = {item.get("id") for item in configured if isinstance(item, Mapping)}
    seen: set[str] = set()
    for gate in required:
        if (not isinstance(gate, Mapping) or set(gate) != {"id", "scope"}
                or not isinstance(gate.get("id"), str) or not IDENTIFIER.fullmatch(gate["id"])
                or gate["id"] in seen or gate["id"] not in configured_ids
                or gate.get("scope") != scope):
            raise InstallationTopologyError("Required admission gate binding is invalid")
        seen.add(gate["id"])


def _endpoint_bindings(participants: list[Any], runtime_hosts: list[Any]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    participant_result, runtime_result = {}, {}
    for node in participants:
        name = node["id"]
        if node["kind"] == "local":
            participant_result[name] = {"kind": "local"}
        elif node["kind"] == "ssh":
            participant_result[name] = _ssh_endpoint(node["alias"])
        else:
            raise InstallationTopologyError("Unsupported endpoint kind")
    for node in runtime_hosts:
        name = node["id"]
        if node["kind"] == "local":
            runtime_result[name] = {"kind": "local"}
        elif node["kind"] == "ssh":
            runtime_result[name] = _ssh_endpoint(node["alias"])
        else:
            raise InstallationTopologyError("Unsupported endpoint kind")
    return participant_result, runtime_result


def _ssh_endpoint(alias: str) -> dict[str, Any]:
    if not isinstance(alias, str) or not IDENTIFIER.fullmatch(alias):
        raise InstallationTopologyError("SSH alias is invalid")
    ssh = shutil.which("ssh")
    if not ssh:
        raise InstallationTopologyError("SSH executable is unavailable")
    base = ProcessParticipant.ssh("topology", alias)
    try:
        result = subprocess.run([ssh, "-G", *base.command[1:-1]], capture_output=True,
                                timeout=15, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise InstallationTopologyError("SSH endpoint resolution failed") from exc
    if result.returncode or len(result.stdout) > 1024 * 1024:
        raise InstallationTopologyError("SSH endpoint resolution failed")
    return {"kind": "ssh", "ssh_config_digest": hashlib.sha256(result.stdout).hexdigest()}


def _validate_endpoint_pairs(bindings: list[Any], hosts: Mapping[str, Any],
                             participant_endpoints: Mapping[str, Any],
                             runtime_endpoints: Mapping[str, Any]) -> None:
    for binding in bindings:
        participant_endpoint = participant_endpoints[binding["participant"]]
        host = hosts[binding["host"]]
        if host["kind"] == "runtime":
            host_endpoint = runtime_endpoints[host["runtime_host"]]
        else:
            host_endpoint = participant_endpoints[host["participant"]]
        if participant_endpoint != host_endpoint:
            raise InstallationTopologyError("Participant and host effective endpoints differ")


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

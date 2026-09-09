"""Coordinate signed runtime-image preparation across an explicit host inventory.

This module only prepares images.  It does not distribute the package, quiesce
participants, install images, or start services.  Host commands and SSH aliases
are private operator configuration; a release cannot select or replace them.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable, Mapping

from .edition.update_manager import verify_update_manifest_signature
from .update_journal import exclusive_lock, save_json
from .update_runtime_preparation_rpc import (FIXED_HELPER, ProcessRuntimePreparation,
                                              binding_identity)
from .update_transaction import TransactionFailure
from .update_transport import IDENTIFIER

SCHEMA = 1
COMPONENTS = frozenset({"backend", "frontend", "engine", "automation_worker"})
PLATFORMS = frozenset({"linux/amd64", "linux/arm64"})
MAX_TIMEOUT = 3600


class RuntimeHostPreparationError(TransactionFailure):
    """Preparation is incomplete; the private journal must be reconciled."""


ClientFactory = Callable[[dict[str, Any]], tuple[Any, dict[str, Any]]]


class RuntimeHostInventory:
    def __init__(self, config: Mapping[str, Any], manifest: Mapping[str, Any],
                 transaction: str, *, client_factory: ClientFactory | None = None):
        _validate_config(config)
        if not isinstance(manifest, Mapping) or not IDENTIFIER.fullmatch(transaction):
            raise ValueError("Explicit release manifest and transaction required")
        self.config = json.loads(json.dumps(dict(config)))
        self.manifest = json.loads(json.dumps(dict(manifest)))
        self.transaction = transaction
        self.client_factory = client_factory or _default_client

    def prepare(self) -> dict[str, Any]:
        _verify_manifest(self.manifest)
        directory = Path(self.config["directory"])
        clients, endpoints = self._clients()
        binding = _binding(self.config, self.manifest, self.transaction, endpoints)
        journal = directory / f"{self.transaction}.json"
        with exclusive_lock(directory / f"{self.transaction}.lock"):
            state = _read_journal(journal)
            if state is not None:
                if state.get("binding") != binding:
                    raise RuntimeHostPreparationError(
                        "Runtime host inventory, release, or endpoint binding changed")
                hosts = state.get("hosts")
                if not isinstance(hosts, dict):
                    raise RuntimeHostPreparationError("Invalid runtime host journal")
                # Cached receipts are evidence, not proof that the host still
                # has the images.  Replay reconciles every host through the
                # same idempotent helper before emitting readiness again.
                state["status"] = "preparing"
                save_json(journal, state)
            else:
                hosts = {host["id"]: {"status": "pending", "receipts": {}}
                         for host in self.config["runtime_hosts"]}
                state = {"schema": SCHEMA, "binding": binding, "status": "preparing",
                         "transaction": self.transaction, "hosts": hosts}
                save_json(journal, state)

            for host in self.config["runtime_hosts"]:
                host_id = host["id"]
                current = hosts[host_id]
                current.update(status="attempted")
                save_json(journal, state)
                try:
                    receipt = clients[host_id].prepare(self.transaction, self.manifest)
                    _validate_host_receipt(receipt, host, self.manifest, self.transaction)
                    current.update(status="prepared", receipts=receipt)
                    save_json(journal, state)
                except Exception as exc:
                    current["status"] = "uncertain"
                    save_json(journal, state)
                    raise RuntimeHostPreparationError(
                        f"Host {host_id} preparation is uncertain; reconcile the same host") from exc

            if set(hosts) != {host["id"] for host in self.config["runtime_hosts"]}:
                raise RuntimeHostPreparationError("Runtime host journal omits a configured host")
            for host in self.config["runtime_hosts"]:
                _validate_host_receipt(hosts[host["id"]].get("receipts"), host,
                                       self.manifest, self.transaction)
            state["status"] = "ready_for_adoption"
            save_json(journal, state)
            return _result(state)

    def plan(self) -> dict[str, Any]:
        """Validate the private inventory without resolving or contacting hosts."""
        _verify_manifest(self.manifest)
        endpoints = {
            host["id"]: ({"kind": "local", "command": list(host["command"])}
                         if host["kind"] == "local"
                         else {"kind": "ssh", "alias": host["alias"]})
            for host in self.config["runtime_hosts"]
        }
        binding = _binding(self.config, self.manifest, self.transaction, endpoints)
        return {"schema": SCHEMA, "status": "plan_validated", "transaction": self.transaction,
                "runtime_hosts": [host["id"] for host in self.config["runtime_hosts"]],
                "components": {host["id"]: list(host["components"])
                                for host in self.config["runtime_hosts"]},
                "inventory_identity": binding["sha256"], "participants_contacted": False}

    def endpoint_bindings(self) -> dict[str, Any]:
        """Resolve operator bindings without contacting a remote host."""
        _, endpoints = self._clients()
        return endpoints

    def _clients(self) -> tuple[dict[str, Any], dict[str, Any]]:
        clients, endpoints = {}, {}
        for host in self.config["runtime_hosts"]:
            client, endpoint = self.client_factory(dict(host))
            clients[host["id"]] = client
            endpoints[host["id"]] = endpoint
        return clients, endpoints


def _default_client(host: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    timeout = host.get("timeout_seconds", 300)
    if host["kind"] == "local":
        command = tuple(host["command"])
        client = ProcessRuntimePreparation(host["id"], command, host["helper_identity"],
                                           timeout)
        return client, {"kind": "local", "command": list(command)}
    client, ssh_binding = ProcessRuntimePreparation.ssh(
        host["id"], host["alias"], host["helper_identity"], timeout)
    return client, {"kind": "ssh", "alias": host["alias"], **ssh_binding}


def _validate_config(config: Mapping[str, Any]) -> None:
    if not isinstance(config, Mapping) or set(config) != {"schema", "directory", "runtime_hosts"} \
            or type(config.get("schema")) is not int or config["schema"] != SCHEMA:
        raise ValueError("Runtime host inventory schema or keys invalid")
    directory = config.get("directory")
    if (not isinstance(directory, str) or not Path(directory).is_absolute()
            or len(Path(directory).parts) < 3 or ".." in Path(directory).parts):
        raise ValueError("A dedicated absolute host-preparation journal directory is required")
    hosts = config.get("runtime_hosts")
    if not isinstance(hosts, list) or not hosts:
        raise ValueError("An explicit runtime host inventory is required")
    seen, declared = set(), []
    for host in hosts:
        if not isinstance(host, Mapping):
            raise ValueError("Invalid runtime host")
        allowed = {"id", "kind", "command", "alias", "helper_identity",
                   "components", "platform", "timeout_seconds"}
        if set(host) - allowed or not {"id", "kind", "helper_identity", "components", "platform"} <= set(host):
            raise ValueError("Runtime host fields are incomplete")
        host_id = host["id"]
        if not isinstance(host_id, str) or not IDENTIFIER.fullmatch(host_id) or host_id in seen:
            raise ValueError("Runtime host IDs must be valid and unique")
        seen.add(host_id)
        if host["kind"] == "local":
            if set(host) - {"id", "kind", "command", "helper_identity", "components", "platform", "timeout_seconds"} \
                    or not isinstance(host.get("command"), list) or not host["command"]:
                raise ValueError("Local runtime host requires an operator command")
            command = host["command"]
            if (not all(isinstance(arg, str) and arg and "\0" not in arg for arg in command)
                    or not Path(command[0]).is_absolute() or command[-1] != FIXED_HELPER):
                raise ValueError("Local runtime host requires the fixed helper as last argv")
        elif host["kind"] == "ssh":
            if set(host) - {"id", "kind", "alias", "helper_identity", "components", "platform", "timeout_seconds"} \
                    or not isinstance(host.get("alias"), str) or not IDENTIFIER.fullmatch(host["alias"]):
                raise ValueError("SSH runtime host requires a strict config alias")
        else:
            raise ValueError("Unsupported runtime host kind")
        if (not isinstance(host["helper_identity"], str)
                or len(host["helper_identity"]) != 64
                or any(c not in "0123456789abcdef" for c in host["helper_identity"])):
            raise ValueError("Runtime helper identity must be a SHA-256 hex digest")
        components = host["components"]
        if (not isinstance(components, list) or not components or len(set(components)) != len(components)
                or any(component not in COMPONENTS for component in components)):
            raise ValueError("Runtime host components must be explicit and unique")
        if host["platform"] not in PLATFORMS:
            raise ValueError("Runtime host platform must be explicit")
        timeout = host.get("timeout_seconds", 300)
        if (isinstance(timeout, bool) or not isinstance(timeout, (int, float))
                or not math.isfinite(timeout) or not 0 < timeout <= MAX_TIMEOUT):
            raise ValueError("Runtime host timeout is invalid")
        declared.extend(components)
    if set(declared) != COMPONENTS:
        raise ValueError("Runtime host components must cover every required component")


def _verify_manifest(manifest: Mapping[str, Any]) -> None:
    valid, error = verify_update_manifest_signature(dict(manifest))
    if not valid:
        raise RuntimeHostPreparationError(error or "Release signature is invalid")
    if not isinstance(manifest.get("version"), str) or not manifest["version"]:
        raise RuntimeHostPreparationError("Release version is required")
    if (not isinstance(manifest.get("checksum_sha256"), str)
            or len(manifest["checksum_sha256"]) != 64
            or any(c not in "0123456789abcdef" for c in manifest["checksum_sha256"])):
        raise RuntimeHostPreparationError("Release checksum is invalid")


def _binding(config: Mapping[str, Any], manifest: Mapping[str, Any], transaction: str,
             endpoints: Mapping[str, Any]) -> dict[str, Any]:
    release = {key: manifest.get(key) for key in
               ("version", "checksum_sha256", "package_size_bytes", "signature", "key_id")}
    value = {"config": config, "endpoints": endpoints, "release": release,
             "transaction": transaction}
    digest = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"sha256": digest, **value}


def _validate_host_receipt(receipt: Any, host: Mapping[str, Any], manifest: Mapping[str, Any],
                           transaction: str) -> None:
    expected = {"schema", "ok", "transaction", "helper_identity", "version",
                "checksum_sha256", "images", "receipts", "binding_sha256"}
    if (not isinstance(receipt, Mapping) or set(receipt) != expected
            or receipt.get("schema") != 1 or receipt.get("ok") is not True
            or receipt.get("transaction") != transaction):
        raise RuntimeHostPreparationError("Host receipt transaction mismatch")
    if receipt.get("version") != manifest.get("version") or receipt.get("checksum_sha256") != manifest.get("checksum_sha256"):
        raise RuntimeHostPreparationError("Host receipt release mismatch")
    if receipt.get("helper_identity") != host["helper_identity"]:
        raise RuntimeHostPreparationError("Host receipt helper identity mismatch")
    images = receipt.get("images")
    if not isinstance(images, Mapping) or set(images) != set(host["components"]):
        raise RuntimeHostPreparationError("Host image receipt omits or adds a runtime component")
    if receipt.get("binding_sha256") != binding_identity(
            host["helper_identity"], transaction, manifest, images, receipt["receipts"]):
        raise RuntimeHostPreparationError("Host receipt binding mismatch")
    _validate_receipt_set(receipt.get("receipts"), host, manifest, transaction)
    for component in host["components"]:
        if images[component] != receipt["receipts"][component]["image"]:
            raise RuntimeHostPreparationError("Host image and receipt digests differ")


def _validate_receipt_set(receipts: Any, host: Mapping[str, Any], manifest: Mapping[str, Any],
                          transaction: str) -> None:
    if not isinstance(receipts, Mapping) or set(receipts) != set(host["components"]):
        raise RuntimeHostPreparationError("Host receipt omits or adds a runtime component")
    for component in host["components"]:
        item = receipts[component]
        if (not isinstance(item, Mapping) or item.get("component") != component
                or item.get("platform") != host["platform"]
                or not isinstance(item.get("image"), str)
                or not item["image"].startswith("sha256:")
                or len(item["image"]) != 71):
            raise RuntimeHostPreparationError("Host image receipt is not pinned to its declared platform")


def _read_journal(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise RuntimeHostPreparationError("Invalid runtime host journal") from exc
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise RuntimeHostPreparationError("Invalid runtime host journal")
    return value


def _result(state: Mapping[str, Any]) -> dict[str, Any]:
    return {"schema": SCHEMA, "status": state["status"],
            "ready_for_adoption": state["status"] == "ready_for_adoption",
            "transaction": state["transaction"], "hosts": state["hosts"]}


def prepare_runtime_hosts(config: Mapping[str, Any], manifest: Mapping[str, Any],
                          transaction: str, **kwargs: Any) -> dict[str, Any]:
    return RuntimeHostInventory(config, manifest, transaction, **kwargs).prepare()


def validate_runtime_host_inventory(config: Mapping[str, Any]) -> None:
    """Validate a host-only projection without opening any endpoint."""
    _validate_config(config)

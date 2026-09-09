"""Operator entrypoint for a signed update and an explicit local/SSH inventory.

Plan is read-only and does not contact participants. Run starts a transaction or
reconciles its existing journal; only the configured participant commands mutate
hosts. Bootstrap, artifact transfer and application drivers remain separate.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from .edition.update_manager import verify_update_manifest_signature
from .update_participant_commands import load_private_json
from .update_transaction import UpdateTransaction, activation_sequence, quiesce_sequence
from .update_transport import IDENTIFIER, ProcessParticipant
from .update_gate_inventory import configured_gates
from .update_runtime_host_inventory import (RuntimeHostInventory,
                                             validate_runtime_host_inventory)


def validated_inventory(config, *, legacy_gate_factory=None):
    if (set(config) - {"schema", "directory", "participants", "runtime_hosts", 'activation_order', 'quiesce_order', 'admission_gates'}
            or not {"schema", "directory", "participants"} <= set(config) or config["schema"] != 1):
        raise ValueError("Invalid controller configuration")
    directory = Path(config["directory"])
    if not directory.is_absolute() or len(directory.parts) < 3 or ".." in directory.parts:
        raise ValueError("A dedicated absolute controller journal directory is required")
    if not isinstance(config["participants"], list) or not config["participants"]:
        raise ValueError("An explicit participant inventory is required")
    participants, bindings = {}, []
    for node in config["participants"]:
        if not isinstance(node, dict) or node.get("kind") not in {"local", "ssh"}:
            raise ValueError("Unsupported participant transport")
        field = "command" if node["kind"] == "local" else "alias"
        if set(node) - {"id", "kind", field, "timeout_seconds"} or not {"id", "kind", field} <= set(node):
            raise ValueError("Invalid participant endpoint fields")
        name = node["id"]
        if not isinstance(name, str) or not IDENTIFIER.fullmatch(name) or name in participants:
            raise ValueError("Participant IDs must be valid and unique")
        timeout = node.get("timeout_seconds", 300)
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool):
            raise ValueError("Invalid participant timeout")
        binding = dict(node)
        if node["kind"] == "local":
            command = node["command"]
            if (not isinstance(command, list) or not command
                    or not all(isinstance(arg, str) and arg and "\0" not in arg for arg in command)
                    or not Path(command[0]).is_absolute()):
                raise ValueError("Local participant requires an absolute executable argv")
            participant = ProcessParticipant(name, tuple(command), timeout)
        else:
            if not isinstance(node["alias"], str):
                raise ValueError("An SSH configuration alias is required")
            participant = ProcessParticipant.ssh(name, node["alias"], timeout)
            ssh = shutil.which("ssh")
            if not ssh:
                raise ValueError("SSH executable is unavailable")
            # Resolve the operator's SSH config without opening a connection.
            # Bind its effective destination/options to this transaction too.
            resolved = subprocess.run([ssh, "-G", *participant.command[1:-1]],
                                      capture_output=True, timeout=15, check=False)
            if resolved.returncode or len(resolved.stdout) > 1024 * 1024:
                raise ValueError("Unable to resolve SSH endpoint configuration")
            binding["ssh_config_digest"] = hashlib.sha256(resolved.stdout).hexdigest()
            binding["ssh_executable"] = ssh
            participant = ProcessParticipant(name, (ssh, *participant.command[1:]), timeout)
        participants[name] = participant
        bindings.append(binding)
    if 'activation_order' in config and not isinstance(config['activation_order'], list):
        raise ValueError('Activation order must be an explicit list')
    order = activation_sequence(participants, config.get('activation_order'))
    quiesce_order = quiesce_sequence(participants, config.get('quiesce_order'))
    _, gate_bindings = configured_gates(config.get('admission_gates', []),
                                       legacy_gate_factory=legacy_gate_factory)
    host_config = _runtime_host_config(config, directory) if "runtime_hosts" in config else None
    if host_config is not None:
        validate_runtime_host_inventory(host_config)
    # Preserve identity for existing inventories without ingress entries.
    identity = [bindings, order]
    if 'quiesce_order' in config:
        identity.append(quiesce_order)
    if gate_bindings:
        identity.append(gate_bindings)
    if host_config is not None:
        identity.append({"runtime_hosts": host_config["runtime_hosts"],
                         "runtime_directory": host_config["directory"]})
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    return directory, participants, digest


def summary(state):
    return {"transaction": state["id"], "status": state["status"],
            "version": state["release"]["version"], "decision": state.get("decision"),
            "participants": [{"id": name, "pending": node.get("pending"),
                              "completed": node.get("completed", [])}
                             for name, node in state["participants"].items()]}


def execute(config, manifest, transaction, *, plan=False, distribute=False,
            prepare_runtimes=False, package=None, legacy_gate_factory=None):
    if sum(bool(value) for value in (plan, distribute, prepare_runtimes)) > 1:
        raise ValueError("Controller actions are mutually exclusive")
    if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
        raise ValueError("Invalid transaction identifier")
    if not isinstance(manifest, dict):
        raise ValueError("A signed manifest object is required")
    valid, _ = verify_update_manifest_signature(manifest)
    if not valid:
        raise ValueError("Release signature is invalid")
    directory, participants, digest = validated_inventory(config,
                                                          legacy_gate_factory=legacy_gate_factory)
    host_config = _runtime_host_config(config, directory) if "runtime_hosts" in config else None
    if prepare_runtimes:
        if package is not None:
            raise ValueError("Runtime preparation requires a pre-distributed cache")
        if host_config is None:
            raise ValueError("runtime_hosts are required for runtime preparation")
        return RuntimeHostInventory(host_config, manifest, transaction).prepare()
    gates, _ = configured_gates(config.get('admission_gates', []),
                               legacy_gate_factory=legacy_gate_factory)
    if distribute:
        if plan or not isinstance(package, Path):
            raise ValueError("Distribution requires a local package path")
        receipts = [node.send_artifact(transaction, manifest, package) for node in participants.values()]
        return {"transaction": transaction, "status": "distributed", "version": manifest["version"],
                "participants": [receipt["participant"] for receipt in receipts],
                "checksum_sha256": manifest["checksum_sha256"]}
    if plan:
        result = {"transaction": transaction, "status": "plan_validated",
                "version": manifest["version"], "participants": list(participants),
                'activation_order': activation_sequence(participants, config.get('activation_order')),
                **({'quiesce_order': quiesce_sequence(participants, config['quiesce_order'])}
                   if 'quiesce_order' in config else {}),
                'admission_gates': list(gates),
                "inventory_identity": digest, "participants_contacted": False}
        if host_config is not None:
            result["runtime_preparation"] = RuntimeHostInventory(
                host_config, manifest, transaction).plan()
        return result
    state = UpdateTransaction(directory / (transaction + ".json"), participants,
                              inventory_identity=digest, activation_order=config.get('activation_order'),
                              quiesce_order=config.get('quiesce_order'),
                              admission_gates=gates).run(transaction, manifest)
    return summary(state)


def _runtime_host_config(config, controller_directory):
    return {"schema": 1, "directory": str(controller_directory / "runtime-preparation"),
            "runtime_hosts": config["runtime_hosts"]}


def main():
    parser = argparse.ArgumentParser(description="Treseko signed multi-participant update controller")
    parser.add_argument("action", nargs="?", choices=("plan", "distribute", "run"))
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--plan", action="store_true")
    actions.add_argument("--distribute", action="store_true")
    actions.add_argument("--run", action="store_true")
    actions.add_argument("--prepare-runtimes", dest="prepare_runtimes", action="store_true")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--transaction", required=True)
    parser.add_argument("--package", type=Path, help="Local archive, required only for distribute")
    args = parser.parse_args()
    try:
        flags = [name for name in ("plan", "distribute", "run", "prepare_runtimes")
                 if getattr(args, name)]
        if args.action and flags:
            raise ValueError("Choose one controller action form")
        action = args.action or ("prepare-runtimes" if flags and flags[0] == "prepare_runtimes"
                                 else (flags[0] if flags else None))
        if action is None:
            raise ValueError("A controller action is required")
        config = load_private_json(args.config)
        with args.manifest.open("rb") as stream:
            raw = stream.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Manifest exceeds limit")
        if (action == "distribute") != (args.package is not None):
            raise ValueError("Use --package only with distribute")
        result = execute(config, json.loads(raw), args.transaction, plan=action == "plan",
                         distribute=action == "distribute", prepare_runtimes=action == "prepare-runtimes",
                         package=args.package)
    except Exception:
        print(json.dumps({"ok": False, "error": "controller_request_failed"}))
        return 1
    print(json.dumps(result))
    if result["status"] in {"plan_validated", "distributed", "complete", "ready_for_adoption"}:
        return 0
    return 2 if result["status"] == "rolled_back" else 3


if __name__ == "__main__":
    raise SystemExit(main())

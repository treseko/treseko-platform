"""Safe user-facing orchestration for an existing signed installation.

This wrapper sequences the already-owned controller API.  It does not install
helpers, configure SSH, invent legacy bootstrap, or perform service operations
outside ``controller.execute``.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
from typing import Any, Mapping

from . import update_controller_cli as controller
from . import update_runtime_host_inventory as host_inventory
from . import update_installation_topology as topology
from .update_journal import exclusive_lock, save_json
from .update_participant_commands import load_private_json
from .update_existing_installation_errors import ExistingInstallationError
from .update_transport import IDENTIFIER
from .update_participant_package import stage_verified_package

SCHEMA = 1
STAGES = {"planned", "distribution_pending", "distributed", "preparation_pending",
          "prepared", "apply_pending", "apply_uncertain", "complete", "rolled_back"}
from .update_complete_source import (
    COMPLETE_SOURCE_DEPLOYMENT, _complete_source_settings, _load_or_stage_complete_source,
    _require_local_compose_installation, _run_atomic_source, _source_tree_digest,
)


def _requires_complete_source(manifest: Mapping[str, Any]) -> bool:
    """Validate the signed mode and select the matching host activation path."""
    deployment = manifest.get("deployment")
    if deployment is None:
        return False
    if deployment != COMPLETE_SOURCE_DEPLOYMENT:
        raise ExistingInstallationError("Unsupported signed deployment contract")
    return True


def _complete_source_state_root(config: Mapping[str, Any], transaction: str) -> tuple[Path, Path]:
    directory, journal = _paths(config, transaction)
    return directory / "complete-source-stages", journal


def _prepare_complete_source(config: Mapping[str, Any], manifest: Mapping[str, Any],
                             transaction: str, package: Path) -> dict[str, Any]:
    if not package.is_file() or package.is_symlink():
        raise ExistingInstallationError("Signed local package is required")
    settings = _complete_source_settings(config)
    directory, journal = _paths(config, transaction)
    identities = _identities(config, manifest, transaction)
    preview = plan(config, manifest, transaction)
    with exclusive_lock(directory / ".lock"):
        state = _read(journal)
        if state is not None:
            _assert_binding(state, identities)
            if state.get("deployment_mode") != "complete-source":
                raise ExistingInstallationError("Transaction is bound to another deployment mode")
            if state.get("stage") not in {"preparation_pending", "prepared"}:
                raise ExistingInstallationError("Complete-source preparation journal is not resumable")
        else:
            state = {"schema": SCHEMA, "transaction": transaction,
                     "identities": identities, "deployment_mode": "complete-source",
                     "stage": "preparation_pending", "plan": _safe_plan(preview)}
            _save(directory, journal, state)
        try:
            candidate, tree_digest = _load_or_stage_complete_source(
                config, manifest, transaction, package)
            validation = _run_atomic_source(candidate, settings, transaction,
                                            str(manifest.get("version") or ""), mode="validate")
        except Exception:
            state["stage"] = "preparation_pending"
            _save(directory, journal, state)
            raise
        state.update(stage="prepared", candidate_root=str(candidate),
                     candidate_tree_sha256=tree_digest,
                     preparation={"status": "ready_for_adoption",
                                  "candidate_services": validation.get("candidate_services", [])})
        _save(directory, journal, state)
        return _safe_state(state) | {"preparation": state["preparation"]}


def _apply_complete_source(config: Mapping[str, Any], manifest: Mapping[str, Any],
                           transaction: str, *, resume_attempt: bool = False) -> dict[str, Any]:
    directory, journal = _paths(config, transaction)
    identities = _identities(config, manifest, transaction)
    with exclusive_lock(directory / ".lock"):
        state = _read(journal)
        allowed = {"apply_pending", "apply_uncertain"} if resume_attempt else {"prepared"}
        if state is None or state.get("stage") not in allowed:
            message = "No atomic Compose application can be reconciled" if resume_attempt else \
                "Complete-source preparation is required before apply"
            raise ExistingInstallationError(message)
        _assert_binding(state, identities)
        if state.get("deployment_mode") != "complete-source":
            raise ExistingInstallationError("Transaction is bound to another deployment mode")
        candidate = Path(state.get("candidate_root") or "")
        settings = _complete_source_settings(config)
        if _source_tree_digest(candidate) != state.get("candidate_tree_sha256"):
            raise ExistingInstallationError("Prepared complete-source files changed")
        state["stage"] = "apply_pending"
        _save(directory, journal, state)
        try:
            result = _run_atomic_source(
                candidate, settings, transaction, str(manifest.get("version") or ""),
                mode="resume" if resume_attempt else "apply")
        except Exception as exc:
            state["stage"] = "apply_uncertain"
            _save(directory, journal, state)
            raise ExistingInstallationError("Atomic Compose outcome is uncertain; resume this transaction") from exc
        phase = result.get("phase")
        if phase == "committed":
            state.update(stage="complete", result_status="complete")
        elif phase == "rolled_back":
            state.update(stage="rolled_back", result_status="rolled_back")
        else:
            state.update(stage="apply_uncertain", result_status="apply_uncertain")
        state["apply"] = {"status": state["result_status"], "transaction": transaction,
                          "version": str(manifest.get("version") or "")}
        _save(directory, journal, state)
        return _safe_state(state) | {"apply": state["apply"]}


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _identities(config: Mapping[str, Any], manifest: Mapping[str, Any], transaction: str) -> dict[str, str]:
    return {"config": _digest(config), "release": _digest(manifest), "transaction": transaction}


def _paths(config: Mapping[str, Any], transaction: str) -> tuple[Path, Path]:
    if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
        raise ExistingInstallationError("Invalid transaction identifier")
    directory = _safe_orchestration_directory(config)
    return directory, directory / f"{transaction}.json"


def _read(path: Path) -> dict[str, Any] | None:
    if path.is_symlink():
        raise ExistingInstallationError("Unsafe orchestration journal path")
    if not path.exists():
        return None
    if not path.is_file():
        raise ExistingInstallationError("Unsafe orchestration journal path")
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise ExistingInstallationError("Invalid orchestration journal") from exc
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ExistingInstallationError("Invalid orchestration journal")
    return value


def _assert_binding(state: Mapping[str, Any], identities: Mapping[str, str]) -> None:
    if state.get("identities") != dict(identities):
        raise ExistingInstallationError("Transaction, release, or configuration changed")


def _safe_state(state: Mapping[str, Any]) -> dict[str, Any]:
    return {key: state[key] for key in ("schema", "transaction", "stage", "identities")
            if key in state} | {"status": state.get("result_status", state.get("stage"))}


def _save(directory: Path, path: Path, state: dict[str, Any]) -> None:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    save_json(path, state)


def plan(config: Mapping[str, Any], manifest: Mapping[str, Any], transaction: str) -> dict[str, Any]:
    """Validate both inventories through the controller without creating a journal."""
    if _requires_complete_source(manifest):
        _require_local_compose_installation(config)
        settings = _complete_source_settings(config)
        return {"status": "plan_validated", "deployment_mode": "complete-source",
                "atomic_compose": True, "project": settings["project"]}
    topology.validate(config)
    return controller.execute(topology.controller_config(config), dict(manifest), transaction, plan=True)


def prepare(config: Mapping[str, Any], manifest: Mapping[str, Any], transaction: str,
            package: Path) -> dict[str, Any]:
    if _requires_complete_source(manifest):
        return _prepare_complete_source(config, manifest, transaction, package)
    if not isinstance(package, Path) or not package.is_file():
        raise ExistingInstallationError("Signed local package is required")
    topology_state = topology.validate(config)
    identities = _identities(config, manifest, transaction)
    directory, journal = _paths(config, transaction)
    preview = plan(config, manifest, transaction)
    with exclusive_lock(directory / ".lock"):
        state = _read(journal)
        if state is not None:
            _assert_binding(state, identities)
            if state.get("topology_digest") != topology_state["digest"]:
                raise ExistingInstallationError("Installation topology changed")
        else:
            state = {"schema": SCHEMA, "transaction": transaction, "identities": identities,
                     "topology_digest": topology_state["digest"], "stage": "planned",
                     "plan": _safe_plan(preview)}
            _save(directory, journal, state)
        if state.get("stage") not in {"planned", "distribution_pending", "distributed",
                                       "preparation_pending", "prepared"}:
            raise ExistingInstallationError("Preparation journal is not resumable")
        if state.get("stage") in {"planned", "distribution_pending"}:
            state["stage"] = "distribution_pending"
            _save(directory, journal, state)
            try:
                receipt = controller.execute(topology.controller_config(config), dict(manifest), transaction,
                                             distribute=True, package=package)
            except Exception as exc:
                state["stage"] = "distribution_pending"
                _save(directory, journal, state)
                raise ExistingInstallationError("Artifact distribution is uncertain") from exc
            state.update(stage="distributed", distribution=_safe_result(receipt))
            _save(directory, journal, state)
        state["stage"] = "preparation_pending"
        _save(directory, journal, state)
        try:
            result = controller.execute(topology.controller_config(config), dict(manifest), transaction,
                                        prepare_runtimes=True)
        except Exception as exc:
            _save(directory, journal, state)
            raise ExistingInstallationError("Runtime preparation is incomplete") from exc
        if result.get("status") != "ready_for_adoption" or result.get("ready_for_adoption") is not True:
            _save(directory, journal, state)
            raise ExistingInstallationError("Runtime preparation is incomplete")
        state.update(stage="prepared", preparation=_safe_result(result))
        _save(directory, journal, state)
        return _safe_state(state) | {"preparation": state["preparation"]}


def apply(config: Mapping[str, Any], manifest: Mapping[str, Any], transaction: str) -> dict[str, Any]:
    if _requires_complete_source(manifest):
        return _apply_complete_source(config, manifest, transaction)
    identities = _identities(config, manifest, transaction)
    directory, journal = _paths(config, transaction)
    with exclusive_lock(directory / ".lock"):
        state = _read(journal)
        if state is None:
            raise ExistingInstallationError("Runtime preparation is required before apply")
        _assert_binding(state, identities)
        topology_state = topology.validate(config)
        if state.get("topology_digest") != topology_state["digest"]:
            raise ExistingInstallationError("Installation topology changed")
        if state.get("stage") != "prepared":
            raise ExistingInstallationError("Runtime preparation is not complete")
        _require_runtime_preparation(config, manifest, transaction, topology_state)
        # A read-only controller plan validates gates, participants and both
        # inventories before the apply intent is persisted.
        controller.execute(topology.controller_config(config), dict(manifest), transaction, plan=True)
        state["stage"] = "apply_pending"
        _save(directory, journal, state)
        try:
            result = controller.execute(topology.controller_config(config), dict(manifest), transaction)
        except Exception as exc:
            state["stage"] = "apply_uncertain"
            _save(directory, journal, state)
            raise ExistingInstallationError("Apply outcome is uncertain; use resume") from exc
        _complete_or_retain(state, result, directory, journal, topology_state)
        _save(directory, journal, state)
        return _safe_state(state) | {"apply": state["apply"]}


def resume(config: Mapping[str, Any], manifest: Mapping[str, Any], transaction: str) -> dict[str, Any]:
    if _requires_complete_source(manifest):
        return _apply_complete_source(config, manifest, transaction, resume_attempt=True)
    identities = _identities(config, manifest, transaction)
    directory, journal = _paths(config, transaction)
    with exclusive_lock(directory / ".lock"):
        state = _read(journal)
        if state is None or state.get("stage") not in {"apply_pending", "apply_uncertain"}:
            raise ExistingInstallationError("No attempted application can be reconciled")
        _assert_binding(state, identities)
        topology_state = topology.validate(config)
        if state.get("topology_digest") != topology_state["digest"]:
            raise ExistingInstallationError("Installation topology changed")
        try:
            result = controller.execute(topology.controller_config(config), dict(manifest), transaction)
        except Exception as exc:
            state["stage"] = "apply_uncertain"
            _save(directory, journal, state)
            raise ExistingInstallationError("Apply remains uncertain; retry resume") from exc
        _complete_or_retain(state, result, directory, journal, topology_state)
        _save(directory, journal, state)
        return _safe_state(state) | {"apply": state["apply"]}


def status(config: Mapping[str, Any], transaction: str | None = None) -> dict[str, Any]:
    """Read actual orchestration journals without validating or mutating hosts."""
    directory = _safe_orchestration_directory(config)
    if transaction:
        if not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
            raise ExistingInstallationError("Invalid transaction identifier")
        paths = [directory / f"{transaction}.json"]
    else:
        paths = ([path for path in sorted(directory.glob("*.json"))
                  if IDENTIFIER.fullmatch(path.stem) and not path.is_symlink()]
                 if directory.is_dir() and not directory.is_symlink() else [])
    journals = []
    for path in paths:
        state = _read(path)
        if state is not None:
            journals.append(_safe_state(state))
    return {"schema": SCHEMA, "status": "status", "journals": journals}


def _safe_plan(value: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value[key] for key in ("status", "inventory_identity", "runtime_preparation")
            if key in value}


def _require_runtime_preparation(config: Mapping[str, Any], manifest: Mapping[str, Any],
                                 transaction: str, topology_state: Mapping[str, Any] | None = None) -> None:
    topology_state = topology_state or topology.validate(config)
    hosts = config.get("runtime_hosts")
    if not isinstance(hosts, list) or not hosts:
        raise ExistingInstallationError("Runtime host preparation inventory is required")
    host_config = {"schema": 1,
                   "directory": str(Path(config["directory"]) / "runtime-preparation"),
                   "runtime_hosts": config["runtime_hosts"]}
    host_inventory.validate_runtime_host_inventory(host_config)
    path = Path(host_config["directory"]) / f"{transaction}.json"
    state = _read(path)
    binding = state.get("binding") if isinstance(state, dict) else None
    if state is None or state.get("status") != "ready_for_adoption" or not isinstance(binding, dict):
        raise ExistingInstallationError("Runtime preparation journal is not ready")
    endpoints = binding.get("endpoints")
    if not isinstance(endpoints, dict):
        raise ExistingInstallationError("Runtime preparation binding is incomplete")
    current_endpoints = host_inventory.RuntimeHostInventory(
        host_config, manifest, transaction).endpoint_bindings()
    if current_endpoints != endpoints:
        raise ExistingInstallationError("Runtime host endpoint binding changed")
    expected_binding = host_inventory._binding(host_config, manifest, transaction, current_endpoints)
    if binding != expected_binding:
        raise ExistingInstallationError("Runtime preparation release or inventory binding changed")
    prepared = state.get("hosts")
    if (not isinstance(prepared, dict)
            or set(prepared) != {host.get("id") for host in hosts}
            or any(node.get("status") != "prepared" for node in prepared.values())):
        raise ExistingInstallationError("Runtime host preparation is incomplete")
    for host in hosts:
        node = prepared[host["id"]]
        host_inventory._validate_host_receipt(node.get("receipts"), host, manifest, transaction)
    topology.validate_runtime_receipt_coverage(topology_state, {"hosts": prepared})


def _safe_orchestration_directory(config: Mapping[str, Any]) -> Path:
    value = config.get("directory")
    path = Path(value) if isinstance(value, str) else Path(".")
    if (not isinstance(value, str) or not path.is_absolute() or ".." in path.parts
            or path.is_symlink()):
        raise ExistingInstallationError("Unsafe orchestration directory")
    return path / "existing-installation"


def _complete_or_retain(state: dict[str, Any], result: Any,
                        directory: Path, journal: Path,
                        topology_state: Mapping[str, Any]) -> None:
    state["apply"] = _safe_result(result)
    if not isinstance(result, Mapping) or result.get("status") not in {"complete", "rolled_back"}:
        state["stage"] = "apply_uncertain"
        _save(directory, journal, state)
        raise ExistingInstallationError("Controller result is non-terminal; use resume")
    status = topology.validate_terminal_result(result, set(topology_state["participant_ids"]))
    if status == "complete":
        state["stage"] = "complete"
        state["result_status"] = "complete"
        return
    if status == "rolled_back":
        state["stage"] = "rolled_back"
        state["result_status"] = "rolled_back"
        return
    raise ExistingInstallationError("Controller result is non-terminal; use resume")


def _safe_result(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {"status": "invalid"}
    return {key: value[key] for key in ("status", "transaction", "ready_for_adoption",
                                        "checksum_sha256", "inventory_identity") if key in value}


def _load_manifest(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    if len(raw) > 1024 * 1024:
        raise ValueError("Manifest exceeds limit")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Manifest must be an object")
    return value


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Existing signed installation orchestrator")
    parser.add_argument("command", choices=("plan", "prepare", "apply", "resume", "status"))
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--transaction")
    parser.add_argument("--package", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command != "status" and not args.transaction:
            raise ValueError("Transaction is required")
        config = load_private_json(args.config)
        if args.command == "status":
            result = status(config, args.transaction)
        else:
            if args.manifest is None:
                raise ValueError("Manifest is required")
            manifest = _load_manifest(args.manifest)
            if args.command == "plan":
                if args.package is not None:
                    raise ValueError("Package is only valid for prepare")
                result = plan(config, manifest, args.transaction)
            elif args.command == "prepare":
                if args.package is None:
                    raise ValueError("Signed local package is required for prepare")
                result = prepare(config, manifest, args.transaction, args.package)
            elif args.command == "apply":
                if args.package is not None:
                    raise ValueError("Package is not used by apply")
                result = apply(config, manifest, args.transaction)
            else:
                if args.package is not None:
                    raise ValueError("Package is not used by resume")
                result = resume(config, manifest, args.transaction)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print(json.dumps({"ok": False, "error": "existing_installation_request_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

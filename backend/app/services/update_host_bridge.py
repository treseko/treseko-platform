"""Host-owned bridge for the existing-installation orchestrator.

The bridge owns only request admission, package staging and durable recovery
state.  Lifecycle execution remains in ``update_existing_installation``.
Requests never select a controller config, executable, host, or arbitrary
path; those bindings come from the private bridge configuration.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from typing import Any, Mapping

from . import update_existing_installation as orchestration
from .edition.update_manager import verify_update_manifest_signature
from .update_journal import exclusive_lock, save_json
from .update_participant_commands import load_private_json

SCHEMA = 1
MAX_REQUEST_BYTES = 1024 * 1024
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
TERMINAL = {"complete", "rolled_back"}
REQUEST_ACTIONS = {"plan", "prepare", "apply", "resume", "status"}


class HostBridgeError(RuntimeError):
    """A safe, exportable bridge error without remote or secret details."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _private_dir(path: Path, label: str, mode: int, *, owner: set[int] | None = None,
                 group: set[int] | None = None, forbidden_mode: int = 0o077) -> Path:
    path = _canonical_path(path, label)
    if path.is_symlink():
        raise HostBridgeError(f"unsafe_{label}")
    path.mkdir(parents=True, exist_ok=True, mode=mode)
    info = path.lstat()
    owner = owner or {0, os.geteuid()}
    group = group or {0, os.getegid()}
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in owner
            or info.st_gid not in group or info.st_mode & forbidden_mode):
        raise HostBridgeError(f"unsafe_{label}")
    return path


def _canonical_path(path: Path, label: str) -> Path:
    if not path.is_absolute() or ".." in path.parts:
        raise HostBridgeError(f"unsafe_{label}")
    cursor = path
    while True:
        if cursor.is_symlink() and cursor not in {Path("/tmp"), Path("/var")}:
            raise HostBridgeError(f"unsafe_{label}")
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    try:
        canonical = path.resolve(strict=False)
        current = canonical.parent
        while True:
            info = current.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                    or info.st_mode & 0o022):
                raise HostBridgeError(f"unsafe_{label}")
            if current.parent == current:
                break
            current = current.parent
        return canonical
    except OSError as exc:
        raise HostBridgeError(f"unsafe_{label}") from exc


def _bind_group(path: Path, gid: int, label: str) -> None:
    try:
        os.chown(path, os.geteuid(), gid)
    except OSError as exc:
        raise HostBridgeError(f"unsafe_{label}") from exc


def _regular_private(path: Path, label: str) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as exc:
        raise HostBridgeError(f"missing_{label}") from exc
    if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
            or info.st_mode & 0o077):
        raise HostBridgeError(f"unsafe_{label}")
    return info


def _safe_identifier(value: Any) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise HostBridgeError("invalid_transaction")
    return value


def _safe_report(state: Mapping[str, Any] | None, *, error: str | None = None) -> dict[str, Any]:
    if state is None:
        return {"schema": SCHEMA, "status": "not_found"}
    result = {
        "schema": SCHEMA,
        "transaction": state["transaction"],
        "action": state.get("action"),
        "status": state.get("status", "pending"),
    }
    if error:
        result["error"] = error
    elif state.get("error"):
        result["error"] = state["error"]
    return result


class HostUpdateBridge:
    """Single host-owned request executor around existing_installation."""

    def __init__(self, config: Mapping[str, Any]):
        expected = {"schema", "controller_config", "inbox", "state_dir", "report_dir",
                    "request_uid", "request_gid"}
        if (not isinstance(config, Mapping) or set(config) != expected
                or config.get("schema") != SCHEMA):
            raise HostBridgeError("invalid_bridge_config")
        if (not isinstance(config["request_uid"], int) or isinstance(config["request_uid"], bool)
                or not isinstance(config["request_gid"], int) or isinstance(config["request_gid"], bool)
                or config["request_uid"] < 0 or config["request_gid"] < 0):
            raise HostBridgeError("invalid_request_boundary")
        self.request_uid = config["request_uid"]
        self.request_gid = config["request_gid"]
        self.controller_path = self._absolute(config["controller_config"], "controller_config")
        self.inbox = _private_dir(self._absolute(config["inbox"], "inbox"), "inbox", 0o730,
                                  owner={self.request_uid, os.geteuid()},
                                  group={self.request_gid, os.getegid()}, forbidden_mode=0o007)
        self.state_dir = _private_dir(self._absolute(config["state_dir"], "state_dir"), "state", 0o700)
        self.report_dir = _private_dir(self._absolute(config["report_dir"], "report"), "report", 0o750,
                                       group={self.request_gid, os.getegid()}, forbidden_mode=0o027)
        _bind_group(self.report_dir, self.request_gid, "report")
        self.transactions = _private_dir(self.state_dir / "transactions", "state", 0o700)
        self.staging = _private_dir(self.state_dir / "staging", "state", 0o700)
        _regular_private(self.controller_path, "controller_config")

    @staticmethod
    def _absolute(value: Any, label: str) -> Path:
        if not isinstance(value, str):
            raise HostBridgeError(f"invalid_{label}")
        return _canonical_path(Path(value), label)

    def _load_controller(self) -> tuple[dict[str, Any], str]:
        # Parse once from a NOFOLLOW/private descriptor.  The orchestration
        # layer receives this object, never the mutable config path.
        config = load_private_json(self.controller_path)
        return config, _digest(config)

    def _state_path(self, transaction: str) -> Path:
        return self.transactions / f"{transaction}.json"

    def _read_state(self, transaction: str) -> dict[str, Any] | None:
        path = self._state_path(transaction)
        if path.is_symlink():
            raise HostBridgeError("unsafe_state")
        if not path.exists():
            return None
        _regular_private(path, "state")
        try:
            value = json.loads(path.read_text())
        except (OSError, ValueError, UnicodeError) as exc:
            raise HostBridgeError("invalid_state") from exc
        if not isinstance(value, dict) or value.get("schema") != SCHEMA:
            raise HostBridgeError("invalid_state")
        return value

    def _write_state(self, state: dict[str, Any]) -> None:
        save_json(self._state_path(state["transaction"]), state)

    def _pin_binding(self, controller_digest: str) -> None:
        path = self.state_dir / "binding.json"
        if path.exists():
            _regular_private(path, "binding")
            try:
                binding = json.loads(path.read_text())
            except (OSError, ValueError, UnicodeError) as exc:
                raise HostBridgeError("invalid_binding") from exc
            if binding.get("controller_sha256") != controller_digest:
                raise HostBridgeError("controller_binding_changed")
            return
        save_json(path, {"schema": SCHEMA, "controller_sha256": controller_digest})

    def _check_other_transaction(self, transaction: str) -> None:
        for path in self.transactions.glob("*.json"):
            if path.is_symlink():
                raise HostBridgeError("unsafe_state")
            if path.stem == transaction:
                continue
            state = self._read_state(path.stem)
            if state and state.get("status") not in TERMINAL:
                raise HostBridgeError("another_transaction_pending")

    @staticmethod
    def _manifest(request: Mapping[str, Any]) -> dict[str, Any]:
        manifest = request.get("manifest")
        if not isinstance(manifest, dict):
            raise HostBridgeError("manifest_required")
        valid, _ = verify_update_manifest_signature(manifest)
        if not valid:
            raise HostBridgeError("manifest_signature_invalid")
        checksum = manifest.get("checksum_sha256")
        size = manifest.get("package_size_bytes")
        if not isinstance(checksum, str) or not SHA256.fullmatch(checksum):
            raise HostBridgeError("manifest_checksum_invalid")
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            raise HostBridgeError("manifest_size_invalid")
        return manifest

    def _stage_package(self, manifest: Mapping[str, Any], transaction: str) -> Path:
        checksum = manifest["checksum_sha256"]
        source = self.inbox / checksum
        expected_size = manifest["package_size_bytes"]
        destination = self.staging / f"{transaction}-{checksum}.tar.gz"
        source_fd = -1
        temp: Path | None = None
        for stale in self.staging.glob(f".{transaction}-*.tmp"):
            if stale.is_symlink():
                raise HostBridgeError("unsafe_staging")
            _regular_private(stale, "staging")
            stale.unlink()
        if destination.exists():
            if destination.is_symlink():
                raise HostBridgeError("unsafe_staging")
            info = _regular_private(destination, "staging")
            if (info.st_size != expected_size
                    or hashlib.sha256(destination.read_bytes()).hexdigest() != checksum):
                raise HostBridgeError("staging_conflict")
            return destination
        try:
            source_fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            info = os.fstat(source_fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {self.request_uid, os.geteuid()}
                    or info.st_mode & 0o002 or info.st_size != expected_size):
                raise HostBridgeError("package_source_invalid")
            digest = hashlib.sha256()
            fd, temp_name = tempfile.mkstemp(prefix=f".{transaction}-", suffix=".tmp", dir=self.staging)
            temp = Path(temp_name)
            os.fchmod(fd, 0o600)
            try:
                with os.fdopen(fd, "wb") as output:
                    copied = 0
                    while chunk := os.read(source_fd, min(1024 * 1024, expected_size + 1 - copied)):
                        copied += len(chunk)
                        if copied > expected_size:
                            raise HostBridgeError("package_source_changed")
                        digest.update(chunk)
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
            except BaseException:
                if temp is not None:
                    temp.unlink(missing_ok=True)
                raise
            if copied != expected_size or digest.hexdigest() != checksum:
                temp.unlink(missing_ok=True)
                raise HostBridgeError("package_checksum_invalid")
            os.replace(temp, destination)
            directory_fd = os.open(self.staging, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            return destination
        except OSError as exc:
            raise HostBridgeError("package_source_invalid") from exc
        finally:
            if source_fd >= 0:
                os.close(source_fd)
            if temp is not None:
                temp.unlink(missing_ok=True)

    def _publish_report(self, state: Mapping[str, Any]) -> dict[str, Any]:
        report = _safe_report(state)
        fd, temporary = tempfile.mkstemp(prefix=f".{state['transaction']}-", suffix=".tmp",
                                          dir=self.report_dir)
        try:
            os.fchmod(fd, 0o640)
            os.fchown(fd, os.geteuid(), self.request_gid)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(report, stream, sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.report_dir / f"{state['transaction']}.json")
            directory_fd = os.open(self.report_dir, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return report

    def _new_state(self, request: Mapping[str, Any], controller_digest: str,
                   manifest: Mapping[str, Any] | None) -> dict[str, Any]:
        transaction = request["transaction"]
        return {
            "schema": SCHEMA, "transaction": transaction, "action": request["action"],
            "status": f"{request['action']}_pending", "controller_sha256": controller_digest,
            "manifest": dict(manifest) if manifest is not None else None,
            "manifest_sha256": _digest(manifest) if manifest is not None else None,
        }

    def handle(self, request: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(request, Mapping):
            raise HostBridgeError("invalid_request")
        if request.get("schema") != SCHEMA or request.get("action") not in REQUEST_ACTIONS:
            raise HostBridgeError("invalid_request")
        transaction = _safe_identifier(request.get("transaction"))
        action = request["action"]
        if action == "status":
            if set(request) != {"schema", "transaction", "action"}:
                raise HostBridgeError("invalid_request")
            return _safe_report(self._read_state(transaction))

        expected = {"schema", "transaction", "action", "manifest"}
        if action == "prepare":
            expected.add("package_checksum_sha256")
        if set(request) != expected:
            raise HostBridgeError("invalid_request")

        manifest = self._manifest(request)
        if action == "prepare":
            if request.get("package_checksum_sha256") != manifest["checksum_sha256"]:
                raise HostBridgeError("package_binding_invalid")
        elif request.get("package_checksum_sha256") is not None:
            raise HostBridgeError("unexpected_package_binding")

        controller_config, controller_digest = self._load_controller()
        lock = self.state_dir / "installation.lock"
        try:
            with exclusive_lock(lock):
                self._pin_binding(controller_digest)
                self._check_other_transaction(transaction)
                state = self._read_state(transaction)
                state_existed = state is not None
                if state is not None and state.get("controller_sha256") != controller_digest:
                    raise HostBridgeError("controller_binding_changed")
                if action == "plan":
                    if state is not None:
                        if state.get("manifest_sha256") != _digest(manifest):
                            raise HostBridgeError("manifest_binding_changed")
                        return self._publish_report(state)
                    result = orchestration.plan(controller_config, manifest, transaction)
                    state = self._new_state(request, controller_digest, manifest)
                    state.update(status="plan_validated")
                    self._write_state(state)
                    return self._publish_report(state)
                if state is None:
                    state = self._new_state(request, controller_digest, manifest)
                elif state.get("manifest_sha256") != _digest(manifest):
                    raise HostBridgeError("manifest_binding_changed")
                if action == "prepare":
                    if state.get("status") not in {"prepare_pending", "planned", "plan_validated",
                                                     "prepared", "prepare_stale"}:
                        raise HostBridgeError("prepare_not_allowed")
                    state["action"] = "prepare"
                    state["status"] = "prepare_pending"
                    self._write_state(state)
                    package = self._stage_package(manifest, transaction)
                    try:
                        result = orchestration.prepare(controller_config, manifest, transaction, package)
                    except Exception as exc:
                        state["status"] = "prepare_stale"
                        state["error"] = "prepare_reconciliation_failed"
                        self._write_state(state)
                        self._publish_report(state)
                        raise HostBridgeError("prepare_reconciliation_failed") from exc
                    if result.get("status") != "prepared":
                        raise HostBridgeError("prepare_not_complete")
                    state["status"] = "prepared"
                elif action == "apply":
                    if state.get("status") in TERMINAL:
                        return self._publish_report(state)
                    if state_existed and state.get("status") in {"apply_pending", "apply_uncertain"}:
                        state["action"] = "resume"
                        state["status"] = "apply_pending"
                        self._write_state(state)
                        result = orchestration.resume(controller_config, manifest, transaction)
                        final_status = result.get("status")
                        state["status"] = (final_status if final_status in TERMINAL
                                            else "apply_uncertain")
                        if state["status"] == "apply_uncertain":
                            state["error"] = "apply_nonterminal"
                        self._write_state(state)
                        return self._publish_report(state)
                    if state.get("status") not in {"prepared"}:
                        raise HostBridgeError("apply_requires_prepared")
                    state["action"] = "apply"
                    state["status"] = "apply_pending"
                    self._write_state(state)
                    result = orchestration.apply(controller_config, manifest, transaction)
                    final_status = result.get("status")
                    state["status"] = (final_status if final_status in TERMINAL
                                        else "apply_uncertain")
                    if state["status"] == "apply_uncertain":
                        state["error"] = "apply_nonterminal"
                else:  # resume
                    if state.get("status") not in {"apply_pending", "apply_uncertain"}:
                        raise HostBridgeError("resume_not_allowed")
                    state["action"] = "resume"
                    state["status"] = "apply_pending"
                    self._write_state(state)
                    result = orchestration.resume(controller_config, manifest, transaction)
                    final_status = result.get("status")
                    state["status"] = (final_status if final_status in TERMINAL
                                        else "apply_uncertain")
                    if state["status"] == "apply_uncertain":
                        state["error"] = "apply_nonterminal"
                self._write_state(state)
                return self._publish_report(state)
        except HostBridgeError:
            raise
        except Exception as exc:
            if action in {"apply", "resume"}:
                # The lifecycle call may have crossed its own process boundary.
                # Reacquire the installation lock and compare the durable
                # binding before recording uncertainty; never write a stale
                # local state after the original lock has been released.
                try:
                    with exclusive_lock(lock):
                        current = self._read_state(transaction)
                        if (current is not None
                                and current.get("controller_sha256") == controller_digest
                                and current.get("manifest_sha256") == _digest(manifest)
                                and current.get("status") in {"apply_pending", "apply_uncertain"}):
                            current["status"] = "apply_uncertain"
                            current["error"] = "apply_outcome_uncertain"
                            self._write_state(current)
                            self._publish_report(current)
                except Exception:
                    pass
            raise HostBridgeError("bridge_execution_failed") from exc

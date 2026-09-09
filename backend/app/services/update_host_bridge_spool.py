"""Durable request spool for the host-owned update bridge.

The backend may submit only a bounded JSON request and a package named by its
verified checksum.  A host supervisor invokes ``process_once`` as root; this
module never accepts commands, paths, hosts, or executables from a request.
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

from .update_host_bridge import (IDENTIFIER, MAX_REQUEST_BYTES, REQUEST_ACTIONS,
                                 HostBridgeError, HostUpdateBridge)
from .update_journal import exclusive_lock, save_json
from .update_participant_commands import load_private_json

SCHEMA = 1
NONCE = re.compile(r"[0-9a-f]{16,64}\Z")
TERMINAL = {"complete", "rolled_back", "prepared", "plan_validated"}
PENDING = {"pending", "running", "apply_uncertain"}


class SpoolError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _digest(value: Any) -> str:
    return _digest_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def _safe_dir(path: Path, label: str, *, owner: set[int], group: set[int], writable: bool) -> Path:
    path = _canonical_path(path, label)
    if path.is_symlink():
        raise SpoolError(f"unsafe_{label}")
    path.mkdir(parents=True, exist_ok=True, mode=0o730 if writable else 0o700)
    info = path.lstat()
    forbidden = 0o007 if writable else 0o077
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in owner or info.st_gid not in group
            or info.st_mode & forbidden):
        raise SpoolError(f"unsafe_{label}")
    return path


def _canonical_path(path: Path, label: str) -> Path:
    if not path.is_absolute() or ".." in path.parts:
        raise SpoolError(f"unsafe_{label}")
    cursor = path
    while True:
        if cursor.is_symlink() and cursor not in {Path("/tmp"), Path("/var")}:
            raise SpoolError(f"unsafe_{label}")
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
                raise SpoolError(f"unsafe_{label}")
            if current.parent == current:
                break
            current = current.parent
        return canonical
    except OSError as exc:
        raise SpoolError(f"unsafe_{label}") from exc


def _json_request(request: Mapping[str, Any]) -> tuple[dict[str, Any], str, str]:
    if not isinstance(request, Mapping) or request.get("schema") != SCHEMA:
        raise SpoolError("invalid_request")
    action = request.get("action")
    transaction = request.get("transaction")
    nonce = request.get("nonce")
    if action not in REQUEST_ACTIONS or not isinstance(transaction, str) or not IDENTIFIER.fullmatch(transaction):
        raise SpoolError("invalid_request")
    if not isinstance(nonce, str) or not NONCE.fullmatch(nonce):
        raise SpoolError("invalid_nonce")
    expected = {"schema", "transaction", "action", "nonce"}
    if action == "status":
        if set(request) != expected:
            raise SpoolError("invalid_request")
    else:
        expected.add("manifest")
        if action == "prepare":
            expected.add("package_checksum_sha256")
        if set(request) != expected:
            raise SpoolError("invalid_request")
        if not isinstance(request["manifest"], dict):
            raise SpoolError("manifest_required")
    return dict(request), transaction, nonce


class HostBridgeSpool:
    """Atomic producer plus one-shot host consumer."""

    def __init__(self, config: Mapping[str, Any], *, producer: bool = False):
        expected = ({"schema", "request_inbox", "request_uid", "request_gid"}
                    if producer else {"schema", "bridge_config", "request_inbox", "spool_dir"})
        if not isinstance(config, Mapping) or set(config) != expected or config.get("schema") != SCHEMA:
            raise SpoolError("invalid_spool_config")
        if producer:
            uid, gid = config["request_uid"], config["request_gid"]
        else:
            self.bridge_path = self._absolute(config["bridge_config"], "bridge_config")
            _regular(self.bridge_path, "bridge_config")
            bridge_config = load_private_json(self.bridge_path)
            uid, gid = bridge_config.get("request_uid"), bridge_config.get("request_gid")
        if (not isinstance(uid, int) or isinstance(uid, bool) or uid < 0
                or not isinstance(gid, int) or isinstance(gid, bool) or gid < 0):
            raise SpoolError("invalid_request_boundary")
        self.request_inbox = _safe_dir(self._absolute(config["request_inbox"], "request_inbox"),
                                       "request_inbox", owner={uid, os.geteuid()},
                                       group={gid, os.getegid()}, writable=True)
        self.producer = producer
        if producer:
            # The backend-facing producer must not need read/write access to
            # host state or private receipts.  The root consumer performs the
            # durable request identity check after taking the host lock.
            self.spool_dir = None
            self.receipts = None
            self.bridge = None
        else:
            self.spool_dir = _safe_dir(self._absolute(config["spool_dir"], "spool"), "spool",
                                       owner={0, os.geteuid()}, group={0, os.getegid()}, writable=False)
            self.receipts = _safe_dir(self.spool_dir / "receipts", "receipts",
                                      owner={0, os.geteuid()}, group={0, os.getegid()}, writable=False)
            self.bridge = HostUpdateBridge(bridge_config)
        self.request_uid, self.request_gid = uid, gid

    @classmethod
    def producer_for(cls, config: Mapping[str, Any]) -> "HostBridgeSpool":
        """Create the restricted backend-side request producer."""
        return cls(config, producer=True)

    @staticmethod
    def _absolute(value: Any, label: str) -> Path:
        if not isinstance(value, str):
            raise SpoolError(f"invalid_{label}")
        return _canonical_path(Path(value), label)

    def _receipt_path(self, transaction: str, action: str) -> Path:
        if self.receipts is None:
            raise SpoolError("host_receipts_unavailable")
        return self.receipts / f"{transaction}-{action}.json"

    def _read_receipt(self, transaction: str, action: str) -> dict[str, Any] | None:
        path = self._receipt_path(transaction, action)
        if path.is_symlink():
            raise SpoolError("unsafe_receipt")
        if not path.exists():
            return None
        _regular(path, "receipt")
        try:
            value = json.loads(path.read_text())
        except (OSError, ValueError, UnicodeError) as exc:
            raise SpoolError("invalid_receipt") from exc
        request = value.get("request") if isinstance(value, dict) else None
        if (not isinstance(value, dict) or value.get("schema") != SCHEMA
                or value.get("transaction") != transaction or value.get("action") != action
                or not isinstance(value.get("request_sha256"), str)
                or not isinstance(request, dict)):
            raise SpoolError("invalid_receipt")
        return value

    def _block_receipt(self, path: Path) -> None:
        stem = path.stem.rsplit("-", 1)
        if len(stem) != 2 or not IDENTIFIER.fullmatch(stem[0]) or stem[1] not in REQUEST_ACTIONS:
            raise SpoolError("invalid_receipt")
        save_json(path, {"schema": SCHEMA, "transaction": stem[0], "action": stem[1],
                         "status": "blocked", "error": "invalid_receipt"})

    def _write_receipt(self, value: dict[str, Any]) -> None:
        save_json(self._receipt_path(value["transaction"], value["action"]), value)

    def submit(self, request: Mapping[str, Any]) -> dict[str, Any]:
        value, transaction, nonce = _json_request(request)
        raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        if len(raw) > MAX_REQUEST_BYTES:
            raise SpoolError("request_too_large")
        request_hash = _digest({key: value for key, value in value.items() if key != "nonce"})
        if not self.producer:
            receipt = self._read_receipt(transaction, value["action"])
            if receipt is not None:
                if receipt.get("request_sha256") != request_hash:
                    raise SpoolError("request_changed")
                return {"schema": SCHEMA, "status": "submitted", "transaction": transaction,
                        "action": value["action"], "replayed": True}
        target = self.request_inbox / f"{transaction}-{value['action']}-{nonce}.json"
        existing = self._read_request(target, allow_missing=True)
        if existing is not None:
            if existing[1] != request_hash:
                raise SpoolError("request_changed")
            return {"schema": SCHEMA, "status": "submitted", "transaction": transaction,
                    "action": value["action"], "replayed": True}
        for candidate in self.request_inbox.glob(f"{transaction}-{value['action']}-*.json"):
            old = self._read_request(candidate, allow_missing=False)
            if old is not None and old[1] != request_hash:
                raise SpoolError("request_changed")
        fd, temporary = tempfile.mkstemp(prefix=f".{transaction}-{value['action']}-", suffix=".tmp",
                                          dir=self.request_inbox)
        try:
            os.fchmod(fd, 0o660)
            os.fchown(fd, self.request_uid, self.request_gid)
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            # link is atomic and refuses an existing target; replace would
            # allow a concurrent producer to overwrite an accepted request.
            os.link(temporary, target)
            os.unlink(temporary)
            directory_fd = os.open(self.request_inbox, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except FileExistsError as exc:
            current = self._read_request(target, allow_missing=False)
            if current is not None and current[1] == request_hash:
                return {"schema": SCHEMA, "status": "submitted", "transaction": transaction,
                        "action": value["action"], "replayed": True}
            raise SpoolError("request_changed") from exc
        finally:
            Path(temporary).unlink(missing_ok=True)
        return {"schema": SCHEMA, "status": "submitted", "transaction": transaction,
                "action": value["action"], "replayed": False}

    def _read_request(self, path: Path, *, allow_missing: bool) -> tuple[dict[str, Any], str] | None:
        if path.is_symlink():
            raise SpoolError("unsafe_request")
        if not path.exists():
            if allow_missing:
                return None
            raise SpoolError("missing_request")
        fd = -1
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {self.request_uid, os.geteuid()}
                    or info.st_mode & 0o002 or info.st_size > MAX_REQUEST_BYTES):
                raise SpoolError("unsafe_request")
            raw = os.read(fd, MAX_REQUEST_BYTES + 1)
            if len(raw) > MAX_REQUEST_BYTES:
                raise SpoolError("request_too_large")
            request, transaction, nonce = _json_request(json.loads(raw))
            expected = f"{transaction}-{request['action']}-{nonce}.json"
            if path.name != expected:
                raise SpoolError("request_filename_mismatch")
            return request, _digest({key: value for key, value in request.items() if key != "nonce"})
        except SpoolError:
            raise
        except (OSError, ValueError, UnicodeError) as exc:
            raise SpoolError("invalid_request") from exc
        finally:
            if fd >= 0:
                os.close(fd)

    def _pending_receipt(self) -> dict[str, Any] | None:
        for path in sorted(self.receipts.glob("*.json")):
            if path.is_symlink():
                raise SpoolError("unsafe_receipt")
            try:
                receipt = self._read_receipt(path.stem.rsplit("-", 1)[0], path.stem.rsplit("-", 1)[1])
            except SpoolError:
                self._block_receipt(path)
                continue
            if receipt and receipt.get("status") in PENDING:
                return receipt
        return None

    def process_once(self) -> dict[str, Any]:
        lock = self.spool_dir / "spool.lock"
        try:
            with exclusive_lock(lock):
                receipt = self._pending_receipt()
                request = None
                if receipt is not None:
                    request = dict(receipt["request"])
                else:
                    candidates = sorted(self.request_inbox.glob("*.json"))
                    for path in candidates:
                        loaded = self._read_request(path, allow_missing=False)
                        if loaded is not None:
                            request, request_hash = loaded
                            transaction, nonce = request["transaction"], request["nonce"]
                            action = request["action"]
                            if action == "status":
                                path.unlink()
                                break
                            try:
                                receipt = self._read_receipt(transaction, action)
                            except SpoolError:
                                self._block_receipt(self._receipt_path(transaction, action))
                                raise
                            if receipt is not None and receipt.get("request_sha256") != request_hash:
                                raise SpoolError("request_changed")
                            if receipt is None:
                                receipt = {"schema": SCHEMA, "transaction": transaction,
                                           "action": action, "nonce": nonce,
                                           "request_sha256": request_hash, "request": request,
                                           "status": "pending"}
                                self._write_receipt(receipt)
                            path.unlink()
                            break
                if request is None:
                    return {"schema": SCHEMA, "status": "idle"}
                transaction, action = request["transaction"], request["action"]
                if receipt is None:
                    receipt = self._read_receipt(transaction, action)
                if action == "status":
                    # Status is observational.  It must not create or reset a
                    # lifecycle receipt, even when its nonce is fresh.
                    return self.bridge.handle({key: value for key, value in request.items()
                                               if key != "nonce"})
                receipt["status"] = "running"
                self._write_receipt(receipt)
                bridge_request = dict(request)
                bridge_request.pop("nonce", None)
                try:
                    report = self.bridge.handle(bridge_request)
                except HostBridgeError as exc:
                    uncertain = action in {"apply", "resume"} and exc.code in {
                        "bridge_execution_failed", "apply_outcome_uncertain", "apply_nonterminal"
                    }
                    receipt["status"] = "pending" if uncertain else "blocked"
                    receipt["error"] = exc.code
                    self._write_receipt(receipt)
                    return {"schema": SCHEMA, "status": "blocked", "error": exc.code,
                            "transaction": transaction, "action": action}
                receipt["status"] = report.get("status", "blocked")
                receipt["report"] = report
                self._write_receipt(receipt)
                return report
        except (BlockingIOError, ValueError):
            return {"schema": SCHEMA, "status": "busy"}


def _regular(path: Path, label: str) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as exc:
        raise SpoolError(f"missing_{label}") from exc
    if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
            or info.st_mode & 0o077):
        raise SpoolError(f"unsafe_{label}")
    return info

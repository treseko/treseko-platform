"""Host-owned admission bridge for the Engine 1.0.3 update protocol.

Docker is used only to inventory the pinned container and to run a read-only
authenticated HTTP probe inside it.  Marker and tombstone mutations happen on
the explicitly bound private host directory under a host lock.
"""
from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
from typing import Callable

from .update_journal import exclusive_lock, save_json
from .update_transaction import TransactionFailure


_CONTAINER = re.compile(r"[a-f0-9]{64}\Z")
_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}\Z")
_ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
_MARKER = ".treseko-engine-update-fence"
_MAX_MARKER = 4096


def _default_lock_dir(control: Path) -> Path:
    digest = hashlib.sha256(str(control).encode("utf-8")).hexdigest()[:24]
    return control.parent / (".treseko-engine-update-lock-" + digest)
_PROBE = r'''
import { readFile } from "node:fs/promises";
const [port, tokenName, tokenFileName, timeoutMs] = process.argv.slice(1);
let token = String(process.env[tokenName] || "").trim();
if (!token && process.env[tokenFileName]) {
  try { token = (await readFile(String(process.env[tokenFileName]).trim(), "utf8")).trim(); }
  catch { process.exit(3); }
}
if (!token) process.exit(3);
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), Number(timeoutMs));
let response;
let text;
try {
response = await fetch(`http://127.0.0.1:${port}/internal/update/admission`, {
  headers: {"x-engine-internal-token": token}, redirect: "error", signal: abort.signal
});
const reader = response.body?.getReader();
if (!reader) process.exit(4);
const chunks = [];
let total = 0;
while (true) {
  const {done, value} = await reader.read();
  if (done) break;
  total += value.byteLength;
  if (total > 65536) { await reader.cancel(); process.exit(4); }
  chunks.push(value);
}
text = Buffer.concat(chunks).toString("utf8");
} finally { clearTimeout(timer); }
let value;
try { value = JSON.parse(text); } catch { process.exit(5); }
process.stdout.write(JSON.stringify({status: response.status, value}));
'''


class DockerEngineControl:
    """Future ``DockerRuntime``-compatible pause/drain/resume adapter.

    ``lock_dir`` is a separately bound, operator-owned directory identified in
    the host inventory for this exact control path.  It must be unique per
    control binding; it is never inferred from or placed inside the Engine UID
    10001 directory when a caller supplies it.
    """

    def __init__(self, docker: str, container: str, project: str, service: str,
                 control: Path, container_control: str = "/engine/update-control",
                 port: int = 3010, token_env: str = "AI_ENGINE_INTERNAL_TOKEN",
                 token_file_env: str = "AI_ENGINE_INTERNAL_TOKEN_FILE",
                 control_owner_uid: int = 10001,
                 timeout: float = 15, callback_proof: Callable[[str], bool] | None = None,
                 lock_dir: Path | None = None):
        if not Path(docker).is_absolute() or not Path(docker).is_file():
            raise ValueError("An absolute Docker executable is required")
        if not _CONTAINER.fullmatch(container) or not _IDENTIFIER.fullmatch(project) or not _IDENTIFIER.fullmatch(service):
            raise ValueError("Pinned Engine container and Compose scope are required")
        if not isinstance(control, Path):
            control = Path(control)
        if not control.is_absolute() or ".." in control.parts or control == Path("/"):
            raise ValueError("An explicit private host control directory is required")
        if lock_dir is not None and not isinstance(lock_dir, Path):
            lock_dir = Path(lock_dir)
        if (lock_dir is not None and
                (not lock_dir.is_absolute() or ".." in lock_dir.parts
                 or lock_dir == Path("/") or lock_dir == control
                 or control in lock_dir.parents)):
            raise ValueError("An explicit separate private Engine lock directory is required")
        target = Path(container_control)
        if not target.is_absolute() or ".." in target.parts or target == Path("/"):
            raise ValueError("An explicit Engine control bind target is required")
        if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
            raise ValueError("Invalid Engine probe port")
        if not _ENV_NAME.fullmatch(token_env):
            raise ValueError("Invalid Engine token environment name")
        if not _ENV_NAME.fullmatch(token_file_env):
            raise ValueError("Invalid Engine token-file environment name")
        if (type(control_owner_uid) is not int or control_owner_uid < 0
                or control_owner_uid > 2**31 - 1):
            raise ValueError("Invalid private Engine control owner UID")
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0 < timeout <= 300:
            raise ValueError("Invalid Engine control timeout")
        self.docker, self.container = str(docker), container
        self.project, self.service = project, service
        self.control, self.container_control = control, str(target)
        self.lock_dir = lock_dir or _default_lock_dir(control)
        self.port, self.token_env, self.token_file_env = port, token_env, token_file_env
        self.control_owner_uid = control_owner_uid
        self.timeout = timeout
        self.callback_proof = callback_proof

    def _check_container_id(self, container_id):
        if container_id != self.container or not _CONTAINER.fullmatch(container_id):
            raise ValueError("Pinned Engine container identity required")

    def _run(self, args):
        try:
            return subprocess.run([self.docker, *args], capture_output=True,
                                  timeout=self.timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise TransactionFailure("Engine control outcome is uncertain") from exc

    def _target(self):
        result = self._run(["inspect", "--type", "container", self.container])
        if result.returncode:
            raise TransactionFailure("Engine container inspection failed")
        try:
            records = json.loads(result.stdout)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise TransactionFailure("Engine container inspection is invalid") from exc
        if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
            raise TransactionFailure("Engine container identity is ambiguous")
        record = records[0]
        labels = record.get("Config", {}).get("Labels") or {}
        mounts = [mount for mount in record.get("Mounts", [])
                  if mount.get("Destination") == self.container_control]
        if (record.get("Id") != self.container or record.get("State", {}).get("Running") is not True
                or labels.get("com.docker.compose.project") != self.project
                or labels.get("com.docker.compose.service") != self.service
                or len(mounts) != 1 or mounts[0].get("Type") != "bind"
                or mounts[0].get("RW") is not True
                or Path(mounts[0].get("Source", "")).resolve() != self.control.resolve()):
            raise TransactionFailure("Engine container or control bind differs from inventory")
        return record

    def _host(self):
        try:
            info = self.control.lstat()
        except OSError as exc:
            raise TransactionFailure("Engine host control directory is unavailable") from exc
        if (not stat.S_ISDIR(info.st_mode)
                or info.st_uid != self.control_owner_uid
                or (os.geteuid() != 0 and info.st_uid != os.geteuid())
                or info.st_mode & 0o077):
            raise TransactionFailure("Engine host control directory is not private")

    def _read_marker(self):
        path = self.control / _MARKER
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise TransactionFailure("Engine fence is unreadable") from exc
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != self.control_owner_uid
                    or info.st_mode & 0o077 or info.st_size > _MAX_MARKER):
                raise TransactionFailure("Engine fence is unsafe")
            raw = os.read(fd, _MAX_MARKER + 1)
        finally:
            os.close(fd)
        try:
            value = json.loads(raw)
        except (UnicodeDecodeError, ValueError) as exc:
            raise TransactionFailure("Engine fence is invalid") from exc
        if (not isinstance(value, dict) or value.get("schema") != 1
                or set(value) != {"schema", "transaction"}
                or not _IDENTIFIER.fullmatch(value.get("transaction", ""))):
            raise TransactionFailure("Engine fence is invalid")
        return value["transaction"]

    def _probe(self):
        result = self._run(["exec", self.container, "node", "--input-type=module", "-e", _PROBE,
                            str(self.port), self.token_env, self.token_file_env,
                            str(max(1, int(self.timeout * 1000)))])
        if result.returncode:
            raise TransactionFailure("Engine admission probe failed")
        try:
            response = json.loads(result.stdout)
            status = response["status"]
            value = response["value"]
        except (TypeError, ValueError, KeyError, json.JSONDecodeError) as exc:
            raise TransactionFailure("Engine admission response is invalid") from exc
        if status != 200 or not isinstance(value, dict):
            raise TransactionFailure("Engine admission authentication failed")
        self._validate_status(value)
        return value

    @staticmethod
    def _validate_status(value):
        if (value.get("protocol") != "treseko-engine-update-admission"
                or value.get("protocol_version") != 1
                or not isinstance(value.get("enabled"), bool)
                or not isinstance(value.get("admission_open"), bool)
                or value.get("marker_state") not in {"disabled", "absent", "present", "invalid"}
                or not isinstance(value.get("fenced"), bool)
                or not isinstance(value.get("drainable"), bool)
                or not isinstance(value.get("active_leases"), int) or value["active_leases"] < 0
                or not isinstance(value.get("active_by_kind"), dict)):
            raise TransactionFailure("Engine admission status is malformed")
        process = value.get("process") or {}
        terminal = value.get("terminal_delivery") or {}
        if (not isinstance(process.get("pid"), int) or process["pid"] <= 0
                or not isinstance(process.get("started_at"), str)
                or not isinstance(process.get("identity"), str)
                or terminal.get("scope") != "engine_process_and_local_spool"
                or not isinstance(terminal.get("pending_local_deliveries"), int)
                or terminal["pending_local_deliveries"] < 0
                or terminal.get("local_spool_state") not in {"empty", "pending", "available", "unavailable"}
                or terminal.get("needs_backend_confirmation") is not True):
            raise TransactionFailure("Engine admission status is incomplete")
        if value["drainable"] and (value["active_leases"] != 0
                                    or terminal["pending_local_deliveries"] != 0):
            raise TransactionFailure("Engine admission drainable state is inconsistent")

    def _status_locked(self):
        status = self._probe()
        if status["marker_state"] == "disabled" or not status["enabled"]:
            return status
        owner = self._read_marker()
        if status["marker_state"] == "present" and owner is None:
            raise TransactionFailure("Engine reports a fence without its host marker")
        return status

    def status(self, container_id):
        self._check_container_id(container_id)
        self._target()
        self._host()
        return self._status_locked()

    def pause(self, container_id, transaction):
        self._check_container_id(container_id)
        if not _IDENTIFIER.fullmatch(transaction):
            raise ValueError("Invalid Engine transaction")
        self._target()
        self._host()
        with self._exclusive_lock():
            self._target()
            if (self.control / (".treseko-engine-update-released-" + transaction + ".json")).exists():
                raise TransactionFailure("Released Engine transaction cannot reacquire")
            status = self._status_locked()
            if not status["enabled"]:
                raise TransactionFailure("Engine admission control is disabled")
            owner = self._read_marker()
            if owner not in {None, transaction}:
                raise TransactionFailure("Engine fence belongs to another transaction")
            if owner is None:
                self._write_marker(transaction)
            observed = self._status_locked()
            if (not observed["fenced"] or observed.get("owner_transaction") != transaction
                    or observed["admission_open"]):
                raise TransactionFailure("Engine fence was not observed")
            return observed

    def assert_closed(self, container_id, transaction):
        self._check_container_id(container_id)
        if not _IDENTIFIER.fullmatch(transaction):
            raise ValueError("Invalid Engine transaction")
        self._target()
        self._host()
        with self._exclusive_lock():
            if self._read_marker() != transaction:
                raise TransactionFailure("Owned Engine fence is not present")
            status = self._status_locked()
            if not status["fenced"] or status.get("owner_transaction") != transaction:
                raise TransactionFailure("Engine admission is not closed")
            return status

    def drain(self, container_id, transaction, timeout=None):
        self._check_container_id(container_id)
        if not _IDENTIFIER.fullmatch(transaction):
            raise ValueError("Invalid Engine transaction")
        if self.callback_proof is None:
            raise TransactionFailure("Private callback proof is required before Engine drain")
        limit = self.timeout if timeout is None else timeout
        if not isinstance(limit, (int, float)) or limit <= 0 or limit > 300:
            raise ValueError("Invalid Engine drain timeout")
        self._target()
        self._host()
        with self._exclusive_lock():
            if self._read_marker() != transaction:
                raise TransactionFailure("Owned Engine fence is not present")
            first = self._status_locked()
            if not first["fenced"] or first.get("owner_transaction") != transaction:
                raise TransactionFailure("Engine admission is not closed")
            identity = first["process"]["identity"]
            deadline = time.monotonic() + limit
            while True:
                current = self._status_locked()
                if current["process"]["identity"] != identity:
                    raise TransactionFailure("Engine process identity changed during drain")
                terminal = current["terminal_delivery"]
                ready = (current["fenced"] and current.get("owner_transaction") == transaction
                        and current["active_leases"] == 0
                        and terminal["pending_local_deliveries"] == 0
                        and terminal["local_spool_state"] in {"empty", "available"}
                        and current["drainable"])
                if ready:
                    try:
                        proof = self.callback_proof(transaction)
                    except Exception as exc:
                        raise TransactionFailure("Private callback proof failed; fence retained") from exc
                    if proof is True:
                        confirmed = self._status_locked()
                        if confirmed["process"]["identity"] != identity:
                            raise TransactionFailure("Engine process identity changed after callback proof")
                        confirmed_terminal = confirmed["terminal_delivery"]
                        if (confirmed["fenced"]
                                and confirmed.get("owner_transaction") == transaction
                                and confirmed["active_leases"] == 0
                                and confirmed_terminal["pending_local_deliveries"] == 0
                                and confirmed_terminal["local_spool_state"] in {"empty", "available"}
                                and confirmed["drainable"]):
                            return confirmed
                if time.monotonic() >= deadline:
                    raise TransactionFailure("Engine drain timed out; fence retained")
                time.sleep(min(0.1, max(0.01, deadline - time.monotonic())))

    def resume(self, container_id, transaction):
        self._check_container_id(container_id)
        if not _IDENTIFIER.fullmatch(transaction):
            raise ValueError("Invalid Engine transaction")
        self._target()
        self._host()
        with self._exclusive_lock():
            self._target()
            marker = self._read_marker()
            tombstone = self.control / (".treseko-engine-update-released-" + transaction + ".json")
            if marker not in {None, transaction}:
                raise TransactionFailure("Engine fence belongs to another transaction")
            if marker is None:
                if not tombstone.exists():
                    raise TransactionFailure("Unknown Engine release rejected")
                return self._status_locked()
            save_json(tombstone, {"schema": 1, "transaction": transaction,
                                  "binding": [self.container, self.project, self.service,
                                              str(self.control), self.container_control,
                                              self.control_owner_uid, str(self.lock_dir)]})
            (self.control / _MARKER).unlink()
            self._fsync_directory()
            status = self._status_locked()
            if status["marker_state"] != "absent" or not status["admission_open"]:
                raise TransactionFailure("Engine reopening is not confirmed")
            return status

    def _write_marker(self, transaction):
        path = self.control / _MARKER
        temporary = None
        try:
            fd, temporary = tempfile.mkstemp(
                dir=self.control, prefix=_MARKER + ".", suffix=".tmp")
            with os.fdopen(fd, "w") as stream:
                if os.geteuid() == 0 and self.control_owner_uid != 0:
                    os.fchown(stream.fileno(), self.control_owner_uid, -1)
                os.fchmod(stream.fileno(), 0o600)
                json.dump({"schema": 1, "transaction": transaction}, stream)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            self._publish_marker(Path(temporary), path)
        except FileExistsError:
            if self._read_marker() != transaction:
                raise TransactionFailure("Engine fence belongs to another transaction")
        except OSError as exc:
            raise TransactionFailure("Engine fence publication failed") from exc
        finally:
            if temporary is not None:
                try:
                    os.unlink(temporary)
                except FileNotFoundError:
                    pass
            self._fsync_directory()

    @staticmethod
    def _publish_marker(temporary: Path, destination: Path):
        # The complete, fsynced temp inode becomes visible without replacing a
        # marker another transaction may have published under the host lock.
        os.link(temporary, destination, follow_symlinks=False)
        os.unlink(temporary)

    def _exclusive_lock(self):
        lock_root = self.lock_dir or self.control
        return exclusive_lock(lock_root / ".engine-update.lock")

    def _fsync_directory(self):
        fd = os.open(self.control, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

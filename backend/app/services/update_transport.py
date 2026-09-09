"""Participant RPC over an operator-configured SSH alias or local executable.

Endpoint configuration comes from the installation inventory, never the release.
The remote helper is a fixed command: request values travel exclusively on stdin.
"""
import json
import math
import re
import subprocess
import tempfile
import hashlib
import os
import stat
import selectors
import signal
import time
from dataclasses import dataclass

from .update_transaction import TransactionFailure


OPERATIONS = frozenset({"prepare", "quiesce", "snapshot", "apply", "start", "verify",
                        "activate", "rollback", "verify_rollback", "finalize"})
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
REMOTE_HELPER = "/usr/local/libexec/treseko-update-participant"
MAX_RESPONSE_BYTES = 65536


def _bounded_response(command, source, timeout):
    """Read a bounded receipt, killing only the local transport group on failure.

    Stopping SSH does not prove the remote operation stopped: retain uncertainty.
    Input is a private seekable file, avoiding a pipe write/read deadlock.
    """
    deadline = time.monotonic() + timeout
    with subprocess.Popen(command, stdin=source, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, start_new_session=True) as process:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            output = bytearray()
            try:
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(command, timeout)
                    if not selector.select(remaining):
                        continue
                    chunk = os.read(process.stdout.fileno(), 4096)
                    if not chunk:
                        process.wait(timeout=max(0, deadline - time.monotonic()))
                        if process.returncode:
                            raise TransactionFailure('Participant process failed; outcome is uncertain')
                        return bytes(output)
                    if len(output) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise TransactionFailure('Participant receipt exceeds limit; outcome is uncertain')
                    output.extend(chunk)
            except BaseException:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                raise


@dataclass(frozen=True)
class ProcessParticipant:
    participant_id: str
    command: tuple[str, ...]
    timeout: float = 300

    def __post_init__(self):
        if not IDENTIFIER.fullmatch(self.participant_id):
            raise ValueError("Invalid participant identifier")
        if not self.command or not all(isinstance(arg, str) and arg for arg in self.command):
            raise ValueError("An operator-configured command is required")
        if not math.isfinite(self.timeout) or self.timeout <= 0:
            raise ValueError("A finite positive timeout is required")

    @classmethod
    def ssh(cls, participant_id: str, alias: str, timeout: float = 300):
        if not IDENTIFIER.fullmatch(alias):
            raise ValueError("Use an explicit SSH config alias without options")
        return cls(participant_id, (
            "ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=2", alias, REMOTE_HELPER,
        ), timeout)

    def execute(self, operation: str, transaction: str, release: dict) -> dict:
        if operation not in OPERATIONS or not IDENTIFIER.fullmatch(transaction):
            raise ValueError("Invalid update operation or transaction identifier")
        request = {
            "schema": 1, "participant": self.participant_id,
            "operation": operation, "transaction": transaction, "release": release,
        }
        encoded = json.dumps(request).encode()
        if len(encoded) > 1024 * 1024:
            raise ValueError('Participant request exceeds limit')
        try:
            with tempfile.TemporaryFile() as source:
                source.write(encoded)
                source.seek(0)
                response = _bounded_response(self.command, source, self.timeout)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise TransactionFailure("Participant response unavailable; outcome is uncertain") from exc
        try:
            payload = json.loads(response)
        except (ValueError, TypeError, RecursionError) as exc:
            raise TransactionFailure("Invalid participant response; outcome is uncertain") from exc
        if (not isinstance(payload, dict) or type(payload.get("schema")) is not int or payload.get("schema") != 1
                or payload.get("participant") != self.participant_id
                or payload.get("transaction") != transaction
                or payload.get("operation") != operation):
            raise TransactionFailure("Participant response does not match request; outcome is uncertain")
        # Do not forward arbitrary diagnostics, credentials or stdout into journals.
        return {key: payload[key] for key in ("ok", "version", "previous_version", "transaction")
                if key in payload}

    def send_artifact(self, transaction, release, archive):
        from .update_artifact_transfer import validate_header
        request = {"schema": 1, "participant": self.participant_id, "operation": "receive",
                   "transaction": transaction, "release": release}
        size, checksum = validate_header(request)
        # Send a private copy of the exact bytes hashed, not a path that could
        # change between local validation and SSH transmission.
        with tempfile.TemporaryFile() as payload:
            payload.write(json.dumps(request).encode() + b"\n")
            digest, total = hashlib.sha256(), 0
            descriptor = os.open(archive, os.O_RDONLY | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as source:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    raise ValueError("Local artifact must be a regular file")
                while chunk := source.read(1024 * 1024):
                    total += len(chunk)
                    if total > size:
                        raise ValueError("Local artifact exceeds signed size")
                    digest.update(chunk)
                    payload.write(chunk)
            if total != size or digest.hexdigest() != checksum:
                raise ValueError("Local artifact does not match signed manifest")
            payload.seek(0)
            try:
                response = _bounded_response((*self.command, "--receive"), payload, self.timeout)
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise TransactionFailure("Artifact transfer outcome uncertain; retry the same artifact") from exc
            try:
                receipt = json.loads(response)
            except (ValueError, TypeError, RecursionError) as exc:
                raise TransactionFailure('Invalid artifact receipt; outcome is uncertain') from exc
        expected = {"schema": 1, "ok": True, "operation": "receive",
                    "participant": self.participant_id, "transaction": transaction,
                    "checksum_sha256": checksum, "package_size_bytes": size}
        if receipt != expected:
            raise TransactionFailure("Artifact receipt does not match transfer")
        return expected

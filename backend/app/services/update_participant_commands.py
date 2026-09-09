"""Local service driver commands from private operator configuration, never RPC."""
import json
import math
import os
from pathlib import Path
import stat
import signal
import subprocess
import tempfile

from .update_transaction import TransactionFailure


RUNTIME_OPERATIONS = {"prepare", "quiesce", "snapshot", "apply", "start", "verify",
                      "verify_rollback", "rollback", "activate"}


def load_private_json(path: Path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as stream:
        metadata = os.fstat(stream.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid not in {0, os.geteuid()}
                or metadata.st_mode & 0o022 or metadata.st_size > 1024 * 1024):
            raise ValueError("Participant configuration must be private and operator-owned")
        config = json.load(stream)
    if not isinstance(config, dict) or config.get("schema") != 1:
        raise ValueError("Invalid participant configuration schema")
    return config


def load_private_config(path: Path):
    config = load_private_json(path)
    for key in ("directory", "cache"):
        value = Path(config[key])
        if not value.is_absolute() or len(value.parts) < 3 or ".." in value.parts:
            raise ValueError("Participant paths must be explicit dedicated directories")
    return config


class CommandRuntime:
    def __init__(self, commands: dict, timeout: float = 300):
        if set(commands) != RUNTIME_OPERATIONS:
            raise ValueError("All runtime operation commands must be configured explicitly")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Invalid runtime timeout")
        for command in commands.values():
            if (not isinstance(command, list) or not command
                    or not all(isinstance(arg, str) and arg and "\0" not in arg for arg in command)
                    or not Path(command[0]).is_absolute()):
                raise ValueError("Runtime commands must use absolute executable paths and argv lists")
        self.commands = {key: tuple(value) for key, value in commands.items()}
        self.timeout = timeout

    def __call__(self, operation, context, release):
        request = {"schema": 1, "operation": operation,
                   "context": {key: value for key, value in context.items() if key != "_lock_fd"},
                   "release": release}
        # Commands are trusted local adapters. Keep their diagnostics out of RPC
        # and journals; bound the JSON receipt read back into memory.
        with tempfile.TemporaryFile() as output:
            try:
                # If the RPC helper is killed, its driver retains the host lock
                # until it exits. On a handled timeout, kill/wait the whole local
                # process group before allowing a recovery request to take it.
                inherited = (context["_lock_fd"],) if "_lock_fd" in context else ()
                with subprocess.Popen(self.commands[operation], stdin=subprocess.PIPE,
                                      stdout=output, stderr=subprocess.DEVNULL,
                                      start_new_session=True, pass_fds=inherited) as process:
                    try:
                        process.communicate(json.dumps(request).encode(), timeout=self.timeout)
                    except BaseException:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.wait()
                        raise
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise TransactionFailure("Runtime response unavailable; outcome is uncertain") from exc
            if process.returncode or output.tell() > 65536:
                raise TransactionFailure("Runtime command failed or receipt exceeds limit")
            output.seek(0)
            try:
                receipt = json.load(output)
            except (ValueError, UnicodeError) as exc:
                raise TransactionFailure("Invalid runtime receipt") from exc
        if (not isinstance(receipt, dict) or receipt.get("schema") != 1
                or receipt.get("operation") != operation
                or receipt.get("transaction") != context["transaction"]
                or receipt.get("participant") != context["participant"]):
            raise TransactionFailure("Runtime receipt does not match operation and participant")
        return receipt

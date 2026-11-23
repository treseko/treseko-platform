"""Fail-closed admission gate for the current coordinated installation.

The binding is host-owned evidence mounted read-only into the backend. Its
JSON is not self-authenticating; strict permissions and an explicitly
configured installation-owner UID provide the trust boundary.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
from typing import Any, Mapping


DEFAULT_BINDING_PATH = Path("/run/treseko/update/installation-binding.json")
_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
_MODES = {"legacy", "coordinated"}


class InstallationModeError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def binding_path() -> Path:
    raw = os.getenv("TRESEKO_INSTALLATION_BINDING_FILE")
    path = Path(raw) if raw else DEFAULT_BINDING_PATH
    if (not path.is_absolute() or ".." in path.parts
            or any(char in str(path) for char in ("\x00", "\n", "\r"))):
        raise InstallationModeError("installation_binding_path_invalid")
    return path


def _env_signals() -> tuple[str, bool]:
    mode = os.getenv("TRESEKO_UPDATE_MODE", "").strip().lower()
    if mode not in {"", "legacy", "coordinated"}:
        raise InstallationModeError("installation_mode_invalid")
    boot = os.getenv("TRESEKO_COORDINATED_BACKEND_BOOT", "").strip().lower()
    if boot not in {"", "true", "false"}:
        raise InstallationModeError("coordinated_boot_signal_invalid")
    return mode, boot == "true"


def _validate_binding(path: Path) -> dict[str, Any]:
    raw_owner = os.getenv("TRESEKO_INSTALLATION_BINDING_OWNER_UID", "").strip()
    if raw_owner and not re.fullmatch(r"[0-9]{1,10}", raw_owner):
        raise InstallationModeError("installation_binding_owner_invalid")
    expected_owner = int(raw_owner) if raw_owner else None
    allowed_owners = {0}
    if expected_owner is not None:
        allowed_owners.add(expected_owner)
    current = path.parent
    while True:
        try:
            info = current.lstat()
        except FileNotFoundError as exc:
            raise InstallationModeError("installation_binding_unreadable") from exc
        except OSError as exc:
            raise InstallationModeError("installation_binding_unreadable") from exc
        if (stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode)
                or info.st_uid not in allowed_owners or info.st_mode & 0o022):
            raise InstallationModeError("installation_binding_unsafe_parent")
        if current.parent == current:
            break
        current = current.parent
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_uid not in allowed_owners
                    or before.st_mode & 0o022 or before.st_size > 4096):
                raise InstallationModeError("installation_binding_unsafe")
            raw = stream.read(4097)
            after = os.fstat(stream.fileno())
            if (before.st_dev != after.st_dev or before.st_ino != after.st_ino
                    or before.st_size != after.st_size or after.st_size > 4096
                    or len(raw) > 4096):
                raise InstallationModeError("installation_binding_changed")
    except InstallationModeError:
        raise
    except (OSError, ValueError, UnicodeError) as exc:
        raise InstallationModeError("installation_binding_unreadable") from exc
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise InstallationModeError("installation_binding_invalid") from exc
    if (not isinstance(value, dict)
            or set(value) != {"schema", "installation_id", "mode", "owner", "generation"}
            or type(value.get("schema")) is not int or value["schema"] != 1
            or not isinstance(value.get("installation_id"), str)
            or not _IDENTIFIER.fullmatch(value["installation_id"])
            or value.get("mode") not in _MODES
            or value.get("owner") != "host-update-coordinator"
            or type(value.get("generation")) is not int or value["generation"] < 1):
        raise InstallationModeError("installation_binding_invalid")
    return value


def resolve(command: str = "request") -> str:
    if command not in {"request", "status", "legacy", "coordinated-serve", "migrate-only", "history"}:
        raise InstallationModeError("installation_mode_command_invalid")
    env_mode, boot_signal = _env_signals()
    if command == "coordinated-serve":
        boot_signal = True
    path = binding_path()
    try:
        path.lstat()
    except FileNotFoundError:
        if os.getenv("TRESEKO_INSTALLATION_BINDING_FILE"):
            raise InstallationModeError("installation_binding_missing")
        binding = None
    except OSError as exc:
        raise InstallationModeError("installation_binding_unreadable") from exc
    else:
        binding = _validate_binding(path)
    if binding is None:
        if env_mode == "coordinated" or boot_signal:
            raise InstallationModeError("coordinated_binding_required")
        return "legacy"
    mode = binding["mode"]
    if env_mode and env_mode != mode:
        raise InstallationModeError("installation_mode_binding_mismatch")
    if boot_signal and mode != "coordinated":
        raise InstallationModeError("coordinated_binding_required")
    if command == "legacy" and mode == "coordinated":
        raise InstallationModeError("legacy_path_forbidden")
    return mode


def require(command: str = "request") -> str:
    return resolve(command)


def require_atomic_update_coordinator() -> str:
    """Fail closed unless the host owns updates through its transaction journal."""
    mode = resolve("request")
    if mode != "coordinated":
        raise InstallationModeError("atomic_update_coordinator_required")
    return mode


def _native_worker_restart_ready() -> bool:
    """Check that a paired native Worker will be restarted after self-update.

    The 1.0.7 Worker exits successfully after consuming its update marker.
    A systemd unit with Restart=on-failure therefore leaves it stopped. The
    same-file OTA contains a root bootstrap that changes this policy; until it
    has run, do not advertise or accept an in-app update for this topology.
    """
    raw_dir = os.getenv("TRESEKO_WORKER_UPDATE_SOURCE_DIR") or os.getenv("TRESEKO_WORKER_DIR")
    if not raw_dir:
        return True  # This Backend has no separately managed local Worker.
    worker_dir = Path(raw_dir)
    try:
        if (not worker_dir.is_absolute() or ".." in worker_dir.parts
                or not worker_dir.is_dir() or worker_dir.is_symlink()):
            return False
    except OSError:
        return False

    unit = os.getenv("TRESEKO_WORKER_SYSTEMD_UNIT", "treseko-worker.service").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.@:-]+\.service", unit):
        return False
    systemctl = shutil.which("systemctl") or "/usr/bin/systemctl"
    try:
        state = subprocess.run(
            [systemctl, "show", unit, "--property=LoadState", "--property=Restart"],
            check=False, capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    if state.returncode != 0:
        return False
    properties = dict(
        line.split("=", 1) for line in state.stdout.splitlines() if "=" in line
    )
    return properties.get("LoadState") == "loaded" and properties.get("Restart") == "always"


def require_update_runtime() -> str:
    """Return the updater that can safely apply this installation's package.

    Native systemd installs use the entrypoint update journal and rollback
    path. A paired Worker must also have the restart policy installed by the
    bootstrap included in the same OTA. Compose installations require the
    host coordinator.
    """
    mode = resolve("request")
    if mode == "coordinated":
        return mode
    if mode == "legacy" and os.getenv("TRESEKO_DEPLOY_MODE", "").strip().lower() == "systemd":
        if not _native_worker_restart_ready():
            raise InstallationModeError("native_worker_restart_bootstrap_required")
        return "systemd-native"
    raise InstallationModeError("atomic_update_coordinator_required")


def update_installation_status() -> dict[str, Any]:
    """Describe whether this installation can safely apply an in-app update."""
    try:
        mode = resolve("status")
        native_systemd = (
            mode == "legacy"
            and os.getenv("TRESEKO_DEPLOY_MODE", "").strip().lower() == "systemd"
        )
        supported = mode == "coordinated" or native_systemd
        reported_mode = "systemd-native" if native_systemd else mode
        reason = None if supported else "atomic_update_coordinator_required"
        if native_systemd and not _native_worker_restart_ready():
            supported = False
            reason = "native_worker_restart_bootstrap_required"
    except InstallationModeError as exc:
        reported_mode, supported, reason = "invalid", False, exc.code
    return {"apply_supported": supported, "installation_mode": reported_mode,
            "update_block_reason": reason}

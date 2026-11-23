"""Safely write and activate Linux user-service coordinator artifacts."""
from __future__ import annotations

import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import stat
import subprocess
import tempfile
from typing import Any, Callable, Mapping, Sequence

from .update_host_coordinator_bootstrap import (
    HostCoordinatorBootstrapError, plan_linux_user_bootstrap,
)


def render_linux_user_artifacts(plan: Mapping[str, Any], installation_id: str) -> dict[str, tuple[bytes, int]]:
    """Render the actual host files installed by a platform bootstrap.

    Rendering is side-effect free. Installation code can review and validate
    every target before atomically writing any files.
    """
    service_manager = plan.get("fixed_settings", {}).get("service_manager") if isinstance(plan, Mapping) else None
    if (not isinstance(plan, Mapping) or plan.get("kind") != "host_update_coordinator_bootstrap_plan"
            or plan.get("operational") is not False
            or service_manager not in {"systemd-user", "launchd-user"}):
        raise HostCoordinatorBootstrapError("bootstrap_plan_invalid")
    if not isinstance(installation_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", installation_id):
        raise HostCoordinatorBootstrapError("installation_id_invalid")
    paths = plan.get("paths")
    if not isinstance(paths, Mapping):
        raise HostCoordinatorBootstrapError("bootstrap_paths_invalid")
    image_id = plan.get("helper_image_id")
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise HostCoordinatorBootstrapError("helper_image_identity_required")

    project = plan["project"]
    fixed = plan["fixed_settings"]
    service_name = Path(paths["service"]).name
    timer_name = Path(paths["timer"]).name if paths.get("timer") else None
    wrapper_path = paths["wrapper"]
    wrapper = plan.get("wrapper")
    if not isinstance(wrapper, str) or not wrapper.startswith("#!/bin/sh\nset -eu\n"):
        raise HostCoordinatorBootstrapError("bootstrap_wrapper_invalid")

    if service_manager == "systemd-user":
        # These paths are generated below the user's home and the planner
        # rejects unit-breaking control characters. Keep them unquoted:
        # ConditionPathExists treats quote characters as part of the path,
        # which silently disables the spool service on systemd.
        service = (
            "[Unit]\nDescription=Treseko coordinated update spool consumer\n"
            "After=network-online.target\nWants=network-online.target\n"
            f"ConditionPathExists={paths['bridge_config']}\n"
            f"ConditionPathExists={wrapper_path}\n\n"
            "[Service]\nType=oneshot\n"
            f"ExecStart={wrapper_path}\n"
            "TimeoutStartSec=3600\nNoNewPrivileges=true\nPrivateTmp=true\nUMask=0077\n"
        )
        timer = (
            "[Unit]\nDescription=Treseko coordinated update spool recovery timer\n\n"
            "[Timer]\nOnBootSec=30s\nOnUnitInactiveSec=30s\nPersistent=true\n"
            f"Unit={service_name}\n\n[Install]\nWantedBy=timers.target\n"
        )
    else:
        label = f"com.treseko.update-spool.{project}"
        plist = {
            "Label": label,
            "ProgramArguments": ["/bin/sh", wrapper_path],
            "RunAtLoad": True,
            "StartInterval": 30,
            "StandardOutPath": str(Path(plan["state"]["root"]) / "bridge.log"),
            "StandardErrorPath": str(Path(plan["state"]["root"]) / "bridge.log"),
            "Umask": 0o077,
            "ProcessType": "Background",
        }
        service = plistlib.dumps(plist, fmt=plistlib.FMT_XML, sort_keys=True)
        timer = None
    binding = {
        "schema": 1,
        "installation_id": installation_id,
        "mode": "coordinated",
        "owner": "host-update-coordinator",
        "generation": 1,
    }
    services = plan["topology_binding_existing"]["services"]
    backend_service = services["backend"]
    container_binding = "/run/treseko/update/installation-binding.json"
    env = {
        "TRESEKO_UPDATE_REQUEST_INBOX": fixed["request_inbox"],
        "TRESEKO_UPDATE_PACKAGE_INBOX": fixed["package_inbox"],
        "TRESEKO_UPDATE_REPORT_DIR": fixed["report_dir"],
        "TRESEKO_UPDATE_REQUEST_UID": str(fixed["bridge_uid"]),
        "TRESEKO_UPDATE_REQUEST_GID": str(fixed["bridge_gid"]),
        "TRESEKO_UPDATE_MODE": "coordinated",
        "TRESEKO_BACKEND_UPDATE_CONTROL_DIR": fixed["control_dir"],
        "TRESEKO_INSTALLATION_BINDING_FILE": container_binding,
        "TRESEKO_INSTALLATION_BINDING_OWNER_UID": str(fixed["bridge_uid"]),
    }
    mounts = (
        (fixed["request_inbox"], "rw"),
        (fixed["package_inbox"], "rw"),
        (fixed["report_dir"], "ro"),
        (fixed["control_dir"], "rw"),
        (fixed["binding_path"], "ro"),
    )
    compose_override = (
        "services:\n  " + json.dumps(backend_service) + ":\n"
        "    command: [\"coordinated-serve\"]\n    environment:\n"
        + "".join(f"      {json.dumps(k)}: {json.dumps(v)}\n" for k, v in env.items())
        + "    volumes:\n"
        + "".join(
            "      - " + json.dumps(
                f"{source}:{container_binding if source == fixed['binding_path'] else source}:{mode}"
            ) + "\n"
            for source, mode in mounts
        )
    )
    artifacts = {
        paths["controller_config"]: (json.dumps(plan["controller_config"], sort_keys=True, indent=2).encode() + b"\n", 0o600),
        paths["bridge_runtime_config"]: (json.dumps(plan["bridge_runtime_config"], sort_keys=True, indent=2).encode() + b"\n", 0o600),
        paths["bridge_config"]: (json.dumps(plan["bridge_spool_config"], sort_keys=True, indent=2).encode() + b"\n", 0o600),
        paths["binding"]: (json.dumps(binding, sort_keys=True, indent=2).encode() + b"\n", 0o600),
        paths["compose_override"]: (compose_override.encode(), 0o640),
        paths["service"]: (service if isinstance(service, bytes) else service.encode(), 0o644),
        wrapper_path: (wrapper.encode(), 0o755),
    }
    if timer_name:
        artifacts[paths["timer"]] = (timer.encode(), 0o644)
    expected_count = 8 if service_manager == "systemd-user" else 7
    if len(artifacts) != expected_count or any(Path(path).is_absolute() is False for path in artifacts):
        raise HostCoordinatorBootstrapError("bootstrap_artifacts_invalid")
    return artifacts


def write_linux_user_artifacts(plan: Mapping[str, Any], installation_id: str) -> dict[str, Any]:
    """Atomically install config, Compose override, wrapper, and user units.

    This installs the files only. A caller must activate the timer and apply
    the Compose override after the candidate application is running.
    """
    artifacts = render_linux_user_artifacts(plan, installation_id)
    paths = plan["paths"]
    home = Path(paths["config_root"]).parents[3]
    if home.is_symlink() or not home.is_dir():
        raise HostCoordinatorBootstrapError("home_unavailable")
    home_info = home.lstat()
    uid = os.getuid()
    if home_info.st_uid != uid or home_info.st_mode & 0o022:
        raise HostCoordinatorBootstrapError("home_unsafe")

    state_dirs = plan["state"]
    modes = {
        state_dirs["root"]: 0o700,
        state_dirs["requests"]: 0o730,
        state_dirs["packages"]: 0o700,
        state_dirs["reports"]: 0o750,
        state_dirs["controller"]: 0o700,
        state_dirs["bridge_state"]: 0o700,
        state_dirs["spool_state"]: 0o700,
        state_dirs["control"]: 0o700,
        paths["config_root"]: 0o700,
        str(Path(paths["service"]).parent): 0o700,
        str(Path(paths["wrapper"]).parent): 0o700,
    }
    for raw, mode in modes.items():
        path = Path(raw)
        if not path.is_absolute() or home not in path.parents:
            raise HostCoordinatorBootstrapError("bootstrap_target_outside_home")
        cursor = home
        for component in path.relative_to(home).parts:
            cursor = cursor / component
            if cursor.exists() and cursor.is_symlink():
                raise HostCoordinatorBootstrapError("bootstrap_target_symlink")
        path.mkdir(mode=mode, parents=True, exist_ok=True)
        info = path.lstat()
        unsafe_write_bits = 0o002 if mode & 0o020 else 0o022
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_mode & unsafe_write_bits:
            raise HostCoordinatorBootstrapError("bootstrap_target_unsafe")
        path.chmod(mode)

    backups: dict[str, tuple[bytes | None, int | None]] = {}
    try:
        for raw_path, (content, mode) in artifacts.items():
            path = Path(raw_path)
            if home not in path.parents or path.is_symlink():
                raise HostCoordinatorBootstrapError("bootstrap_artifact_target_unsafe")
            if path.exists():
                info = path.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, uid}:
                    raise HostCoordinatorBootstrapError("bootstrap_existing_artifact_unsafe")
                backups[raw_path] = (path.read_bytes(), stat.S_IMODE(info.st_mode))
            else:
                backups[raw_path] = (None, None)
            fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
            try:
                os.fchmod(fd, mode)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
            finally:
                try:
                    os.unlink(temporary)
                except FileNotFoundError:
                    pass
    except Exception:
        for raw_path, (content, mode) in backups.items():
            path = Path(raw_path)
            if content is None:
                # A pre-existing directory at a file target is unsafe and is
                # left for operator review. Do not let rollback turn that
                # expected validation failure into IsADirectoryError or
                # remove the directory as collateral cleanup.
                if path.is_dir() and not path.is_symlink():
                    continue
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
            else:
                path.write_bytes(content)
                path.chmod(mode or 0o600)
        raise
    return {"ok": True, "operational": False, "installation_id": installation_id,
            "files": sorted(artifacts), "config_sha256": plan["config_sha256"]}


def _run_checked(run: Callable[..., Any], argv: Sequence[str], *, timeout: int = 300) -> Any:
    try:
        result = run(list(argv), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                     text=True, check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired, TimeoutError) as exc:
        raise HostCoordinatorBootstrapError("bootstrap_command_failed") from exc
    if getattr(result, "returncode", 1) != 0:
        raise HostCoordinatorBootstrapError("bootstrap_command_failed")
    return result


def install_linux_user_bootstrap(plan: Mapping[str, Any], installation_id: str,
                                 *, runner: Callable[..., Any] | None = None,
                                 health_timeout: int = 180) -> dict[str, Any]:
    """Install and activate a user coordinator for an already-updated app.

    The currently selected Compose release must already support
    ``coordinated-serve``. Installation files are restored and the backend is
    returned to its previous Compose model if activation or health checks fail.
    """
    artifacts = render_linux_user_artifacts(plan, installation_id)
    topology = plan["topology_binding_existing"]
    active_compose = Path(topology["compose_file"])
    backend_entrypoint = active_compose.parent / "backend" / "entrypoint.sh"
    try:
        capability = backend_entrypoint.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise HostCoordinatorBootstrapError("coordinated_backend_capability_unavailable") from exc
    if "coordinated-serve" not in capability:
        raise HostCoordinatorBootstrapError("coordinated_backend_capability_missing")

    run = runner or subprocess.run
    paths = plan["paths"]
    state = plan["state"]
    service_manager = plan["fixed_settings"]["service_manager"]
    timer_name = Path(paths["timer"]).name if paths.get("timer") else None
    service_path = paths["service"]
    launchd_label = f"com.treseko.update-spool.{plan['project']}"
    try:
        if service_manager == "systemd-user":
            timer_enabled = getattr(run(["systemctl", "--user", "is-enabled", timer_name],
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                        text=True, check=False, timeout=15), "returncode", 1) == 0
            timer_active = getattr(run(["systemctl", "--user", "is-active", timer_name],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, check=False, timeout=15), "returncode", 1) == 0
        else:
            target = f"gui/{os.getuid()}/{launchd_label}"
            timer_active = getattr(run(["launchctl", "print", target],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, check=False, timeout=15), "returncode", 1) == 0
            disabled_state = run(["launchctl", "print-disabled", f"gui/{os.getuid()}"],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, check=False, timeout=15)
            disabled_output = str(getattr(disabled_state, "stdout", ""))
            timer_enabled = (getattr(disabled_state, "returncode", 1) != 0
                             or re.search(rf"{re.escape(launchd_label)}\s*=>\s*true", disabled_output) is None)
    except (OSError, subprocess.TimeoutExpired, TimeoutError):
        timer_enabled = timer_active = False

    backups: dict[str, tuple[bytes | None, int | None]] = {}
    for raw_path in artifacts:
        path = Path(raw_path)
        if path.is_symlink():
            raise HostCoordinatorBootstrapError("bootstrap_existing_artifact_unsafe")
        if path.exists():
            info = path.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.getuid()}:
                raise HostCoordinatorBootstrapError("bootstrap_existing_artifact_unsafe")
            backups[raw_path] = (path.read_bytes(), stat.S_IMODE(info.st_mode))
        else:
            backups[raw_path] = (None, None)

    def compose_command(*, with_override: bool) -> list[str]:
        active_working_dir = str(Path(plan["topology_binding_existing"]["compose_file"]).parent)
        command = [plan["docker"], "compose", "--project-directory", active_working_dir,
                   "--project-name", plan["project"], "--env-file", plan["env_file"],
                   "--profile", "*"]
        for compose_file in plan["compose_files"]:
            command.extend(("-f", compose_file))
        if with_override:
            command.extend(("-f", paths["compose_override"]))
        command.extend(("up", "-d", "--wait", "--wait-timeout", str(health_timeout),
                        plan["topology_binding_existing"]["services"]["backend"]))
        return command

    def restore_files() -> None:
        for raw_path, (content, mode) in backups.items():
            path = Path(raw_path)
            if content is None:
                if path.is_dir() and not path.is_symlink():
                    continue
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
            else:
                temporary = path.with_name(f".{path.name}.{os.urandom(5).hex()}.restore")
                temporary.write_bytes(content)
                temporary.chmod(mode or 0o600)
                os.replace(temporary, path)

    try:
        write_linux_user_artifacts(plan, installation_id)
        for directory in state.values():
            Path(directory).mkdir(mode=0o700, parents=True, exist_ok=True)
        if service_manager == "systemd-user":
            _run_checked(run, ["systemctl", "--user", "daemon-reload"], timeout=30)
            _run_checked(run, ["systemctl", "--user", "enable", "--now", timer_name], timeout=60)
        else:
            target = f"gui/{os.getuid()}"
            _run_checked(run, ["launchctl", "enable", f"{target}/{launchd_label}"], timeout=30)
            _run_checked(run, ["launchctl", "bootstrap", target, service_path], timeout=60)
        _run_checked(run, compose_command(with_override=True), timeout=health_timeout + 30)
        return {"ok": True, "operational": True, "installation_id": installation_id,
                "project": plan["project"], "service": Path(paths["service"]).name,
                "timer": timer_name, "files": sorted(artifacts)}
    except Exception as exc:
        try:
            if service_manager == "systemd-user":
                if not timer_enabled:
                    run(["systemctl", "--user", "disable", "--now", timer_name],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                        check=False, timeout=30)
                _run_checked(run, ["systemctl", "--user", "daemon-reload"], timeout=30)
                if timer_enabled and timer_active:
                    _run_checked(run, ["systemctl", "--user", "enable", "--now", timer_name], timeout=30)
            else:
                target = f"gui/{os.getuid()}"
                run(["launchctl", "bootout", f"{target}/{launchd_label}"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                    check=False, timeout=30)
                if timer_enabled:
                    _run_checked(run, ["launchctl", "enable", f"{target}/{launchd_label}"], timeout=30)
                else:
                    run(["launchctl", "disable", f"{target}/{launchd_label}"],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                        check=False, timeout=30)
                if timer_active:
                    _run_checked(run, ["launchctl", "bootstrap", target, service_path], timeout=30)
            _run_checked(run, compose_command(with_override=False), timeout=health_timeout + 30)
        except Exception as rollback_error:
            # Keep the binding mount source in place if Docker cannot restore
            # the previous backend. Removing it while Compose still references
            # it can recreate the source as an empty directory.
            raise HostCoordinatorBootstrapError("bootstrap_failed_rollback_incomplete") from rollback_error
        restore_files()
        raise HostCoordinatorBootstrapError("bootstrap_activation_failed") from exc

"""Plan a per-installation host user-service bootstrap.

Planning remains side-effect free. Installation is a separate guarded
operation that writes private configuration, enables the user timer, and
activates the coordinated backend only after capability checks pass.
"""
from __future__ import annotations

import os
import hashlib
import json
from pathlib import Path
import re
import shlex
import stat
import subprocess
from typing import Any, Callable, Mapping, Sequence


_PROJECT = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
_REQUIRED_ROLES = {"backend", "frontend", "engine", "db"}
_OPTIONAL_ROLES = {"automation_worker", "plugin_runner"}


class HostCoordinatorBootstrapError(ValueError):
    """The selected Compose installation cannot be bootstrapped safely."""


def _safe_absolute(value: Any, label: str) -> Path:
    if (not isinstance(value, str) or not value.startswith("/") or ".." in Path(value).parts
            or any(char in value for char in ("\x00", "\n", "\r", ",", "%"))):
        raise HostCoordinatorBootstrapError(f"{label}_invalid")
    return Path(value)


def _private_root(path: Path, label: str) -> None:
    if path.is_symlink():
        raise HostCoordinatorBootstrapError(f"{label}_symlink")
    if path.exists():
        info = path.lstat()
        if not path.is_dir() or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022:
            raise HostCoordinatorBootstrapError(f"{label}_unsafe")


def plan_linux_user_bootstrap(candidate: Mapping[str, Any], *, project_root: str,
                              env_file: str, docker: str = "/usr/bin/docker",
                              docker_socket: str = "/var/run/docker.sock",
                              home: str | None = None, uid: int | None = None,
                              gid: int | None = None,
                              docker_socket_gid: int | None = None,
                              helper_image_id: str | None = None) -> dict[str, Any]:
    """Return deterministic private config and host paths for one Compose project.

    This planner supports Linux systemd user units and macOS LaunchAgents.
    It does not create files, build images, or contact Docker; those effects
    belong to the later installer transaction.
    """
    if not isinstance(candidate, Mapping) or candidate.get("operational") is not False:
        raise HostCoordinatorBootstrapError("preflight_candidate_invalid")
    host_os = candidate.get("host_os")
    if candidate.get("deployment") != "single-host-compose" or host_os not in {"linux", "darwin"}:
        raise HostCoordinatorBootstrapError("unsupported_host_topology")
    expected_manager = "systemd-user" if host_os == "linux" else "launchd-user"
    if candidate.get("service_manager_candidate") != expected_manager:
        raise HostCoordinatorBootstrapError("persistent_user_service_manager_unavailable")
    project = candidate.get("compose_project")
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise HostCoordinatorBootstrapError("compose_project_invalid")
    services = candidate.get("service_roles")
    if (not isinstance(services, Mapping) or not _REQUIRED_ROLES <= set(services)
            or set(services) - (_REQUIRED_ROLES | _OPTIONAL_ROLES)
            or any(not isinstance(value, str) or not _PROJECT.fullmatch(value)
                   for value in services.values())
            or len(set(services.values())) != len(services)):
        raise HostCoordinatorBootstrapError("compose_service_inventory_invalid")

    root = _safe_absolute(project_root, "project_root")
    env = _safe_absolute(env_file, "env_file")
    docker_path = _safe_absolute(docker, "docker")
    socket_path = _safe_absolute(docker_socket, "docker_socket")
    if env == root or root in env.parents:
        pass
    else:
        raise HostCoordinatorBootstrapError("env_file_outside_installation")
    active_working = _safe_absolute(candidate.get("compose_working_dir"), "compose_working_dir")
    if active_working != root and root not in active_working.parents:
        raise HostCoordinatorBootstrapError("compose_working_dir_outside_installation")
    compose_files = candidate.get("compose_files")
    if (not isinstance(compose_files, list) or not compose_files
            or any(not isinstance(item, str) or not item.startswith("/") for item in compose_files)):
        raise HostCoordinatorBootstrapError("compose_files_invalid")
    compose_paths = [_safe_absolute(item, "compose_file") for item in compose_files]
    if not isinstance(candidate.get("transaction_overlays_to_rebase", []), list):
        raise HostCoordinatorBootstrapError("transaction_overlays_invalid")
    if helper_image_id is not None and not re.fullmatch(r"sha256:[0-9a-f]{64}", helper_image_id):
        raise HostCoordinatorBootstrapError("helper_image_identity_invalid")
    selected_uid = int(uid if uid is not None else os.getuid())
    selected_gid = int(gid if gid is not None else os.getgid())
    socket_gid = docker_socket_gid
    if socket_gid is not None and (type(socket_gid) is not int or socket_gid < 0):
        raise HostCoordinatorBootstrapError("docker_socket_group_invalid")

    home_path = _safe_absolute(home or str(Path.home()), "home")
    _private_root(home_path, "home")
    user_state = home_path / ".local" / "state" / "treseko-update" / project
    user_config = home_path / ".config" / "treseko" / "update" / project
    unit_root = (home_path / ".config" / "systemd" / "user" if host_os == "linux"
                 else home_path / "Library" / "LaunchAgents")
    helper_root = home_path / ".local" / "libexec"
    state = {
        "root": str(user_state),
        "requests": str(user_state / "requests"),
        "packages": str(user_state / "packages"),
        "reports": str(user_state / "reports"),
        "controller": str(user_state / "controller"),
        "bridge_state": str(user_state / "bridge-state"),
        "spool_state": str(user_state / "spool-state"),
        "control": str(user_state / "control"),
    }
    paths = {
        "config_root": str(user_config),
        "controller_config": str(user_config / "controller.json"),
        "bridge_config": str(user_config / "bridge.json"),
        "bridge_runtime_config": str(user_config / "bridge-runtime.json"),
        "binding": str(user_config / "installation-binding.json"),
        "compose_override": str(user_config / "coordinated.override.yaml"),
        "service": str(unit_root / (f"treseko-update-spool-{project}.service" if host_os == "linux"
                                     else f"com.treseko.update-spool.{project}.plist")),
        "timer": str(unit_root / f"treseko-update-spool-{project}.timer") if host_os == "linux" else None,
        "wrapper": str(helper_root / f"treseko-update-spool-{project}-wrapper"),
    }
    image = helper_image_id or f"treseko-update-helper:{project}"
    controller_config = {
        "schema": 1,
        "directory": state["controller"],
        "atomic_compose": {
            "schema": 1,
            "project": project,
            "project_root": str(root),
            "env_file": str(env),
            "owner_uid": selected_uid,
        },
    }
    bridge_config = {
        "schema": 1,
        "bridge_config": paths["bridge_runtime_config"],
        "request_inbox": state["requests"],
        "spool_dir": state["spool_state"],
    }
    bridge_runtime_config = {
        "schema": 1,
        "controller_config": paths["controller_config"],
        "inbox": state["packages"],
        "state_dir": state["bridge_state"],
        "report_dir": state["reports"],
        "request_uid": selected_uid,
        "request_gid": selected_gid,
    }
    fixed = {
        "binding_path": paths["binding"],
        "compose_override_path": paths["compose_override"],
        "service_path": paths["service"],
        "timer_path": paths["timer"],
        "wrapper_path": paths["wrapper"],
        "request_inbox": state["requests"],
        "package_inbox": state["packages"],
        "report_dir": state["reports"],
        "control_dir": state["control"],
        "host_bridge_wrapper": paths["wrapper"],
        "host_bridge_config": paths["bridge_config"],
        "bridge_uid": selected_uid,
        "bridge_gid": selected_gid,
        "service_manager": expected_manager,
    }
    command = [
        docker_path.as_posix(), "run", "--rm", "--network", "none",
        "--user", f"{fixed['bridge_uid']}:{fixed['bridge_gid']}",
        "--mount", f"type=bind,src={docker_socket},dst=/var/run/docker.sock",
        "--mount", f"type=bind,src={paths['bridge_config']},dst={paths['bridge_config']},readonly",
        "--mount", f"type=bind,src={paths['bridge_runtime_config']},dst={paths['bridge_runtime_config']},readonly",
        "--mount", f"type=bind,src={paths['controller_config']},dst={paths['controller_config']},readonly",
        "--mount", f"type=bind,src={str(root)},dst={str(root)}",
        "--mount", f"type=bind,src={str(env)},dst={str(env)},readonly",
    ]
    if socket_gid is not None:
        command.extend(("--group-add", str(socket_gid)))
    command.extend(("--mount", f"type=bind,src={state['root']},dst={state['root']}"))
    external_compose_files = [path for path in compose_paths if root not in path.parents]
    # The coordinator override is host-owned and is appended to the active
    # Compose project after bootstrap. The spool helper also needs it mounted
    # read-only: atomic_local_update reconstructs the active Compose model from
    # Docker's config_files label, which includes this external file.
    helper_compose_files = list(dict.fromkeys(
        [*external_compose_files, _safe_absolute(paths["compose_override"], "compose_override")]
    ))
    for compose_path in helper_compose_files:
        command.extend(("--mount", f"type=bind,src={compose_path},dst={compose_path},readonly"))
    command.extend((image, "-m", "app.services.update_host_bridge_cli", "--config",
                    paths["bridge_config"], "--once", "--spool"))
    wrapper = "#!/bin/sh\nset -eu\nexec " + " ".join(shlex.quote(item) for item in command) + "\n"
    topology = {"scope": str(root), "compose_file": str(active_working / "docker-compose.prod.yml"),
                "project": project, "services": dict(services)}
    return {
        "schema": 1,
        "kind": "host_update_coordinator_bootstrap_plan",
        "operational": False,
        "project": project,
        "installation_root": str(root),
        "env_file": str(env),
        "docker": str(docker_path),
        "docker_socket": str(socket_path),
        "helper_image": image,
        "helper_image_id": helper_image_id,
        "state": state,
        "paths": paths,
        "controller_config": controller_config,
        "bridge_runtime_config": bridge_runtime_config,
        "bridge_spool_config": bridge_config,
        "fixed_settings": fixed,
        "topology_binding_existing": topology,
        "legacy_state": {
            "update_ready": str(root / ".treseko-local" / "update-ready"),
            "pending_journal": str(root / ".treseko-local" / "update-transactions" / "pending.json"),
        },
        "compose_files": list(compose_files),
        "external_compose_files": [str(path) for path in external_compose_files],
        "helper_compose_files": [str(path) for path in helper_compose_files],
        "transaction_overlays_to_rebase": list(candidate.get("transaction_overlays_to_rebase", [])),
        "wrapper": wrapper,
        "config_sha256": hashlib.sha256(json.dumps({"controller": controller_config,
            "bridge": bridge_runtime_config, "spool": bridge_config}, sort_keys=True,
            separators=(",", ":")).encode()).hexdigest(),
    }

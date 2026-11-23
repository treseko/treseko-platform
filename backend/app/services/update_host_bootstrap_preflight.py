"""Read-only preflight for migrating a legacy Docker Compose install.

This deliberately does not install files or restart services. It proves the
active Compose identity and effective service set before a platform bootstrap
may prepare a cutover.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import shutil
import re
from typing import Any, Callable, Mapping, Sequence

from .update_participant_commands import load_private_json

_RUNNER = Callable[[Sequence[str]], Any]
_SCHEMA = 1
_REQUIRED = {"backend", "frontend", "engine", "db", "redis"}
_OPTIONAL = {"automation-worker", "plugin-runner"}
_ALLOWED = _REQUIRED | _OPTIONAL | {"migrator"}
_PROJECT = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
_HEX = re.compile(r"^[0-9a-f]{64}$")
_SERVICE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]*$")


def _requires_operator_elevation(service_manager: str | None = None) -> bool:
    if service_manager in {"systemd-user", "launchd-user"}:
        return False
    if os.name == "nt":
        try:
            import ctypes
            return not bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            return True
    if (sys.platform.startswith("linux")
            and (service_manager in {"systemd-user", "launchd-user"} or
                 (service_manager is None and _persistent_user_systemd_available()))):
        # A user manager with lingering can own the spool consumer. Docker
        # access and project-file ownership are checked independently by the
        # installer; do not require root merely to install a user unit.
        return False
    return os.geteuid() != 0


def _elevation_mechanism(service_manager: str | None) -> str:
    if service_manager in {"systemd-user", "launchd-user"}:
        return "none"
    if os.name == "nt":
        return "windows-admin"
    return "already-root" if os.geteuid() == 0 else "sudo"


def _persistent_user_systemd_available() -> bool:
    """Read-only hint for a persistent systemd user service installation."""
    if not sys.platform.startswith("linux") or not hasattr(os, "getuid"):
        return False
    try:
        manager = subprocess.run(["systemctl", "--user", "is-system-running"],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, check=False, timeout=5)
        # systemctl is-system-running exits with status 1 when the user
        # manager is degraded, even though the manager is alive and can own
        # persistent user units. Trust the reported state and let the separate
        # linger check decide whether it survives logout/reboot.
        if manager.stdout.strip() not in {"running", "degraded"}:
            return False
        linger = subprocess.run(["loginctl", "show-user", str(os.getuid()), "-p", "Linger"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, check=False, timeout=5)
        return linger.returncode == 0 and linger.stdout.strip() == "Linger=yes"
    except (OSError, subprocess.TimeoutExpired):
        return False


def _service_manager_candidate() -> str | None:
    if sys.platform.startswith("linux") and _persistent_user_systemd_available():
        return "systemd-user"
    if sys.platform == "darwin" and shutil.which("launchctl"):
        return "launchd-user"
    return None


class BootstrapPreflightError(ValueError):
    pass


def _run(argv: Sequence[str]) -> Any:
    return subprocess.run(list(argv), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, check=False, timeout=30)


def _invoke(run: _RUNNER, argv: Sequence[str]) -> tuple[Any | None, str | None]:
    try:
        result = run(argv)
    except (OSError, subprocess.TimeoutExpired, TimeoutError):
        return None, "command_failed"
    if getattr(result, "returncode", 1) != 0:
        return result, "command_failed"
    return result, None


def _safe_config(config: Mapping[str, Any]) -> tuple[Path, Path, Path]:
    if (not isinstance(config, Mapping) or set(config) != {"schema", "docker", "project_root", "env_file"}
            or type(config.get("schema")) is not int or config.get("schema") != _SCHEMA):
        raise BootstrapPreflightError("config_invalid")
    docker = config.get("docker")
    if (not isinstance(docker, str) or not Path(docker).is_absolute()
            or not _safe_path(Path(docker), regular=True) or not os.access(docker, os.X_OK)):
        raise BootstrapPreflightError("docker_unavailable")
    root, env_file = config.get("project_root"), config.get("env_file")
    if not isinstance(root, str) or not Path(root).is_absolute() or not isinstance(env_file, str) or not Path(env_file).is_absolute():
        raise BootstrapPreflightError("installation_paths_invalid")
    root_path, env_path = Path(root), Path(env_file)
    if not _safe_path(root_path, regular=False) or not _safe_path(env_path, regular=True):
        raise BootstrapPreflightError("installation_paths_unavailable")
    info = env_path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise BootstrapPreflightError("environment_file_permissions_unsafe")
    if not _under(env_path, root_path):
        raise BootstrapPreflightError("environment_file_outside_installation")
    return Path(docker), root_path.resolve(), env_path.resolve()


def _safe_path(path: Path, *, regular: bool) -> bool:
    if not path.is_absolute():
        return False
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            info = current.lstat()
        except OSError:
            return False
        if stat.S_ISLNK(info.st_mode):
            return False
    try:
        info = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode) if regular else stat.S_ISDIR(info.st_mode)


def _is_wsl_host() -> bool:
    if not sys.platform.startswith("linux"):
        return False
    try:
        return "microsoft" in Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8").lower()
    except OSError:
        return False


def _compose_host_path(value: str) -> str:
    """Normalize Docker Desktop Windows labels to paths visible in WSL."""
    if not _is_wsl_host():
        return value
    raw = value.removeprefix("\\\\?\\")
    match = re.fullmatch(r"([A-Za-z]):[\\/](.*)", raw)
    if not match:
        return value
    drive, tail = match.groups()
    parts = [part for part in re.split(r"[\\/]+", tail) if part]
    return str(Path("/mnt") / drive.lower() / Path(*parts))


def _under(path: Path, root: Path) -> bool:
    resolved = path.resolve()
    resolved_root = root.resolve()
    return resolved == resolved_root or resolved_root in resolved.parents


def _belongs_to_installation(working_dir: str, root: Path) -> bool:
    path = Path(working_dir)
    if not path.is_absolute():
        return False
    resolved = path.resolve()
    release_root = (root / ".treseko-local" / "releases").resolve()
    return resolved == root or release_root == resolved or release_root in resolved.parents


def _committed_overlay_matches_active_release(overlay: Path, root: Path) -> bool:
    suffix = "-atomic-candidate.compose.yml"
    if (not overlay.name.endswith(suffix) or not _under(overlay, root)
            or not _safe_path(overlay, regular=True)):
        return False
    transaction = overlay.name[:-len(suffix)]
    if not transaction or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", transaction):
        return False
    try:
        journal = load_private_json(overlay.parent / f"{transaction}.json")
        active_release = load_private_json(root / ".treseko-local" / "active-release.json")
    except (OSError, ValueError, TypeError):
        return False
    version = journal.get("version")
    return (journal.get("phase") == "committed" and isinstance(version, str)
            and bool(version) and active_release.get("version") == version)


def _rolled_back_overlay_is_rebaseable(overlay: Path, root: Path) -> bool:
    """Allow rebasing only an intact rollback override from a completed transaction."""
    suffix = "-rollback.compose.yml"
    if (not overlay.name.endswith(suffix) or not _under(overlay, root)
            or not _safe_path(overlay, regular=True)):
        return False
    transaction = overlay.name[:-len(suffix)]
    if not transaction or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", transaction):
        return False
    try:
        journal = load_private_json(overlay.parent / f"{transaction}.json")
        active_release_path = root / ".treseko-local" / "active-release.json"
        old_images = journal.get("old_images")
        active_services = journal.get("old_active_services")
        if (journal.get("phase") != "rolled_back" or journal.get("transaction") != transaction
                or not isinstance(old_images, dict) or not old_images
                or not isinstance(active_services, list) or not active_services
                or not all(isinstance(item, str) and _SERVICE.fullmatch(item) for item in active_services)
                or not set(active_services).issubset(old_images)):
            return False
        lines = ["services:"]
        for service, image in sorted(old_images.items()):
            if (not isinstance(service, str) or not _SERVICE.fullmatch(service)
                    or image != f"treseko-rollback:{transaction[:20]}-{service}"):
                return False
            lines += [f"  {service}:", f"    image: {image}", "    pull_policy: never"]
            if service == "migrator":
                lines += ["    entrypoint: [\"/bin/true\"]", "    command: []"]
        if overlay.read_text(encoding="utf-8") != "\n".join(lines) + "\n":
            return False
    except (OSError, ValueError, TypeError, UnicodeError):
        return False
    if active_release_path.exists():
        try:
            active_release = load_private_json(active_release_path)
        except (OSError, ValueError, TypeError):
            return False
        if not isinstance(active_release.get("version"), str) or not active_release["version"]:
            return False
    return True


def inspect_legacy_installation(config: Mapping[str, Any], runner: _RUNNER | None = None) -> dict[str, Any]:
    report: dict[str, Any] = {
        "schema": _SCHEMA,
        "kind": "HOST_UPDATE_BOOTSTRAP_PREFLIGHT",
        "status": "blocked",
        "operational": False,
        "project": None,
        "bootstrap_candidate": None,
        "compose_files": [],
        "profiles": ["*"],
        "services": {"declared": [], "running": [], "missing": [], "unexpected": []},
        "transaction_overlays": [],
        "rebaseable_transaction_overlays": [],
        "requirements": [],
        "blockers": [],
    }
    try:
        docker, root, env_file = _safe_config(config)
    except BootstrapPreflightError as exc:
        report["blockers"].append(str(exc))
        return report
    run = runner or _run

    result, error = _invoke(run, [str(docker), "ps", "-a", "--no-trunc", "--format", "{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Label \"com.docker.compose.service\"}}\t{{.Label \"com.docker.compose.project.working_dir\"}}\t{{.Label \"com.docker.compose.project.config_files\"}}"])
    if error or result is None:
        report["blockers"].append("docker_inventory_unavailable")
        return report

    records = []
    lines = str(getattr(result, "stdout", "")).splitlines()
    for line in lines:
        fields = line.split("\t", 6)
        if len(fields) != 7:
            report["blockers"].append("docker_inventory_invalid")
            return report
        cid, name, state, project, service, working_dir, config_files = fields
        if not _HEX.fullmatch(cid):
            report["blockers"].append("container_identity_invalid")
            return report
        if project:
            records.append({"id": cid, "name": name, "state": state, "project": project,
                            "service": service, "working_dir": _compose_host_path(working_dir),
                            "config_files": [_compose_host_path(item) for item in config_files.split(",")]
                            if config_files else []})
    if not records:
        report["blockers"].append("compose_project_not_found")
        return report

    # A host may run many independent Compose projects. Select by the
    # operator-supplied installation root first; project names are not
    # derivable from directory names and cannot be globally unique evidence.
    records = [item for item in records if _belongs_to_installation(item["working_dir"], root)]
    if not records:
        report["blockers"].append("compose_project_not_found_for_installation")
        return report

    projects = {item["project"] for item in records}
    if len(projects) != 1 or not all(_PROJECT.fullmatch(item) for item in projects):
        report["blockers"].append("compose_project_ambiguous")
        return report
    project = next(iter(projects))
    report["project"] = project
    working_dirs = {item["working_dir"] for item in records}
    config_sets = {tuple(item["config_files"]) for item in records}
    if len(working_dirs) != 1 or len(config_sets) != 1:
        report["blockers"].append("compose_identity_disagrees_between_containers")
        return report
    working_dir = Path(next(iter(working_dirs)))
    compose_files = list(next(iter(config_sets)))
    if (not _belongs_to_installation(str(working_dir), root)
            or not compose_files or any(not Path(item).is_absolute() for item in compose_files)):
        report["blockers"].append("compose_root_does_not_match_installation")
        return report
    if any(not _safe_path(Path(item), regular=True) for item in compose_files):
        report["blockers"].append("compose_file_unavailable_or_unsafe")
        return report
    report["compose_files"] = compose_files
    report["transaction_overlays"] = [item for item in compose_files if ".treseko-local/update-transactions/" in item]
    for raw_overlay in report["transaction_overlays"]:
        overlay = Path(raw_overlay)
        if (_committed_overlay_matches_active_release(overlay, root)
                or _rolled_back_overlay_is_rebaseable(overlay, root)):
            report["rebaseable_transaction_overlays"].append(raw_overlay)
        else:
            report["blockers"].append("active_transaction_overlay_requires_reconciliation")

    active_by_service: dict[str, list[dict[str, Any]]] = {}
    for item in records:
        if item["state"].lower() == "running":
            active_by_service.setdefault(item["service"], []).append(item)
    duplicates = sorted(name for name, matches in active_by_service.items() if len(matches) != 1)
    if duplicates:
        report["blockers"].append("duplicate_active_compose_services")

    argv = [str(docker), "compose", "--project-directory", str(root), "--project-name", project,
            "--env-file", str(env_file), "--profile", "*", *sum((['-f', item] for item in compose_files), []),
            "config", "--services"]
    compose_result, compose_error = _invoke(run, argv)
    if compose_error or compose_result is None:
        report["blockers"].append("effective_compose_model_unavailable")
        return report
    declared = sorted({line.strip() for line in str(compose_result.stdout).splitlines() if line.strip()})
    running = sorted(active_by_service)
    report["services"].update(declared=declared, running=running,
                              missing=sorted(_REQUIRED - set(declared)),
                              unexpected=sorted(set(declared) - _ALLOWED))
    if report["services"]["missing"]:
        report["blockers"].append("required_compose_services_missing")
    if report["services"]["unexpected"]:
        report["blockers"].append("unsupported_compose_services_present")
    # The Compose model is inspected with every profile enabled so we can
    # validate optional services, but only profiles represented by running
    # containers are active. The atomic updater preserves those active
    # profiles and must not require disabled optional services during bootstrap.
    missing_running = sorted(_REQUIRED - set(running))
    if missing_running:
        report["services"]["missing_running"] = missing_running
        report["blockers"].append("required_compose_services_not_running")
    if report["rebaseable_transaction_overlays"]:
        report["requirements"].append("committed_transaction_overlays_must_be_rebased_during_bootstrap")

    if not report["blockers"]:
        report["status"] = "preflight_passed"
        service_manager = _service_manager_candidate()
        role_map = {"backend": "backend", "frontend": "frontend", "engine": "engine",
                    "automation-worker": "automation_worker", "db": "db",
                    "plugin-runner": "plugin_runner"}
        services = {role: service for service, role in role_map.items()
                    if service in declared and service in running}
        report["bootstrap_candidate"] = {
            "schema": 1,
            "operational": False,
            "deployment": "single-host-compose",
            "host_os": sys.platform,
            "installation_root": str(root),
            "compose_working_dir": str(working_dir),
            "compose_project": project,
            "compose_files": compose_files,
            "active_services": running,
            "declared_services": declared,
            "service_roles": services,
            "transaction_overlays_to_rebase": report["rebaseable_transaction_overlays"],
            "service_manager_candidate": service_manager,
            "requires_operator_elevation": _requires_operator_elevation(service_manager),
            "elevation_mechanism": _elevation_mechanism(service_manager),
        }
    return report


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only legacy Compose update bootstrap preflight")
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        config = load_private_json(args.config)
        result = inspect_legacy_installation(config)
    except Exception:
        result = {"schema": _SCHEMA, "kind": "HOST_UPDATE_BOOTSTRAP_PREFLIGHT",
                  "status": "blocked", "operational": False, "blockers": ["preflight_failed"]}
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("status") == "preflight_passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())

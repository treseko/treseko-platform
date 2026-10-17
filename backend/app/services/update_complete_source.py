"""Validation and staging helpers for signed complete-source releases."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from typing import Any, Mapping

from .update_journal import save_json
from .update_participant_package import stage_verified_package
from .update_existing_installation_errors import ExistingInstallationError

COMPLETE_SOURCE_DEPLOYMENT = {
    "mode": "complete-source", "path": "source-release",
    "compose_file": "docker-compose.prod.yml", "activation": "atomic-compose",
}
_COMPOSE_PROJECT = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")


def _complete_source_settings(config: Mapping[str, Any]) -> dict[str, Any]:
    settings = config.get("atomic_compose")
    if (not isinstance(settings, Mapping)
            or set(settings) != {"schema", "project", "project_root", "env_file"}
            or type(settings.get("schema")) is not int or settings["schema"] != 1
            or not isinstance(settings.get("project"), str)
            or not _COMPOSE_PROJECT.fullmatch(settings["project"])):
        raise ExistingInstallationError("Complete-source host Compose configuration is required")
    project_root = Path(settings.get("project_root") or "")
    env_file = Path(settings.get("env_file") or "")
    if (not project_root.is_absolute() or ".." in project_root.parts
            or not env_file.is_absolute() or ".." in env_file.parts):
        raise ExistingInstallationError("Invalid host Compose source path")
    current = Path(project_root.anchor)
    for part in project_root.parts[1:]:
        current /= part
        try:
            info = current.lstat()
        except OSError as exc:
            raise ExistingInstallationError("Host Compose source directory is unavailable") from exc
        if stat.S_ISLNK(info.st_mode):
            raise ExistingInstallationError("Host Compose source directory cannot be a symlink")
    info = project_root.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, os.geteuid()}
            or info.st_mode & 0o022):
        raise ExistingInstallationError("Host Compose source directory is unsafe")
    if env_file != project_root and project_root not in env_file.parents:
        raise ExistingInstallationError("Host Compose environment file must be inside its bound source root")
    current = Path(env_file.anchor)
    for part in env_file.parts[1:]:
        current /= part
        try:
            info = current.lstat()
        except OSError as exc:
            raise ExistingInstallationError("Host Compose environment file is unavailable") from exc
        if stat.S_ISLNK(info.st_mode):
            raise ExistingInstallationError("Host Compose environment file cannot be a symlink")
    info = env_file.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
            or info.st_mode & 0o022 or info.st_size > 1024 * 1024
            or not os.access(env_file, os.R_OK)):
        raise ExistingInstallationError("Host Compose environment file is unsafe")
    return {"schema": 1, "project": settings["project"],
            "project_root": str(project_root), "env_file": str(env_file),
            "docker": "/usr/bin/docker"}


def _require_local_compose_installation(config: Mapping[str, Any]) -> None:
    participants = config.get("participants", [])
    runtime_hosts = config.get("runtime_hosts", [])
    if (not isinstance(participants, list) or not isinstance(runtime_hosts, list)
            or any(not isinstance(host, Mapping) or host.get("kind") != "local"
                   for host in participants)
            or any(not isinstance(host, Mapping) or host.get("kind") != "local"
                   for host in runtime_hosts)):
        raise ExistingInstallationError(
            "Atomic Compose releases require every application service on the configured local host"
        )



def _source_tree_digest(root: Path) -> str:
    if root.is_symlink() or not root.is_dir():
        raise ExistingInstallationError("Verified complete-source tree is unavailable")
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ExistingInstallationError("Verified complete-source tree contains an unsafe file")
        mode = stat.S_IMODE(path.stat().st_mode)
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(f"{mode:o}".encode("ascii"))
        digest.update(b"\0")
        if path.is_file():
            file_digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    file_digest.update(chunk)
            digest.update(file_digest.digest())
        digest.update(b"\0")
    return digest.hexdigest()


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run_atomic_source(candidate: Path, settings: Mapping[str, Any], transaction: str,
                       version: str, *, mode: str) -> dict[str, Any]:
    script = candidate / "scripts" / "atomic_local_update.py"
    if script.is_symlink() or not script.is_file():
        raise ExistingInstallationError("Signed atomic Compose updater is missing")
    install_root = candidate.parent.parent / "atomic-compose-state"
    command = [sys.executable, str(script), "--docker", settings["docker"],
               "--project", settings["project"], "--candidate-root", str(candidate),
               "--install-root", str(install_root), "--env-file", settings["env_file"],
               "--version", version, "--transaction", transaction,
               "--expected-project-root", settings["project_root"]]
    if mode == "validate":
        command.append("--validate-only")
    elif mode == "resume":
        command.append("--reconcile-only")
    elif mode != "apply":
        raise ExistingInstallationError("Invalid complete-source transaction action")
    try:
        result = subprocess.run(command, capture_output=True, timeout=3 * 60 * 60,
                                check=False, env={**os.environ, "DOCKER_HOST":
                                                  os.environ.get("DOCKER_HOST", "unix:///var/run/docker.sock")})
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ExistingInstallationError("Atomic Compose operation outcome is uncertain") from exc
    if len(result.stdout) > 65536 or len(result.stderr) > 65536:
        raise ExistingInstallationError("Atomic Compose helper returned an oversized result")
    payload = None
    try:
        payload = json.loads(result.stdout) if result.stdout.strip() else None
    except (ValueError, UnicodeError):
        payload = None
    if isinstance(payload, dict) and payload.get("transaction") == transaction:
        phase = payload.get("phase")
        if mode == "validate" and result.returncode == 0 and phase == "prepared":
            return payload
        if mode == "apply" and result.returncode == 0 and phase == "committed":
            return payload
        if mode == "resume" and result.returncode == 0 and phase in {"committed", "rolled_back", "not_started"}:
            return payload
    journal = install_root / ".treseko-local" / "update-transactions" / f"{transaction}.json"
    try:
        state = json.loads(journal.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError):
        state = None
    phase = state.get("phase") if isinstance(state, dict) else None
    if phase == "rolled_back":
        return {"transaction": transaction, "phase": "rolled_back", "version": version}
    if phase == "committed":
        return {"transaction": transaction, "phase": "committed", "version": version}
    if phase == "recovery_required":
        return {"transaction": transaction, "phase": "recovery_required", "version": version}
    raise ExistingInstallationError("Atomic Compose operation is nonterminal; reconcile this transaction")


def _load_or_stage_complete_source(config: Mapping[str, Any], manifest: Mapping[str, Any],
                                   transaction: str, package: Path) -> tuple[Path, str]:
    from .update_existing_installation import _complete_source_state_root

    stages, _ = _complete_source_state_root(config, transaction)
    stages.mkdir(parents=True, exist_ok=True, mode=0o700)
    if stages.is_symlink() or not stages.is_dir():
        raise ExistingInstallationError("Complete-source staging directory is unsafe")
    checksum = str(manifest.get("checksum_sha256") or "")
    destination = stages / f"{transaction}-{checksum}"
    marker = destination / "verified-source.json"
    if destination.exists():
        if destination.is_symlink() or marker.is_symlink() or not marker.is_file():
            raise ExistingInstallationError("Existing complete-source stage needs operator review")
        try:
            marker_info = marker.lstat()
            saved = json.loads(marker.read_text(encoding="utf-8"))
            package_digest = _file_digest(package)
            package_size = package.stat().st_size
            candidate = destination / "payload" / "source-release"
            tree_digest = _source_tree_digest(candidate)
        except (OSError, ValueError, UnicodeError, ExistingInstallationError) as exc:
            raise ExistingInstallationError("Existing complete-source stage is invalid") from exc
        if (marker_info.st_uid not in {0, os.geteuid()} or marker_info.st_mode & 0o077
                or saved != {"schema": 1, "transaction": transaction,
                             "checksum_sha256": checksum, "package_size_bytes": package_size,
                             "source_tree_sha256": tree_digest}
                or package_digest != checksum or package_size != manifest.get("package_size_bytes")):
            raise ExistingInstallationError("Existing complete-source stage does not match the signed package")
        return candidate, tree_digest
    staged = stage_verified_package(package, dict(manifest), destination)
    candidate = staged / "payload" / "source-release"
    tree_digest = _source_tree_digest(candidate)
    save_json(marker, {"schema": 1, "transaction": transaction,
                       "checksum_sha256": checksum,
                       "package_size_bytes": package.stat().st_size,
                       "source_tree_sha256": tree_digest})
    marker.chmod(0o600)
    return candidate, tree_digest

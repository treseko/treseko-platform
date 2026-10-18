"""Trusted-image validation for the Docker-only existing-installation CLI."""

from __future__ import annotations

import os
import json
from pathlib import Path
import stat
from typing import Any

from .update_helper_installation_launcher import IMAGE, _has_symlink_component, _path
from .update_participant_commands import load_private_json


def _fail(message: str) -> None:
    raise SystemExit(message)


def _validate_mount(entry: Any, strict: bool) -> tuple[str, str, str, str]:
    if not isinstance(entry, dict) or set(entry) != {"source", "target", "mode", "purpose"}:
        _fail("invalid mount fields")
    source = _path(entry["source"], "mount source")
    target = _path(entry["target"], "mount target")
    mode = entry["mode"]
    purpose = entry["purpose"]
    if source != target or mode not in {"ro", "rw"} or not isinstance(purpose, str) or not purpose:
        _fail("invalid mount binding")
    if strict:
        try:
            info = source.lstat()
        except OSError:
            _fail("mount source unavailable")
        if _has_symlink_component(source) or stat.S_ISLNK(info.st_mode):
            _fail("mount source is a symlink")
        if info.st_uid != os.geteuid() and info.st_uid != 0:
            _fail("mount source owner is invalid")
        if mode == "ro" and stat.S_IMODE(info.st_mode) & 0o022:
            _fail("readonly mount is writable by group/other")
    return str(source), str(target), mode, purpose


def validate(args: list[str]) -> list[tuple[str, str, str, str]]:
    launcher, image, docker, socket, network, action, config, manifest, package, strict = args
    payload = load_private_json(Path(launcher))
    required = {"schema", "type", "docker", "image", "socket", "network", "mounts"}
    if set(payload) != required or payload["schema"] != 1 or payload["type"] != "docker":
        _fail("invalid launcher config")
    if payload["docker"] != docker or payload["image"] != image or payload["socket"] != socket:
        _fail("launcher binding mismatch")
    if payload["network"] != network or not IMAGE.fullmatch(image):
        _fail("invalid launcher identity")
    if network in {"host", "none"}:
        _fail("dedicated Docker network required")
    mounts = [_validate_mount(entry, strict == "1") for entry in payload["mounts"]]
    purposes = [item[3] for item in mounts]
    if len(set(purposes)) != len(purposes) or "launcher" not in purposes:
        _fail("launcher mount is required")
    required_mounts = [(config, "controller", "ro")]
    required_mounts.append((socket, "socket", "rw"))
    if action != "status":
        required_mounts.append((manifest, "manifest", "ro"))
    if action == "prepare":
        required_mounts.append((package, "package", "ro"))
    for source, purpose, mode in required_mounts:
        if not source or (source, source, mode, purpose) not in mounts:
            _fail(f"missing {purpose} mount")
    if not {"state", "cache"}.issubset(purposes):
        _fail("state and cache mounts are required")
    controller_config = load_private_json(Path(config))
    manifest_value = {}
    if action != "status":
        try:
            raw_manifest = Path(manifest).read_bytes()
            if len(raw_manifest) > 1024 * 1024:
                _fail("manifest exceeds limit")
            manifest_value = json.loads(raw_manifest)
        except (OSError, ValueError, UnicodeError):
            _fail("invalid manifest")
    deployment = manifest_value.get("deployment") if isinstance(manifest_value, dict) else None
    if deployment is not None:
        expected = {"mode": "complete-source", "path": "source-release",
                    "compose_file": "docker-compose.prod.yml", "activation": "atomic-compose"}
        atomic = controller_config.get("atomic_compose")
        if (deployment != expected or not isinstance(atomic, dict) or set(atomic) != {
                "schema", "project", "project_root", "env_file"}
                or type(atomic.get("schema")) is not int or atomic.get("schema") != 1):
            _fail("complete-source host configuration is required")
        project_root = _path(atomic["project_root"], "atomic Compose project root")
        env_file = _path(atomic["env_file"], "atomic Compose environment file")
        project_mount = (str(project_root), str(project_root), "ro", "atomic-project")
        if project_mount not in mounts:
            _fail("atomic Compose project root must be mounted readonly")
        env_mounted = any(source == str(env_file) and mode == "ro"
                          for source, _, mode, _ in mounts)
        env_in_project = env_file == project_root or project_root in env_file.parents
        if not env_mounted and not env_in_project:
            _fail("atomic Compose environment file must be mounted readonly")
        state_root = Path(controller_config["directory"])
        if not any((Path(source) == state_root or Path(source) in state_root.parents) and mode == "rw"
                   for source, _, mode, _ in mounts):
            _fail("controller state directory must be mounted writable")
        if not Path("/usr/bin/docker").is_file() or not os.access("/usr/bin/docker", os.X_OK):
            _fail("trusted helper image has no Docker CLI")
    paths = [(Path(source), mode) for source, _, mode, _ in mounts]
    for index, (current, mode) in enumerate(paths):
        for other, other_mode in paths[index + 1:]:
            if current == other or (current in other.parents or other in current.parents) and "rw" in {mode, other_mode}:
                _fail("overlapping writable mounts")
    return mounts


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher-config", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--docker", required=True)
    parser.add_argument("--socket", required=True)
    parser.add_argument("--network", required=True)
    parser.add_argument("--action", required=True, choices=("plan", "prepare", "apply", "resume", "status"))
    parser.add_argument("--config", required=True)
    parser.add_argument("--manifest", default="")
    parser.add_argument("--package", default="")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    mounts = validate([args.launcher_config, args.image, args.docker, args.socket,
                       args.network, args.action, args.config, args.manifest,
                       args.package, "1" if args.strict else "0"])
    for source, target, mode, purpose in mounts:
        print(f"{source}\t{target}\t{mode}\t{purpose}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

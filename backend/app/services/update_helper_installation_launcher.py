"""Validation and fixed Docker launchers for installed update helpers."""

from __future__ import annotations

import os
from pathlib import Path
import re
import shlex
import stat
from typing import Any, Mapping


HELPERS = {
    "participant": "treseko-update-participant",
    "ingress": "treseko-update-ingress",
    "runtime_preparation": "treseko-update-runtime-preparation",
}
OPTIONAL_HELPERS = {"host_bridge": "treseko-update-host-bridge"}
MODULES = {
    "participant": "app.services.update_participant_cli",
    "ingress": "app.services.update_ingress_cli",
    "runtime_preparation": "app.services.update_runtime_preparation_cli",
}
OPTIONAL_MODULES = {"host_bridge": "app.services.update_host_bridge_cli"}
IMAGE = re.compile(r"(?:[A-Za-z0-9][A-Za-z0-9._/-]*@)?sha256:[0-9a-f]{64}\Z")
NETWORK = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
MOUNT_MODES = {"ro", "rw"}
BROAD = {"/", "/root", "/home", "/Users", "/workspace", "/workspaces"}


def _path(value: Any, label: str) -> Path:
    if (not isinstance(value, str) or not value.startswith("/")
            or any(char in value for char in ("\x00", ",", "\n", "\r"))):
        raise ValueError(f"{label} must be an absolute path")
    result = Path(value)
    if ".." in result.parts or result in {Path(item) for item in BROAD}:
        raise ValueError(f"{label} is too broad")
    return result


def _regular_executable(path: Path, label: str) -> None:
    try:
        info = path.lstat()
    except OSError as exc:
        raise ValueError(f"{label} is unavailable") from exc
    if not stat.S_ISREG(info.st_mode) or not os.access(path, os.X_OK):
        raise ValueError(f"{label} must be an executable file")


def _has_symlink_component(path: Path) -> bool:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            if stat.S_ISLNK(current.lstat().st_mode):
                return True
        except FileNotFoundError:
            continue
    return False


def _socket(path: Path) -> dict[str, int]:
    try:
        info = path.lstat()
    except OSError as exc:
        raise ValueError("Docker socket is unavailable") from exc
    if not stat.S_ISSOCK(info.st_mode):
        raise ValueError("Docker socket must be a Unix socket")
    if info.st_uid not in {0, os.geteuid()}:
        raise ValueError("Docker socket has an unexpected owner")
    return {"uid": info.st_uid, "gid": info.st_gid, "mode": stat.S_IMODE(info.st_mode)}


def _maps(helper_names=None):
    names = set(HELPERS) if helper_names is None else set(helper_names)
    if names == set(HELPERS):
        return HELPERS, MODULES
    if names == set(HELPERS) | set(OPTIONAL_HELPERS):
        return HELPERS | OPTIONAL_HELPERS, MODULES | OPTIONAL_MODULES
    raise ValueError("Helper configuration must contain exactly three legacy helpers or four coordinated helpers")


def _mounts(value: Any, root: Path, helper_names=None) -> dict[str, list[dict[str, Any]]]:
    helpers, _ = _maps(helper_names)
    if not isinstance(value, dict) or set(value) != set(helpers):
        raise ValueError("Docker launcher mounts must cover every helper")
    result: dict[str, list[dict[str, Any]]] = {}
    for helper in helpers:
        entries = value[helper]
        if not isinstance(entries, list):
            raise ValueError("Docker launcher mounts must be lists")
        normalized = []
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {"source", "target", "mode"}:
                raise ValueError("Docker launcher mount fields are invalid")
            source = _path(entry["source"], "mount source")
            target = _path(entry["target"], "mount target")
            mode = entry["mode"]
            if mode not in MOUNT_MODES or source != target:
                raise ValueError("Docker helper mounts must preserve the host path and use ro/rw")
            if root != Path("/") and root not in source.parents:
                raise ValueError("Docker launcher mount source must be under root-prefix")
            if _has_symlink_component(source):
                raise ValueError("Docker launcher mount source cannot be a symlink")
            normalized.append({"source": str(source), "target": str(target), "mode": mode})
        paths = [Path(item["source"]) for item in normalized]
        for index, current in enumerate(paths):
            for other in paths[index + 1:]:
                if current == other or current in other.parents or other in current.parents:
                    raise ValueError("Docker launcher mounts overlap")
        result[helper] = normalized
    return result


def validate(config: Mapping[str, Any], root: Path, helper_names=None) -> dict[str, Any] | None:
    if config is None:
        return None
    required = {"type", "docker", "image", "socket", "network", "mounts"}
    if not isinstance(config, Mapping) or set(config) != required or config["type"] != "docker":
        raise ValueError("Invalid Docker helper launcher configuration")
    docker = _path(config["docker"], "Docker executable")
    _regular_executable(docker, "Docker executable")
    socket = _path(config["socket"], "Docker socket")
    socket_identity = _socket(socket)
    if not isinstance(config["image"], str) or not IMAGE.fullmatch(config["image"]):
        raise ValueError("Docker helper image must be immutable by digest")
    if not isinstance(config["network"], str) or not NETWORK.fullmatch(config["network"]):
        raise ValueError("Docker helper network must be explicit")
    return {
        "type": "docker",
        "docker": str(docker),
        "image": config["image"],
        "socket": str(socket),
        "socket_identity": socket_identity,
        "network": config["network"],
        "mounts": _mounts(config["mounts"], root, helper_names),
    }


def binding(config: Mapping[str, Any], configs: Mapping[str, Path], config_hashes: Mapping[str, str],
            backend: Path, backend_sha256: str | None, helper_names=None) -> dict[str, Any] | None:
    if config is None:
        return None
    helpers = {}
    helpers, _ = _maps(helper_names)
    for helper in helpers:
        mounts = [
            {"source": str(configs[helper]), "target": str(configs[helper]), "mode": "ro"},
            {"source": str(backend), "target": str(backend), "mode": "ro"},
            *config["mounts"][helper],
        ]
        socket_mount = {"source": config["socket"], "target": config["socket"], "mode": "rw"}
        mounts.append(socket_mount)
        _assert_no_overlap(mounts)
        helpers[helper] = {
            "config": {"path": str(configs[helper]), "sha256": config_hashes[helper]},
            "backend": {"path": str(backend), "sha256": backend_sha256},
            "mounts": mounts,
        }
    return {key: config[key] for key in ("type", "docker", "image", "socket", "network")} | {
        "socket_identity": config["socket_identity"], "helpers": helpers,
    }


def _assert_no_overlap(mounts: list[dict[str, Any]]) -> None:
    paths = [(Path(item["source"]), item["mode"]) for item in mounts]
    for index, (current, mode) in enumerate(paths):
        for other, other_mode in paths[index + 1:]:
            if current == other:
                raise ValueError("Docker launcher mount is duplicated")
            if current in other.parents or other in current.parents:
                if "rw" in {mode, other_mode}:
                    raise ValueError("Docker launcher writable mount overlaps another mount")


def wrapper(config: Mapping[str, Any], helper: str, backend: Path, config_path: Path) -> bytes:
    helpers, modules = _maps(config.get("helpers"))
    if helper not in helpers or helper not in config["helpers"]:
        raise ValueError("Unknown Docker helper")
    spec = config["helpers"][helper]
    args = [config["docker"], "run", "--rm", "-i", "--network", config["network"]]
    args.extend([
        "--entrypoint", "/usr/local/bin/python",
        "--env", "PYTHONDONTWRITEBYTECODE=1", "--env", f"PYTHONPATH={backend}",
        "--env", f"DOCKER_HOST=unix://{config['socket']}",
    ])
    for mount in spec["mounts"]:
        option = f"type=bind,src={mount['source']},dst={mount['target']}"
        if mount["mode"] == "ro":
            option += ",readonly"
        args.extend(["--mount", option])
    args.extend([config["image"], "-m", modules[helper], "--config", str(config_path)])
    if helper == "host_bridge":
        args.extend(["--once", "--spool"])
    rendered = [shlex.quote(str(item)) for item in args]
    command = " ".join(rendered)
    docker_host = shlex.quote(f"unix://{config['socket']}")
    return ("#!/bin/sh\nset -eu\nif [ \"$#\" -ne 0 ]; then exit 2; fi\n"
            "export DOCKER_HOST=" + docker_host + "\nexec " + command + "\n").encode()

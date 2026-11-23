"""Command-line entry point for host coordinator bootstrap operations."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import shutil
import stat
import uuid
from typing import Any

from .update_host_coordinator_bootstrap import (
    HostCoordinatorBootstrapError, plan_linux_user_bootstrap,
)
from .update_host_coordinator_installer import install_linux_user_bootstrap


def _socket_from_docker_context(docker: str, configured: str | None = None) -> Path:
    endpoint = configured or os.environ.get("DOCKER_HOST", "")
    if not endpoint:
        try:
            result = subprocess.run([docker, "context", "inspect", "--format",
                                     "{{.Endpoints.docker.Host}}"],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, check=False, timeout=15)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise HostCoordinatorBootstrapError("docker_context_unavailable") from exc
        if result.returncode == 0:
            endpoint = result.stdout.strip()
    if not endpoint:
        endpoint = "unix:///var/run/docker.sock"
    if not endpoint.startswith("unix://"):
        raise HostCoordinatorBootstrapError("docker_endpoint_not_local_unix_socket")
    path = Path(endpoint.removeprefix("unix://"))
    if not path.is_absolute():
        raise HostCoordinatorBootstrapError("docker_socket_invalid")
    if path.is_symlink():
        if sys.platform != "darwin":
            raise HostCoordinatorBootstrapError("docker_socket_invalid")
        expected_socket = Path.home() / ".docker" / "run" / "docker.sock"
        try:
            resolved = path.resolve(strict=True)
            expected_resolved = expected_socket.resolve(strict=False)
        except OSError as exc:
            raise HostCoordinatorBootstrapError("docker_socket_invalid") from exc
        if resolved != expected_resolved or resolved.is_symlink():
            raise HostCoordinatorBootstrapError("docker_socket_invalid")
        path = resolved
    try:
        info = path.stat()
    except OSError as exc:
        raise HostCoordinatorBootstrapError("docker_socket_unavailable") from exc
    if not stat.S_ISSOCK(info.st_mode) or not os.access(path, os.R_OK | os.W_OK):
        raise HostCoordinatorBootstrapError("docker_socket_unavailable")
    return path


def _preflight_installation(docker: str, project_root: str, env_file: str) -> dict[str, Any]:
    if not (sys.platform.startswith("linux") or sys.platform == "darwin"):
        raise HostCoordinatorBootstrapError("host_os_adapter_not_implemented")
    from .update_host_bootstrap_preflight import inspect_legacy_installation

    report = inspect_legacy_installation({"schema": 1, "docker": docker,
                                          "project_root": project_root, "env_file": env_file})
    if report.get("operational") is not False or report.get("status") != "preflight_passed":
        raise HostCoordinatorBootstrapError("host_installation_preflight_failed")
    return report


def _build_helper(source_root: Path, docker: str, project: str) -> str:
    version_file = source_root / "VERSION"
    script = source_root / "scripts" / "build_trusted_update_helper_image.sh"
    if not version_file.is_file() or not script.is_file() or script.is_symlink():
        raise HostCoordinatorBootstrapError("trusted_helper_build_source_missing")
    version = version_file.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", version):
        raise HostCoordinatorBootstrapError("trusted_helper_version_invalid")
    allowlist = source_root / "scripts" / "update-runtime" / "bootstrap" / "helper-modules.txt"
    dockerfile = source_root / "scripts" / "update-runtime" / "bootstrap" / "Dockerfile"
    try:
        module_paths = [source_root / line.strip() for line in allowlist.read_text(encoding="utf-8").splitlines()
                        if line.strip() and not line.lstrip().startswith("#")]
        digest = hashlib.sha256()
        for path in [version_file, script, allowlist, dockerfile, *module_paths]:
            if path.is_symlink() or not path.is_file():
                raise HostCoordinatorBootstrapError("trusted_helper_source_unsafe")
            relative = path.relative_to(source_root).as_posix()
            digest.update(relative.encode("utf-8") + b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    except (OSError, ValueError, UnicodeError) as exc:
        raise HostCoordinatorBootstrapError("trusted_helper_source_unavailable") from exc
    tag = f"treseko-update-helper-{project}:{version}-{digest.hexdigest()[:12]}"
    try:
        cached = subprocess.run([docker, "image", "inspect", "--format", "{{.Id}}", tag],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                check=False, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        cached = None
    if cached is not None and cached.returncode == 0:
        cached_id = cached.stdout.strip()
        if re.fullmatch(r"sha256:[0-9a-f]{64}", cached_id):
            return cached_id
    environment = os.environ.copy()
    environment["DOCKER_BIN"] = docker
    try:
        built = subprocess.run(["bash", str(script), tag], cwd=source_root, env=environment,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                              check=False, timeout=3600)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HostCoordinatorBootstrapError("trusted_helper_build_failed") from exc
    if built.returncode != 0:
        raise HostCoordinatorBootstrapError("trusted_helper_build_failed")
    try:
        inspected = subprocess.run([docker, "image", "inspect", "--format", "{{.Id}}", tag],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   check=False, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HostCoordinatorBootstrapError("trusted_helper_identity_unavailable") from exc
    image_id = inspected.stdout.strip()
    if inspected.returncode != 0 or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise HostCoordinatorBootstrapError("trusted_helper_identity_unavailable")
    return image_id


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Install the Treseko host update coordinator")
    parser.add_argument("command", choices=("preflight", "prepare", "plan", "install"))
    parser.add_argument("--install-root", required=True, type=Path)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--docker", default=shutil.which("docker") or "/usr/bin/docker")
    parser.add_argument("--docker-socket")
    parser.add_argument("--source-release-root", type=Path)
    args = parser.parse_args(argv)
    try:
        root = args.install_root.resolve(strict=True)
        env_file = (args.env_file or root / "compose.production.env").resolve(strict=True)
        docker = str(Path(args.docker).resolve(strict=True))
        report = _preflight_installation(docker, str(root), str(env_file))
        candidate = report["bootstrap_candidate"]
        if args.command == "preflight":
            print(json.dumps({"ok": True, "kind": "host_update_bootstrap_preflight",
                              "operational": False, "candidate": candidate}, sort_keys=True))
            return 0
        docker_socket = _socket_from_docker_context(docker, args.docker_socket)
        socket_gid = docker_socket.stat().st_gid
        plan = plan_linux_user_bootstrap(
            candidate, project_root=str(root), env_file=str(env_file), docker=docker,
            docker_socket=str(docker_socket), home=str(Path.home()), uid=os.getuid(),
            gid=os.getgid(), docker_socket_gid=socket_gid,
        )
        if args.command == "plan":
            print(json.dumps(plan, sort_keys=True))
            return 0
        if args.source_release_root is None:
            raise HostCoordinatorBootstrapError("source_release_root_required")
        source_root = args.source_release_root.resolve(strict=True)
        source_version_file = source_root / "VERSION"
        if not source_version_file.is_file():
            raise HostCoordinatorBootstrapError("source_release_version_missing")
        source_version = source_version_file.read_text(encoding="utf-8").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}", source_version):
            raise HostCoordinatorBootstrapError("source_release_version_invalid")
        if args.command != "prepare":
            active_compose = Path(plan["topology_binding_existing"]["compose_file"])
            active_version = active_compose.parent / "VERSION"
            if (not active_version.is_file()
                    or active_version.read_text(encoding="utf-8").strip() != source_version):
                raise HostCoordinatorBootstrapError("active_release_version_mismatch")
        helper_image_id = _build_helper(source_root, docker, plan["project"])
        if args.command == "prepare":
            print(json.dumps({"ok": True, "operational": False,
                              "helper_image_id": helper_image_id,
                              "project": plan["project"]}, sort_keys=True))
            return 0
        plan = plan_linux_user_bootstrap(
            candidate, project_root=str(root), env_file=str(env_file), docker=docker,
            docker_socket=str(docker_socket), home=str(Path.home()), uid=os.getuid(),
            gid=os.getgid(), docker_socket_gid=socket_gid, helper_image_id=helper_image_id,
        )
        result = install_linux_user_bootstrap(plan, uuid.uuid4().hex)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as exc:
        error = str(exc) if isinstance(exc, HostCoordinatorBootstrapError) else "bootstrap_failed"
        print(json.dumps({"ok": False, "error": error}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

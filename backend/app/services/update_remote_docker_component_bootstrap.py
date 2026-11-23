"""First-hop updater for a legacy Engine or Worker in a local Docker host.

The command runs on the Docker host so it can mutate the exact persistent mount
used by the selected container. It consumes the signed component archive nested
in the one-file OTA, then switches the container to a versioned runtime.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from typing import Any

from . import update_remote_component_bootstrap as common


class RemoteDockerBootstrapError(ValueError):
    pass


def _require_local_docker_endpoint(docker: str) -> None:
    endpoint = (os.getenv("DOCKER_HOST") or "").strip()
    if not endpoint:
        try:
            result = subprocess.run(
                [docker, "context", "inspect", "--format={{(index .Endpoints \"docker\").Host}}"],
                capture_output=True, text=True, timeout=10, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RemoteDockerBootstrapError("docker_context_inspection_failed") from exc
        if result.returncode:
            raise RemoteDockerBootstrapError("docker_context_inspection_failed")
        endpoint = result.stdout.strip()
    if not endpoint.startswith("unix:///"):
        raise RemoteDockerBootstrapError("local_docker_context_required")


def _docker_json(docker: str, container: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", container):
        raise RemoteDockerBootstrapError("docker_container_name_invalid")
    try:
        result = subprocess.run([docker, "inspect", container], capture_output=True,
                                text=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RemoteDockerBootstrapError("docker_inspect_failed") from exc
    if result.returncode:
        raise RemoteDockerBootstrapError("docker_container_not_found")
    try:
        rows = json.loads(result.stdout)
        value = rows[0]
    except (ValueError, IndexError, TypeError, KeyError) as exc:
        raise RemoteDockerBootstrapError("docker_inspect_invalid") from exc
    if not isinstance(value, dict):
        raise RemoteDockerBootstrapError("docker_inspect_invalid")
    return value


def _runtime_mount(docker: str, container: str, component: str) -> tuple[dict[str, Any], Path, str]:
    spec = common._COMPONENTS.get(component)
    if spec is None:
        raise RemoteDockerBootstrapError("component_not_supported")
    details = _docker_json(docker, container)
    if not details.get("State", {}).get("Running"):
        raise RemoteDockerBootstrapError("docker_container_not_running")
    config = details.get("Config") or {}
    mounts = details.get("Mounts") or []
    destination = "/engine" if component == "engine" else "/worker"
    matches = [item for item in mounts if isinstance(item, dict) and item.get("Destination") == destination]
    if (len(matches) != 1 or matches[0].get("Type") not in {"volume", "bind"}
            or matches[0].get("RW") is not True):
        raise RemoteDockerBootstrapError("docker_component_runtime_mount_invalid")
    raw_root = matches[0].get("Source")
    if not isinstance(raw_root, str) or not Path(raw_root).is_absolute():
        raise RemoteDockerBootstrapError("docker_component_runtime_mount_invalid")
    runtime_root = Path(raw_root)
    if runtime_root.is_symlink() or not runtime_root.is_dir():
        raise RemoteDockerBootstrapError("docker_component_runtime_mount_unavailable")
    env: dict[str, str] = {}
    for row in config.get("Env") or []:
        key, separator, value = str(row).partition("=")
        if separator and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            # Keep only dependency and proxy settings. Never pass container
            # credentials through logs, arguments, or the host environment.
            if key in {"PATH", "NPM_CONFIG_REGISTRY", "npm_config_registry", "HTTP_PROXY", "HTTPS_PROXY",
                       "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"}:
                env[key] = value
    return details, runtime_root.resolve(strict=True), destination


def _exec(docker: str, container: str, *, cwd: str | None = None,
          uid: int | None = None, gid: int | None = None,
          env: dict[str, str] | None = None, argv: list[str]) -> str:
    command = [docker, "exec"]
    if uid is not None:
        command.extend(("--user", f"{uid}:{gid if gid is not None else uid}"))
    if cwd:
        command.extend(("--workdir", cwd))
    for key, value in (env or {}).items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) or "\x00" in value:
            raise RemoteDockerBootstrapError("docker_exec_environment_invalid")
        command.extend(("--env", f"{key}={value}"))
    command.extend((container, *argv))
    return common._run(command, timeout=25 * 60)


def _install_release_dependencies(docker: str, container: str, root_in_container: str,
                                  release: Path, component: str, uid: int, gid: int) -> None:
    relative = release.relative_to(release.parents[1]).as_posix()
    workdir = f"{root_in_container}/{relative}"
    skip_downloads = {
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
        "CYPRESS_INSTALL_BINARY": "0",
        "PUPPETEER_SKIP_DOWNLOAD": "1",
    }
    _exec(docker, container, cwd=workdir, uid=uid, gid=gid, env=skip_downloads, argv=["npm", "ci"])
    if component == "engine":
        _exec(docker, container, cwd=workdir, uid=uid, gid=gid,
              env={"PLAYWRIGHT_BROWSERS_PATH": f"{root_in_container}/.cache/ms-playwright"},
              argv=["npx", "playwright", "install", "chromium"])
        return
    _exec(docker, container, cwd=workdir, uid=uid, gid=gid,
          env={"PLAYWRIGHT_BROWSERS_PATH": f"{root_in_container}/.cache/ms-playwright"},
          argv=["npx", "playwright", "install", "chromium", "firefox", "webkit"])
    metadata = json.loads((release / "package.json").read_text(encoding="utf-8"))
    dependencies = {**(metadata.get("dependencies") or {}), **(metadata.get("devDependencies") or {})}
    if "cypress" in dependencies:
        _exec(docker, container, cwd=workdir, uid=uid, gid=gid,
              env={"CYPRESS_CACHE_FOLDER": f"{root_in_container}/.cache/cypress"},
              argv=["npx", "cypress", "install"])
    if "puppeteer" in dependencies:
        _exec(docker, container, cwd=workdir, uid=uid, gid=gid,
              env={"PUPPETEER_CACHE_DIR": f"{root_in_container}/.cache/puppeteer"},
              argv=["node", "node_modules/puppeteer/install.mjs"])


def _container_health(docker: str, container: str, component: str, version: str) -> bool:
    if not _docker_json(docker, container).get("State", {}).get("Running"):
        return False
    script = (
        "fetch('http://127.0.0.1:3010/health').then(async r=>{const j=await r.json();"
        f"process.exit(r.ok&&j.status==='ok'&&j.version==={json.dumps(version)}?0:1)"
        "}).catch(()=>process.exit(1))"
    )
    try:
        common._run([docker, "exec", container, "node", "-e", script], timeout=12)
        if component == "automation-worker":
            return True
        return True
    except common.RemoteBootstrapError:
        return False


def _wait_worker(docker: str, container: str, api_base: str, token: str,
                 version: str, build_id: str, timeout: int = 180) -> bool:
    endpoint = common._validated_api_base(api_base) + "/automation-runners/me/update-status"
    deadline = time.monotonic() + timeout
    active_since: float | None = None
    while time.monotonic() < deadline:
        try:
            result = common._fetch_json(endpoint, token, "X-Runner-Token", timeout=6)
            expected = (result.get("status") == "current" and result.get("desired_version") == version
                        and result.get("observed_version") == version
                        and result.get("desired_build_id") == build_id
                        and result.get("observed_build_id") == build_id)
            if expected and _docker_json(docker, container).get("State", {}).get("Running"):
                if active_since is None:
                    active_since = time.monotonic()
                elif time.monotonic() - active_since >= 3:
                    return True
            else:
                active_since = None
        except (common.RemoteBootstrapError, RemoteDockerBootstrapError):
            active_since = None
        time.sleep(2)
    return False


def bootstrap_remote_docker_component(*, ota: Path, component: str, container: str,
                                      docker: str = "docker", api_base: str | None = None,
                                      runner_token_file: Path | None = None,
                                      maintenance_window_confirmed: bool = False) -> dict[str, Any]:
    if os.name != "posix" or not sys.platform.startswith("linux"):
        raise RemoteDockerBootstrapError("linux_docker_host_required")
    if os.geteuid() != 0:
        raise RemoteDockerBootstrapError("docker_host_root_required")
    if component == "engine" and not maintenance_window_confirmed:
        raise RemoteDockerBootstrapError("engine_maintenance_window_confirmation_required")
    _require_local_docker_endpoint(docker)
    details, runtime_root, container_root = _runtime_mount(docker, container, component)
    owner = runtime_root.stat()
    uid, gid = owner.st_uid, owner.st_gid
    if uid < 0 or gid < 0:
        raise RemoteDockerBootstrapError("docker_runtime_owner_invalid")
    token = ""
    if component == "automation-worker":
        api_base = common._validated_api_base(api_base or "")
        token_path = runner_token_file or runtime_root / ".runner-token"
        token = common._read_worker_token(token_path, uid)

    spec = common._COMPONENTS[component]
    release_root = runtime_root / spec["releases"]
    if release_root.is_symlink() or (release_root.exists() and not release_root.is_dir()):
        raise RemoteDockerBootstrapError("release_directory_unsafe")
    pointer_path = runtime_root / spec["pointer"]
    docker_name = details.get("Name", "").lstrip("/")
    if docker_name != container:
        raise RemoteDockerBootstrapError("docker_container_identity_mismatch")

    with tempfile.TemporaryDirectory(prefix="treseko-remote-docker-ota-") as temp_name:
        temporary = Path(temp_name)
        package, manifest = common._load_component_package(ota.resolve(strict=True), temporary)
        if manifest.get("deployment") is not None or manifest.get("components", {}).get("source-release"):
            raise RemoteDockerBootstrapError("embedded_component_bootstrap_contract_invalid")
        source, version, build_id = common._stage_source(package, manifest, component, temporary)
        release_root.mkdir(mode=0o750, exist_ok=True)
        release_root.chmod(0o750)
        os.chown(release_root, uid, gid)
        if release_root.stat().st_mode & 0o022:
            raise RemoteDockerBootstrapError("release_directory_unsafe")
        old_pointer, _ = common._read_pointer(pointer_path, component, release_root)
        pointer_snapshot = common._snapshot_regular_file(pointer_path)
        target = release_root / f"{version}-{build_id[:12]}"
        common._copy_release(source, target, component, version, build_id, uid, gid, {},
                             install_dependencies=False, install_browsers=False)
        try:
            _install_release_dependencies(docker, container, container_root, target, component, uid, gid)
        except Exception:
            if target.parent == release_root and target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
            raise
        previous_release = old_pointer.get("release") if old_pointer else None
        new_pointer = {"schema": 1, "release": target.name, "previous_release": previous_release}
        backup_root = release_root / ".treseko-remote-docker-backups" / f"{component}-{uuid.uuid4().hex}"
        backup_root.mkdir(parents=True, mode=0o700)
        worker_lock: tuple[Path, str] | None = None
        if component == "automation-worker":
            worker_lock = common._acquire_worker_update_lock(api_base or "", token, runtime_root, uid, gid)
        old_root_files: dict[str, tuple[bytes, int, int, int] | None] = {}
        runtime_manifest_path = runtime_root / ".treseko-runtime-manifest.json"
        stopped = False
        try:
            if component == "automation-worker":
                # The backend fence serializes the drain against claims and
                # refuses acquisition while a job or result is still active.
                common._run([docker, "stop", "--time", "300", container], timeout=330)
                stopped = True
            else:
                # A Docker Engine has no legacy admission fence. This isolated
                # bootstrap therefore needs an operator maintenance window.
                common._run([docker, "stop", "--time", "300", container], timeout=330)
                stopped = True
            for name in common._MANAGED_ROOT_FILES[component]:
                current = runtime_root / name
                old_root_files[name] = common._snapshot_regular_file(current)
                snapshot = old_root_files[name]
                if snapshot is not None:
                    content, mode, file_uid, file_gid = snapshot
                    backup_file = backup_root / name
                    backup_file.write_bytes(content)
                    os.chmod(backup_file, mode)
                    os.chown(backup_file, file_uid, file_gid)
                common._atomic_write(current, (target / name).read_bytes(),
                                     0o755 if name.endswith((".mjs", ".sh")) else 0o644)
                os.chown(current, uid, gid)
            old_root_files[".treseko-runtime-manifest.json"] = common._snapshot_regular_file(
                runtime_manifest_path
            )
            common._atomic_write(
                runtime_manifest_path,
                (target / ".treseko-runtime-manifest.json").read_bytes(), 0o600,
            )
            os.chown(runtime_manifest_path, uid, gid)
            common._atomic_write(pointer_path, (json.dumps(new_pointer, sort_keys=True) + "\n").encode(), 0o600)
            os.chown(pointer_path, uid, gid)
            common._run([docker, "start", container], timeout=120)
            stopped = False
            if component == "engine":
                deadline = time.monotonic() + 150
                healthy = False
                while time.monotonic() < deadline:
                    if _container_health(docker, container, component, version):
                        healthy = True
                        break
                    time.sleep(2)
            else:
                healthy = _wait_worker(docker, container, api_base or "", token, version, build_id)
            if not healthy:
                raise RemoteDockerBootstrapError("component_health_check_failed_rollback_applied")
        except Exception:
            rollback_errors: list[str] = []
            try:
                state = _docker_json(docker, container).get("State", {})
                if state.get("Running"):
                    common._run([docker, "stop", "--time", "300", container], timeout=330)
                common._restore_regular_file(pointer_path, pointer_snapshot)
            except Exception as rollback_error:
                rollback_errors.append(f"pointer:{type(rollback_error).__name__}")
            for name, snapshot in old_root_files.items():
                try:
                    current = runtime_root / name
                    common._restore_regular_file(current, snapshot)
                except Exception as rollback_error:
                    rollback_errors.append(f"{name}:{type(rollback_error).__name__}")
            if (target.parent == release_root and target.is_dir() and not target.is_symlink()
                    and (not old_pointer or old_pointer.get("release") != target.name)):
                try:
                    shutil.rmtree(target)
                except Exception as rollback_error:
                    rollback_errors.append(f"release:{type(rollback_error).__name__}")
            try:
                common._run([docker, "start", container], timeout=120)
                stopped = False
            except Exception as rollback_error:
                rollback_errors.append(f"restart:{type(rollback_error).__name__}")
            if worker_lock and not rollback_errors:
                try:
                    common._release_worker_update_lock(api_base or "", token, *worker_lock)
                except Exception as rollback_error:
                    rollback_errors.append(f"update_lock:{type(rollback_error).__name__}")
            if rollback_errors:
                raise RemoteDockerBootstrapError("rollback_failed:" + ",".join(rollback_errors))
            raise
        if worker_lock:
            common._release_worker_update_lock(api_base or "", token, *worker_lock)
    return {"ok": True, "component": component, "version": version, "build_id": build_id,
            "container": container, "runtime_root": str(runtime_root), "backup": str(backup_root),
            "identity_preserved": component == "automation-worker"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ota", required=True, type=Path)
    parser.add_argument("--component", required=True, choices=tuple(common._COMPONENTS))
    parser.add_argument("--container", required=True, help="Existing local Docker container name")
    parser.add_argument("--docker", default="docker")
    parser.add_argument("--api-base", help="Host-reachable Treseko API for Worker updates")
    parser.add_argument("--runner-token-file", type=Path)
    parser.add_argument("--maintenance-window-confirmed", action="store_true",
                        help="Required for Engine: confirm this container may be unavailable during update")
    args = parser.parse_args(argv)
    try:
        result = bootstrap_remote_docker_component(
            ota=args.ota, component=args.component, container=args.container, docker=args.docker,
            api_base=args.api_base, runner_token_file=args.runner_token_file,
            maintenance_window_confirmed=args.maintenance_window_confirmed,
        )
    except Exception as exc:
        error = str(exc) if isinstance(exc, (RemoteDockerBootstrapError, common.RemoteBootstrapError)) else "remote_docker_bootstrap_failed"
        print(json.dumps({"ok": False, "error": error}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

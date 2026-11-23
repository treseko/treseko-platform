"""First-hop bootstrap for legacy remote Engine and Worker hosts.

This command is shipped inside the single full OTA. It uses the signed,
embedded component bootstrap archive to seed a legacy remote runtime with the
same versioned launcher/self-updater used by later pull updates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

from .edition.update_manager import verify_update_manifest_signature
from .update_participant_package import stage_verified_package

_COMPONENTS = {
    "engine": {
        "package_path": "engine", "releases": ".engine-releases",
        "pointer": ".treseko-active-engine-release.json",
        "launcher": "engine-launcher.mjs", "service": "treseko-engine",
        "version_re": re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$"),
    },
    "automation-worker": {
        "package_path": "automation-worker", "releases": ".worker-releases",
        "pointer": ".treseko-active-worker-release.json",
        "launcher": "worker-launcher.mjs", "service": "treseko-worker",
        "version_re": re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$"),
    },
}
_MANAGED_ROOT_FILES = {
    "engine": ("package.json", "package-lock.json", "VERSION", "engine-launcher.mjs", "release-lifecycle.mjs", "entrypoint.sh", "hash_component_tree.sh"),
    "automation-worker": ("package.json", "package-lock.json", "VERSION", "worker-launcher.mjs", "entrypoint.sh", "hash_component_tree.sh"),
}
_REQUIRED_SOURCE = {
    "engine": ("package.json", "package-lock.json", "VERSION", "src/server.ts", "engine-launcher.mjs", "release-lifecycle.mjs", "engine-self-update.mjs", "hash_component_tree.sh"),
    "automation-worker": ("package.json", "package-lock.json", "VERSION", "src/worker.mjs", "worker-launcher.mjs", "src/worker-self-update.mjs", "hash_component_tree.sh"),
}
_MAX_OUTER_BYTES = 3 * 1024**3
_MAX_EXPANDED_BYTES = 2 * 1024**3
_MAX_FILES = 100_000


class RemoteBootstrapError(ValueError):
    pass


def _safe_tar_members(archive: tarfile.TarFile, *, max_files: int, max_bytes: int) -> list[tarfile.TarInfo]:
    members: list[tarfile.TarInfo] = []
    names: set[str] = set()
    total = 0
    for member in archive:
        raw = member.name
        path = PurePosixPath(raw)
        if (path.is_absolute() or ".." in path.parts or "\\" in raw or "\x00" in raw
                or not (member.isdir() or member.isfile()) or member.issym() or member.islnk()):
            raise RemoteBootstrapError("package_archive_path_or_type_invalid")
        normalized = "/".join(part for part in path.parts if part not in {"", "."})
        if not normalized:
            continue
        if normalized in names:
            raise RemoteBootstrapError("package_archive_duplicate_path")
        names.add(normalized)
        total += member.size
        if len(names) > max_files or total > max_bytes:
            raise RemoteBootstrapError("package_archive_limit_exceeded")
        members.append(member)
    return members


def _component_build_id(root: Path, component: str) -> str:
    excluded_dirs = {".git", "node_modules", ".cache", ".pytest_cache", "coverage", "logs", "reports", "pending-deliveries", "test-results"}
    if component == "engine":
        excluded_dirs |= {"update-control", ".engine-releases"}
    else:
        excluded_dirs |= {".state"}
    excluded_files = {
        ".treseko-content-digest", ".maintenance", ".treseko-active-engine-release.json",
        ".treseko-active-worker-release.json", ".treseko-update-fence", ".treseko-update-draining",
        ".treseko-update-restart", ".treseko-runtime-manifest.json", "maintenance.html",
        ".runner-token", ".runner-token.pairing", ".worker-instance-id", ".env",
    }
    records: list[tuple[str, Path]] = []
    for current, dirs, files in os.walk(root, followlinks=False):
        base = Path(current)
        dirs[:] = sorted(name for name in dirs if name not in excluded_dirs and not (base / name).is_symlink()
                         and not name.startswith(".env"))
        for name in files:
            item = base / name
            relative = item.relative_to(root).as_posix()
            if (name in excluded_files or name.startswith(".env.") or item.is_symlink() or not item.is_file()
                    or "\n" in relative or "\r" in relative or "\\" in relative):
                continue
            records.append((relative, item))
    digest = hashlib.sha256()
    for relative, item in sorted(records):
        content_hash = hashlib.sha256(item.read_bytes()).hexdigest()
        digest.update(f"{content_hash}  ./{relative}\n".encode("utf-8"))
    return digest.hexdigest()


def _read_pointer(path: Path, component: str, release_root: Path) -> tuple[dict[str, Any] | None, bytes | None]:
    if path.is_symlink():
        raise RemoteBootstrapError("active_release_pointer_unsafe")
    if not path.exists():
        return None, None
    if not path.is_file() or path.stat().st_size > 64 * 1024:
        raise RemoteBootstrapError("active_release_pointer_unsafe")
    raw = path.read_bytes()
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise RemoteBootstrapError("active_release_pointer_invalid") from exc
    if not isinstance(value, dict) or value.get("schema") != 1:
        raise RemoteBootstrapError("active_release_pointer_invalid")
    release = str(value.get("release") or "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,100}", release):
        raise RemoteBootstrapError("active_release_pointer_invalid")
    active = release_root / release
    if active.is_symlink() or not active.is_dir():
        raise RemoteBootstrapError("active_release_missing")
    return value, raw


def _snapshot_regular_file(path: Path) -> tuple[bytes, int, int, int] | None:
    """Capture a managed file without following links, including rollback metadata."""
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode):
        raise RemoteBootstrapError("managed_runtime_file_unsafe")
    return path.read_bytes(), stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid


def _restore_regular_file(path: Path, snapshot: tuple[bytes, int, int, int] | None) -> None:
    if snapshot is None:
        try:
            info = path.lstat()
        except FileNotFoundError:
            return
        if not stat.S_ISREG(info.st_mode):
            raise RemoteBootstrapError("rollback_target_unsafe")
        path.unlink()
        return
    content, mode, uid, gid = snapshot
    _atomic_write(path, content, mode)
    os.chown(path, uid, gid)


def _unit_properties(service: str, runtime_root: Path) -> tuple[str, str]:
    if service not in {"treseko-engine", "treseko-worker"}:
        raise RemoteBootstrapError("systemd_unit_not_supported")
    result = subprocess.run(["systemctl", "show", service, "--property=FragmentPath", "--property=WorkingDirectory", "--property=User"],
                            capture_output=True, text=True, timeout=15, check=False)
    if result.returncode:
        raise RemoteBootstrapError("systemd_unit_unavailable")
    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        key, sep, value = line.partition("=")
        if sep:
            values[key] = value
    fragment = Path(values.get("FragmentPath", ""))
    working = Path(values.get("WorkingDirectory", ""))
    if (not fragment.is_absolute() or not fragment.is_file() or fragment.is_symlink()
            or not working.is_absolute() or working.resolve() != runtime_root.resolve()):
        raise RemoteBootstrapError("systemd_unit_runtime_mismatch")
    unit_text = fragment.read_text(encoding="utf-8", errors="replace")
    if str(runtime_root) not in unit_text:
        raise RemoteBootstrapError("systemd_unit_runtime_mismatch")
    return values.get("User") or "root", unit_text


def _run(argv: list[str], *, cwd: Path | None = None, timeout: int = 900,
         env: dict[str, str] | None = None) -> str:
    try:
        result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True,
                                timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RemoteBootstrapError("bootstrap_process_failed_or_timed_out") from exc
    if result.returncode:
        detail = (result.stderr or result.stdout or "").strip()[:400]
        raise RemoteBootstrapError(f"bootstrap_command_failed:{Path(argv[0]).name}:{detail}")
    return result.stdout.strip()


def _run_as_service_user(argv: list[str], *, cwd: Path, timeout: int,
                         env: dict[str, str], uid: int) -> str:
    if uid == 0 or os.geteuid() == uid:
        return _run(argv, cwd=cwd, timeout=timeout, env=env)
    runuser = shutil.which("runuser")
    env_command = shutil.which("env")
    if not runuser or not env_command:
        raise RemoteBootstrapError("service_user_privilege_drop_unavailable")
    user = __import__("pwd").getpwuid(uid)
    allowed = {
        "PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH", "NPM_CONFIG_REGISTRY",
        "NPM_CONFIG_USERCONFIG", "npm_config_userconfig", "HTTP_PROXY", "HTTPS_PROXY",
        "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
    }
    safe_values = {key: value for key, value in env.items() if key in allowed}
    # The caller runs as root, so inheriting its HOME would make npm and
    # Playwright write into /root (or fail when the target service is sandboxed).
    safe_values["HOME"] = user.pw_dir
    safe_values.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin")
    safe_env = [f"{key}={value}" for key, value in safe_values.items()]
    return _run([runuser, "-u", user.pw_name, "--", env_command, "-i", *safe_env, *argv],
                cwd=cwd, timeout=timeout)


def _fetch_json(url: str, token: str, header: str, *, timeout: float = 8.0,
                method: str = "GET", extra_headers: dict[str, str] | None = None) -> dict[str, Any]:
    headers = {header: token, "Accept": "application/json", **(extra_headers or {})}
    request = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                raise RemoteBootstrapError("remote_agent_api_rejected")
            value = json.loads(response.read(1024 * 1024))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read(64 * 1024))
            detail = payload.get("detail") if isinstance(payload, dict) else None
            code = detail.get("code") if isinstance(detail, dict) else None
        except (OSError, ValueError):
            code = None
        if isinstance(code, str) and re.fullmatch(r"[a-z][a-z0-9_]{2,80}", code):
            raise RemoteBootstrapError(code) from exc
        raise RemoteBootstrapError("remote_agent_api_rejected") from exc
    except (OSError, urllib.error.URLError, ValueError) as exc:
        if isinstance(exc, RemoteBootstrapError):
            raise
        raise RemoteBootstrapError("remote_agent_api_unavailable") from exc
    if not isinstance(value, dict):
        raise RemoteBootstrapError("remote_agent_api_response_invalid")
    return value


def _validated_api_base(raw: str) -> str:
    value = str(raw or "").strip().rstrip("/")
    try:
        parsed = urllib.parse.urlsplit(value)
        hostname = (parsed.hostname or "").lower()
        # Clear invalid bracket/port syntax as well as control characters before
        # this value is used as the destination for the persisted runner token.
        _ = parsed.port
    except ValueError as exc:
        raise RemoteBootstrapError("worker_api_base_invalid") from exc
    if (parsed.scheme not in {"https", "http"} or not hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or any(ord(char) < 0x20 for char in value)):
        raise RemoteBootstrapError("worker_api_base_invalid")
    if parsed.scheme == "http" and hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise RemoteBootstrapError("worker_api_base_must_use_https")
    return value


def _read_worker_token(path: Path, service_uid: int) -> str:
    try:
        info = path.lstat()
    except OSError as exc:
        raise RemoteBootstrapError("worker_token_file_missing") from exc
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != service_uid
            or stat.S_IMODE(info.st_mode) & 0o077 or info.st_size > 4096):
        raise RemoteBootstrapError("worker_token_file_unsafe")
    try:
        token = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as exc:
        raise RemoteBootstrapError("worker_token_invalid") from exc
    if not token:
        raise RemoteBootstrapError("worker_token_invalid")
    return token


def _worker_update_lock_file(runtime_root: Path, service_uid: int, service_gid: int) -> tuple[Path, str]:
    state_root = runtime_root / ".state"
    if state_root.is_symlink():
        raise RemoteBootstrapError("worker_update_state_directory_unsafe")
    try:
        state_root.lstat()
    except FileNotFoundError:
        state_root.mkdir(mode=0o700)
        os.chown(state_root, service_uid, service_gid)
    state_info = state_root.stat()
    if not stat.S_ISDIR(state_info.st_mode) or state_info.st_uid != service_uid or state_info.st_mode & 0o022:
        raise RemoteBootstrapError("worker_update_state_directory_unsafe")
    lock_file = state_root / "ota-update-lock"
    try:
        info = lock_file.lstat()
    except FileNotFoundError:
        token = secrets.token_urlsafe(32)
        _atomic_write(lock_file, (token + "\n").encode("ascii"), 0o600)
        os.chown(lock_file, service_uid, service_gid)
        return lock_file, token
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != service_uid
            or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 512):
        raise RemoteBootstrapError("worker_update_lock_file_unsafe")
    try:
        token = lock_file.read_text(encoding="ascii").strip()
    except (OSError, UnicodeError) as exc:
        raise RemoteBootstrapError("worker_update_lock_file_invalid") from exc
    if len(token) < 32 or len(token) > 256:
        raise RemoteBootstrapError("worker_update_lock_file_invalid")
    return lock_file, token


def _acquire_worker_update_lock(api_base: str, runner_token: str, runtime_root: Path,
                                service_uid: int, service_gid: int) -> tuple[Path, str]:
    lock_file, lock_token = _worker_update_lock_file(runtime_root, service_uid, service_gid)
    response = _fetch_json(
        api_base.rstrip("/") + "/automation-runners/me/update-lock", runner_token,
        "X-Runner-Token", method="POST",
        extra_headers={"X-Runner-Update-Lock": lock_token},
    )
    if response.get("locked") is not True or response.get("lock_token") != lock_token:
        raise RemoteBootstrapError("worker_update_lock_not_confirmed")
    return lock_file, lock_token


def _release_worker_update_lock(api_base: str, runner_token: str,
                                lock_file: Path, lock_token: str) -> None:
    response = _fetch_json(
        api_base.rstrip("/") + "/automation-runners/me/update-lock", runner_token,
        "X-Runner-Token", method="DELETE",
        extra_headers={"X-Runner-Update-Lock": lock_token},
    )
    if response.get("locked") is not False:
        raise RemoteBootstrapError("worker_update_lock_release_unconfirmed")
    try:
        info = lock_file.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISREG(info.st_mode):
        raise RemoteBootstrapError("worker_update_lock_file_unsafe")
    lock_file.unlink()


def _load_component_package(ota: Path, temporary: Path) -> tuple[Path, dict[str, Any]]:
    from .update_remote_component_bootstrap_packages import load_component_package
    return load_component_package(sys.modules[__name__], ota, temporary)


def _stage_source(archive: Path, manifest: dict[str, Any], component: str,
                  temporary: Path) -> tuple[Path, str, str]:
    from .update_remote_component_bootstrap_packages import stage_source
    return stage_source(sys.modules[__name__], archive, manifest, component, temporary)


def _copy_release(source: Path, release: Path, component: str, version: str, build_id: str,
                  owner_uid: int, owner_gid: int, env: dict[str, str], *,
                  install_dependencies: bool = True, install_browsers: bool = True) -> None:
    from .update_remote_component_bootstrap_packages import copy_release
    return copy_release(sys.modules[__name__], source, release, component, version, build_id,
                        owner_uid, owner_gid, env, install_dependencies=install_dependencies,
                        install_browsers=install_browsers)


def _atomic_write(path: Path, content: bytes, mode: int = 0o644) -> None:
    temporary = path.with_name(path.name + f".{uuid.uuid4().hex}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _wait_engine(url: str, version: str, timeout: int = 75) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=3) as response:
                body = json.loads(response.read(256 * 1024))
            if response.status == 200 and body.get("status") == "ok" and body.get("version") == version:
                return True
        except (OSError, urllib.error.URLError, ValueError):
            pass
        time.sleep(1)
    return False


def _wait_worker(api_base: str, token: str, version: str, build_id: str, timeout: int = 120,
                 service: str = "treseko-worker") -> bool:
    endpoint = api_base.rstrip("/") + "/automation-runners/me/update-status"
    deadline = time.monotonic() + timeout
    active_since: float | None = None
    while time.monotonic() < deadline:
        try:
            result = _fetch_json(endpoint, token, "X-Runner-Token", timeout=6)
            # `current` alone is not proof of convergence: an older backend or
            # a stale runner record can omit the observed fields while still
            # naming the new desired version. Require the heartbeat's exact
            # version and source build before committing this release.
            if (result.get("status") == "current"
                    and result.get("desired_version") == version
                    and result.get("observed_version") == version
                    and result.get("desired_build_id") == build_id
                    and result.get("observed_build_id") == build_id):
                active = subprocess.run(
                    ["systemctl", "is-active", "--quiet", service],
                    capture_output=True, text=True, timeout=5, check=False,
                ).returncode == 0
                now = time.monotonic()
                if active:
                    if active_since is None:
                        active_since = now
                    elif now - active_since >= 3:
                        # The API reports the runner's last heartbeat, which
                        # can remain current after its local process has died.
                        # Require both a matching remote version and a stable
                        # systemd service before committing the new pointer.
                        return True
                else:
                    active_since = None
            else:
                active_since = None
        except RemoteBootstrapError:
            active_since = None
        time.sleep(2)
    return False


def bootstrap_remote_component(*, ota: Path, component: str, runtime_root: Path,
                               service: str | None = None, api_base: str | None = None,
                               runner_token_file: Path | None = None,
                               engine_health_url: str | None = None) -> dict[str, Any]:
    from .update_remote_component_bootstrap_systemd import bootstrap_remote_component as activate
    return activate(sys.modules[__name__], ota=ota, component=component, runtime_root=runtime_root,
                    service=service, api_base=api_base, runner_token_file=runner_token_file,
                    engine_health_url=engine_health_url)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ota", required=True, type=Path, help="Path to the single full OTA archive")
    parser.add_argument("--component", required=True, choices=tuple(_COMPONENTS))
    parser.add_argument("--runtime-root", required=True, type=Path)
    parser.add_argument("--service", help="Defaults to the matching Treseko systemd unit")
    parser.add_argument("--api-base", help="Required for Automation Worker bootstrap, e.g. https://treseko.internal/api")
    parser.add_argument("--runner-token-file", type=Path)
    parser.add_argument("--engine-health-url")
    args = parser.parse_args(argv)
    try:
        result = bootstrap_remote_component(ota=args.ota, component=args.component,
                                            runtime_root=args.runtime_root, service=args.service,
                                            api_base=args.api_base,
                                            runner_token_file=args.runner_token_file,
                                            engine_health_url=args.engine_health_url)
    except Exception as exc:
        error = str(exc) if isinstance(exc, RemoteBootstrapError) else "remote_component_bootstrap_failed"
        print(json.dumps({"ok": False, "error": error}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Systemd-native migration preparation helpers for the legacy updater."""
from __future__ import annotations

import json
import os
import pwd
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

class LegacyMigrationError(ValueError):
    pass


def _chown_tree(path: Path, uid: int, gid: int) -> None:
    """Give the unprivileged systemd service ownership of an extracted subtree."""
    if path.is_symlink() or not path.is_dir():
        raise LegacyMigrationError("native_dependency_staging_unsafe")
    for current, directories, files in os.walk(path, followlinks=False):
        current_path = Path(current)
        for name in [*directories, *files]:
            child = current_path / name
            if child.is_symlink():
                raise LegacyMigrationError("native_dependency_staging_unsafe")
            os.chown(child, uid, gid)
        os.chown(current_path, uid, gid)


def _native_systemd_preflight(root: Path, service: str, run_command) -> tuple[int, int]:
    if not sys.platform.startswith("linux") or os.name != "posix":
        raise LegacyMigrationError("native_systemd_host_unsupported")
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        raise LegacyMigrationError("native_systemd_requires_root")
    if not re.fullmatch(r"[A-Za-z0-9_.@:-]+\.service", service):
        raise LegacyMigrationError("native_systemd_service_invalid")
    backend = root / "backend"
    entrypoint = backend / "entrypoint.sh"
    if (root.is_symlink() or not root.is_dir() or backend.is_symlink()
            or entrypoint.is_symlink() or not entrypoint.is_file()):
        raise LegacyMigrationError("native_installation_paths_unsafe")
    if not (root / "frontend" / "html").is_dir():
        raise LegacyMigrationError("native_frontend_not_found")
    show = run_command(["systemctl", "show", service, "--property=ActiveState", "--property=ExecStart",
                        "--property=Environment", "--property=User"], timeout=20)
    if show.returncode != 0:
        raise LegacyMigrationError("native_systemd_service_unavailable")
    properties = dict(line.split("=", 1) for line in show.stdout.splitlines() if "=" in line)
    if str(entrypoint) not in properties.get("ExecStart", "") or properties.get("ActiveState") != "active":
        raise LegacyMigrationError("native_systemd_service_binding_mismatch")
    try:
        environment = shlex.split(properties.get("Environment", ""))
    except ValueError as exc:
        raise LegacyMigrationError("native_systemd_environment_invalid") from exc
    env = dict(item.split("=", 1) for item in environment if "=" in item)
    expected_environment = {
        "TRESEKO_DEPLOY_MODE": "systemd", "TRESEKO_APP_DIR": str(root / "backend"),
        "TRESEKO_VERSION_FILE": str(root / "VERSION"),
        "TRESEKO_FRONTEND_DIR": str(root / "frontend" / "html"),
        "TRESEKO_ENGINE_DIR": str(root / "engine"), "TRESEKO_WORKER_DIR": str(root / "worker"),
        "UPDATES_DIR": str(root / "data" / "updates"), "CHECK_PENDING_UPDATE": "true",
    }
    if any(env.get(name) != value for name, value in expected_environment.items()):
        raise LegacyMigrationError("native_systemd_mode_not_declared")
    service_user = properties.get("User", "").strip()
    if not service_user:
        raise LegacyMigrationError("native_systemd_service_user_missing")
    try:
        account = pwd.getpwnam(service_user)
    except KeyError as exc:
        raise LegacyMigrationError("native_systemd_service_user_missing") from exc
    if account.pw_uid == 0:
        raise LegacyMigrationError("native_systemd_service_user_invalid")
    return account.pw_uid, account.pw_gid


def _prepare_native_update_staging(updates: Path, extracted_root: Path,
                                   service_uid: int, service_gid: int) -> None:
    """Let the unprivileged Backend consume its staged update after restart."""
    try:
        os.chown(updates, service_uid, service_gid)
        os.chmod(updates, 0o700)
        os.chown(extracted_root, service_uid, service_gid)
        os.chmod(extracted_root, 0o700)
    except OSError as exc:
        raise LegacyMigrationError("native_staging_permissions_failed") from exc


def _prepare_native_component_dependencies(staged: Path, root: Path,
                                          service_uid: int, service_gid: int) -> None:
    """Install signed OTA dependencies before a legacy Backend replaces its entrypoint."""
    npm = shutil.which("npm")
    if not npm:
        raise LegacyMigrationError("native_update_npm_unavailable")
    engine = staged / "engine"
    worker = staged / "automation-worker"
    if not (engine / "package-lock.json").is_file() or not (worker / "package-lock.json").is_file():
        raise LegacyMigrationError("native_update_component_lock_missing")

    browser_cache = root / "data" / "ms-playwright"
    npm_cache = root / "data" / "update-npm-cache"
    if browser_cache.is_symlink() or npm_cache.is_symlink():
        raise LegacyMigrationError("native_browser_cache_unsafe")
    browser_cache.mkdir(mode=0o755, parents=True, exist_ok=True)
    npm_cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(browser_cache, service_uid, service_gid)
    os.chown(npm_cache, service_uid, service_gid)

    for component, environment in (
        (engine, {"PLAYWRIGHT_BROWSERS_PATH": str(browser_cache)}),
        (worker, {
            "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
            "CYPRESS_INSTALL_BINARY": "0",
            "PUPPETEER_SKIP_DOWNLOAD": "1",
        }),
    ):
        _chown_tree(component, service_uid, service_gid)
        try:
            service_home = pwd.getpwuid(service_uid).pw_dir
        except KeyError as exc:
            raise LegacyMigrationError("native_systemd_service_user_missing") from exc
        env = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": service_home,
            "npm_config_cache": str(npm_cache),
            "CI": "true",
        }
        env.update(environment)
        try:
            result = subprocess.run(
                [npm, "--prefix", str(component), "ci"],
                capture_output=True, text=True, check=False, timeout=60 * 60,
                env=env, user=service_uid, group=service_gid,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise LegacyMigrationError("native_component_dependency_install_failed") from exc
        if result.returncode != 0:
            raise LegacyMigrationError("native_component_dependency_install_failed")

    if not (engine / "node_modules" / "tsx" / "dist" / "cli.mjs").is_file():
        raise LegacyMigrationError("native_engine_runtime_dependency_missing")


def _ensure_native_engine_ready(root: Path, run_command, open_url=urlopen) -> str:
    """Make sure the legacy Engine is alive to consume its post-update marker."""
    unit = os.environ.get("TRESEKO_ENGINE_SYSTEMD_UNIT", "treseko-engine.service")
    if not re.fullmatch(r"[A-Za-z0-9_.@:-]+\.service", unit):
        raise LegacyMigrationError("native_systemd_engine_service_invalid")
    state = run_command(["systemctl", "is-active", unit], timeout=20)
    if state.returncode != 0 or state.stdout.strip() != "active":
        started = run_command(["systemctl", "start", unit], timeout=60)
        if started.returncode != 0:
            raise LegacyMigrationError("native_engine_service_start_failed")

    details = run_command(["systemctl", "show", unit, "--property=Environment"], timeout=20)
    port = 13010
    if details.returncode == 0:
        try:
            environment = shlex.split(details.stdout.partition("=")[2])
            port_value = next((item.split("=", 1)[1] for item in environment
                               if item.startswith("ENGINE_PORT=")), str(port))
            port = int(port_value)
            if not 1 <= port <= 65535:
                raise ValueError("invalid port")
        except (ValueError, IndexError):
            raise LegacyMigrationError("native_engine_service_environment_invalid")

    try:
        expected_version = (root / "engine" / "VERSION").read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as exc:
        raise LegacyMigrationError("native_engine_version_missing") from exc
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        active = run_command(["systemctl", "is-active", unit], timeout=20)
        if active.returncode == 0 and active.stdout.strip() == "active":
            try:
                with open_url(f"http://127.0.0.1:{port}/health", timeout=3) as response:
                    health = json.loads(response.read(64 * 1024))
                if health.get("version") == expected_version:
                    return unit
            except (OSError, ValueError, URLError):
                pass
        time.sleep(2)
    raise LegacyMigrationError("native_engine_service_not_ready")


def _prepare_native_worker_restart(source_release: Path, run_command) -> None:
    """Install the signed OTA's systemd compatibility drop-in before 1.0.7 exits."""
    worker_unit = os.environ.get("TRESEKO_WORKER_SYSTEMD_UNIT", "treseko-worker.service")
    if not re.fullmatch(r"[A-Za-z0-9_.@:-]+\.service", worker_unit):
        raise LegacyMigrationError("native_systemd_worker_service_invalid")
    bootstrap = source_release / "scripts" / "bootstrap_native_worker_restart.sh"
    if bootstrap.is_symlink() or not bootstrap.is_file():
        raise LegacyMigrationError("native_worker_restart_bootstrap_missing")
    result = run_command(["bash", str(bootstrap)], timeout=60,
                  env={**os.environ, "TRESEKO_WORKER_UNIT": worker_unit})
    if result.returncode != 0:
        raise LegacyMigrationError("native_worker_restart_bootstrap_failed")


def _prepare_legacy_systemd_entrypoint(root: Path, updates: Path, transaction: str,
                                      service_uid: int, service_gid: int) -> None:
    """Patch the exact 1.0.7 Docker-only chown before its first native restart."""
    entrypoint = root / "backend" / "entrypoint.sh"
    if entrypoint.is_symlink() or not entrypoint.is_file():
        raise LegacyMigrationError("native_installation_paths_unsafe")
    try:
        original = entrypoint.read_text(encoding="utf-8")
        stat = entrypoint.stat()
    except (OSError, UnicodeError) as exc:
        raise LegacyMigrationError("native_legacy_entrypoint_unreadable") from exc
    guarded = re.compile(
        r'(?m)^(?P<indent>[ \t]*)if \[ "\$\{TRESEKO_DEPLOY_MODE:-docker\}" = "docker" \]; then\n'
        r'(?P=indent)  chown -R 10001:10001 "\$ENGINE_DIR"\n(?P=indent)fi[ \t]*$'
    )
    if guarded.search(original):
        try:
            os.chown(entrypoint, service_uid, service_gid)
        except OSError as exc:
            raise LegacyMigrationError("native_legacy_entrypoint_ownership_failed") from exc
        return
    legacy = re.compile(r'(?m)^(?P<indent>[ \t]*)chown -R 10001:10001 "\$ENGINE_DIR"[ \t]*$')
    matches = list(legacy.finditer(original))
    if len(matches) > 1:
        raise LegacyMigrationError("native_legacy_entrypoint_pattern_ambiguous")
    if not matches:
        try:
            os.chown(entrypoint, service_uid, service_gid)
        except OSError as exc:
            raise LegacyMigrationError("native_legacy_entrypoint_ownership_failed") from exc
        return

    backup_root = updates / "native-bootstrap-backups"
    backup_dir = backup_root / transaction
    for directory in (backup_root, backup_dir):
        if directory.is_symlink():
            raise LegacyMigrationError("native_bootstrap_backup_unsafe")
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    backup = backup_dir / "entrypoint.sh"
    shutil.copy2(entrypoint, backup)
    backup.chmod(0o600)
    replacement = (
        '{indent}if [ "${{TRESEKO_DEPLOY_MODE:-docker}}" = "docker" ]; then\n'
        '{indent}  chown -R 10001:10001 "$ENGINE_DIR"\n'
        '{indent}fi'
    ).format(indent=matches[0].group("indent"))
    updated = legacy.sub(lambda _: replacement, original, count=1)
    temporary = entrypoint.with_name(f".entrypoint.{transaction}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(stat.st_mode & 0o777)
        os.chown(temporary, service_uid, service_gid)
        os.replace(temporary, entrypoint)
    except OSError as exc:
        temporary.unlink(missing_ok=True)
        raise LegacyMigrationError("native_legacy_entrypoint_compatibility_failed") from exc

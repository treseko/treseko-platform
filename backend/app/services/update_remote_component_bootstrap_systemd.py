"""Transactional systemd activation for remote Engine and Worker releases."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
import uuid
from typing import Any


def bootstrap_remote_component(context: Any, *, ota: Path, component: str, runtime_root: Path,
                               service: str | None = None, api_base: str | None = None,
                               runner_token_file: Path | None = None,
                               engine_health_url: str | None = None) -> dict[str, Any]:
    if component not in context._COMPONENTS:
        raise context.RemoteBootstrapError("component_not_supported")
    spec = context._COMPONENTS[component]
    expected_service = spec["service"]
    service = service or expected_service
    if service != expected_service:
        raise context.RemoteBootstrapError("systemd_unit_component_mismatch")
    if os.name != "posix" or not context.sys.platform.startswith("linux") or context.os.geteuid() != 0:
        raise context.RemoteBootstrapError("linux_root_required")
    if not runtime_root.is_absolute() or runtime_root == Path("/"):
        raise context.RemoteBootstrapError("runtime_root_invalid")
    if runtime_root.is_symlink() or not runtime_root.is_dir():
        raise context.RemoteBootstrapError("runtime_root_invalid")
    runtime_root = runtime_root.resolve(strict=True)
    if runtime_root == Path("/") or not runtime_root.is_dir():
        raise context.RemoteBootstrapError("runtime_root_invalid")
    owner_name, unit_text = context._unit_properties(service, runtime_root)
    try:
        owner = __import__("pwd").getpwnam(owner_name)
    except KeyError as exc:
        raise context.RemoteBootstrapError("systemd_service_user_invalid") from exc
    if component == "automation-worker":
        api_base = context._validated_api_base(api_base or "")
        token_file = runner_token_file or Path(os.getenv("QA_RUNNER_TOKEN_FILE") or runtime_root / ".runner-token")
        token = context._read_worker_token(token_file, owner.pw_uid)
    else:
        token = ""
        engine_health_url = engine_health_url or "http://127.0.0.1:3010/health"

    release_root = runtime_root / spec["releases"]
    if release_root.is_symlink() or (release_root.exists() and not release_root.is_dir()):
        raise context.RemoteBootstrapError("release_directory_unsafe")
    pointer_path = runtime_root / spec["pointer"]
    with context.tempfile.TemporaryDirectory(prefix="treseko-remote-ota-") as temp_name:
        temporary = Path(temp_name)
        package, manifest = context._load_component_package(ota.resolve(strict=True), temporary)
        if manifest.get("deployment") is not None or manifest.get("components", {}).get("source-release"):
            raise context.RemoteBootstrapError("embedded_component_bootstrap_contract_invalid")
        source, version, build_id = context._stage_source(package, manifest, component, temporary)
        # Verify the signed payload before writing releases, backups, pointers,
        # or managed root files on the target installation.
        release_root.mkdir(mode=0o750, exist_ok=True)
        release_root.chmod(0o750)
        context.os.chown(release_root, owner.pw_uid, owner.pw_gid)
        if release_root.stat().st_mode & 0o022:
            raise context.RemoteBootstrapError("release_directory_unsafe")
        old_pointer, _ = context._read_pointer(pointer_path, component, release_root)
        pointer_snapshot = context._snapshot_regular_file(pointer_path)
        old_root_files: dict[str, tuple[bytes, int, int, int] | None] = {}
        target = release_root / f"{version}-{build_id[:12]}"
        env = context.os.environ.copy()
        for line in unit_text.splitlines():
            if line.startswith("Environment="):
                raw = line[len("Environment="):]
                key, equals, value = raw.partition("=")
                if equals and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                    env.setdefault(key, value.strip('"'))
        context._copy_release(source, target, component, version, build_id,
                              owner.pw_uid, owner.pw_gid, env)
        previous_release = old_pointer.get("release") if old_pointer else None
        new_pointer = {"schema": 1, "release": target.name, "previous_release": previous_release}
        backup_root = (runtime_root.parent / ".treseko-remote-bootstrap-backups"
                       / f"{component}-{uuid.uuid4().hex}")
        backup_root.mkdir(parents=True, mode=0o700)
        worker_lock: tuple[Path, str] | None = None
        if component == "automation-worker":
            worker_lock = context._acquire_worker_update_lock(
                api_base or "", token, runtime_root, owner.pw_uid, owner.pw_gid,
            )
        try:
            for name in context._MANAGED_ROOT_FILES[component]:
                current = runtime_root / name
                old_root_files[name] = context._snapshot_regular_file(current)
                if old_root_files[name] is not None:
                    content, mode, uid, gid = old_root_files[name]
                    backup_file = backup_root / name
                    backup_file.write_bytes(content)
                    context.os.chmod(backup_file, mode)
                    context.os.chown(backup_file, uid, gid)
                payload = (target / name).read_bytes()
                mode = 0o755 if name.endswith((".mjs", ".sh")) else 0o644
                context._atomic_write(current, payload, mode)
                context.os.chown(current, owner.pw_uid, owner.pw_gid)
            context._atomic_write(pointer_path, (json.dumps(new_pointer, sort_keys=True) + "\n").encode(), 0o600)
            context.os.chown(pointer_path, owner.pw_uid, owner.pw_gid)
            context._run(["systemctl", "restart", service], timeout=120)
            if component == "engine":
                healthy = context._wait_engine(engine_health_url or "http://127.0.0.1:3010/health", version)
            else:
                healthy = context._wait_worker(api_base or "", token, version, build_id, service=service)
            if not healthy:
                raise context.RemoteBootstrapError("component_health_check_failed_rollback_applied")
        except Exception:
            rollback_errors: list[str] = []
            try:
                context._restore_regular_file(pointer_path, pointer_snapshot)
            except Exception as rollback_error:
                rollback_errors.append(f"pointer:{type(rollback_error).__name__}")
            for name, snapshot in old_root_files.items():
                try:
                    context._restore_regular_file(runtime_root / name, snapshot)
                except Exception as rollback_error:
                    rollback_errors.append(f"{name}:{type(rollback_error).__name__}")
            try:
                context._run(["systemctl", "restart", service], timeout=120)
            except Exception as rollback_error:
                rollback_errors.append(f"restart:{type(rollback_error).__name__}")
            if worker_lock and not rollback_errors:
                try:
                    context._release_worker_update_lock(api_base or "", token, *worker_lock)
                except Exception as rollback_error:
                    rollback_errors.append(f"update_lock:{type(rollback_error).__name__}")
            if rollback_errors:
                raise context.RemoteBootstrapError("rollback_failed:" + ",".join(rollback_errors))
            raise
        if worker_lock:
            # Keep the Worker fenced until the backend acknowledges release.
            context._release_worker_update_lock(api_base or "", token, *worker_lock)
    return {"ok": True, "component": component, "version": version, "build_id": build_id,
            "service": service, "runtime_root": str(runtime_root), "backup": str(backup_root),
            "identity_preserved": component == "automation-worker"}

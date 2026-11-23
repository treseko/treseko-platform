from __future__ import annotations

import json
import io
import os
from pathlib import Path
import subprocess
import getpass
import tarfile
from types import SimpleNamespace

from app.services import update_legacy_host_migration as migration


def _manifest(version="1.0.8", source="1.0.7"):
    return {
        "version": version, "from_versions": [source],
        "deployment": migration.DEPLOYMENT,
        "host_bridge_bootstrap_verified": True,
        "bootstrap_protocol": migration.PROTOCOL,
        "checksum_sha256": "a" * 64,
    }


def test_signed_contract_accepts_only_the_declared_108_to_1011_legacy_edge(tmp_path, monkeypatch):
    archive = tmp_path / "update.tar.gz"
    archive.write_bytes(b"signed archive placeholder")
    monkeypatch.setattr(migration, "verify_update_manifest_signature", lambda _: (True, None))

    manifest = _manifest(version="1.0.11", source="1.0.8")
    manifest["package_size_bytes"] = archive.stat().st_size
    migration._validate_signed_contract(archive, manifest)

    incompatible = _manifest(version="1.0.11", source="1.0.7")
    incompatible["package_size_bytes"] = archive.stat().st_size
    try:
        migration._validate_signed_contract(archive, incompatible)
        assert False, "expected unsupported source to be rejected"
    except migration.LegacyMigrationError as exc:
        assert str(exc) == "release_not_eligible_for_legacy_migration"


def test_signed_contract_rejects_release_without_bootstrap_protocol(tmp_path, monkeypatch):
    archive = tmp_path / "update.tar.gz"
    archive.write_bytes(b"signed archive placeholder")
    monkeypatch.setattr(migration, "verify_update_manifest_signature", lambda _: (True, None))
    manifest = _manifest(version="1.0.11", source="1.0.8")
    manifest["bootstrap_protocol"] = None
    try:
        migration._validate_signed_contract(archive, manifest)
        assert False, "expected protocol gate to reject this package"
    except migration.LegacyMigrationError as exc:
        assert str(exc) == "release_not_eligible_for_legacy_migration"


def test_single_file_bundle_extracts_only_signed_manifest_and_named_package(tmp_path, monkeypatch):
    package_bytes = b"ota package bytes"
    manifest = _manifest()
    manifest["artifact"] = "treseko-update-v1.0.8.tar.gz"
    manifest["package_size_bytes"] = len(package_bytes)
    monkeypatch.setattr(migration, "verify_update_manifest_signature", lambda _: (True, None))
    bundle_path = tmp_path / "treseko-update-v1.0.8-single-file.tar"
    manifest_bytes = json.dumps(manifest).encode()
    with tarfile.open(bundle_path, "w") as bundle:
        for name, payload in ((manifest["artifact"], package_bytes),
                              ("manifest.json", manifest_bytes)):
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            bundle.addfile(info, io.BytesIO(payload))

    package, manifest_path = migration._unpack_single_file_bundle(bundle_path, tmp_path / "unpacked")
    assert package.read_bytes() == package_bytes
    assert json.loads(manifest_path.read_text()) == manifest


def test_single_file_bundle_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(migration, "verify_update_manifest_signature", lambda _: (True, None))
    bundle_path = tmp_path / "bad.tar"
    payload = b"{}"
    with tarfile.open(bundle_path, "w") as bundle:
        for name in ("../escape", "manifest.json"):
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            bundle.addfile(info, io.BytesIO(payload))
    try:
        migration._unpack_single_file_bundle(bundle_path, tmp_path / "unpacked")
        assert False, "expected unsafe bundle to be rejected"
    except migration.LegacyMigrationError as exc:
        assert str(exc) == "migration_bundle_layout_invalid"


def test_single_file_bundle_rejects_invalid_signature_before_unpacking(tmp_path, monkeypatch):
    package_bytes = b"ota package bytes"
    manifest = _manifest()
    manifest["artifact"] = "update.tar.gz"
    manifest["package_size_bytes"] = len(package_bytes)
    bundle_path = tmp_path / "bundle.tar"
    with tarfile.open(bundle_path, "w") as bundle:
        for name, payload in ((manifest["artifact"], package_bytes),
                              ("manifest.json", json.dumps(manifest).encode())):
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            bundle.addfile(info, io.BytesIO(payload))
    monkeypatch.setattr(migration, "verify_update_manifest_signature", lambda _: (False, "invalid"))
    try:
        migration._unpack_single_file_bundle(bundle_path, tmp_path / "unpacked")
        assert False, "expected invalid signature to be rejected"
    except migration.LegacyMigrationError as exc:
        assert str(exc) == "release_signature_invalid"
    assert not (tmp_path / "unpacked" / "update.tar.gz").exists()


def test_migration_applies_signed_source_then_installs_coordinator(tmp_path, monkeypatch):
    root = tmp_path / "installation"
    root.mkdir()
    env_file = root / "compose.production.env"
    env_file.write_text("private=fixture\n")
    docker = tmp_path / "docker"
    docker.write_text("#!/bin/sh\n")
    docker.chmod(0o755)
    archive = tmp_path / "update.tar.gz"
    archive.write_bytes(b"signed archive placeholder")
    manifest = _manifest(version="1.0.11", source="1.0.8")
    manifest["artifact"] = archive.name
    manifest["package_size_bytes"] = archive.stat().st_size
    bundle_path = tmp_path / "single-file-bundle.tar"
    with tarfile.open(bundle_path, "w") as bundle:
        bundle.add(archive, arcname=archive.name)
        encoded_manifest = json.dumps(manifest).encode()
        info = tarfile.TarInfo("manifest.json")
        info.size = len(encoded_manifest)
        bundle.addfile(info, io.BytesIO(encoded_manifest))

    monkeypatch.setattr(migration, "verify_update_manifest_signature", lambda _: (True, None))
    monkeypatch.setattr(migration, "_active_version", lambda _: "1.0.8")
    monkeypatch.setattr(migration, "inspect_legacy_installation", lambda _: {
        "status": "preflight_passed", "operational": False,
        "bootstrap_candidate": {"compose_project": "treseko-qa",
                                "compose_working_dir": str(root)},
    })

    def stage(_archive, _manifest, destination):
        destination.mkdir(parents=True)
        (destination / "manifest.json").write_text(json.dumps({
            "version": "1.0.11", "from_versions": ["1.0.8"],
            "deployment": migration.DEPLOYMENT,
            "bootstrap_protocol": migration.PROTOCOL,
        }))
        (destination / "update-plan.json").write_text(json.dumps({
            "version": "1.0.11", "previous_versions": ["1.0.8"],
            "deployment": migration.DEPLOYMENT,
            "bootstrap_protocol": migration.PROTOCOL,
        }))
        source = destination / "source-release"
        (source / "scripts").mkdir(parents=True)
        (source / "scripts" / "atomic_local_update.py").write_text("# fixture\n")
        return destination

    monkeypatch.setattr(migration, "stage_verified_package", stage)
    calls = []

    def run(argv, *, timeout, env=None):
        calls.append(argv)
        if "atomic_local_update.py" in argv[1]:
            state_dir = root / ".treseko-local" / "update-transactions"
            state_dir.mkdir(parents=True)
            (state_dir / "migration-test.json").write_text(json.dumps({"phase": "committed"}))
            release = root / ".treseko-local" / "releases" / "release-1011"
            release.mkdir(parents=True)
            (release / "VERSION").write_text("1.0.11\n")
            pointer = root / ".treseko-local" / "active-release.json"
            pointer.write_text(json.dumps({"version": "1.0.11", "release": "release-1011"}))
        return subprocess.CompletedProcess(argv, 0, "{}", "")

    monkeypatch.setattr(migration, "_run", run)
    result = migration.migrate(install_root=root, env_file=env_file, docker=str(docker),
                               archive=bundle_path,
                               transaction="migration-test")
    assert result["phase"] == "committed"
    assert result["version"] == "1.0.11"
    assert result["coordinator"] == "installed"
    assert len(calls) == 2
    assert "--expected-project-root" in calls[0]
    assert "--source-release-root" in calls[1]


def test_native_migration_stages_one_signed_bundle_and_waits_for_entrypoint_receipt(tmp_path, monkeypatch):
    root = tmp_path / "treseko"
    (root / "backend").mkdir(parents=True)
    (root / "backend" / "entrypoint.sh").write_text("#!/bin/sh\n")
    (root / "frontend" / "html").mkdir(parents=True)
    (root / "engine").mkdir()
    (root / "worker").mkdir()
    (root / "data").mkdir()
    (root / "VERSION").write_text("1.0.7\n")
    archive = tmp_path / "treseko-update-v1.0.8.tar.gz"
    archive.write_bytes(b"signed archive placeholder")
    manifest_path = tmp_path / "manifest.json"
    manifest = _manifest()
    manifest.update({"artifact": archive.name, "package_size_bytes": archive.stat().st_size})
    manifest_path.write_text(json.dumps(manifest))

    monkeypatch.setattr(migration, "verify_update_manifest_signature", lambda _: (True, None))
    monkeypatch.setattr(migration, "_native_systemd_preflight", lambda *_: (1000, 1000))
    monkeypatch.setattr(migration, "_prepare_native_update_staging", lambda *_: None)
    preparation_order = []
    monkeypatch.setattr(migration, "_prepare_native_component_dependencies",
                        lambda *_: preparation_order.append("dependencies"))
    monkeypatch.setattr(migration, "_prepare_native_worker_restart",
                        lambda *_: preparation_order.append("worker-restart"))
    monkeypatch.setattr(migration, "_ensure_native_engine_ready",
                        lambda *_: (preparation_order.append("engine-ready")
                                    or "treseko-engine.service"))
    monkeypatch.setattr(migration, "_prepare_legacy_systemd_entrypoint",
                        lambda *_: preparation_order.append("legacy-entrypoint"))

    def stage(_archive, _manifest, destination):
        destination.mkdir(parents=True)
        (destination / "source-release").mkdir()
        (destination / "source-release" / "VERSION").write_text("1.0.8\n")
        return destination

    monkeypatch.setattr(migration, "stage_verified_package", stage)
    monkeypatch.setattr(
        "app.services.update_package_preflight.validate_update_package", lambda _root: None
    )
    calls = []

    def run(argv, *, timeout, env=None):
        calls.append(argv)
        if argv[:2] == ["systemctl", "restart"]:
            updates = root / "data" / "updates"
            if argv[-1] == "treseko-engine.service":
                (root / "engine" / ".treseko-update-restart").unlink()
                return subprocess.CompletedProcess(argv, 0, "", "")
            for relative in ("VERSION", "frontend/html/VERSION", "engine/VERSION", "worker/VERSION"):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("1.0.8\n")
            (root / "engine" / ".treseko-update-restart").touch()
            (updates / "update-applied").write_text(json.dumps({
                "task_id": transaction, "version": "1.0.8",
            }))
            (updates / "update-ready").unlink()
        return subprocess.CompletedProcess(argv, 0, "active", "")

    monkeypatch.setattr(migration, "_run", run)
    transaction = "native-migration-test"
    result = migration.migrate_native_systemd(
        install_root=root, archive=archive, manifest_path=manifest_path,
        transaction=transaction, timeout_seconds=1,
    )

    assert result["phase"] == "committed"
    assert result["mode"] == "systemd-native"
    assert result["components"] == ["backend", "frontend", "engine", "automation-worker"]
    assert calls == [
        ["systemctl", "restart", "treseko-backend.service"],
        ["systemctl", "restart", "treseko-engine.service"],
        ["systemctl", "is-active", "treseko-backend.service"],
    ]
    assert preparation_order == ["dependencies", "engine-ready", "worker-restart", "legacy-entrypoint"]
    assert not (root / "data" / "updates" / "update-ready").exists()


def test_native_legacy_entrypoint_patches_only_docker_uid_chown_and_keeps_backup(tmp_path):
    root = tmp_path / "treseko"
    entrypoint = root / "backend" / "entrypoint.sh"
    entrypoint.parent.mkdir(parents=True)
    original = '#!/bin/sh\n  chown -R 10001:10001 "$ENGINE_DIR"\n'
    entrypoint.write_text(original)
    updates = root / "data" / "updates"
    updates.mkdir(parents=True)

    migration._prepare_legacy_systemd_entrypoint(
        root, updates, "native-test", os.getuid(), os.getgid()
    )

    assert entrypoint.read_text() == (
        '#!/bin/sh\n  if [ "${TRESEKO_DEPLOY_MODE:-docker}" = "docker" ]; then\n'
        '    chown -R 10001:10001 "$ENGINE_DIR"\n  fi\n'
    )
    backup = updates / "native-bootstrap-backups" / "native-test" / "entrypoint.sh"
    assert backup.read_text() == original
    assert backup.stat().st_mode & 0o777 == 0o600
    migration._prepare_legacy_systemd_entrypoint(
        root, updates, "native-test-repeat", os.getuid(), os.getgid()
    )
    assert not (updates / "native-bootstrap-backups" / "native-test-repeat").exists()


def test_native_dependency_preparation_runs_npm_as_service_user(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    engine = staged / "engine"
    worker = staged / "automation-worker"
    engine.mkdir(parents=True)
    worker.mkdir()
    (engine / "package-lock.json").write_text("{}")
    (worker / "package-lock.json").write_text("{}")
    root = tmp_path / "treseko"
    (root / "data").mkdir(parents=True)
    monkeypatch.setattr(migration.shutil, "which", lambda _: "/usr/bin/npm")
    monkeypatch.setattr(migration.pwd, "getpwuid", lambda _: SimpleNamespace(pw_dir="/home/treseko"))
    monkeypatch.setattr(migration.os, "chown", lambda *_: None)
    monkeypatch.setattr(migration, "_chown_tree", lambda *_: None)
    calls = []

    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        if argv[2] == str(engine):
            cli = engine / "node_modules" / "tsx" / "dist" / "cli.mjs"
            cli.parent.mkdir(parents=True)
            cli.write_text("// fixture")
        return subprocess.CompletedProcess(argv, 0, "", "")

    monkeypatch.setattr(migration.subprocess, "run", run)
    migration._prepare_native_component_dependencies(staged, root, 1234, 5678)

    assert len(calls) == 2
    assert all(call[1]["user"] == 1234 and call[1]["group"] == 5678 for call in calls)
    assert calls[0][1]["env"]["PLAYWRIGHT_BROWSERS_PATH"] == str(root / "data" / "ms-playwright")
    assert calls[0][1]["env"]["HOME"] == "/home/treseko"
    assert calls[0][1]["env"]["npm_config_cache"] == str(root / "data" / "update-npm-cache")
    assert "SSH_AUTH_SOCK" not in calls[0][1]["env"]
    assert calls[1][1]["env"]["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"] == "1"
    assert calls[1][1]["env"]["CYPRESS_INSTALL_BINARY"] == "0"


def test_native_worker_restart_installs_the_ota_dropin_with_configured_unit(tmp_path, monkeypatch):
    source = tmp_path / "source-release"
    script = source / "scripts" / "bootstrap_native_worker_restart.sh"
    script.parent.mkdir(parents=True)
    script.write_text("#!/bin/bash\n")
    monkeypatch.setenv("TRESEKO_WORKER_SYSTEMD_UNIT", "custom-worker.service")
    calls = []
    monkeypatch.setattr(migration, "_run", lambda argv, **kwargs: (
        calls.append((argv, kwargs)) or subprocess.CompletedProcess(argv, 0, "", "")
    ))

    migration._prepare_native_worker_restart(source)

    assert calls[0][0] == ["bash", str(script)]
    assert calls[0][1]["env"]["TRESEKO_WORKER_UNIT"] == "custom-worker.service"


def test_native_migration_starts_inactive_engine_and_waits_for_current_health(tmp_path, monkeypatch):
    root = tmp_path / "treseko"
    (root / "engine").mkdir(parents=True)
    (root / "engine" / "VERSION").write_text("1.0.7\n")
    states = iter((subprocess.CompletedProcess([], 3, "inactive", ""),
                   subprocess.CompletedProcess([], 0, "active", "")))
    calls = []

    def run(argv, **kwargs):
        calls.append(argv)
        if argv[:2] == ["systemctl", "is-active"]:
            return next(states)
        if argv[:2] == ["systemctl", "show"]:
            return subprocess.CompletedProcess(argv, 0, "Environment=ENGINE_PORT=13010", "")
        return subprocess.CompletedProcess(argv, 0, "", "")

    class HealthResponse(io.BytesIO):
        pass

    monkeypatch.setattr(migration, "_run", run)
    monkeypatch.setattr(migration, "urlopen", lambda url, timeout: (
        calls.append([url]) or HealthResponse(b'{"version":"1.0.7"}')
    ))
    unit = migration._ensure_native_engine_ready(root)

    assert unit == "treseko-engine.service"
    assert ["systemctl", "start", "treseko-engine.service"] in calls
    assert ["http://127.0.0.1:13010/health"] in calls


def test_native_migration_rejects_incompatible_origin_before_staging(tmp_path, monkeypatch):
    root = tmp_path / "treseko"
    root.mkdir()
    (root / "VERSION").write_text("1.0.6\n")
    archive = tmp_path / "update.tar.gz"
    archive.write_bytes(b"archive")
    manifest_path = tmp_path / "manifest.json"
    manifest = _manifest()
    manifest.update({"artifact": archive.name, "package_size_bytes": archive.stat().st_size})
    manifest_path.write_text(json.dumps(manifest))
    monkeypatch.setattr(migration, "verify_update_manifest_signature", lambda _: (True, None))
    monkeypatch.setattr(migration, "_native_systemd_preflight", lambda *_: None)
    calls = []
    monkeypatch.setattr(migration, "stage_verified_package", lambda *_: calls.append(True))

    try:
        migration.migrate_native_systemd(
            install_root=root, archive=archive, manifest_path=manifest_path,
            transaction="native-bad-origin",
        )
        assert False, "expected unsupported native origin to be rejected"
    except migration.LegacyMigrationError as exc:
        assert str(exc) == "native_migration_source_version_unsupported"
    assert calls == []


def test_native_systemd_preflight_requires_service_paths_to_match_install_root(tmp_path, monkeypatch):
    root = tmp_path / "treseko"
    (root / "backend").mkdir(parents=True)
    (root / "backend" / "entrypoint.sh").write_text("#!/bin/sh\n")
    (root / "frontend" / "html").mkdir(parents=True)
    monkeypatch.setattr(migration.os, "geteuid", lambda: 0)
    monkeypatch.setattr(migration.sys, "platform", "linux")
    monkeypatch.setattr(migration.os, "name", "posix")

    valid_environment = {
        "TRESEKO_DEPLOY_MODE": "systemd",
        "TRESEKO_APP_DIR": str(root / "backend"),
        "TRESEKO_VERSION_FILE": str(root / "VERSION"),
        "TRESEKO_FRONTEND_DIR": str(root / "frontend" / "html"),
        "TRESEKO_ENGINE_DIR": str(root / "engine"),
        "TRESEKO_WORKER_DIR": str(root / "worker"),
        "UPDATES_DIR": str(root / "data" / "updates"),
        "CHECK_PENDING_UPDATE": "true",
    }
    show_output = (
        "ActiveState=active\n"
        f"ExecStart={{ path={root}/backend/entrypoint.sh ; argv[]=/bin/sh {root}/backend/entrypoint.sh ; }}\n"
        f"User={getpass.getuser()}\n"
        + "Environment=" + " ".join(f"{key}={value}" for key, value in valid_environment.items()) + "\n"
    )
    monkeypatch.setattr(migration, "_run", lambda *_args, **_kwargs:
                        subprocess.CompletedProcess([], 0, show_output, ""))

    migration._native_systemd_preflight(root, "treseko-backend.service")

    bad_output = show_output.replace(f"TRESEKO_WORKER_DIR={root}/worker",
                                     "TRESEKO_WORKER_DIR=/srv/other/worker")
    monkeypatch.setattr(migration, "_run", lambda *_args, **_kwargs:
                        subprocess.CompletedProcess([], 0, bad_output, ""))
    try:
        migration._native_systemd_preflight(root, "treseko-backend.service")
        assert False, "expected a mismatched unit path to be rejected"
    except migration.LegacyMigrationError as exc:
        assert str(exc) == "native_systemd_mode_not_declared"


def test_native_staging_is_private_and_owned_by_backend_account(tmp_path):
    updates = tmp_path / "data" / "updates"
    extracted = updates / "extracted"
    extracted.mkdir(parents=True)
    migration._prepare_native_update_staging(
        updates, extracted, migration.os.getuid(), migration.os.getgid()
    )
    assert updates.stat().st_mode & 0o777 == 0o700
    assert extracted.stat().st_mode & 0o777 == 0o700
    assert updates.stat().st_uid == migration.os.getuid()
    assert extracted.stat().st_uid == migration.os.getuid()

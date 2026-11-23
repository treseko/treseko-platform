"""Verified host-side migration from legacy Treseko installations.

Compose installations use the transactional updater and install the host
coordinator. Linux/systemd installations use a one-time bridge because their
legacy embedded updater cannot start a complete-source migration itself.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import pwd  # re-exported for compatibility with migration-focused tests
import re
import shutil  # re-exported for compatibility with migration-focused tests
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from typing import Any
from urllib.request import urlopen

from .edition.update_manager import verify_update_manifest_signature
from .update_host_bootstrap_preflight import inspect_legacy_installation
from .update_participant_package import stage_verified_package
from .update_legacy_migration_support import (
    LegacyMigrationError,
    _chown_tree,
    _ensure_native_engine_ready as _native_ensure_engine_ready,
    _native_systemd_preflight as _native_preflight,
    _prepare_legacy_systemd_entrypoint as _native_prepare_entrypoint,
    _prepare_native_component_dependencies as _native_prepare_dependencies,
    _prepare_native_worker_restart as _native_prepare_worker_restart,
    _prepare_native_update_staging as _native_prepare_staging,
)

PROTOCOL = "treseko-host-update-coordinator/v1"
DEPLOYMENT = {"mode": "complete-source", "path": "source-release",
              "compose_file": "docker-compose.prod.yml", "activation": "atomic-compose"}
# Keep legacy migration edges explicit. A complete-source release is not safe
# to apply from an arbitrary older runtime just because its version appears in
# the general OTA compatibility list.
SUPPORTED_LEGACY_MIGRATIONS = {"1.0.8": "1.0.7", "1.0.11": "1.0.8"}
_TRANSACTION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")




def _read_json(path: Path, *, max_bytes: int = 1024 * 1024) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > max_bytes:
        raise LegacyMigrationError("migration_input_unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError) as exc:
        raise LegacyMigrationError("migration_input_invalid") from exc
    if not isinstance(value, dict):
        raise LegacyMigrationError("migration_input_invalid")
    return value


def _active_version(root: Path) -> str | None:
    pointer_path = root / ".treseko-local" / "active-release.json"
    if pointer_path.is_symlink():
        raise LegacyMigrationError("active_release_pointer_unsafe")
    if pointer_path.is_file():
        pointer = _read_json(pointer_path, max_bytes=64 * 1024)
        version, release = pointer.get("version"), pointer.get("release")
        if (not isinstance(version, str) or not isinstance(release, str)
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,100}", release)):
            raise LegacyMigrationError("active_release_pointer_invalid")
        active = root / ".treseko-local" / "releases" / release
        if active.is_symlink() or not active.is_dir():
            raise LegacyMigrationError("active_release_missing")
        if (active / "VERSION").read_text(encoding="utf-8").strip() != version:
            raise LegacyMigrationError("active_release_version_mismatch")
        return version
    legacy_version = root / "VERSION"
    if legacy_version.is_file() and not legacy_version.is_symlink():
        return legacy_version.read_text(encoding="utf-8").strip()
    return None


def _validate_signed_contract(archive: Path, manifest: dict[str, Any]) -> None:
    valid, error = verify_update_manifest_signature(manifest)
    if not valid:
        raise LegacyMigrationError("release_signature_invalid" if error else "release_signature_missing")
    version = manifest.get("version")
    source_version = SUPPORTED_LEGACY_MIGRATIONS.get(str(version))
    if (source_version is None
            or manifest.get("from_versions") != [source_version]
            or manifest.get("deployment") != DEPLOYMENT
            or manifest.get("host_bridge_bootstrap_verified") is not True
            or manifest.get("bootstrap_protocol") != PROTOCOL):
        raise LegacyMigrationError("release_not_eligible_for_legacy_migration")
    checksum = manifest.get("checksum_sha256")
    size = manifest.get("package_size_bytes")
    if (not re.fullmatch(r"[a-f0-9]{64}", str(checksum or ""))
            or type(size) is not int or size <= 0):
        raise LegacyMigrationError("release_archive_contract_invalid")
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size != size:
        raise LegacyMigrationError("release_archive_unsafe")


def _unpack_single_file_bundle(bundle: Path, destination: Path) -> tuple[Path, Path]:
    """Read a one-download migration bundle without extracting untrusted paths."""
    if bundle.is_symlink() or not bundle.is_file():
        raise LegacyMigrationError("migration_bundle_unsafe")
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.is_symlink() or not destination.is_dir():
        raise LegacyMigrationError("migration_bundle_unsafe")
    try:
        with tarfile.open(bundle, "r:") as archive:
            members = archive.getmembers()
            if len(members) != 2:
                raise LegacyMigrationError("migration_bundle_layout_invalid")
            by_name: dict[str, tarfile.TarInfo] = {}
            for member in members:
                name = member.name.removeprefix("./")
                if name in by_name or not member.isfile() or member.issym() or member.islnk():
                    raise LegacyMigrationError("migration_bundle_layout_invalid")
                by_name[name] = member
            manifest_member = by_name.get("manifest.json")
            if manifest_member is None or manifest_member.size > 1024 * 1024:
                raise LegacyMigrationError("migration_bundle_layout_invalid")
            manifest_stream = archive.extractfile(manifest_member)
            if manifest_stream is None:
                raise LegacyMigrationError("migration_bundle_layout_invalid")
            try:
                manifest_value = json.loads(manifest_stream.read().decode("utf-8"))
            except (ValueError, UnicodeError) as exc:
                raise LegacyMigrationError("migration_input_invalid") from exc
            if not isinstance(manifest_value, dict):
                raise LegacyMigrationError("migration_input_invalid")
            signature_valid, signature_error = verify_update_manifest_signature(manifest_value)
            if not signature_valid:
                raise LegacyMigrationError(
                    "release_signature_invalid" if signature_error else "release_signature_missing")
            artifact_name = manifest_value.get("artifact")
            if (not isinstance(artifact_name, str) or "/" in artifact_name
                    or "\\" in artifact_name or artifact_name in {"", ".", ".."}
                    or set(by_name) != {"manifest.json", artifact_name}):
                raise LegacyMigrationError("migration_bundle_layout_invalid")
            artifact_member = by_name[artifact_name]
            expected_size = manifest_value.get("package_size_bytes")
            if (type(expected_size) is not int or expected_size <= 0
                    or expected_size > 20 * 1024**3 or artifact_member.size != expected_size):
                raise LegacyMigrationError("release_archive_contract_invalid")
            package_path = destination / artifact_name
            manifest_path = destination / "manifest.json"
            for member, output in ((artifact_member, package_path), (manifest_member, manifest_path)):
                stream = archive.extractfile(member)
                if stream is None:
                    raise LegacyMigrationError("migration_bundle_layout_invalid")
                with output.open("xb") as target:
                    while chunk := stream.read(1024 * 1024):
                        target.write(chunk)
            return package_path, manifest_path
    except (tarfile.TarError, OSError) as exc:
        raise LegacyMigrationError("migration_bundle_invalid") from exc


def _run(argv: list[str], *, timeout: int,
         env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(argv, capture_output=True, text=True, check=False,
                              timeout=timeout, env=env or os.environ.copy())
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LegacyMigrationError("migration_process_failed_or_timed_out") from exc


def migrate(*, install_root: Path, env_file: Path, docker: str, archive: Path,
            manifest_path: Path | None = None, transaction: str | None = None) -> dict[str, Any]:
    archive = archive.resolve(strict=True)
    if manifest_path is None:
        with tempfile.TemporaryDirectory(prefix="treseko-legacy-update-") as temporary:
            package_path, embedded_manifest = _unpack_single_file_bundle(archive, Path(temporary))
            return migrate(install_root=install_root, env_file=env_file, docker=docker,
                           archive=package_path, manifest_path=embedded_manifest,
                           transaction=transaction)
    root = install_root.resolve(strict=True)
    env_path = env_file.resolve(strict=True)
    docker_path = Path(docker).resolve(strict=True)
    archive = archive.resolve(strict=True)
    manifest = _read_json(manifest_path.resolve(strict=True))
    _validate_signed_contract(archive, manifest)
    version = str(manifest["version"])
    transaction = transaction or f"legacy-{uuid.uuid4().hex}"
    if not _TRANSACTION.fullmatch(transaction):
        raise LegacyMigrationError("migration_transaction_invalid")

    preflight = inspect_legacy_installation({
        "schema": 1, "docker": str(docker_path),
        "project_root": str(root), "env_file": str(env_path),
    })
    if preflight.get("status") != "preflight_passed" or preflight.get("operational") is not False:
        raise LegacyMigrationError("legacy_installation_preflight_failed")
    candidate_info = preflight.get("bootstrap_candidate")
    if not isinstance(candidate_info, dict):
        raise LegacyMigrationError("legacy_installation_identity_missing")

    active_version = _active_version(root)
    allowed_sources = manifest.get("from_versions")
    if active_version != version and (not isinstance(allowed_sources, list)
                                      or active_version not in allowed_sources):
        raise LegacyMigrationError("installed_version_not_in_signed_source_set")
    source_version = SUPPORTED_LEGACY_MIGRATIONS.get(version)
    if source_version is None or active_version not in {source_version, version}:
        raise LegacyMigrationError("legacy_migration_source_version_unsupported")

    state_root = root / ".treseko-local" / "bootstrap-stages"
    state_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if state_root.is_symlink() or not state_root.is_dir():
        raise LegacyMigrationError("migration_state_root_unsafe")
    try:
        state_root.chmod(0o700)
    except OSError as exc:
        raise LegacyMigrationError("migration_state_root_unsafe") from exc
    stage = state_root / f"{transaction}-{manifest['checksum_sha256']}"
    if stage.exists():
        raise LegacyMigrationError("migration_stage_exists_review_required")
    staged = stage_verified_package(archive, manifest, stage)
    source = staged / "source-release"
    internal = _read_json(staged / "manifest.json")
    plan = _read_json(staged / "update-plan.json")
    if (internal.get("version") != version or internal.get("from_versions") != allowed_sources
            or internal.get("deployment") != DEPLOYMENT or internal.get("bootstrap_protocol") != PROTOCOL
            or plan.get("version") != version or plan.get("previous_versions") != allowed_sources
            or plan.get("deployment") != DEPLOYMENT or plan.get("bootstrap_protocol") != PROTOCOL):
        raise LegacyMigrationError("signed_release_contract_mismatch")

    if active_version != version:
        atomic_updater = source / "scripts" / "atomic_local_update.py"
        command = [sys.executable, str(atomic_updater), "--docker", str(docker_path),
                   "--project", str(candidate_info["compose_project"]),
                   "--candidate-root", str(source), "--install-root", str(root),
                   "--env-file", str(env_path), "--version", version,
                   "--transaction", transaction, "--expected-project-root",
                   str(candidate_info["compose_working_dir"])]
        applied = _run(command, timeout=3 * 60 * 60)
        state = _read_json(root / ".treseko-local" / "update-transactions" / f"{transaction}.json",
                           max_bytes=4 * 1024 * 1024) if (root / ".treseko-local" / "update-transactions" / f"{transaction}.json").is_file() else {}
        if applied.returncode != 0 or state.get("phase") != "committed":
            raise LegacyMigrationError("atomic_application_failed_or_needs_reconciliation")

    pointer = _read_json(root / ".treseko-local" / "active-release.json", max_bytes=64 * 1024)
    release_root = root / ".treseko-local" / "releases" / str(pointer.get("release") or "")
    if pointer.get("version") != version or release_root.is_symlink() or not release_root.is_dir():
        raise LegacyMigrationError("committed_release_not_active")
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(release_root / "backend") + os.pathsep + environment.get("PYTHONPATH", "")
    environment["TRESEKO_HOST_BOOTSTRAP_PROTOCOL"] = PROTOCOL
    installed = _run([sys.executable, "-m", "app.services.update_host_coordinator_cli",
                      "install", "--install-root", str(root), "--env-file", str(env_path),
                      "--docker", str(docker_path), "--source-release-root", str(release_root)],
                     timeout=60 * 60, env=environment)
    if installed.returncode != 0:
        # The app transaction is committed and healthy; retrying this command
        # is safe and finishes the independent coordinator installation.
        raise LegacyMigrationError("application_committed_coordinator_install_pending")
    return {"ok": True, "phase": "committed", "version": version,
            "project": candidate_info["compose_project"], "coordinator": "installed",
            "transaction": transaction}


def _native_systemd_preflight(root: Path, service: str) -> tuple[int, int]:
    return _native_preflight(root, service, _run)


def _prepare_native_update_staging(updates: Path, extracted_root: Path,
                                   service_uid: int, service_gid: int) -> None:
    return _native_prepare_staging(updates, extracted_root, service_uid, service_gid)














def _prepare_native_component_dependencies(staged: Path, root: Path,
                                          service_uid: int, service_gid: int) -> None:
    return _native_prepare_dependencies(staged, root, service_uid, service_gid)


def _ensure_native_engine_ready(root: Path) -> str:
    return _native_ensure_engine_ready(root, _run, urlopen)


def _prepare_native_worker_restart(source_release: Path) -> None:
    return _native_prepare_worker_restart(source_release, _run)


def _prepare_legacy_systemd_entrypoint(root: Path, updates: Path, transaction: str,
                                      service_uid: int, service_gid: int) -> None:
    return _native_prepare_entrypoint(root, updates, transaction, service_uid, service_gid)


def _native_component_versions(root: Path, version: str) -> bool:
    expected = {
        root / "VERSION": version,
        root / "frontend" / "html" / "VERSION": version,
        root / "engine" / "VERSION": version,
        root / "worker" / "VERSION": version,
    }
    try:
        return all(path.is_file() and not path.is_symlink()
                   and path.read_text(encoding="utf-8").strip() == value
                   for path, value in expected.items())
    except (OSError, UnicodeError):
        return False


def migrate_native_systemd(*, install_root: Path, archive: Path,
                           manifest_path: Path | None = None,
                           service: str = "treseko-backend.service",
                           transaction: str | None = None,
                           timeout_seconds: int = 3 * 60 * 60) -> dict[str, Any]:
    """Apply the same signed OTA to a legacy bare-metal systemd installation.

    This is a one-time host-side bridge for 1.0.7, whose embedded updater
    cannot dispatch a complete-source release. The existing entrypoint performs
    the backup, migration, component convergence and rollback.
    """
    archive = archive.resolve(strict=True)
    if manifest_path is None:
        with tempfile.TemporaryDirectory(prefix="treseko-native-ota-") as temporary:
            package, embedded_manifest = _unpack_single_file_bundle(archive, Path(temporary))
            return migrate_native_systemd(
                install_root=install_root, archive=package,
                manifest_path=embedded_manifest, service=service,
                transaction=transaction, timeout_seconds=timeout_seconds,
            )
    root = install_root.resolve(strict=True)
    manifest = _read_json(manifest_path.resolve(strict=True))
    _validate_signed_contract(archive, manifest)
    version = str(manifest["version"])
    transaction = transaction or f"native-{uuid.uuid4().hex}"
    if not _TRANSACTION.fullmatch(transaction):
        raise LegacyMigrationError("migration_transaction_invalid")
    active_version = _active_version(root)
    source_version = SUPPORTED_LEGACY_MIGRATIONS.get(version)
    if source_version is None or active_version != source_version:
        raise LegacyMigrationError("native_migration_source_version_unsupported")

    service_uid, service_gid = _native_systemd_preflight(root, service)
    data_root = root / "data"
    if data_root.is_symlink() or not data_root.is_dir():
        raise LegacyMigrationError("native_updates_path_unsafe")
    updates = root / "data" / "updates"
    updates.mkdir(parents=True, exist_ok=True, mode=0o700)
    if updates.is_symlink() or not updates.is_dir():
        raise LegacyMigrationError("native_updates_path_unsafe")
    ready = updates / "update-ready"
    if ready.exists() or ready.is_symlink():
        raise LegacyMigrationError("native_update_already_pending")
    extracted_root = updates / "extracted"
    extracted_root.mkdir(mode=0o700, exist_ok=True)
    if extracted_root.is_symlink() or not extracted_root.is_dir():
        raise LegacyMigrationError("native_staging_path_unsafe")
    stage = extracted_root / f"{version}-{transaction}-{manifest['checksum_sha256']}"
    if stage.exists() or stage.is_symlink():
        raise LegacyMigrationError("migration_stage_exists_review_required")
    staged = stage_verified_package(archive, manifest, stage)
    if not (staged / "source-release" / "VERSION").is_file():
        raise LegacyMigrationError("signed_release_source_tree_missing")
    if (staged / "source-release" / "VERSION").read_text(encoding="utf-8").strip() != version:
        raise LegacyMigrationError("signed_release_source_version_mismatch")
    from .update_package_preflight import validate_update_package
    try:
        validate_update_package(staged)
    except Exception as exc:
        raise LegacyMigrationError("native_update_package_preflight_failed") from exc
    source_release = staged / "source-release"
    _prepare_native_component_dependencies(staged, root, service_uid, service_gid)
    engine_unit = _ensure_native_engine_ready(root)
    _prepare_native_worker_restart(source_release)
    _prepare_legacy_systemd_entrypoint(root, updates, transaction, service_uid, service_gid)
    _prepare_native_update_staging(updates, extracted_root, service_uid, service_gid)

    payload = json.dumps({"path": str(staged), "task_id": transaction, "version": version},
                         sort_keys=True).encode("utf-8")
    temporary_flag = updates / f"update-ready.{transaction}.tmp"
    try:
        with temporary_flag.open("xb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        temporary_flag.chmod(0o644)
        os.replace(temporary_flag, ready)
    except OSError as exc:
        temporary_flag.unlink(missing_ok=True)
        raise LegacyMigrationError("native_update_marker_write_failed") from exc

    restarted = _run(["systemctl", "restart", service], timeout=timeout_seconds)
    if restarted.returncode != 0:
        raise LegacyMigrationError("native_update_restart_failed_review_required")
    applied = updates / "update-applied"
    failed = updates / "update-failed"
    engine_restart_requested = False
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        engine_restart_marker = root / "engine" / ".treseko-update-restart"
        if engine_restart_marker.is_symlink():
            raise LegacyMigrationError("native_engine_restart_marker_unsafe")
        if engine_restart_marker.is_file() and not engine_restart_requested:
            engine_restart = _run(["systemctl", "restart", engine_unit], timeout=120)
            if engine_restart.returncode != 0:
                raise LegacyMigrationError("native_engine_restart_failed_review_required")
            engine_restart_requested = True
        if failed.is_file() and not failed.is_symlink():
            raise LegacyMigrationError("native_update_failed_rollback_review_required")
        if applied.is_file() and not applied.is_symlink():
            try:
                receipt = _read_json(applied, max_bytes=64 * 1024)
            except LegacyMigrationError:
                receipt = {}
            if receipt.get("task_id") == transaction and receipt.get("version") == version:
                if not _native_component_versions(root, version):
                    raise LegacyMigrationError("native_update_component_convergence_failed")
                state = _run(["systemctl", "is-active", service], timeout=20)
                if state.returncode != 0 or state.stdout.strip() != "active":
                    raise LegacyMigrationError("native_backend_service_not_active")
                return {"ok": True, "phase": "committed", "version": version,
                        "mode": "systemd-native", "transaction": transaction,
                        "components": ["backend", "frontend", "engine", "automation-worker"]}
        time.sleep(1)
    raise LegacyMigrationError("native_update_timeout_review_required")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install-root", required=True, type=Path)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--docker")
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--manifest", type=Path,
                        help="Manifiesto firmado; omítelo si --package es un bundle descargable único.")
    parser.add_argument("--transaction")
    parser.add_argument("--native-systemd", action="store_true",
                        help="Aplica el OTA desde el host a la instalación bare-metal systemd.")
    parser.add_argument("--service", default="treseko-backend.service")
    args = parser.parse_args(argv)
    try:
        if args.native_systemd:
            result = migrate_native_systemd(
                install_root=args.install_root, archive=args.package,
                manifest_path=args.manifest, service=args.service,
                transaction=args.transaction,
            )
        else:
            if args.env_file is None or not args.docker:
                raise LegacyMigrationError("compose_migration_arguments_required")
            result = migrate(install_root=args.install_root, env_file=args.env_file,
                             docker=args.docker, archive=args.package,
                             manifest_path=args.manifest, transaction=args.transaction)
    except Exception as exc:
        error = str(exc) if isinstance(exc, LegacyMigrationError) else "legacy_migration_failed"
        print(json.dumps({"ok": False, "error": error}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

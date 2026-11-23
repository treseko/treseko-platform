from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.update_host_bridge_client import (
    CoordinatedBridgeClient,
    CoordinatedBridgeError,
    CoordinatedBridgeSettings,
)


def _settings(tmp_path):
    request, packages, reports = (tmp_path / name for name in ("requests", "packages", "reports"))
    for path in (request, packages, reports):
        path.mkdir(mode=0o750)
    return CoordinatedBridgeSettings(request, packages, reports, os.getuid(), os.getgid()), request, reports


def test_coordinated_settings_fail_closed_when_environment_is_incomplete(monkeypatch):
    for name in ("TRESEKO_UPDATE_REQUEST_INBOX", "TRESEKO_UPDATE_PACKAGE_INBOX",
                 "TRESEKO_UPDATE_REPORT_DIR", "TRESEKO_UPDATE_REQUEST_UID",
                 "TRESEKO_UPDATE_REQUEST_GID"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(CoordinatedBridgeError, match="coordinated_settings_missing"):
        CoordinatedBridgeSettings.from_environment()


def test_coordinated_settings_accepts_host_owned_spool_directories(tmp_path, monkeypatch):
    request, packages, reports = (tmp_path / name for name in ("requests", "packages", "reports"))
    for path in (request, packages, reports):
        path.mkdir(mode=0o750)
    host_uid = os.getuid() + 12000
    original_lstat = Path.lstat
    original_stat = Path.stat
    host_owned = {request, packages, reports}

    def lstat_with_host_owner(path):
        info = original_lstat(path)
        if path in host_owned:
            fields = list(info)
            fields[4] = host_uid
            return os.stat_result(fields)
        return info

    def stat_with_host_owner(path, **kwargs):
        info = original_stat(path, **kwargs)
        if path in host_owned:
            fields = list(info)
            fields[4] = host_uid
            return os.stat_result(fields)
        return info

    monkeypatch.setattr(Path, "lstat", lstat_with_host_owner)
    monkeypatch.setattr(Path, "stat", stat_with_host_owner)
    settings = CoordinatedBridgeSettings(request, packages, reports, host_uid, os.getgid())
    assert settings.request_inbox == request
    assert settings.package_inbox == packages
    assert settings.report_dir == reports


def test_staged_package_is_transferred_to_configured_host_uid(tmp_path, monkeypatch):
    settings, _, _ = _settings(tmp_path)
    settings.request_uid = os.getuid() + 12000
    descriptor = os.open(tmp_path / "owner-check", os.O_CREAT | os.O_RDWR, 0o600)
    client = CoordinatedBridgeClient(settings)
    original_fstat = os.fstat
    fchown_calls = []
    reads = 0

    def fake_fstat(fd):
        nonlocal reads
        reads += 1
        info = original_fstat(fd)
        fields = list(info)
        fields[4] = 0 if reads == 1 else settings.request_uid
        return os.stat_result(fields)

    monkeypatch.setattr(os, "geteuid", lambda: 0)
    monkeypatch.setattr(os, "fstat", fake_fstat)
    monkeypatch.setattr(os, "fchown", lambda fd, uid, gid: fchown_calls.append((fd, uid, gid)))
    try:
        client._set_host_package_owner(descriptor)
    finally:
        os.close(descriptor)
    assert fchown_calls and fchown_calls[0][1:] == (settings.request_uid, -1)


def test_coordinated_settings_rejects_unconfigured_spool_owner(tmp_path, monkeypatch):
    request, packages, reports = (tmp_path / name for name in ("requests", "packages", "reports"))
    for path in (request, packages, reports):
        path.mkdir(mode=0o750)
    foreign_uid = os.getuid() + 12000
    original_lstat = Path.lstat

    def lstat_with_foreign_owner(path):
        info = original_lstat(path)
        if path == request:
            fields = list(info)
            fields[4] = foreign_uid
            return os.stat_result(fields)
        return info

    monkeypatch.setattr(Path, "lstat", lstat_with_foreign_owner)
    with pytest.raises(CoordinatedBridgeError, match="unsafe_request_inbox"):
        CoordinatedBridgeSettings(request, packages, reports, os.getuid(), os.getgid())


def test_report_reader_accepts_configured_host_owner(tmp_path, monkeypatch):
    request, packages, reports = (tmp_path / name for name in ("requests", "packages", "reports"))
    for path in (request, packages, reports):
        path.mkdir(mode=0o750)
    host_uid = os.getuid() + 12000
    settings = CoordinatedBridgeSettings(request, packages, reports, host_uid, os.getgid())
    report = reports / "tx-host-report.json"
    report.write_text(json.dumps({"schema": 1, "transaction": "tx-host-report",
                                  "action": "apply", "status": "complete"}))
    report_inode = report.stat().st_ino
    original_fstat = os.fstat

    def fstat_with_host_owner(fd):
        info = original_fstat(fd)
        if info.st_ino == report_inode:
            fields = list(info)
            fields[4] = host_uid
            return os.stat_result(fields)
        return info

    monkeypatch.setattr(os, "fstat", fstat_with_host_owner)
    assert CoordinatedBridgeClient(settings).read_report("tx-host-report")["status"] == "complete"


def test_real_producer_prepare_and_mock_consumer_report(tmp_path):
    settings, request_dir, reports = _settings(tmp_path)
    package = tmp_path / "download.tar.gz"
    raw = b"signed-package-fixture"
    package.write_bytes(raw)
    manifest = {"schema": 1, "version": "1.0.3", "package_url": "grant://temporary",
                "checksum_sha256": hashlib.sha256(raw).hexdigest(), "package_size_bytes": len(raw)}
    client = CoordinatedBridgeClient(settings)
    submitted = client.submit_prepare("tx-client", manifest, package)
    assert submitted["status"] == "submitted"
    request_path = next(request_dir.glob("tx-client-prepare-*.json"))
    request = json.loads(request_path.read_text())
    assert request["manifest"] == manifest
    assert request["package_checksum_sha256"] == manifest["checksum_sha256"]
    assert (settings.package_inbox / manifest["checksum_sha256"]).read_bytes() == raw

    # Mock consumer scope: only the host process may publish this reduced report.
    (reports / "tx-client.json").write_text(json.dumps({
        "schema": 1, "transaction": "tx-client", "action": "prepare", "status": "prepared"
    }))
    assert client.read_report("tx-client")["status"] == "prepared"
    (reports / "tx-client.json").write_text(json.dumps({
        "schema": 1, "transaction": "tx-client", "action": "prepare", "status": "prepare_stale"
    }))
    assert client.read_report("tx-client")["status"] == "prepare_stale"
    (reports / "tx-client.json").write_text("{not-json")
    with pytest.raises(CoordinatedBridgeError, match="invalid_coordinated_report"):
        client.read_report("tx-client")


def test_apply_retry_uses_stable_nonce_and_ignores_old_prepare_report(tmp_path):
    settings, request_dir, reports = _settings(tmp_path)
    settings.report_timeout = 0.05
    manifest = {"version": "1.0.3", "package_url": "https://updates.invalid/a",
                "checksum_sha256": "b" * 64, "package_size_bytes": 1}
    client = CoordinatedBridgeClient(settings)
    client.persist_manifest("tx-retry", manifest)
    client.submit_apply("tx-retry", manifest)
    client.submit_apply("tx-retry", manifest)
    requests = list(request_dir.glob("tx-retry-apply-*.json"))
    assert len(requests) == 1
    assert client.load_manifest("tx-retry") == manifest
    (reports / "tx-retry.json").write_text(json.dumps({
        "schema": 1, "transaction": "tx-retry", "action": "prepare", "status": "prepared"
    }))
    assert asyncio.run(client.wait_report("tx-retry", action="apply")) is None
    (reports / "tx-retry.json").write_text(json.dumps({
        "schema": 1, "transaction": "tx-retry", "action": "apply", "status": "complete"
    }))
    assert client.read_report("tx-retry", action="apply")["status"] == "complete"


def test_client_rejects_invalid_transaction_before_constructing_private_path(tmp_path):
    settings, _, _ = _settings(tmp_path)
    client = CoordinatedBridgeClient(settings)
    with pytest.raises(CoordinatedBridgeError, match="invalid_transaction"):
        client.load_manifest("../escape")
    with pytest.raises(CoordinatedBridgeError, match="invalid_transaction"):
        client.submit_status("../escape")


def test_manifest_directory_and_report_permissions_are_fail_closed(tmp_path):
    request, packages, reports = (tmp_path / name for name in ("requests", "packages", "reports"))
    for path in (request, packages, reports):
        path.mkdir(mode=0o750)
    (packages / ".coordinated-manifests").symlink_to(tmp_path / "elsewhere", target_is_directory=True)
    (tmp_path / "elsewhere").mkdir(mode=0o700)
    with pytest.raises(CoordinatedBridgeError, match="unsafe_manifest_dir"):
        CoordinatedBridgeSettings(request, packages, reports, os.getuid(), os.getgid())

    clean = tmp_path / "clean"
    clean.mkdir()
    settings, _, reports = _settings(clean)
    (reports / "tx-report.json").write_text(json.dumps({
        "schema": 1, "transaction": "tx-report", "status": "prepared",
    }))
    with pytest.raises(CoordinatedBridgeError, match="invalid_coordinated_report"):
        CoordinatedBridgeClient(settings).read_report("tx-report")
    (reports / "tx-report.json").chmod(0o664)
    with pytest.raises(CoordinatedBridgeError, match="invalid_coordinated_report"):
        CoordinatedBridgeClient(settings).read_report("tx-report")


def test_nonce_symlink_and_malformed_nonce_are_rejected(tmp_path):
    settings, _, _ = _settings(tmp_path)
    client = CoordinatedBridgeClient(settings)
    nonce = settings.manifest_dir / ".tx-nonce-status.nonce"
    nonce.symlink_to(tmp_path / "nonce-target")
    (tmp_path / "nonce-target").write_text("a" * 32)
    with pytest.raises(CoordinatedBridgeError, match="nonce_persistence_failed"):
        client._stable_nonce("tx-nonce", "status")
    nonce.unlink()
    nonce.write_text("not-a-nonce")
    nonce.chmod(0o644)
    with pytest.raises(CoordinatedBridgeError, match="nonce_persistence_failed"):
        client._stable_nonce("tx-nonce", "status")


def test_wait_report_survives_missing_report_then_accepts_fresh_action(tmp_path):
    settings, _, reports = _settings(tmp_path)
    settings.report_timeout = 0.01
    client = CoordinatedBridgeClient(settings)
    assert asyncio.run(client.wait_report("tx-restart", action="apply")) is None
    (reports / "tx-restart.json").write_text(json.dumps({
        "schema": 1, "transaction": "tx-restart", "action": "apply", "status": "apply_pending",
    }))
    assert client.read_report("tx-restart", action="apply")["status"] == "apply_pending"


def test_existing_package_is_hashed_streamingly(tmp_path, monkeypatch):
    settings, _, _ = _settings(tmp_path)
    raw = b"package-content"
    checksum = hashlib.sha256(raw).hexdigest()
    target = settings.package_inbox / checksum
    target.write_bytes(raw)
    seen = []
    real_read = os.read

    def bounded_read(fd, size):
        seen.append(size)
        assert size <= 1024 * 1024
        return real_read(fd, size)

    monkeypatch.setattr(os, "read", bounded_read)
    assert CoordinatedBridgeClient(settings).stage_package(target, checksum, len(raw)) == target
    assert seen


def test_coordinated_restart_without_report_stays_pending_then_reconciles(tmp_path, monkeypatch):
    from app.services.updater import UpdateService, UpdateSettings, UpdateTaskState
    from app.services import updater_operations

    bridge_root = tmp_path / "bridge"
    bridge_root.mkdir()
    settings, _, reports = _settings(bridge_root)
    for key, value in {
        "TRESEKO_UPDATE_MODE": "coordinated",
        "TRESEKO_UPDATE_REQUEST_INBOX": str(settings.request_inbox),
        "TRESEKO_UPDATE_PACKAGE_INBOX": str(settings.package_inbox),
        "TRESEKO_UPDATE_REPORT_DIR": str(settings.report_dir),
        "TRESEKO_UPDATE_REQUEST_UID": str(os.getuid()),
        "TRESEKO_UPDATE_REQUEST_GID": str(os.getgid()),
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(updater_operations, "require_installation_mode", lambda _command: "coordinated")
    update_settings = UpdateSettings(
        updates_dir=tmp_path / "updates", backups_dir=tmp_path / "backups",
        app_dir=tmp_path / "app", frontend_dir=tmp_path / "frontend",
        engine_dir=tmp_path / "engine", worker_dir=tmp_path / "worker",
        history_file=tmp_path / "updates" / "history.json", database_url="",
    )
    state = UpdateTaskState(task_id="tx-restart", status="in_progress",
                            channel="community-stable", stage="apply_pending", progress_pct=95)
    update_settings.history_file.parent.mkdir(parents=True)
    update_settings.history_file.write_text(json.dumps({"tasks": [state.as_dict()]}))
    restarted = UpdateService(settings=update_settings)
    pending = asyncio.run(restarted.get_update_status("tx-restart"))
    assert pending["status"] == "in_progress"
    assert pending["stage"] == "apply_pending"
    (reports / "tx-restart.json").write_text(json.dumps({
        "schema": 1, "transaction": "tx-restart", "action": "apply", "status": "complete",
    }))
    reconciled = asyncio.run(restarted.get_update_status("tx-restart"))
    assert reconciled["status"] == "done"


def test_router_keeps_original_premium_manifest_separate_from_grant_url(monkeypatch):
    from app import schemas
    from app.api.routers import system_updates as router

    original = {"channel": "premium-stable", "edition": "premium", "version": "1.0.3",
                "package_url": "https://catalog.invalid/original.tar.gz",
                "checksum_sha256": "a" * 64, "package_size_bytes": 12}
    captured = {}

    class Entitlements:
        async def get_state(self, _db):
            return {"edition": "premium", "enabled_features": ["updates.premium"],
                    "update_channel": "premium-stable", "license": {"license_id": "test"}}

    class Service:
        def validate_update_request(self, **_kwargs):
            return original

        async def apply_update(self, **kwargs):
            captured.update(kwargs)
            return "tx-router"

    async def grant(manifest, state, *, current_version):
        assert manifest == original
        return {
            "package_url": "https://grant.invalid/one",
            "manifest": {**manifest, "package_url": "treseko-update://premium-stable/1.0.4/package.tar.gz"},
        }

    async def audit(*_args, **_kwargs):
        return None

    old = (router.get_entitlement_provider, router.get_update_service,
           router.request_premium_download_grant, router.crud.create_audit_log,
           router.validate_update_manifest, router.require_update_runtime)
    router.get_entitlement_provider = lambda: Entitlements()
    router.get_update_service = lambda: Service()
    router.request_premium_download_grant = grant
    router.crud.create_audit_log = audit
    router.validate_update_manifest = lambda manifest, _state: manifest
    # This unit test exercises Premium grant/manifest handling after the
    # installation-mode admission gate; fail-closed admission is covered above.
    router.require_update_runtime = lambda: "coordinated"
    try:
        result = asyncio.run(router.apply_system_update(
            schemas.SystemUpdateApplyRequest(channel="premium-stable", manifest=original,
                                             confirmation="APPLY_UPDATE"),
            SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={}), object(),
            SimpleNamespace(id="user", email="qa@example.invalid")))
    finally:
        (router.get_entitlement_provider, router.get_update_service,
         router.request_premium_download_grant, router.crud.create_audit_log,
         router.validate_update_manifest, router.require_update_runtime) = old
    assert result == {"task_id": "tx-router", "status": "queued"}
    assert captured["manifest"] == original
    assert captured["download_manifest"]["package_url"] == "https://grant.invalid/one"

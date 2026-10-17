from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services.edition import update_manager

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / "backend/.venv/bin/python"


def _signed_package(tmp_path, monkeypatch):
    archive = tmp_path / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for relative in ("app/services/update_existing_installation.py",
                         "app/services/update_controller_cli.py"):
            source = ROOT / "backend" / relative
            tar.add(source, arcname=f"backend/{relative}")
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    raw = public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    public_key = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    monkeypatch.setattr(update_manager, "_configured_update_public_keys", lambda: (public_key,))
    manifest = {
        "manifest_version": 1, "edition": "community", "channel": "community-stable",
        "version": "1.0.3", "artifact": archive.name, "artifact_type": "tar.gz",
        "package_url": "https://updates.invalid/release.tar.gz",
        "package_size_bytes": archive.stat().st_size,
        "checksum_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "published_at": "2026-09-09T00:00:00Z",
        "key_id": update_manager._public_key_fingerprint(public),
    }
    signature = private.sign(update_manager._canonical_manifest_payload(manifest))
    manifest["signature"] = "ed25519:" + base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return archive, manifest, public_key


def _config(tmp_path):
    controller = tmp_path / "controller.json"
    controller.write_text(json.dumps({"schema": 1, "directory": str(tmp_path / "controller-journal")}))
    controller.chmod(0o600)
    values = {
        "schema": 1, "controller_config": str(controller),
        "inbox": str(tmp_path / "inbox"), "state_dir": str(tmp_path / "state"),
        "report_dir": str(tmp_path / "reports"), "request_uid": os.getuid(),
        "request_gid": os.getgid(),
    }
    config = tmp_path / "bridge.json"
    config.write_text(json.dumps(values))
    config.chmod(0o600)
    return config, values


DRIVER = r'''
import json, os, sys
from pathlib import Path
from app.services import update_host_bridge as bridge
from app.services import update_host_bridge_cli as cli

calls = Path(os.environ["CALLS"])
def record(name):
    with calls.open("a") as stream:
        stream.write(name + "\n")

def plan(config, manifest, transaction):
    record("plan")
    return {"status": "plan_validated"}
def prepare(config, manifest, transaction, package):
    assert package.is_file() and package.stat().st_size == manifest["package_size_bytes"]
    record("prepare")
    if os.environ.get("FAIL_PREPARE") == "1":
        raise RuntimeError("simulated host offline")
    return {"status": "prepared"}
def apply(config, manifest, transaction):
    record("apply")
    if os.environ.get("CRASH_APPLY") == "1":
        os._exit(75)
    if os.environ.get("FAIL_APPLY") == "1":
        raise RuntimeError("simulated lost ACK")
    if os.environ.get("NONTERMINAL_APPLY") == "1":
        return {"status": "recovery_pending"}
    return {"status": "complete"}
def resume(config, manifest, transaction):
    record("resume")
    return {"status": "complete"}
bridge.orchestration.plan = plan
bridge.orchestration.prepare = prepare
bridge.orchestration.apply = apply
bridge.orchestration.resume = resume
sys.argv = ["bridge", "--config", os.environ["BRIDGE_CONFIG"], "--once"]
raise SystemExit(cli.main())
'''


def _run(config, request, public_key, calls, *, fail_apply=False, crash_apply=False, fail_prepare=False):
    env = os.environ.copy()
    env.update({"PYTHONPATH": str(ROOT / "backend"), "BRIDGE_CONFIG": str(config),
               "CALLS": str(calls), "TRESEKO_UPDATE_PUBLIC_KEY": public_key,
               "TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY": "1"})
    if fail_apply:
        env["FAIL_APPLY"] = "1"
    else:
        env.pop("FAIL_APPLY", None)
    if crash_apply:
        env["CRASH_APPLY"] = "1"
    else:
        env.pop("CRASH_APPLY", None)
    if fail_prepare:
        env["FAIL_PREPARE"] = "1"
    else:
        env.pop("FAIL_PREPARE", None)
    if request.get("_nonterminal_test_only"):
        env["NONTERMINAL_APPLY"] = "1"
    else:
        env.pop("NONTERMINAL_APPLY", None)
    return subprocess.run([str(PYTHON), "-c", DRIVER], input=json.dumps(request).encode(),
                          cwd=ROOT / "backend", env=env, capture_output=True, timeout=30)


def _request(action, transaction, manifest, **extra):
    return {"schema": 1, "transaction": transaction, "action": action,
            "manifest": manifest, **extra}


def test_subprocess_prepare_replay_apply_uncertain_and_resume_same_transaction(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    config_path, config = _config(tmp_path)
    Path(config["inbox"]).mkdir(mode=0o700)
    (Path(config["inbox"]) / manifest["checksum_sha256"]).write_bytes(archive.read_bytes())
    calls = tmp_path / "calls.log"

    prepared = _run(config_path, _request("prepare", "tx-one", manifest,
                                          package_checksum_sha256=manifest["checksum_sha256"]),
                     public_key, calls)
    assert prepared.returncode == 0
    assert json.loads(prepared.stdout)["status"] == "prepared"
    replay = _run(config_path, _request("prepare", "tx-one", manifest,
                                       package_checksum_sha256=manifest["checksum_sha256"]),
                  public_key, calls)
    assert replay.returncode == 0
    assert calls.read_text().splitlines() == ["prepare", "prepare"]
    planned = _run(config_path, _request("plan", "tx-one", manifest), public_key, calls)
    assert planned.returncode == 0
    assert json.loads(planned.stdout)["status"] == "prepared"
    assert calls.read_text().splitlines() == ["prepare", "prepare"]

    lost = _run(config_path, _request("apply", "tx-one", manifest), public_key, calls,
                fail_apply=True)
    assert lost.returncode == 1
    assert json.loads(lost.stdout)["error"] == "bridge_execution_failed"
    resumed = _run(config_path, _request("resume", "tx-one", manifest), public_key, calls)
    assert resumed.returncode == 0
    assert json.loads(resumed.stdout)["status"] == "complete"
    assert calls.read_text().splitlines() == ["prepare", "prepare", "apply", "resume"]
    private_state = json.loads((Path(config["state_dir"]) / "transactions/tx-one.json").read_text())
    assert private_state["manifest"] == manifest
    assert "manifest" not in json.loads(resumed.stdout)
    report = Path(config["report_dir"]) / "tx-one.json"
    assert json.loads(report.read_text())["status"] == "complete"
    assert report.stat().st_mode & 0o007 == 0
    assert report.stat().st_gid == os.getgid()
    assert Path(config["report_dir"]).stat().st_mode & 0o020 == 0


def test_bridge_reconciles_nonterminal_result_and_cleans_crashed_stage(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    config_path, config = _config(tmp_path)
    inbox = Path(config["inbox"])
    inbox.mkdir(mode=0o700)
    (inbox / manifest["checksum_sha256"]).write_bytes(archive.read_bytes())
    staging = Path(config["state_dir"]) / "staging"
    Path(config["state_dir"]).mkdir(mode=0o700)
    staging.mkdir(mode=0o700)
    stale = staging / ".tx-crash-old.tmp"
    stale.write_bytes(b"partial")
    stale.chmod(0o600)
    calls = tmp_path / "calls.log"
    request = _request("prepare", "tx-crash", manifest,
                       package_checksum_sha256=manifest["checksum_sha256"])
    assert _run(config_path, request, public_key, calls).returncode == 0
    nonterminal = _request("apply", "tx-crash", manifest)
    nonterminal["_nonterminal_test_only"] = True
    # The extra field is intentionally not part of the bridge request; use the
    # driver environment through a dedicated subprocess invocation below.
    nonterminal.pop("_nonterminal_test_only")
    env = os.environ.copy()
    env.update({"PYTHONPATH": str(ROOT / "backend"), "BRIDGE_CONFIG": str(config_path),
                "CALLS": str(calls), "TRESEKO_UPDATE_PUBLIC_KEY": public_key,
                "TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY": "1", "NONTERMINAL_APPLY": "1"})
    result = subprocess.run([str(PYTHON), "-c", DRIVER], input=json.dumps(nonterminal).encode(),
                            cwd=ROOT / "backend", env=env, capture_output=True, timeout=30)
    assert result.returncode == 0
    assert json.loads(result.stdout)["status"] == "apply_uncertain"
    resumed = _run(config_path, _request("resume", "tx-crash", manifest), public_key, calls)
    assert resumed.returncode == 0
    assert json.loads(resumed.stdout)["status"] == "complete"
    assert not list(staging.glob(".tx-crash-*.tmp"))


def test_bridge_rejects_fifo_without_blocking(tmp_path, monkeypatch):
    _, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    config_path, config = _config(tmp_path)
    inbox = Path(config["inbox"])
    inbox.mkdir(mode=0o700)
    os.mkfifo(inbox / manifest["checksum_sha256"])
    calls = tmp_path / "calls.log"
    result = _run(config_path, _request("prepare", "tx-fifo", manifest,
                                       package_checksum_sha256=manifest["checksum_sha256"]),
                  public_key, calls)
    assert result.returncode == 1
    assert json.loads(result.stdout)["error"] == "package_source_invalid"


def test_apply_pending_after_controller_crash_uses_resume_not_apply(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    config_path, config = _config(tmp_path)
    inbox = Path(config["inbox"])
    inbox.mkdir(mode=0o700)
    (inbox / manifest["checksum_sha256"]).write_bytes(archive.read_bytes())
    calls = tmp_path / "calls.log"
    request = _request("prepare", "tx-crash-apply", manifest,
                       package_checksum_sha256=manifest["checksum_sha256"])
    assert _run(config_path, request, public_key, calls).returncode == 0
    crashed = _run(config_path, _request("apply", "tx-crash-apply", manifest),
                   public_key, calls, crash_apply=True)
    assert crashed.returncode == 75
    recovered = _run(config_path, _request("apply", "tx-crash-apply", manifest),
                     public_key, calls)
    assert recovered.returncode == 0
    assert json.loads(recovered.stdout)["status"] == "complete"
    assert calls.read_text().splitlines() == ["prepare", "apply", "resume"]


def test_prepared_replay_reports_stale_when_host_reconciliation_is_unavailable(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    config_path, config = _config(tmp_path)
    inbox = Path(config["inbox"])
    inbox.mkdir(mode=0o700)
    (inbox / manifest["checksum_sha256"]).write_bytes(archive.read_bytes())
    calls = tmp_path / "calls.log"
    request = _request("prepare", "tx-stale", manifest,
                       package_checksum_sha256=manifest["checksum_sha256"])
    assert _run(config_path, request, public_key, calls).returncode == 0
    stale = _run(config_path, request, public_key, calls, fail_prepare=True)
    assert stale.returncode == 1
    assert json.loads(stale.stdout)["error"] == "prepare_reconciliation_failed"
    state = json.loads((Path(config["state_dir"]) / "transactions/tx-stale.json").read_text())
    assert state["status"] == "prepare_stale"
    assert json.loads((Path(config["report_dir"]) / "tx-stale.json").read_text())["status"] == "prepare_stale"


def test_bridge_rejects_bad_signature_symlink_and_apply_before_prepare(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    config_path, config = _config(tmp_path)
    inbox = Path(config["inbox"])
    inbox.mkdir(mode=0o700)
    calls = tmp_path / "calls.log"
    bad = dict(manifest, signature="ed25519:invalid")
    result = _run(config_path, _request("plan", "tx-bad", bad), public_key, calls)
    assert result.returncode == 1
    assert json.loads(result.stdout)["error"] == "manifest_signature_invalid"

    source = tmp_path / "outside.tar.gz"
    source.write_bytes(archive.read_bytes())
    (inbox / manifest["checksum_sha256"]).symlink_to(source)
    result = _run(config_path, _request("prepare", "tx-link", manifest,
                                       package_checksum_sha256=manifest["checksum_sha256"]),
                  public_key, calls)
    assert result.returncode == 1
    assert json.loads(result.stdout)["error"] == "package_source_invalid"

    result = _run(config_path, _request("apply", "tx-new", manifest), public_key, calls)
    assert result.returncode == 1
    assert json.loads(result.stdout)["error"] == "another_transaction_pending"


def test_bridge_rejects_another_transaction_and_malicious_request_fields(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    config_path, config = _config(tmp_path)
    inbox = Path(config["inbox"])
    inbox.mkdir(mode=0o700)
    (inbox / manifest["checksum_sha256"]).write_bytes(archive.read_bytes())
    calls = tmp_path / "calls.log"
    request = _request("prepare", "tx-one", manifest,
                       package_checksum_sha256=manifest["checksum_sha256"])
    assert _run(config_path, request, public_key, calls).returncode == 0
    other = _run(config_path, _request("plan", "tx-two", manifest, path="/etc/passwd"),
                 public_key, calls)
    assert other.returncode == 1
    assert json.loads(other.stdout)["error"] == "invalid_request"
    other = _run(config_path, _request("plan", "tx-two", manifest), public_key, calls)
    assert other.returncode == 1
    assert json.loads(other.stdout)["error"] == "another_transaction_pending"

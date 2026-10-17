from __future__ import annotations

import json
import base64
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import pytest

from app.services.update_host_bridge_spool import HostBridgeSpool, SpoolError
from test_update_host_bridge import (_signed_package, _config, _request, DRIVER as BRIDGE_DRIVER)
from test_update_backend_image_docker import backend_image

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / "backend/.venv/bin/python"

SPOOL_DRIVER = BRIDGE_DRIVER.replace(
    'from app.services import update_host_bridge as bridge\n',
    'from app.services import update_host_bridge as bridge\nfrom app.services import update_host_bridge_spool as spool\n',
).replace(
    'sys.argv = ["bridge", "--config", os.environ["BRIDGE_CONFIG"], "--once"]',
    'sys.argv = ["bridge", "--config", os.environ["SPOOL_CONFIG"], "--once", "--spool"]',
).replace(
    'record("prepare")\n',
    'record("prepare")\n    if os.environ.get("CRASH_PREPARE") == "1":\n        os._exit(74)\n',
).replace(
    'record("apply")\n',
    'record("apply")\n    if os.environ.get("SLEEP_APPLY") == "1":\n        time.sleep(1)\n',
).replace(
    'import json, os, sys\n',
    'import json, os, sys, time\n',
)


def _spool_config(tmp_path, bridge_config):
    values = {"schema": 1, "bridge_config": str(bridge_config),
              "request_inbox": str(tmp_path / "request-inbox"),
              "spool_dir": str(tmp_path / "spool")}
    path = tmp_path / "spool-config.json"
    path.write_text(json.dumps(values))
    path.chmod(0o600)
    return path, values


def _environment(spool_config, public_key, calls, **flags):
    environment = os.environ.copy()
    environment.update({"PYTHONPATH": str(ROOT / "backend"),
                        "SPOOL_CONFIG": str(spool_config),
                        "CALLS": str(calls),
                        "TRESEKO_UPDATE_PUBLIC_KEY": public_key,
                        "TRESEKO_ALLOW_DEV_PUBLIC_KEY": "1",
                        "TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY": "1"})
    environment.update(flags)
    return environment


def _run_spool(spool_config, public_key, calls, **flags):
    return subprocess.run([str(PYTHON), "-c", SPOOL_DRIVER], cwd=ROOT / "backend",
                          env=_environment(spool_config, public_key, calls, **flags),
                          capture_output=True, timeout=30)


def test_spool_no_request_is_noop(tmp_path):
    bridge_config, _ = _config(tmp_path)
    spool_config, _ = _spool_config(tmp_path, bridge_config)
    result = _run_spool(spool_config, "unused", tmp_path / "calls.log")
    assert result.returncode == 0
    assert json.loads(result.stdout)["status"] == "idle"


def test_backend_producer_needs_only_request_boundary(tmp_path):
    inbox = tmp_path / "request-inbox"
    inbox.mkdir(mode=0o730)
    producer = HostBridgeSpool.producer_for({
        "schema": 1, "request_inbox": str(inbox),
        "request_uid": os.getuid(), "request_gid": os.getgid(),
    })
    request = {"schema": 1, "transaction": "tx-producer", "action": "status",
               "nonce": "f" * 16}
    result = producer.submit(request)
    assert result["status"] == "submitted"
    assert json.loads(next(inbox.glob("*.json")).read_text()) == request
    # No host-private path was opened or created by the backend-side object.
    assert not (tmp_path / "spool").exists()


def test_status_nonce_is_observational_and_blocked_apply_does_not_monopolize(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    bridge_config, bridge_values = _config(tmp_path)
    spool_config, spool_values = _spool_config(tmp_path, bridge_config)
    Path(bridge_values["inbox"]).mkdir(mode=0o700)
    (Path(bridge_values["inbox"]) / manifest["checksum_sha256"]).write_bytes(archive.read_bytes())
    spool = HostBridgeSpool(spool_values)
    apply = {"schema": 1, "transaction": "tx-blocked", "action": "apply",
             "manifest": manifest, "nonce": "1" * 16}
    spool.submit(apply)
    first = _run_spool(spool_config, public_key, tmp_path / "calls.log")
    first_result = json.loads(first.stdout)
    assert first_result.get("error") == "apply_requires_prepared", first.stdout
    receipt = json.loads((Path(spool_values["spool_dir"]) / "receipts/tx-blocked-apply.json").read_text())
    assert receipt["status"] == "blocked"
    assert _run_spool(spool_config, public_key, tmp_path / "calls.log").stdout == b'{"schema": 1, "status": "idle"}\n'
    spool.submit({"schema": 1, "transaction": "tx-blocked", "action": "status",
                  "nonce": "2" * 16})
    status = _run_spool(spool_config, public_key, tmp_path / "calls.log")
    assert json.loads(status.stdout)["status"] == "not_found"


def test_spool_subprocess_kill_replays_pending_same_tx_without_second_apply(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    bridge_config, bridge_values = _config(tmp_path)
    spool_config, spool_values = _spool_config(tmp_path, bridge_config)
    Path(bridge_values["inbox"]).mkdir(mode=0o700)
    (Path(bridge_values["inbox"]) / manifest["checksum_sha256"]).write_bytes(archive.read_bytes())
    calls = tmp_path / "calls.log"
    spool = HostBridgeSpool(spool_values)
    prepare = _request("prepare", "tx-spool", manifest,
                       package_checksum_sha256=manifest["checksum_sha256"])
    assert spool.submit({**prepare, "nonce": "a" * 16})["status"] == "submitted"
    assert _run_spool(spool_config, public_key, calls).returncode == 0
    apply = {"schema": 1, "transaction": "tx-spool", "action": "apply",
             "manifest": manifest, "nonce": "b" * 16}
    spool.submit(apply)
    killed = _run_spool(spool_config, public_key, calls, CRASH_APPLY="1")
    assert killed.returncode == 75
    recovered = _run_spool(spool_config, public_key, calls)
    assert recovered.returncode == 0
    assert json.loads(recovered.stdout)["status"] == "complete"
    assert calls.read_text().splitlines() == ["prepare", "apply", "resume"]
    receipt = json.loads((Path(spool_values["spool_dir"]) / "receipts/tx-spool-apply.json").read_text())
    assert receipt["status"] == "complete"
    assert "manifest" not in json.loads(recovered.stdout)


def test_spool_killed_prepare_replays_same_transaction(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    bridge_config, bridge_values = _config(tmp_path)
    spool_config, spool_values = _spool_config(tmp_path, bridge_config)
    Path(bridge_values["inbox"]).mkdir(mode=0o700)
    (Path(bridge_values["inbox"]) / manifest["checksum_sha256"]).write_bytes(archive.read_bytes())
    calls = tmp_path / "calls.log"
    spool = HostBridgeSpool(spool_values)
    request = _request("prepare", "tx-prepare-crash", manifest,
                       package_checksum_sha256=manifest["checksum_sha256"])
    spool.submit({**request, "nonce": "9" * 16})
    crashed = _run_spool(spool_config, public_key, calls, CRASH_PREPARE="1")
    assert crashed.returncode == 74
    recovered = _run_spool(spool_config, public_key, calls)
    assert json.loads(recovered.stdout)["status"] == "prepared"
    assert calls.read_text().splitlines() == ["prepare", "prepare"]


def test_spool_contenders_share_host_lock_and_request_identity(tmp_path, monkeypatch):
    archive, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    bridge_config, bridge_values = _config(tmp_path)
    spool_config, spool_values = _spool_config(tmp_path, bridge_config)
    Path(bridge_values["inbox"]).mkdir(mode=0o700)
    (Path(bridge_values["inbox"]) / manifest["checksum_sha256"]).write_bytes(archive.read_bytes())
    calls = tmp_path / "calls.log"
    spool = HostBridgeSpool(spool_values)
    prep = _request("prepare", "tx-lock", manifest,
                    package_checksum_sha256=manifest["checksum_sha256"])
    spool.submit({**prep, "nonce": "c" * 16})
    assert _run_spool(spool_config, public_key, calls).returncode == 0
    apply = {"schema": 1, "transaction": "tx-lock", "action": "apply",
             "manifest": manifest, "nonce": "d" * 16}
    spool.submit(apply)
    first = subprocess.Popen([str(PYTHON), "-c", SPOOL_DRIVER], cwd=ROOT / "backend",
                             env=_environment(spool_config, public_key, calls, SLEEP_APPLY="1"),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(0.15)
    second = _run_spool(spool_config, public_key, calls)
    output = first.communicate(timeout=30)[0]
    assert second.returncode == 0
    assert json.loads(second.stdout)["status"] == "busy"
    assert json.loads(output)["status"] == "complete"
    changed = {**apply, "nonce": "e" * 16, "manifest": dict(manifest, version="1.0.4")}
    with pytest.raises(SpoolError, match="request_changed"):
        spool.submit(changed)


@pytest.mark.skipif(os.getenv("TRESEKO_RUN_DOCKER_UPDATE_TESTS") != "1",
                    reason="Real two-UID Docker boundary is opt-in")
def test_docker_two_uid_real_producer_consumer_boundary(backend_image, tmp_path, monkeypatch):
    if shutil.which("docker") is None:
        pytest.skip("Docker unavailable")
    _, image, _, _ = backend_image
    _, manifest, public_key = _signed_package(tmp_path, monkeypatch)
    volume = f"treseko-test-spool-{os.getpid()}-{time.time_ns()}"
    encoded_manifest = base64.b64encode(json.dumps(manifest, separators=(",", ":")).encode()).decode()
    created = subprocess.run(["docker", "volume", "create", volume], capture_output=True, timeout=30)
    assert created.returncode == 0, created.stderr
    mount = ["--mount", f"type=volume,src={volume},dst=/mnt"]
    try:
        setup = (
            "mkdir -p /mnt/inbox /mnt/state /mnt/reports /mnt/spool/receipts /mnt/controller-journal "
            "&& chown 10001:20001 /mnt/inbox && chmod 0730 /mnt/inbox "
            "&& chmod 0700 /mnt/state /mnt/spool /mnt/spool/receipts "
            "&& chmod 0750 /mnt/reports "
            "&& printf '%s' '{\"schema\":1,\"directory\":\"/mnt/controller-journal\"}' > /mnt/controller.json "
            "&& printf '%s' '{\"schema\":1,\"controller_config\":\"/mnt/controller.json\",\"inbox\":\"/mnt/inbox\",\"state_dir\":\"/mnt/state\",\"report_dir\":\"/mnt/reports\",\"request_uid\":10001,\"request_gid\":20001}' > /mnt/bridge.json "
            "&& printf '%s' '{\"schema\":1,\"bridge_config\":\"/mnt/bridge.json\",\"request_inbox\":\"/mnt/inbox\",\"spool_dir\":\"/mnt/spool\"}' > /mnt/spool.json "
            "&& printf '%s' '{\"schema\":1,\"request_inbox\":\"/mnt/inbox\",\"request_uid\":10001,\"request_gid\":20001}' > /mnt/producer.json "
            f"&& printf '%s' '{encoded_manifest}' | base64 -d > /mnt/manifest.json "
            "&& chown 10001:20001 /mnt/manifest.json && chmod 0640 /mnt/manifest.json "
            "&& chown 0:0 /mnt/controller.json /mnt/bridge.json /mnt/spool.json "
            "&& chmod 0600 /mnt/controller.json /mnt/bridge.json /mnt/spool.json "
            "&& chown 0:20001 /mnt/reports && chmod 0750 /mnt/reports"
        )
        setup_result = subprocess.run(["docker", "run", "--rm", *mount, "--entrypoint", "/bin/sh",
                                      image, "-c", setup], capture_output=True, timeout=60)
        assert setup_result.returncode == 0, setup_result.stderr
        app_mount = ["--mount", f"type=bind,src={ROOT / 'backend/app'},dst=/app/app,readonly"]
        producer_code = (
            "import json; from app.services.update_host_bridge_spool import HostBridgeSpool; "
            "p=HostBridgeSpool.producer_for(json.load(open('/mnt/producer.json'))); "
            "m=json.load(open('/mnt/manifest.json')); "
            "print(p.submit({'schema':1,'transaction':'tx-docker-boundary','action':'plan',"
            "'manifest':m,'nonce':'a'*16}))"
        )
        submit = subprocess.run(["docker", "run", "--rm", "--user", "10001:20001", *mount,
                                 *app_mount, "--entrypoint", "python", "-e", "PYTHONPATH=/app",
                                 image, "-c", producer_code], capture_output=True, timeout=60)
        assert submit.returncode == 0, submit.stderr
        consumer_code = (
            "from app.services import update_host_bridge as b, update_host_bridge_cli as c; "
            "from app.services.edition import update_manager as u; "
            f"u._configured_update_public_keys=lambda:({public_key!r},); "
            "b.orchestration.plan=lambda config,manifest,transaction:{'status':'plan_validated'}; "
            "c.main(['--config','/mnt/spool.json','--once','--spool'])"
        )
        consumer = subprocess.run(["docker", "run", "--rm", *mount, *app_mount,
                                   "--entrypoint", "python", "-e", "PYTHONPATH=/app",
                                   "-e", f"TRESEKO_UPDATE_PUBLIC_KEY={public_key}",
                                   "-e", "TRESEKO_ALLOW_DEV_PUBLIC_KEY=1",
                                   "-e", "TRESEKO_ALLOW_DEV_UPDATE_PUBLIC_KEY=1", image,
                                   "-c", consumer_code], capture_output=True, timeout=60)
        assert consumer.returncode == 0, consumer.stderr
        assert json.loads(consumer.stdout)["status"] == "plan_validated", consumer.stdout
        reader = subprocess.run(["docker", "run", "--rm", "--user", "10001:20001", *mount,
                                 "--entrypoint", "/bin/sh", image, "-c",
                                 "cat /mnt/reports/tx-docker-boundary.json; "
                                 "if printf x > /mnt/state/denied; then exit 10; fi; "
                                 "if printf x > /mnt/reports/tx-docker-boundary.json; then exit 11; fi; "
                                 "if cat /mnt/bridge.json; then exit 12; fi"],
                                capture_output=True, timeout=60)
        assert reader.returncode == 0, reader.stderr
        assert b'"status": "plan_validated"' in reader.stdout
    finally:
        subprocess.run(["docker", "volume", "rm", "-f", volume], capture_output=True, timeout=30)

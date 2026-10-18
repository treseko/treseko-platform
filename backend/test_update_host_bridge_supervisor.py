from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import time

from app.services.update_journal import exclusive_lock
from app.services.update_host_bridge_spool import HostBridgeSpool
from test_update_host_bridge import _config
from test_update_host_bridge_spool import _spool_config


ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / "backend/.venv/bin/python"
CLI = "app.services.update_host_bridge_cli"
TEMPLATE_DIR = ROOT / "scripts/systemd"


def _setup(tmp_path):
    bridge_config, _ = _config(tmp_path)
    spool_config, values = _spool_config(tmp_path, bridge_config)
    return spool_config, values


def _run(spool_config):
    env = {**os.environ, "PYTHONPATH": str(ROOT / "backend")}
    return subprocess.run(
        [str(PYTHON), "-m", CLI, "--config", str(spool_config), "--once", "--spool"],
        cwd=ROOT / "backend", env=env, capture_output=True, text=True, timeout=15,
    )


def test_supervisor_cli_empty_spool_is_one_shot_noop(tmp_path):
    spool_config, _ = _setup(tmp_path)
    result = _run(spool_config)
    assert result.returncode == 0
    assert json.loads(result.stdout) == {"schema": 1, "status": "idle"}


def test_supervisor_process_lock_blocks_competing_process_and_recovers(tmp_path):
    spool_config, values = _setup(tmp_path)
    spool = HostBridgeSpool(values)
    with exclusive_lock(spool.spool_dir / "spool.lock"):
        blocked = _run(spool_config)
        assert blocked.returncode == 0
        assert json.loads(blocked.stdout)["status"] == "busy"
    recovered = _run(spool_config)
    assert recovered.returncode == 0
    assert json.loads(recovered.stdout)["status"] == "idle"


def test_supervisor_killed_before_lock_release_can_be_restarted(tmp_path):
    spool_config, values = _setup(tmp_path)
    HostBridgeSpool(values)
    lock_path = Path(values["spool_dir"]) / "spool.lock"
    lock_path.touch()
    holder = subprocess.Popen([
        str(PYTHON), "-c",
        "import fcntl,sys,time; fd=open(sys.argv[1],'a+'); fcntl.flock(fd,fcntl.LOCK_EX); time.sleep(30)",
        str(lock_path),
    ])
    try:
        for _ in range(50):
            if lock_path.exists():
                break
            time.sleep(0.02)
        killed = _run(spool_config)
        assert killed.returncode == 0
        assert json.loads(killed.stdout)["status"] == "busy"
        holder.kill()
        holder.wait(timeout=5)
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)
    assert _run(spool_config).returncode == 0


def test_systemd_templates_use_fixed_adapter_timer_and_no_directory_trigger():
    service = (TEMPLATE_DIR / "treseko-update-spool.service.in").read_text()
    timer = (TEMPLATE_DIR / "treseko-update-spool.timer.in").read_text()
    wrapper = (TEMPLATE_DIR / "treseko-update-spool-wrapper.sh.in").read_text()
    assert "ExecStart=@TRESEKO_UPDATE_BRIDGE_WRAPPER@" in service
    assert "OnUnitInactiveSec=30s" in timer and "Persistent=true" in timer
    assert "DirectoryNotEmpty" not in timer
    assert "@TRESEKO_UPDATE_BRIDGE_HELPER@" in wrapper
    assert "$#" in wrapper and "--once" not in wrapper
    assert "argv" in wrapper and "commands" in wrapper


def test_fixed_wrapper_runs_cli_without_request_arguments(tmp_path):
    spool_config, _ = _setup(tmp_path)
    wrapper = (TEMPLATE_DIR / "treseko-update-spool-wrapper.sh.in").read_text()
    helper = tmp_path / "fixed-helper"
    helper.write_text(f"#!/bin/sh\nexec {PYTHON} -m {CLI} --config {spool_config} --once --spool\n")
    helper.chmod(0o755)
    wrapper = wrapper.replace("@TRESEKO_UPDATE_BRIDGE_HELPER@", str(helper))
    path = tmp_path / "fixed-wrapper"
    path.write_text(wrapper)
    path.chmod(0o755)
    result = subprocess.run([str(path)], cwd=ROOT / "backend", env={
        **os.environ, "PYTHONPATH": str(ROOT / "backend")},
        capture_output=True, text=True, timeout=15)
    assert result.returncode == 0
    assert json.loads(result.stdout)["status"] == "idle"
    rejected = subprocess.run([str(path), "unexpected"], capture_output=True, text=True, timeout=15)
    assert rejected.returncode == 2

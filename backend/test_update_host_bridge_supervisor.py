from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

from app.services.update_host_bridge import HostBridgeError
from app.services.update_host_bridge_cli import supervise


ROOT = Path(__file__).resolve().parents[1]
PYTHON = Path(sys.executable)
CLI = "app.services.update_host_bridge_cli"


def _setup(tmp_path):
    from test_update_host_bridge import _config
    from test_update_host_bridge_spool import _spool_config
    bridge_config, _ = _config(tmp_path)
    return _spool_config(tmp_path, bridge_config)


def _run(spool_config):
    env = {**os.environ, "PYTHONPATH": str(ROOT / "backend")}
    return subprocess.run(
        [str(PYTHON), "-m", CLI, "--config", str(spool_config), "--once", "--spool"],
        cwd=ROOT / "backend", env=env, capture_output=True, text=True, timeout=15,
    )


class StopAfter:
    def __init__(self, calls: int):
        self.calls = calls
        self.waits = 0

    def is_set(self):
        return self.waits >= self.calls

    def wait(self, _interval):
        self.waits += 1
        return self.is_set()


class Spool:
    def __init__(self, results):
        self.results = iter(results)
        self.calls = 0

    def process_once(self):
        self.calls += 1
        value = next(self.results)
        if isinstance(value, Exception):
            raise value
        return value


def test_supervisor_reconciles_until_stopped_and_suppresses_idle(capsys):
    spool = Spool([
        {"schema": 1, "status": "idle"},
        {"schema": 1, "status": "complete", "transaction": "tx-1"},
        {"schema": 1, "status": "idle"},
    ])
    stop = StopAfter(3)

    supervise(spool, 30, stop)

    assert spool.calls == 3
    assert json.loads(capsys.readouterr().out) == {
        "schema": 1, "status": "complete", "transaction": "tx-1"}


def test_supervisor_emits_bounded_errors_and_continues(capsys):
    spool = Spool([
        HostBridgeError("invalid_manifest"),
        RuntimeError("sensitive detail must not be emitted"),
    ])
    stop = StopAfter(2)

    supervise(spool, 5, stop)

    lines = capsys.readouterr().out.splitlines()
    assert [json.loads(line) for line in lines] == [
        {"schema": 1, "status": "blocked", "error": "invalid_manifest"},
        {"schema": 1, "status": "blocked", "error": "bridge_request_failed"},
    ]
    assert "sensitive detail" not in "\n".join(lines)

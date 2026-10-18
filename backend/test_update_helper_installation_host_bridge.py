from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import sys
import tempfile

from app.services import update_helper_installation as installer_module
from app.services import update_helper_complete_source as complete_source_module
from app.services import update_helper_installation_launcher as launcher
from test_update_helper_installation import HELPER_MODULES
from test_update_participant_package import release
from test_update_host_bridge_supervisor import _run, _setup


def _four_config(root: Path):
    config_dir = root / "etc"
    config_dir.mkdir()
    project = root / "project"
    project.mkdir()
    (project / "compose.production.env").write_text("LOCAL_SETTING=1\n")
    for name in ("spool-inbox", "spool-state", "bridge-inbox", "bridge-state",
                 "bridge-reports", "controller-state"):
        (root / name).mkdir(mode=0o700)
    controller = config_dir / "controller.json"
    controller.write_text(json.dumps({
        "schema": 1, "directory": "/controller-state",
        "atomic_compose": {"schema": 1, "project": "treseko-test",
                           "project_root": "/project", "env_file": "/project/compose.production.env"},
    }))
    controller.chmod(0o600)
    bridge = config_dir / "host_bridge_config.json"
    bridge.write_text(json.dumps({"schema": 1, "controller_config": "/etc/controller.json",
                                  "inbox": "/bridge-inbox", "state_dir": "/bridge-state",
                                  "report_dir": "/bridge-reports", "request_uid": os.getuid(),
                                  "request_gid": os.getgid()}))
    bridge.chmod(0o600)
    configs = {}
    for name in (*installer_module.HELPERS, "host_bridge"):
        path = config_dir / f"{name}.json"
        value = ({"schema": 1, "bridge_config": "/etc/host_bridge_config.json",
                  "request_inbox": "/spool-inbox", "spool_dir": "/spool-state"}
                 if name == "host_bridge" else {"schema": 1, "helper": name})
        path.write_text(json.dumps(value))
        path.chmod(0o600)
        configs[name] = f"/etc/{name}.json"
    host_mounts = [
        {"source": str(path), "target": str(path), "mode": "ro"}
        for path in (config_dir / "host_bridge.json", bridge, controller, project)
    ] + [
        {"source": str(root / name), "target": str(root / name), "mode": "rw"}
        for name in ("spool-inbox", "spool-state", "bridge-inbox", "bridge-state",
                     "bridge-reports", "controller-state")
    ]
    cache = root / "cache"
    cache.mkdir(mode=0o700)
    return {
        "schema": 1, "python": os.environ.get("PYTHON", sys.executable),
        "cache": "/cache", "manifest": "/manifest.json", "bin_dir": "/installed",
        "state_dir": "/state", "configs": configs,
        "launcher": {"type": "docker", "mounts": {name: (host_mounts if name == "host_bridge" else [])
                                                       for name in (*installer_module.HELPERS, "host_bridge")}},
    }, cache


def test_fourth_config_is_explicit_and_legacy_shape_remains_three(tmp_path, monkeypatch):
    root = tmp_path / "root"
    root.mkdir(mode=0o700)
    config, _ = _four_config(root)
    monkeypatch.setattr(installer_module.launcher, "validate", lambda value, *_args: value)
    parsed = installer_module._config(config, root)
    assert parsed[-1] == {"participant", "ingress", "runtime_preparation", "host_bridge"}
    legacy = dict(config, configs={key: value for key, value in config["configs"].items()
                                   if key != "host_bridge"})
    assert installer_module._config(legacy, root)[-1] == set(installer_module.HELPERS)


def test_docker_host_bridge_wrapper_uses_image_entrypoint_without_module_or_argv(tmp_path):
    root = tmp_path / "root"
    root.mkdir(mode=0o700)
    docker = root / "docker"
    docker.write_text("#!/bin/sh\n")
    docker.chmod(0o755)
    fd, socket_name = tempfile.mkstemp(prefix="treseko-hb-", dir="/tmp")
    os.close(fd)
    os.unlink(socket_name)
    sock = Path(socket_name)
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(str(sock))
    try:
        config = {
            "type": "docker", "docker": str(docker), "image": "helper@sha256:" + "a" * 64,
            "socket": str(sock), "network": "updates", "mounts": {name: [] for name in (
                "participant", "ingress", "runtime_preparation", "host_bridge")},
        }
        normalized = launcher.validate(config, root, set(config["mounts"]))
        rendered = launcher.wrapper(
            normalized | {"helpers": {name: {"mounts": []} for name in config["mounts"]}},
            "host_bridge", root / "backend", root / "host.json",
        ).decode()
        assert "--entrypoint /usr/local/bin/python" in rendered
        assert "-m app.services.update_host_bridge_cli" in rendered
        assert "--config" in rendered
        assert "--once --spool" in rendered
        assert 'if [ "$#" -ne 0 ]' in rendered
    finally:
        listener.close()
        sock.unlink(missing_ok=True)


def test_complete_source_requires_readonly_project_and_writable_transaction_state(tmp_path):
    root = tmp_path / "root"
    root.mkdir(mode=0o700)
    (root / "etc").mkdir()
    (root / "project").mkdir()
    paths = ["spool-inbox", "spool-state", "bridge-inbox", "bridge-state",
             "bridge-reports", "controller-state"]
    for name in paths:
        (root / name).mkdir(mode=0o700)
    env_file = root / "project" / "compose.production.env"
    env_file.write_text("LOCAL_SETTING=1\n")
    env_file.chmod(0o600)
    controller = root / "etc" / "controller.json"
    controller.write_text(json.dumps({
        "schema": 1, "directory": "/controller-state",
        "atomic_compose": {"schema": 1, "project": "treseko-test",
                           "project_root": "/project", "env_file": "/project/compose.production.env"},
    }))
    controller.chmod(0o600)
    bridge = root / "etc" / "host_bridge.json"
    bridge.write_text(json.dumps({"schema": 1, "controller_config": "/etc/controller.json",
                                  "inbox": "/bridge-inbox", "state_dir": "/bridge-state",
                                  "report_dir": "/bridge-reports", "request_uid": os.getuid(),
                                  "request_gid": os.getgid()}))
    bridge.chmod(0o600)
    spool = root / "etc" / "spool.json"
    spool.write_text(json.dumps({"schema": 1, "bridge_config": "/etc/host_bridge.json",
                                 "request_inbox": "/spool-inbox", "spool_dir": "/spool-state"}))
    spool.chmod(0o600)
    readonly = [root / "etc" / "spool.json", bridge, controller]
    readonly.extend([root / "project"])
    writable = [root / name for name in paths]
    mounts = [{"source": str(path), "target": str(path), "mode": mode}
              for path, mode in [(path, "ro") for path in readonly]
              + [(path, "rw") for path in writable]]

    complete_source_module.validate_complete_source_mounts(
        spool, root, {"mounts": {"host_bridge": mounts}})

    try:
        complete_source_module.validate_complete_source_mounts(
            spool, root, {"mounts": {"host_bridge": [
                item for item in mounts if item["source"] != str(bridge)]}})
    except ValueError as exc:
        assert "bridge configuration must be mounted ro" in str(exc)
    else:
        raise AssertionError("unmounted bridge configuration was accepted")


def test_installed_host_bridge_cli_really_runs_process_once_and_reports_idle(tmp_path):
    spool_config, _ = _setup(tmp_path)
    result = _run(spool_config)
    assert result.returncode == 0
    assert json.loads(result.stdout) == {"schema": 1, "status": "idle"}


def test_fourth_helper_receipt_replay_and_rollback_include_host_bridge(tmp_path, monkeypatch):
    release_root = tmp_path / "release"
    release_root.mkdir()
    archive, manifest = release(
        release_root, monkeypatch,
        additional_files={**HELPER_MODULES,
                          "backend/app/services/update_host_bridge_cli.py": "def main(): return 0\n"},
    )
    root = tmp_path / "root"
    root.mkdir(mode=0o700)
    config, cache = _four_config(root)
    config["launcher"] = {"type": "docker", "mounts": config["launcher"]["mounts"]}
    names = {"participant", "ingress", "runtime_preparation", "host_bridge"}
    monkeypatch.setattr(installer_module.launcher, "validate", lambda value, *_args: value)
    monkeypatch.setattr(installer_module.launcher, "binding", lambda *_args: {
        "type": "docker", "helpers": {name: {"mounts": []} for name in names},
    })
    monkeypatch.setattr(installer_module.launcher, "wrapper", lambda *_args: b"#!/bin/sh\n")
    (root / "manifest.json").write_text(json.dumps(manifest, sort_keys=True))
    (root / "manifest.json").chmod(0o600)
    target = cache / f"{manifest['checksum_sha256']}.tar.gz"
    target.write_bytes(archive.read_bytes())
    target.chmod(0o600)
    installer = installer_module.HelperInstallation(config, root)
    installed = installer.install()
    assert "treseko-update-host-bridge" in installed["wrappers"]
    assert installer.install()["replayed"] is True
    rollback = installer.rollback()
    assert rollback["ok"] is True
    assert not (root / "installed" / "treseko-update-host-bridge").exists()

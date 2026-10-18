from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess

import pytest

from app.services.update_cutover_preparation import CutoverPreparationError, prepare_cutover
from app.services.update_host_bridge_client import CoordinatedBridgeSettings


ROLES = {"backend": "api_actual", "frontend": "web_actual", "engine": "engine_actual",
         "automation_worker": "worker_actual", "db": "postgres_actual"}


def _config(tmp_path: Path, *, plugin_runner: bool = False) -> dict:
    private = tmp_path / "private"
    private.mkdir(mode=0o700)
    compose = private / "compose.yml"
    compose.write_text("services:\n  api_actual:\n    image: pinned\n")
    wrapper = private / "host-bridge-wrapper"
    wrapper.write_text("#!/bin/sh\n")
    wrapper.chmod(0o700)
    bridge = private / "host-bridge.json"
    bridge.write_text("{}")
    bridge.chmod(0o600)
    requests = private / "requests"
    requests.mkdir(mode=0o730)
    requests.chmod(0o730)
    packages = private / "packages"
    packages.mkdir(mode=0o700)
    packages.chmod(0o700)
    reports = private / "reports"
    reports.mkdir(mode=0o750)
    reports.chmod(0o750)
    services = dict(ROLES)
    if plugin_runner:
        services["plugin_runner"] = "plugins_actual"
    return {
        "schema": 1, "installation_id": "fixture-installation",
        "topology_binding_existing": {"scope": "fixture", "compose_file": str(compose),
                                       "project": "fixture_project", "services": services},
        "fixed_settings": {
            "binding_path": "/etc/treseko/update/installation-binding.json",
            "compose_override_path": "/etc/treseko/update/coordinated.override.yaml",
            "systemd_service_path": "/etc/systemd/system/treseko-update-spool.service",
            "systemd_timer_path": "/etc/systemd/system/treseko-update-spool.timer",
            "systemd_wrapper_path": "/usr/local/libexec/treseko-update-spool-wrapper",
            "request_inbox": str(private / "requests"), "package_inbox": str(private / "packages"),
            "report_dir": str(private / "reports"), "control_dir": "/run/treseko/update/control",
            "host_bridge_wrapper": str(wrapper), "host_bridge_config": str(bridge),
            "bridge_uid": os.getuid(), "bridge_gid": os.getgid(),
        },
        "legacy_state": {"update_ready": str(private / "update-ready"),
                          "pending_journal": str(private / "pending.json")},
    }


def test_prepare_cutover_renders_private_nonoperational_bundle(tmp_path):
    config = _config(tmp_path)
    result = prepare_cutover(config, tmp_path / "bundle")
    output = tmp_path / "bundle"
    assert result["operational"] is False
    binding = json.loads((output / "installation-binding.json").read_text())
    assert binding["mode"] == "coordinated"
    override = (output / "compose.override.yaml").read_text()
    assert "api_actual" in override
    for name in ("TRESEKO_UPDATE_REQUEST_INBOX", "TRESEKO_UPDATE_PACKAGE_INBOX",
                 "TRESEKO_UPDATE_REPORT_DIR", "TRESEKO_UPDATE_REQUEST_UID",
                 "TRESEKO_UPDATE_REQUEST_GID", "TRESEKO_UPDATE_MODE",
                 "TRESEKO_BACKEND_UPDATE_CONTROL_DIR"):
        assert name in override
    assert "TRESEKO_UPDATE_BRIDGE_CONFIG" not in override
    assert "coordinated-serve" in override
    assert "host-bridge.json" not in override
    assert "10001" not in (output / "bundle.json").read_text()
    unit = (output / "treseko-update-spool.service").read_text()
    assert "TimeoutStartSec=3600" in unit
    assert 'ExecStart="/usr/local/libexec/treseko-update-spool-wrapper"' in unit
    assert f'ConditionPathExists="{config["fixed_settings"]["host_bridge_wrapper"]}"' in unit
    wrapper = output / "treseko-update-spool-wrapper.sh"
    assert wrapper.stat().st_mode & 0o777 == 0o755
    bundle = json.loads((output / "bundle.json").read_text())
    plan = bundle["install_plan"]["files"]
    assert set(plan) == set(bundle["artifacts"])
    assert plan["treseko-update-spool-wrapper.sh"] == {
        "target": "/usr/local/libexec/treseko-update-spool-wrapper", "mode": "0755", "owner": "root"}
    assert plan["installation-binding.json"]["mode"] == "0600"


def test_prepare_cutover_records_active_plugin_runner_service(tmp_path):
    config = _config(tmp_path, plugin_runner=True)
    result = prepare_cutover(config, tmp_path / "bundle")
    bundle = json.loads((tmp_path / "bundle" / "bundle.json").read_text())
    assert result["services"]["plugin_runner"] == "plugins_actual"
    assert bundle["services"] == config["topology_binding_existing"]["services"]


def test_prepare_cutover_keeps_plugin_runner_optional_for_older_topologies(tmp_path):
    result = prepare_cutover(_config(tmp_path), tmp_path / "bundle")
    assert "plugin_runner" not in result["services"]


def test_rendered_public_env_reconstructs_real_client_settings(tmp_path, monkeypatch):
    config = _config(tmp_path)
    prepare_cutover(config, tmp_path / "bundle")
    override = (tmp_path / "bundle" / "compose.override.yaml").read_text().splitlines()
    environment = {}
    in_environment = False
    for line in override:
        if line.strip() == "environment:":
            in_environment = True
            continue
        if line.strip() == "volumes:":
            break
        if in_environment and line.startswith("      "):
            key, raw = line.strip().split(": ", 1)
            environment[json.loads(key)] = json.loads(raw)
    fixed = config["fixed_settings"]
    for name in ("TRESEKO_UPDATE_REQUEST_INBOX", "TRESEKO_UPDATE_PACKAGE_INBOX",
                 "TRESEKO_UPDATE_REPORT_DIR", "TRESEKO_UPDATE_REQUEST_UID",
                 "TRESEKO_UPDATE_REQUEST_GID"):
        monkeypatch.setenv(name, environment[name])
    settings = CoordinatedBridgeSettings.from_environment()
    assert settings.request_inbox == Path(fixed["request_inbox"])
    assert settings.package_inbox == Path(fixed["package_inbox"])
    assert settings.report_dir == Path(fixed["report_dir"])
    assert settings.request_uid == fixed["bridge_uid"]
    assert settings.request_gid == fixed["bridge_gid"]
    assert environment["TRESEKO_UPDATE_MODE"] == "coordinated"
    assert environment["TRESEKO_BACKEND_UPDATE_CONTROL_DIR"] == fixed["control_dir"]

    mounts = [json.loads(line.strip()[2:]) for line in override if line.startswith("      - ")]
    assert mounts == [
        f"{fixed['request_inbox']}:{fixed['request_inbox']}:rw",
        f"{fixed['package_inbox']}:{fixed['package_inbox']}:rw",
        f"{fixed['report_dir']}:{fixed['report_dir']}:ro",
        f"{fixed['control_dir']}:{fixed['control_dir']}:rw",
        f"{fixed['binding_path']}:/run/treseko/update/installation-binding.json:ro",
    ]


def test_rendered_supervisor_wrapper_is_safe_shell(tmp_path):
    prepare_cutover(_config(tmp_path), tmp_path / "bundle")
    wrapper = tmp_path / "bundle" / "treseko-update-spool-wrapper.sh"
    assert subprocess.run(["/bin/sh", "-n", str(wrapper)], check=False).returncode == 0
    text = wrapper.read_text()
    assert "--" not in text and "$@" not in text


def test_prepare_cutover_rejects_legacy_update_marker(tmp_path):
    config = _config(tmp_path)
    Path(config["legacy_state"]["update_ready"]).write_text("pending")
    with pytest.raises(CutoverPreparationError, match="legacy_update_pending"):
        prepare_cutover(config, tmp_path / "bundle")


def test_prepare_cutover_rejects_active_pending_journal(tmp_path):
    config = _config(tmp_path)
    journal = Path(config["legacy_state"]["pending_journal"])
    journal.write_text(json.dumps({"schema": 3, "phase": "installing", "secret": "CANARY"}))
    journal.chmod(0o600)
    with pytest.raises(CutoverPreparationError, match="pending_journal_active"):
        prepare_cutover(config, tmp_path / "bundle")


def test_prepare_cutover_requires_all_declared_roles(tmp_path):
    config = _config(tmp_path)
    del config["topology_binding_existing"]["services"]["engine"]
    with pytest.raises(CutoverPreparationError, match="topology_roles_incomplete"):
        prepare_cutover(config, tmp_path / "bundle")


@pytest.mark.parametrize(("key", "value"), [
    ("systemd_wrapper_path", "/etc/treseko/unsafe-wrapper"),
    ("systemd_service_path", "/tmp/treseko-update-spool.service"),
    ("compose_override_path", "/tmp/override.yaml"),
])
def test_prepare_cutover_rejects_unallowlisted_install_targets(tmp_path, key, value):
    config = _config(tmp_path)
    config["fixed_settings"][key] = value
    with pytest.raises(CutoverPreparationError, match=f"{key}_not_allowlisted"):
        prepare_cutover(config, tmp_path / "bundle")


def test_prepare_cutover_never_overwrites_output(tmp_path):
    output = tmp_path / "bundle"
    output.mkdir()
    (output / "sentinel").write_text("operator-owned")
    with pytest.raises(CutoverPreparationError, match="output_dir_exists"):
        prepare_cutover(_config(tmp_path), output)
    assert (output / "sentinel").read_text() == "operator-owned"


def test_prepare_cutover_does_not_export_private_config_or_secrets(tmp_path):
    config = _config(tmp_path)
    Path(config["fixed_settings"]["host_bridge_config"]).write_text('{"token":"CANARY"}')
    prepare_cutover(config, tmp_path / "bundle")
    body = (tmp_path / "bundle" / "bundle.json").read_text()
    assert "CANARY" not in body
    assert str(config["fixed_settings"]["host_bridge_config"]) not in body

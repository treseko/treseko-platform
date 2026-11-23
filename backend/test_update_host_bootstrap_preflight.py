import json
from pathlib import Path
import subprocess
import sys
import os

from app.services import update_host_bootstrap_preflight as preflight
from app.services.update_host_bootstrap_preflight import inspect_legacy_installation


def _id(value):
    return (value.encode().hex() * 32)[:64]


def _fixture(tmp_path, *, overlay=True):
    root = tmp_path / "treseko-install"
    root.mkdir()
    release = root / ".treseko-local" / "releases" / "1.0.7-test"
    release.mkdir(parents=True)
    compose = release / "docker-compose.prod.yml"
    compose.write_text("services: {}\n")
    active_release = root / ".treseko-local" / "active-release.json"
    active_release.write_text(json.dumps({"schema": 1, "version": "1.0.7"}))
    active_release.chmod(0o600)
    configs = [str(compose)]
    if overlay:
        tx = root / ".treseko-local" / "update-transactions"
        tx.mkdir(parents=True)
        overlay_file = tx / "tx-atomic-candidate.compose.yml"
        overlay_file.write_text("services: {}\n")
        journal = tx / "tx.json"
        journal.write_text(json.dumps({"schema": 1, "phase": "committed", "version": "1.0.7"}))
        journal.chmod(0o600)
        configs.append(str(overlay_file))
    env = root / "compose.production.env"
    env.write_text("SECRET_FILE=/secret/path\n")
    env.chmod(0o600)
    project = "treseko-test"
    services = ["backend", "frontend", "engine", "automation-worker", "plugin-runner", "db", "redis"]
    rows = []
    for index, service in enumerate(services):
        rows.append("\t".join((_id(service), f"{project}-{service}-1", "running", project,
                                service, str(release), ",".join(configs))))
    stdout = "\n".join(rows) + "\n"
    config = {"schema": 1, "docker": str(Path(sys.executable).resolve()), "project_root": str(root), "env_file": str(env)}
    return config, stdout, services


def _runner(inventory, services, *, compose_code=0):
    calls = []

    def run(argv):
        calls.append(argv)
        if argv[1] == "ps":
            return subprocess.CompletedProcess(argv, 0, inventory, "")
        if argv[1] == "compose":
            return subprocess.CompletedProcess(argv, compose_code, "\n".join(services) + "\n", "")
        raise AssertionError(argv)

    return run, calls


def test_preflight_reports_effective_project_services_and_profiles(tmp_path):
    config, inventory, services = _fixture(tmp_path, overlay=False)
    runner, calls = _runner(inventory, [*services, "migrator"])

    report = inspect_legacy_installation(config, runner)

    assert report["status"] == "preflight_passed"
    assert report["project"] == "treseko-test"
    assert report["services"]["running"] == sorted(services)
    assert report["profiles"] == ["*"]
    assert "--profile" in calls[1] and calls[1][calls[1].index("--profile") + 1] == "*"
    assert str(config["env_file"]) in calls[1]
    assert config["env_file"] not in json.dumps(report)
    candidate = report["bootstrap_candidate"]
    assert candidate["operational"] is False
    assert candidate["deployment"] == "single-host-compose"
    assert candidate["compose_project"] == "treseko-test"
    assert candidate["host_os"] == sys.platform
    assert candidate["elevation_mechanism"] == (
        "windows-admin" if os.name == "nt" else
        ("none" if candidate["service_manager_candidate"] in {"systemd-user", "launchd-user"} else "sudo")
    )
    assert candidate["installation_root"] == config["project_root"]
    assert "env_file" not in candidate
    assert candidate["service_roles"] == {
        "backend": "backend", "frontend": "frontend", "engine": "engine",
        "automation_worker": "automation-worker", "db": "db",
        "plugin_runner": "plugin-runner",
    }
    assert candidate["active_services"] == sorted(services)
    assert isinstance(candidate["requires_operator_elevation"], bool)


def test_preflight_allows_declared_but_inactive_optional_plugin_runner(tmp_path):
    config, inventory, declared = _fixture(tmp_path, overlay=False)
    running = [service for service in declared if service != "plugin-runner"]
    rows = [row for row in inventory.splitlines() if "\tplugin-runner\t" not in row]
    runner, _ = _runner("\n".join(rows) + "\n", [*declared, "migrator"])

    report = inspect_legacy_installation(config, runner)

    assert report["status"] == "preflight_passed"
    assert report["services"].get("missing_running", []) == []
    assert report["bootstrap_candidate"]["active_services"] == sorted(running)
    assert "plugin_runner" not in report["bootstrap_candidate"]["service_roles"]


def test_preflight_allows_declared_but_inactive_optional_automation_worker(tmp_path):
    config, inventory, declared = _fixture(tmp_path, overlay=False)
    optional_services = {"automation-worker", "plugin-runner"}
    running = [service for service in declared if service not in optional_services]
    rows = [row for row in inventory.splitlines()
            if not any(f"\t{service}\t" in row for service in optional_services)]
    runner, _ = _runner("\n".join(rows) + "\n", [*declared, "migrator"])

    report = inspect_legacy_installation(config, runner)

    assert report["status"] == "preflight_passed"
    assert report["services"].get("missing_running", []) == []
    assert report["bootstrap_candidate"]["active_services"] == sorted(running)
    assert "automation_worker" not in report["bootstrap_candidate"]["service_roles"]
    assert "plugin_runner" not in report["bootstrap_candidate"]["service_roles"]


def test_preflight_marks_committed_overlay_for_rebasing(tmp_path):
    config, inventory, services = _fixture(tmp_path, overlay=True)
    runner, _ = _runner(inventory, [*services, "migrator"])

    report = inspect_legacy_installation(config, runner)

    assert report["status"] == "preflight_passed"
    assert not report["blockers"]
    assert len(report["transaction_overlays"]) == 1
    assert report["rebaseable_transaction_overlays"] == report["transaction_overlays"]
    assert report["requirements"] == ["committed_transaction_overlays_must_be_rebased_during_bootstrap"]


def test_preflight_allows_intact_completed_rollback_overlay_for_rebasing(tmp_path):
    config, inventory, services = _fixture(tmp_path, overlay=True)
    root = Path(config["project_root"])
    tx_dir = root / ".treseko-local/update-transactions"
    (tx_dir / "tx-atomic-candidate.compose.yml").unlink()
    images = {service: f"treseko-rollback:tx-{service}" for service in services}
    rollback = tx_dir / "tx-rollback.compose.yml"
    lines = ["services:"]
    for service, image in sorted(images.items()):
        lines += [f"  {service}:", f"    image: {image}", "    pull_policy: never"]
    rollback.write_text("\n".join(lines) + "\n")
    rollback.chmod(0o600)
    journal = tx_dir / "tx.json"
    journal.write_text(json.dumps({"schema": 1, "transaction": "tx", "phase": "rolled_back",
                                   "version": "1.0.8", "old_images": images,
                                   "old_active_services": services}))
    journal.chmod(0o600)
    rows = inventory.splitlines()
    for index, row in enumerate(rows):
        fields = row.split("\t")
        fields[6] = str(root / ".treseko-local/releases/1.0.7-test/docker-compose.prod.yml") + "," + str(rollback)
        rows[index] = "\t".join(fields)
    runner, _ = _runner("\n".join(rows) + "\n", [*services, "migrator"])
    (root / ".treseko-local/active-release.json").unlink()

    report = inspect_legacy_installation(config, runner)

    assert report["status"] == "preflight_passed"
    assert report["rebaseable_transaction_overlays"] == [str(rollback)]
    assert report["bootstrap_candidate"]["transaction_overlays_to_rebase"] == [str(rollback)]


def test_preflight_rejects_tampered_rollback_overlay(tmp_path):
    config, inventory, services = _fixture(tmp_path, overlay=True)
    root = Path(config["project_root"])
    tx_dir = root / ".treseko-local/update-transactions"
    (tx_dir / "tx-atomic-candidate.compose.yml").unlink()
    images = {service: f"treseko-rollback:tx-{service}" for service in services}
    journal = tx_dir / "tx.json"
    journal.write_text(json.dumps({"schema": 1, "transaction": "tx", "phase": "rolled_back",
                                   "version": "1.0.8", "old_images": images,
                                   "old_active_services": services}))
    journal.chmod(0o600)
    rollback = tx_dir / "tx-rollback.compose.yml"
    rollback.write_text("services:\n  backend:\n    image: attacker:latest\n")
    rollback.chmod(0o600)
    rows = inventory.splitlines()
    for index, row in enumerate(rows):
        fields = row.split("\t")
        fields[6] = str(root / ".treseko-local/releases/1.0.7-test/docker-compose.prod.yml") + "," + str(rollback)
        rows[index] = "\t".join(fields)
    runner, _ = _runner("\n".join(rows) + "\n", [*services, "migrator"])

    report = inspect_legacy_installation(config, runner)

    assert report["status"] == "blocked"
    assert "active_transaction_overlay_requires_reconciliation" in report["blockers"]


def test_preflight_blocks_pending_or_mismatched_transaction_journal(tmp_path):
    config, inventory, services = _fixture(tmp_path, overlay=True)
    journal = Path(config["project_root"]) / ".treseko-local/update-transactions/tx.json"
    journal.write_text(json.dumps({"schema": 1, "phase": "installing", "version": "1.0.7"}))
    runner, _ = _runner(inventory, [*services, "migrator"])

    report = inspect_legacy_installation(config, runner)

    assert report["status"] == "blocked"
    assert "active_transaction_overlay_requires_reconciliation" in report["blockers"]


def test_preflight_blocks_ambiguous_or_incomplete_project(tmp_path):
    config, inventory, services = _fixture(tmp_path, overlay=False)
    lines = inventory.splitlines()
    parts = lines[-1].split("\t")
    parts[3] = "another-project"
    lines[-1] = "\t".join(parts)
    runner, _ = _runner("\n".join(lines) + "\n", services)

    report = inspect_legacy_installation(config, runner)

    assert report["status"] == "blocked"
    assert "compose_project_ambiguous" in report["blockers"]
    assert report["bootstrap_candidate"] is None


def test_preflight_ignores_other_installations_on_same_host(tmp_path):
    config, inventory, services = _fixture(tmp_path, overlay=False)
    other = inventory.splitlines()[0].split("\t")
    other[1] = "another-project-backend-1"
    other[3] = "another-project"
    other[5] = str(tmp_path / "another-installation")
    runner, _ = _runner(inventory + "\t".join(other) + "\n", [*services, "migrator"])

    report = inspect_legacy_installation(config, runner)

    assert report["status"] == "preflight_passed"
    assert report["project"] == "treseko-test"


def test_preflight_blocks_secret_file_with_unsafe_permissions(tmp_path):
    config, inventory, services = _fixture(tmp_path, overlay=False)
    env = config["env_file"]
    open(env, "w").write("SECRET=do-not-print\n")
    import os
    os.chmod(env, 0o644)
    runner, _ = _runner(inventory, services)

    report = inspect_legacy_installation(config, runner)

    assert report["blockers"] == ["environment_file_permissions_unsafe"]
    assert "do-not-print" not in json.dumps(report)


def test_preflight_blocks_if_effective_compose_cannot_be_resolved(tmp_path):
    config, inventory, services = _fixture(tmp_path, overlay=False)
    runner, _ = _runner(inventory, services, compose_code=1)

    report = inspect_legacy_installation(config, runner)

    assert report["blockers"] == ["effective_compose_model_unavailable"]


def test_persistent_degraded_user_systemd_does_not_require_root(monkeypatch):
    monkeypatch.setattr(preflight.sys, "platform", "linux")
    monkeypatch.setattr(preflight.os, "getuid", lambda: 1000)

    def run(argv, **kwargs):
        if argv[:3] == ["systemctl", "--user", "is-system-running"]:
            # systemctl reports "degraded" but returns 1 for this real state.
            return subprocess.CompletedProcess(argv, 1, "degraded\n", "")
        if argv[:2] == ["loginctl", "show-user"]:
            return subprocess.CompletedProcess(argv, 0, "Linger=yes\n", "")
        raise AssertionError(argv)

    monkeypatch.setattr(preflight.subprocess, "run", run)

    assert preflight._service_manager_candidate() == "systemd-user"
    assert preflight._requires_operator_elevation() is False


def test_user_systemd_without_linger_is_not_a_persistent_service_manager(monkeypatch):
    monkeypatch.setattr(preflight.sys, "platform", "linux")
    monkeypatch.setattr(preflight.os, "getuid", lambda: 1000)

    def run(argv, **kwargs):
        if argv[:3] == ["systemctl", "--user", "is-system-running"]:
            return subprocess.CompletedProcess(argv, 0, "running\n", "")
        if argv[:2] == ["loginctl", "show-user"]:
            return subprocess.CompletedProcess(argv, 0, "Linger=no\n", "")
        raise AssertionError(argv)

    monkeypatch.setattr(preflight.subprocess, "run", run)

    assert preflight._service_manager_candidate() is None
    assert preflight._requires_operator_elevation() is True


def test_wsl_normalizes_windows_docker_compose_labels(monkeypatch):
    monkeypatch.setattr(preflight, "_is_wsl_host", lambda: True)
    assert preflight._compose_host_path(r"C:\Treseko\docker-compose.prod.yml") == \
        "/mnt/c/Treseko/docker-compose.prod.yml"
    assert preflight._compose_host_path(r"D:\Data\compose.yaml") == "/mnt/d/Data/compose.yaml"


def test_non_wsl_does_not_normalize_windows_compose_paths(monkeypatch):
    monkeypatch.setattr(preflight, "_is_wsl_host", lambda: False)
    source = r"C:\Treseko\docker-compose.prod.yml"
    assert preflight._compose_host_path(source) == source

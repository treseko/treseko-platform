import ast
import json
import subprocess
import tarfile
from pathlib import Path

import pytest

from app.services.automation_worker_updates import (
    create_worker_update_archive,
    worker_execution_blocker,
    worker_source_directory,
    worker_source_build_id,
    worker_update_status,
)

BUILD_ID = "a" * 64


def test_matching_worker_version_is_current_and_preserves_instance_identity():
    result = worker_update_status({
        "component_version": "1.0.8",
        "worker_build_id": BUILD_ID,
        "worker_instance_id": "worker-instance-1",
    }, desired_version="1.0.8", desired_build_id=BUILD_ID)

    assert result == {
        "status": "current",
        "update_required": False,
        "desired_version": "1.0.8",
        "observed_version": "1.0.8",
        "desired_build_id": BUILD_ID,
        "observed_build_id": BUILD_ID,
        "worker_instance_id": "worker-instance-1",
    }


def test_same_semver_with_different_worker_source_requires_update():
    result = worker_update_status({
        "component_version": "1.0.8", "worker_build_id": "b" * 64,
    }, desired_version="1.0.8", desired_build_id=BUILD_ID)

    assert result["status"] == "update_required"
    assert result["observed_version"] == result["desired_version"] == "1.0.8"
    assert result["observed_build_id"] == "b" * 64
    assert result["desired_build_id"] == BUILD_ID


def test_same_semver_without_reported_build_id_requires_update():
    result = worker_update_status({
        "component_version": "1.0.8",
    }, desired_version="1.0.8", desired_build_id=BUILD_ID)

    assert result["status"] == "update_required"
    assert result["observed_build_id"] is None


def test_old_worker_version_requires_update_after_relink():
    result = worker_update_status({
        "worker_version": "1.0.7",
        "worker_instance_id": "worker-instance-1",
    }, desired_version="1.0.8", desired_build_id=BUILD_ID)

    assert result["status"] == "update_required"
    assert result["update_required"] is True
    assert result["observed_version"] == "1.0.7"
    assert result["worker_instance_id"] == "worker-instance-1"
    assert worker_execution_blocker(
        {"worker_version": "1.0.7"}, desired_version="1.0.8", desired_build_id=BUILD_ID,
    )["code"] == "worker_update_required"


def test_unknown_or_malformed_worker_version_is_not_marked_current():
    for capabilities in ({}, {"component_version": "dev"}):
        result = worker_update_status(capabilities, desired_version="1.0.8", desired_build_id=BUILD_ID)
        assert result["status"] == "version_unknown"
        assert result["update_required"] is True


def test_newer_worker_is_reported_without_automatic_downgrade():
    result = worker_update_status({"versions": {"automation_worker": "1.0.10"}},
                                  desired_version="1.0.8", desired_build_id=BUILD_ID)

    assert result["status"] == "ahead"
    assert result["update_required"] is True


def test_unavailable_target_does_not_claim_worker_is_current():
    result = worker_update_status({"component_version": "1.0.8"}, desired_version="", desired_build_id=BUILD_ID)

    assert result["status"] == "target_version_unavailable"
    assert result["update_required"] is True


def test_unverified_or_ahead_worker_cannot_receive_jobs():
    for capabilities, expected_code in (({}, "worker_version_unverified"),
                                        ({"component_version": "1.0.8"}, "worker_update_required")):
        blocker = worker_execution_blocker(capabilities, desired_version="1.0.8", desired_build_id=BUILD_ID)
        assert blocker is not None
        assert blocker["code"] == expected_code


def test_current_worker_remains_eligible_for_jobs():
    assert worker_execution_blocker({
        "component_version": "1.0.8", "worker_build_id": BUILD_ID,
    }, desired_version="1.0.8", desired_build_id=BUILD_ID) is None


def test_worker_update_archive_contains_source_but_not_runtime_credentials(tmp_path):
    source = tmp_path / "worker"
    (source / "src").mkdir(parents=True)
    (source / "vendor").mkdir()
    (source / "src" / "worker.mjs").write_text("console.log('worker')\n")
    (source / "package.json").write_text(json.dumps({"version": "1.0.8"}))
    (source / "package-lock.json").write_text("{}")
    (source / "VERSION").write_text("1.0.8\n")
    (source / "worker-launcher.mjs").write_text("// runtime launcher\n")
    (source / "entrypoint.sh").write_text("#!/bin/sh\n")
    (source / ".treseko-active-worker-release.json").write_text('{"version":"1.0.7"}')
    (source / ".worker-releases" / "1.0.7").mkdir(parents=True)
    (source / ".worker-releases" / "1.0.7" / "worker.mjs").write_text("old runtime")
    (source / ".npmrc").write_text("audit=false\n")
    (source / ".runner-token").write_text("secret-token")
    (source / ".env.production").write_text("SECRET=value")
    (source / ".worker-instance-id").write_text("private-id")
    (source / ".state").mkdir()
    (source / ".state" / "result.json").write_text("private-result")
    (source / "node_modules").mkdir()
    (source / "node_modules" / "installed.js").write_text("runtime")

    archive_path, checksum = create_worker_update_archive(source, desired_version="1.0.8")
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            names = set(archive.getnames())
            assert "src/worker.mjs" in names
            assert "package-lock.json" in names
            assert ".npmrc" in names
            assert not any(name.startswith(".worker-releases/") for name in names)
            assert ".treseko-active-worker-release.json" not in names
            assert not any(".runner-token" in name for name in names)
            assert not any(".env" in name for name in names)
            assert not any(".worker-instance-id" in name for name in names)
            assert not any(name.startswith(".state/") for name in names)
            assert not any(name.startswith("node_modules/") for name in names)
        assert len(checksum) == 64
        expected_build_id = subprocess.run(
            ["sh", str(Path(__file__).resolve().parents[1] / "automation-worker" / "hash_component_tree.sh"), str(source)],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        assert worker_source_build_id(source) == expected_build_id
    finally:
        archive_path.unlink(missing_ok=True)


def test_worker_update_archive_rejects_version_mismatch(tmp_path):
    source = tmp_path / "worker"
    (source / "src").mkdir(parents=True)
    (source / "src" / "worker.mjs").write_text("worker")
    (source / "package.json").write_text(json.dumps({"version": "1.0.7"}))
    (source / "VERSION").write_text("1.0.7\n")

    with pytest.raises(ValueError, match="worker_source_version_mismatch"):
        create_worker_update_archive(source, desired_version="1.0.8")


def test_worker_build_id_rejects_source_from_a_different_ota_version(tmp_path):
    source = tmp_path / "worker"
    source.mkdir()
    (source / "package.json").write_text(json.dumps({"version": "1.0.7"}))
    (source / "VERSION").write_text("1.0.7\n")

    with pytest.raises(ValueError, match="worker_source_version_mismatch"):
        worker_source_build_id(source)


def test_worker_update_archive_rejects_symlinked_source_files(tmp_path):
    source = tmp_path / "worker"
    (source / "src").mkdir(parents=True)
    (source / "src" / "worker.mjs").write_text("worker")
    (source / "package.json").write_text(json.dumps({"version": "1.0.8"}))
    (source / "VERSION").write_text("1.0.8\n")
    (source / "linked.js").symlink_to(source / "src" / "worker.mjs")

    with pytest.raises(ValueError, match="worker_source_contains_non_regular_file"):
        create_worker_update_archive(source, desired_version="1.0.8")


def test_worker_update_source_uses_active_release_after_self_update(tmp_path, monkeypatch):
    runtime = tmp_path / "worker"
    (runtime / "src").mkdir(parents=True)
    active_source = runtime / ".worker-releases" / "1.0.8-abcdef123456"
    (active_source / "src").mkdir(parents=True)
    (runtime / "src" / "worker.mjs").write_text("old root runtime", encoding="utf-8")
    (active_source / "src" / "worker.mjs").write_text("active release runtime", encoding="utf-8")
    (active_source / "worker-launcher.mjs").write_text("launcher", encoding="utf-8")
    (active_source / "entrypoint.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    (active_source / "package.json").write_text(
        json.dumps({"version": "1.0.8", "scripts": {"start": "node worker-launcher.mjs"}}),
        encoding="utf-8",
    )
    (active_source / "package-lock.json").write_text("{}", encoding="utf-8")
    (active_source / "VERSION").write_text("1.0.8\n", encoding="utf-8")
    (runtime / ".worker-releases").chmod(0o700)
    (runtime / ".treseko-active-worker-release.json").write_text(
        '{"schema":1,"release":"1.0.8-abcdef123456"}', encoding="utf-8",
    )
    monkeypatch.setenv("TRESEKO_WORKER_DIR", str(runtime))

    source = worker_source_directory()
    assert source == active_source.resolve()
    archive_path, _ = create_worker_update_archive(source, desired_version="1.0.8")
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            assert archive.extractfile("src/worker.mjs").read() == b"active release runtime"
    finally:
        archive_path.unlink(missing_ok=True)


def test_worker_update_source_rejects_invalid_active_release_pointer(tmp_path, monkeypatch):
    runtime = tmp_path / "worker"
    runtime.mkdir()
    (runtime / ".treseko-active-worker-release.json").write_text(
        '{"schema":1,"release":"../outside"}', encoding="utf-8",
    )
    monkeypatch.setenv("TRESEKO_WORKER_DIR", str(runtime))

    with pytest.raises(ValueError, match="worker_active_release_invalid"):
        worker_source_directory()


def test_worker_update_source_rejects_symlinked_active_release_pointer(tmp_path, monkeypatch):
    runtime = tmp_path / "worker"
    runtime.mkdir()
    external = tmp_path / "external-pointer.json"
    external.write_text('{"schema":1,"release":"1.0.8-abcdef123456"}', encoding="utf-8")
    (runtime / ".treseko-active-worker-release.json").symlink_to(external)
    monkeypatch.setenv("TRESEKO_WORKER_DIR", str(runtime))

    with pytest.raises(ValueError, match="worker_active_release_invalid"):
        worker_source_directory()


def test_worker_update_source_prefers_packaged_source_when_no_local_worker_runs(tmp_path, monkeypatch):
    packaged_source = tmp_path / "packaged-worker"
    runtime_volume = tmp_path / "empty-worker-volume"
    packaged_source.mkdir()
    runtime_volume.mkdir()
    monkeypatch.setenv("TRESEKO_WORKER_UPDATE_SOURCE_DIR", str(packaged_source))
    monkeypatch.setenv("TRESEKO_WORKER_DIR", str(runtime_volume))

    assert worker_source_directory() == packaged_source.resolve()


def test_docker_backend_packages_worker_source_without_local_worker_service():
    repository = Path(__file__).resolve().parents[1]
    dockerfile = (repository / "backend" / "Dockerfile").read_text(encoding="utf-8")
    compose = (repository / "docker-compose.prod.yml").read_text(encoding="utf-8")

    assert "COPY automation-worker/src/ /opt/treseko/automation-worker-source/src/" in dockerfile
    assert "TRESEKO_WORKER_UPDATE_SOURCE_DIR: /opt/treseko/automation-worker-source" in compose


def test_stale_worker_is_blocked_from_job_poll_and_claim_but_can_check_updates():
    repository = Path(__file__).resolve().parents[1]
    source = (repository / "backend" / "app" / "api" / "routers" / "automation.py").read_text(encoding="utf-8")
    module = ast.parse(source)
    functions = {node.name: node for node in module.body if isinstance(node, ast.AsyncFunctionDef)}
    for name in ("get_next_automation_job", "claim_automation_job"):
        dependencies = [
            keyword.value for decorator in functions[name].decorator_list if isinstance(decorator, ast.Call)
            for keyword in decorator.keywords if keyword.arg == "dependencies"
        ]
        assert dependencies
        assert any("_require_current_worker_version" in ast.unparse(value) for value in dependencies)

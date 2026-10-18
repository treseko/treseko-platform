from __future__ import annotations

from pathlib import Path

from app.services.worker_result_storage import result_upload_root


def test_docker_upgrade_uses_existing_persistent_updates_volume(tmp_path, monkeypatch):
    data_root = tmp_path / "updates"
    data_root.mkdir()
    monkeypatch.delenv("AUTOMATION_RESULT_UPLOAD_DIR", raising=False)
    monkeypatch.setenv("TRESEKO_DEPLOY_MODE", "docker")

    assert result_upload_root(data_root=data_root) == data_root / "worker-results"


def test_explicit_result_storage_directory_takes_precedence(tmp_path, monkeypatch):
    configured = tmp_path / "dedicated-results"
    monkeypatch.setenv("AUTOMATION_RESULT_UPLOAD_DIR", str(configured))
    monkeypatch.setenv("TRESEKO_DEPLOY_MODE", "docker")

    assert result_upload_root(data_root=tmp_path / "updates") == configured


def test_non_docker_install_uses_code_local_state(tmp_path, monkeypatch):
    fallback = tmp_path / "backend-state"
    monkeypatch.delenv("AUTOMATION_RESULT_UPLOAD_DIR", raising=False)
    monkeypatch.delenv("TRESEKO_DEPLOY_MODE", raising=False)

    assert result_upload_root(data_root=tmp_path / "updates", fallback_root=fallback) == fallback

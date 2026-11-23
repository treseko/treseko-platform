from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.services.updater import UpdateService, UpdateSettings, UpdateTaskState
from app.services import updater_artifacts


def _service(tmp_path: Path) -> UpdateService:
    return UpdateService(settings=UpdateSettings(
        updates_dir=tmp_path / "updates",
        backups_dir=tmp_path / "backups",
        app_dir=tmp_path / "app",
        frontend_dir=tmp_path / "frontend",
        engine_dir=tmp_path / "engine",
        worker_dir=tmp_path / "worker",
        history_file=tmp_path / "updates" / "history.json",
        database_url="",
        docker_mode=False,
    ))


def test_native_systemd_restart_uses_supervisor_exit_code_not_systemctl(tmp_path, monkeypatch):
    service = _service(tmp_path)
    monkeypatch.setenv("TRESEKO_DEPLOY_MODE", "systemd")
    def exit_with_code(code):
        raise SystemExit(code)

    with patch.object(updater_artifacts.os, "_exit", side_effect=exit_with_code) as exit_process, patch(
        "asyncio.create_subprocess_exec",
        side_effect=AssertionError("native systemd must not call systemctl"),
    ):
        try:
            asyncio.run(updater_artifacts._restart_services(service))
        except SystemExit as exc:
            assert exc.code == 75
        else:
            raise AssertionError("Native systemd restart did not exit with code 75")
    exit_process.assert_called_once_with(75)


def test_explicit_prepared_restart_is_allowed_for_native_systemd(tmp_path, monkeypatch):
    from app.services import updater_operations

    service = _service(tmp_path)
    service._tasks["prepared-native"] = UpdateTaskState(
        task_id="prepared-native", status="done", stage="prepared",
        channel="community-stable", version="1.0.8",
    )
    service._persist_history = lambda: None
    service._append_event = lambda *_args, **_kwargs: None
    service._restart_after_ack = AsyncMock()
    monkeypatch.setattr(updater_operations, "require_update_runtime", lambda: "systemd-native")
    monkeypatch.setattr(updater_operations, "ENABLE_SELF_UPDATE_APPLY", False)

    result = asyncio.run(service.restart_prepared_update("prepared-native"))

    assert result["status"] == "restarting"
    assert result["stage"] == "restarting"

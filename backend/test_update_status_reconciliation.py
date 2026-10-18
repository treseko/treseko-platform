from __future__ import annotations

from pathlib import Path

from app.services.updater import UpdateService, UpdateSettings, UpdateTaskState
from app.services import update_host_bridge_client, updater_operations


def _service(tmp_path: Path) -> UpdateService:
    updates = tmp_path / "updates"
    return UpdateService(UpdateSettings(
        updates_dir=updates,
        backups_dir=tmp_path / "backups",
        app_dir=tmp_path / "app",
        frontend_dir=tmp_path / "frontend",
        engine_dir=tmp_path / "engine",
        worker_dir=tmp_path / "worker",
        history_file=updates / "update-history.json",
        database_url="",
    ))


async def test_completed_host_report_clears_stale_restart_failure(tmp_path, monkeypatch):
    service = _service(tmp_path)
    task_id = "coordinated-task"
    service._tasks[task_id] = UpdateTaskState(
        task_id=task_id,
        status="failed",
        stage="interrupted",
        channel="premium-stable",
        version="1.0.7",
        progress_pct=90,
        error="The backend restarted before the task was saved.",
        message="The task was interrupted by restart.",
    )
    service._latest_task_id = task_id
    persisted = []
    service._persist_history = lambda: persisted.append(True)
    monkeypatch.setattr(updater_operations, "require_installation_mode", lambda _command: "coordinated")
    monkeypatch.setattr(update_host_bridge_client.CoordinatedBridgeSettings,
                        "from_environment", lambda: object())

    class CompletedReport:
        def __init__(self, _settings):
            pass

        def read_report(self, transaction):
            assert transaction == task_id
            return {"schema": 1, "transaction": task_id, "action": "apply", "status": "complete"}

    monkeypatch.setattr(update_host_bridge_client, "CoordinatedBridgeClient", CompletedReport)
    result = await service.get_update_status(task_id)

    assert result["status"] == "done"
    assert result["stage"] == "applied"
    assert result["progress_pct"] == 100
    assert result["error"] is None
    assert result["message"] == "Actualizacion coordinada reconciliada tras el reinicio."
    assert result["completed_at"]
    assert persisted == [True]

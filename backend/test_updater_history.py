from __future__ import annotations

import asyncio
import gzip
import io
import json
import os
import sys
import tarfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.updater import UpdateService, UpdateSettings, UpdateTaskState  # noqa: E402
from app.version import PRODUCT_VERSION  # noqa: E402


def test_update_db_history_default_is_enabled_for_production_runtime() -> None:
    from app.services import updater

    if "TRESEKO_UPDATE_DB_HISTORY_ENABLED" not in os.environ:
        assert updater.UPDATE_DB_HISTORY_ENABLED is True


class _CommunityLatestHandler(BaseHTTPRequestHandler):
    request_count = 0

    def do_POST(self) -> None:  # noqa: N802
        # The legacy-only fixture must explicitly reject the new route.  The
        # BaseHTTPRequestHandler default is HTTP 501, which is not a route
        # mismatch response and therefore cannot exercise the fallback.
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length:
            self.rfile.read(content_length)
        self.send_response(405)
        self.send_header("Allow", "GET")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/community/latest":
            self.send_response(404)
            self.end_headers()
            return
        type(self).request_count += 1
        payload = {
            "version": "99.99.99",
            "channel": "community-stable",
            "checksum_sha256": "1" * 64,
            "package_url": f"http://{self.server.server_address[0]}:{self.server.server_address[1]}/download/pkg.tar.gz",
        }
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


class _FakeRedis:
    def __init__(self, initial: dict[str, str] | None = None):
        self.values = dict(initial or {})
        self.setex_calls: list[tuple[str, int, str]] = []

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.values[key] = value
        self.setex_calls.append((key, ttl, value))


def _update_package_bytes(
    version: str,
    *,
    manifest_version: str | None = None,
    version_file: str | None = None,
    include_changelog: bool = True,
) -> bytes:
    package_manifest = {
        "manifest_version": 1,
        "channel": "community-stable",
        "edition": "community",
        "version": manifest_version or version,
        "artifact": f"treseko-update-v{version}.tar.gz",
    }
    out = io.BytesIO()
    files = {
        "manifest.json": json.dumps(package_manifest).encode("utf-8"),
        "VERSION": (version_file or version).encode("utf-8"),
        "frontend/dist/VERSION": version.encode("utf-8"),
        "engine/VERSION": version.encode("utf-8"),
        "automation-worker/VERSION": version.encode("utf-8"),
        "frontend/dist/version.json": json.dumps({"version": version}).encode("utf-8"),
        "engine/package.json": json.dumps({"version": version}).encode("utf-8"),
        "automation-worker/package.json": json.dumps({"version": version}).encode("utf-8"),
    }
    if include_changelog:
        files["CHANGELOG.md"] = f"# Treseko {version}\n\n- Smoke update package.\n".encode("utf-8")
    with tarfile.open(fileobj=out, mode="w:gz") as archive:
        for name, content in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    return out.getvalue()


async def test_update_history_survives_service_restart() -> None:
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        settings = UpdateSettings(
            updates_dir=root / "updates",
            backups_dir=root / "backups",
            app_dir=root / "app",
            frontend_dir=root / "frontend",
            engine_dir=root / "engine",
            worker_dir=root / "worker",
            history_file=root / "updates" / "update-history.json",
            database_url="",
        )
        service = UpdateService(settings=settings)
        # This persistence test exercises task journaling without contacting a
        # privileged host; the bridge is intentionally unavailable in this unit.
        with patch("app.services.updater_operations.require_update_runtime", return_value="coordinated"), \
                patch("app.services.updater_lifecycle.require_update_runtime", return_value="coordinated"), \
                patch("app.services.update_host_bridge_client.CoordinatedBridgeSettings.from_environment",
                      return_value=object()), \
                patch("app.services.updater_lifecycle.CoordinatedBridgeClient",
                      side_effect=RuntimeError("simulated host bridge unavailable")):
            task_id = await service.apply_update(
                channel="community-stable",
                manifest={
                    "version": "9.9.9",
                    "channel": "community-stable",
                    "edition": "community",
                    "checksum_sha256": "0" * 64,
                    "package_url": "http://127.0.0.1:1/missing.tar.gz",
                },
            )

            for _ in range(50):
                status = await service.get_update_status(task_id)
                if status["status"] == "failed":
                    break
                await asyncio.sleep(0.02)
            else:
                raise AssertionError("update task did not fail as expected")

        history_payload = json.loads(settings.history_file.read_text(encoding="utf-8"))
        assert history_payload["tasks"][0]["task_id"] == task_id
        assert history_payload["tasks"][0]["status"] == "failed"
        assert history_payload["tasks"][0]["version"] == "9.9.9"
        assert history_payload["tasks"][0]["current_version"]
        assert history_payload["tasks"][0]["pending_version"] == "9.9.9"

        restarted_service = UpdateService(settings=settings)
        history = await restarted_service.get_update_history()
        assert history[0]["task_id"] == task_id
        assert history[0]["status"] == "failed"
        assert history[0]["pending_version"] == "9.9.9"


async def test_applied_marker_completes_restarting_task_after_boot() -> None:
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        settings = UpdateSettings(
            updates_dir=root / "updates",
            backups_dir=root / "backups",
            app_dir=root / "app",
            frontend_dir=root / "frontend",
            engine_dir=root / "engine",
            worker_dir=root / "worker",
            history_file=root / "updates" / "update-history.json",
            database_url="",
        )
        settings.updates_dir.mkdir(parents=True)
        task = UpdateTaskState(
            task_id="applied-task",
            status="restarting",
            channel="community-stable",
            version="1.0.0-rc.1",
            previous_version="0.9.0-rc.1",
            stage="restarting",
            progress_pct=95,
        )
        settings.history_file.write_text(json.dumps({"tasks": [task.as_dict()]}), encoding="utf-8")
        (settings.updates_dir / "update-applied").write_text(
            json.dumps({"task_id": "applied-task", "version": "1.0.0-rc.1"}),
            encoding="utf-8",
        )

        restarted = UpdateService(settings=settings)
        status = await restarted.get_update_status("applied-task")
        assert status["status"] == "done"
        assert status["stage"] == "applied"
        assert status["progress_pct"] == 100
        assert status["current_version"] == PRODUCT_VERSION
        assert status["previous_version"] == "0.9.0-rc.1"
        assert status["pending_version"] is None


async def test_convergence_pending_keeps_task_restarting_after_boot() -> None:
    """El backend arrancado por el entrypoint no pisa su propia tarea.

    Mientras el entrypoint confirma la convergencia con el backend en marcha,
    el historial no debe convertir esa tarea en fallida: si lo hiciera, nadie
    la reconciliaria despues y la actualizacion quedaria visible como
    interrumpida aunque termine bien.
    """
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        settings = UpdateSettings(
            updates_dir=root / "updates",
            backups_dir=root / "backups",
            app_dir=root / "app",
            frontend_dir=root / "frontend",
            engine_dir=root / "engine",
            worker_dir=root / "worker",
            history_file=root / "updates" / "update-history.json",
            database_url="",
        )
        settings.updates_dir.mkdir(parents=True)
        task = UpdateTaskState(
            task_id="converging-task",
            status="restarting",
            channel="premium-stable",
            version="1.0.6",
            previous_version="1.0.5",
            stage="restarting",
            progress_pct=95,
        )
        settings.history_file.write_text(json.dumps({"tasks": [task.as_dict()]}), encoding="utf-8")
        (settings.updates_dir / "update-convergence-pending").write_text(
            json.dumps(
                {
                    "schema": 1,
                    "status": "applying",
                    "task_id": "converging-task",
                    "version": "1.0.6",
                }
            ),
            encoding="utf-8",
        )

        restarted = UpdateService(settings=settings)
        status = await restarted.get_update_status("converging-task")
        assert status["status"] == "restarting"
        assert status["stage"] == "restarting"
        assert not status.get("error")
        assert "interrumpida" not in (status.get("message") or "")

        # Si otro usuario consulta el historial, la tarea sigue en curso.
        history = await restarted.get_update_history()
        assert history[0]["task_id"] == "converging-task"
        assert history[0]["status"] == "restarting"


async def test_boot_without_convergence_pending_marks_task_interrupted() -> None:
    """Sin el marcador, el arranque sigue tratando la tarea como interrumpida."""
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        settings = UpdateSettings(
            updates_dir=root / "updates",
            backups_dir=root / "backups",
            app_dir=root / "app",
            frontend_dir=root / "frontend",
            engine_dir=root / "engine",
            worker_dir=root / "worker",
            history_file=root / "updates" / "update-history.json",
            database_url="",
        )
        settings.updates_dir.mkdir(parents=True)
        task = UpdateTaskState(
            task_id="interrupted-task",
            status="restarting",
            channel="premium-stable",
            version="1.0.6",
            previous_version="1.0.5",
            stage="restarting",
            progress_pct=95,
        )
        settings.history_file.write_text(json.dumps({"tasks": [task.as_dict()]}), encoding="utf-8")

        restarted = UpdateService(settings=settings)
        status = await restarted.get_update_status("interrupted-task")
        assert status["status"] == "failed"
        assert status["stage"] == "interrupted"
        assert status["error"] == "El proceso se reinicio antes de terminar la tarea de update."
        assert status["message"] == "La tarea quedo interrumpida por reinicio del proceso."


async def test_community_update_check_uses_cache() -> None:
    _CommunityLatestHandler.request_count = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), _CommunityLatestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            service = UpdateService(
                settings=UpdateSettings(
                    updates_dir=root / "updates",
                    backups_dir=root / "backups",
                    app_dir=root / "app",
                    frontend_dir=root / "frontend",
                    engine_dir=root / "engine",
                    worker_dir=root / "worker",
                    history_file=root / "updates" / "update-history.json",
                    database_url="",
                ),
                update_server_url=f"http://127.0.0.1:{server.server_address[1]}",
            )
            service._redis_cache_url = ""
            first = await service.check_community_update()
            second = await service.check_community_update()
            assert first["latest_version"] == "99.99.99"
            assert second["latest_version"] == "99.99.99"
            assert _CommunityLatestHandler.request_count == 1
    finally:
        server.shutdown()
        server.server_close()


async def test_manual_community_update_check_bypasses_cache() -> None:
    _CommunityLatestHandler.request_count = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), _CommunityLatestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            service = UpdateService(
                settings=UpdateSettings(
                    updates_dir=root / "updates",
                    backups_dir=root / "backups",
                    app_dir=root / "app",
                    frontend_dir=root / "frontend",
                    engine_dir=root / "engine",
                    worker_dir=root / "worker",
                    history_file=root / "updates" / "update-history.json",
                    database_url="",
                ),
                update_server_url=f"http://127.0.0.1:{server.server_address[1]}",
            )
            service._redis_cache_url = ""
            await service.check_community_update()
            await service.check_community_update(force_refresh=True)
            assert _CommunityLatestHandler.request_count == 2
    finally:
        server.shutdown()
        server.server_close()


async def test_community_update_ignores_cache_from_previous_installed_version() -> None:
    _CommunityLatestHandler.request_count = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), _CommunityLatestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            service = UpdateService(
                settings=UpdateSettings(
                    updates_dir=root / "updates",
                    backups_dir=root / "backups",
                    app_dir=root / "app",
                    frontend_dir=root / "frontend",
                    engine_dir=root / "engine",
                    worker_dir=root / "worker",
                    history_file=root / "updates" / "update-history.json",
                    database_url="",
                ),
                update_server_url=f"http://127.0.0.1:{server.server_address[1]}",
            )
            service._redis_cache_url = ""
            service._community_update_cache = {
                "channel": "community-stable",
                "current_version": "obsolete-version",
                "latest_version": "obsolete-version",
            }
            service._community_update_cache_at = __import__("time").monotonic()
            result = await service.check_community_update()
            assert result["latest_version"] == "99.99.99"
            assert _CommunityLatestHandler.request_count == 1
    finally:
        server.shutdown()
        server.server_close()


async def test_update_step_timeout_fails_fast() -> None:
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        service = UpdateService(
            settings=UpdateSettings(
                updates_dir=root / "updates",
                backups_dir=root / "backups",
                app_dir=root / "app",
                frontend_dir=root / "frontend",
                engine_dir=root / "engine",
                worker_dir=root / "worker",
                history_file=root / "updates" / "update-history.json",
                database_url="",
            )
        )
        try:
            await service._with_step_timeout(asyncio.sleep(0.05), "paso lento", timeout_seconds=0.001)
        except TimeoutError as exc:
            assert "paso lento" in str(exc)
        else:
            raise AssertionError("slow update step did not time out")


async def test_community_update_check_uses_redis_when_available() -> None:
    cached_payload = {
        "available": True,
        "current_version": PRODUCT_VERSION,
        "latest_version": "88.88.88",
        "version": "88.88.88",
        "channel": "community-stable",
        "checksum_sha256": "2" * 64,
        "manifest": {
            "version": "88.88.88",
            "channel": "community-stable",
            "edition": "community",
            "checksum_sha256": "2" * 64,
            "package_url": "https://updates.treseko.com/download/pkg.tar.gz",
        },
    }
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        service = UpdateService(
            settings=UpdateSettings(
                updates_dir=root / "updates",
                backups_dir=root / "backups",
                app_dir=root / "app",
                frontend_dir=root / "frontend",
                engine_dir=root / "engine",
                worker_dir=root / "worker",
                history_file=root / "updates" / "update-history.json",
                database_url="",
            ),
            update_server_url="http://127.0.0.1:1",
        )
        fake_redis = _FakeRedis({"treseko:update:community-stable:latest": json.dumps(cached_payload)})
        service._redis_cache_url = "redis://fake"
        service._redis = fake_redis  # type: ignore[assignment]
        result = await service.check_community_update()
        assert result["latest_version"] == "88.88.88"
        assert fake_redis.setex_calls == []


async def test_community_update_check_writes_redis_cache() -> None:
    _CommunityLatestHandler.request_count = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), _CommunityLatestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            service = UpdateService(
                settings=UpdateSettings(
                    updates_dir=root / "updates",
                    backups_dir=root / "backups",
                    app_dir=root / "app",
                    frontend_dir=root / "frontend",
                    engine_dir=root / "engine",
                    worker_dir=root / "worker",
                    history_file=root / "updates" / "update-history.json",
                    database_url="",
                ),
                update_server_url=f"http://127.0.0.1:{server.server_address[1]}",
            )
            fake_redis = _FakeRedis()
            service._redis_cache_url = "redis://fake"
            service._redis = fake_redis  # type: ignore[assignment]
            result = await service.check_community_update()
            assert result["latest_version"] == "99.99.99"
            assert _CommunityLatestHandler.request_count == 1
            assert fake_redis.setex_calls
            key, ttl, raw = fake_redis.setex_calls[-1]
            assert key == "treseko:update:community-stable:latest"
            assert ttl > 0
            assert json.loads(raw)["latest_version"] == "99.99.99"
    finally:
        server.shutdown()
        server.server_close()


async def test_community_update_channel_can_use_smoke_cache() -> None:
    cached_payload = {
        "available": True,
        "current_version": PRODUCT_VERSION,
        "latest_version": "77.77.77",
        "version": "77.77.77",
        "channel": "community-smoke",
        "manifest": {
            "version": "77.77.77",
            "channel": "community-smoke",
            "edition": "community",
            "checksum_sha256": "3" * 64,
            "package_url": "https://updates.treseko.com/download/pkg.tar.gz",
        },
    }
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        service = UpdateService(
            settings=UpdateSettings(
                updates_dir=root / "updates",
                backups_dir=root / "backups",
                app_dir=root / "app",
                frontend_dir=root / "frontend",
                engine_dir=root / "engine",
                worker_dir=root / "worker",
                history_file=root / "updates" / "update-history.json",
                database_url="",
            ),
            update_server_url="http://127.0.0.1:1",
        )
        fake_redis = _FakeRedis({"treseko:update:community-smoke:latest": json.dumps(cached_payload)})
        service._redis_cache_url = "redis://fake"
        service._redis = fake_redis  # type: ignore[assignment]
        result = await service.check_community_update("community-smoke")
        assert result["channel"] == "community-smoke"
        assert result["latest_version"] == "77.77.77"


async def test_update_manifest_normalization_rejects_invalid_source() -> None:
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        service = UpdateService(
            settings=UpdateSettings(
                updates_dir=root / "updates",
                backups_dir=root / "backups",
                app_dir=root / "app",
                frontend_dir=root / "frontend",
                engine_dir=root / "engine",
                worker_dir=root / "worker",
                history_file=root / "updates" / "update-history.json",
                database_url="",
            )
        )
        try:
            service._normalize_manifest({
                "version": "9.9.9",
                "channel": "community-stable",
                "edition": "community",
                "package_url": "https://updates.treseko.com/pkg.tar.gz",
                "checksum_sha256": "4" * 64,
                "previous_version": "0.0.0-not-installed",
            })
        except ValueError as exc:
            assert "requiere actualizar desde" in str(exc)
        else:
            raise AssertionError("invalid source version was accepted by manifest normalization")
        assert await service.get_update_history() == []


async def test_apply_update_rejects_legacy_installation_before_queueing() -> None:
    from app.services.update_installation_mode import InstallationModeError

    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        service = UpdateService(settings=UpdateSettings(
            updates_dir=root / "updates", backups_dir=root / "backups",
            app_dir=root / "app", frontend_dir=root / "frontend",
            engine_dir=root / "engine", worker_dir=root / "worker",
            history_file=root / "updates" / "update-history.json", database_url="",
        ))
        try:
            await service.apply_update(
                channel="community-stable",
                manifest={"version": "9.9.9", "channel": "community-stable",
                          "edition": "community", "package_url": "https://updates.treseko.com/pkg.tar.gz",
                          "checksum_sha256": "4" * 64},
            )
        except InstallationModeError as exc:
            assert exc.code == "atomic_update_coordinator_required"
        else:
            raise AssertionError("legacy installation was allowed to queue a non-atomic app update")
        assert service._tasks == {}
        assert await service.get_update_history() == []


async def test_update_history_records_operator_context() -> None:
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        settings = UpdateSettings(
            updates_dir=root / "updates",
            backups_dir=root / "backups",
            app_dir=root / "app",
            frontend_dir=root / "frontend",
            engine_dir=root / "engine",
            worker_dir=root / "worker",
            history_file=root / "updates" / "update-history.json",
            database_url="",
        )
        service = UpdateService(settings=settings)
        with patch("app.services.updater_operations.require_update_runtime", return_value="coordinated"), \
                patch("app.services.updater_lifecycle.require_update_runtime", return_value="coordinated"), \
                patch("app.services.update_host_bridge_client.CoordinatedBridgeSettings.from_environment",
                      return_value=object()), \
                patch("app.services.updater_lifecycle.CoordinatedBridgeClient",
                      side_effect=RuntimeError("simulated host bridge unavailable")):
            task_id = await service.apply_update(
                channel="community-stable",
                manifest={
                    "version": "9.9.9",
                    "channel": "community-stable",
                    "edition": "community",
                    "checksum_sha256": "0" * 64,
                    "package_url": "http://127.0.0.1:1/missing.tar.gz",
                },
                initiated_by_user_id="user-1",
                initiated_by_email="admin@qa.local",
                initiated_from_ip="203.0.113.10",
                apply_confirmation="APPLY_UPDATE",
            )

            for _ in range(50):
                status = await service.get_update_status(task_id)
                if status["status"] == "failed":
                    break
                await asyncio.sleep(0.02)
            else:
                raise AssertionError("update task did not fail as expected")

        history_payload = json.loads(settings.history_file.read_text(encoding="utf-8"))
        task = history_payload["tasks"][0]
        assert task["initiated_by_user_id"] == "user-1"
        assert task["initiated_by_email"] == "admin@qa.local"
        assert task["initiated_from_ip"] == "203.0.113.10"
        assert task["apply_confirmation"] == "APPLY_UPDATE"
        events = task["events"]
        assert [event["event"] for event in events[:2]] == ["queued", "started"]
        assert events[0]["details"]["confirmation"] == "APPLY_UPDATE"
        assert events[0]["details"]["force_restart"] is False
        assert events[-1]["event"] == "failed"
        assert events[-1]["details"]["error"]
        assert all(event.get("actor_email") == "admin@qa.local" for event in events if event["event"] in {"queued", "started"})

        result = await service.rollback(
            task_id,
            requested_by_user_id="user-2",
            requested_by_email="ops@qa.local",
            requested_from_ip="203.0.113.20",
        )
        assert result["rollback_by_user_id"] == "user-2"
        assert result["rollback_by_email"] == "ops@qa.local"
        assert result["rollback_from_ip"] == "203.0.113.20"
        assert result["rollback_requested_at"]
        assert result["rollback_restore_database"] is False
        rollback_events = result["events"]
        assert rollback_events[-2]["event"] == "rollback_requested"
        assert rollback_events[-2]["actor_email"] == "ops@qa.local"
        assert rollback_events[-2]["ip_address"] == "203.0.113.20"
        assert rollback_events[-1]["event"] == "rollback"
        assert rollback_events[-1]["details"] == {"restored_code": False, "restored_database": False}


async def test_rollback_restores_code_backup_and_clears_ready_flag() -> None:
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        settings = UpdateSettings(
            updates_dir=root / "updates",
            backups_dir=root / "backups",
            app_dir=root / "app",
            frontend_dir=root / "frontend",
            engine_dir=root / "engine",
            worker_dir=root / "worker",
            history_file=root / "updates" / "update-history.json",
            database_url="",
        )
        for path in [
            settings.app_dir / "app",
            settings.app_dir / "alembic",
            settings.frontend_dir,
            settings.engine_dir,
            settings.worker_dir,
        ]:
            path.mkdir(parents=True)
            (path / "version.txt").write_text("old", encoding="utf-8")

        service = UpdateService(settings=settings)
        task_id = "rollback-test"
        backup_path = await service._backup_code("0.9.0-test", task_id)
        service._tasks[task_id] = UpdateTaskState(
            task_id=task_id,
            status="done",
            channel="community-stable",
            version="1.0.0-test",
            rollback_path=str(backup_path),
        )
        service._latest_task_id = task_id
        settings.updates_dir.mkdir(parents=True, exist_ok=True)
        (settings.updates_dir / "update-ready").write_text(str(root / "pending"), encoding="utf-8")

        for path in [
            settings.app_dir / "app",
            settings.app_dir / "alembic",
            settings.frontend_dir,
            settings.engine_dir,
            settings.worker_dir,
        ]:
            (path / "version.txt").write_text("new", encoding="utf-8")

        result = await service.rollback(task_id)
        assert result["stage"] == "rollback_restored"
        assert result["events"][-1]["event"] == "rollback_restored"
        assert result["events"][-1]["details"]["restored_code"] is True
        assert not (settings.updates_dir / "update-ready").exists()
        for path in [
            settings.app_dir / "app",
            settings.app_dir / "alembic",
            settings.frontend_dir,
            settings.engine_dir,
            settings.worker_dir,
        ]:
            assert (path / "version.txt").read_text(encoding="utf-8") == "old"


async def test_rollback_database_requires_opt_in_and_streams_backup_to_psql() -> None:
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        capture_path = root / "restored.sql"
        fake_psql = root / "fake-psql.sh"
        fake_psql.write_text(
            "#!/bin/sh\ncat > \"$TRESEKO_FAKE_PSQL_CAPTURE\"\n",
            encoding="utf-8",
        )
        fake_psql.chmod(0o755)
        db_backup = root / "backups" / "pre-update-db-test.sql.gz"
        db_backup.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(db_backup, "wb") as fh:
            fh.write(b"SELECT 'rollback-ok';\n")

        settings = UpdateSettings(
            updates_dir=root / "updates",
            backups_dir=root / "backups",
            app_dir=root / "app",
            frontend_dir=root / "frontend",
            engine_dir=root / "engine",
            worker_dir=root / "worker",
            history_file=root / "updates" / "update-history.json",
            database_url="postgresql://user:pass@localhost:5432/treseko",
            psql_path=str(fake_psql),
        )
        service = UpdateService(settings=settings)
        task_id = "rollback-db-test"
        service._tasks[task_id] = UpdateTaskState(
            task_id=task_id,
            status="done",
            channel="community-stable",
            version="1.0.0-test",
            backup_path=str(db_backup),
        )
        service._latest_task_id = task_id

        try:
            await service.rollback(task_id, restore_database=True, confirmation="RESTORE_DATABASE")
        except ValueError as exc:
            assert "deshabilitado" in str(exc)
        else:
            raise AssertionError("database rollback was allowed without opt-in")

        previous_allow = os.environ.get("TRESEKO_ALLOW_DB_ROLLBACK")
        previous_capture = os.environ.get("TRESEKO_FAKE_PSQL_CAPTURE")
        os.environ["TRESEKO_ALLOW_DB_ROLLBACK"] = "true"
        os.environ["TRESEKO_FAKE_PSQL_CAPTURE"] = str(capture_path)
        try:
            result = await service.rollback(task_id, restore_database=True, confirmation="RESTORE_DATABASE")
        finally:
            if previous_allow is None:
                os.environ.pop("TRESEKO_ALLOW_DB_ROLLBACK", None)
            else:
                os.environ["TRESEKO_ALLOW_DB_ROLLBACK"] = previous_allow
            if previous_capture is None:
                os.environ.pop("TRESEKO_FAKE_PSQL_CAPTURE", None)
            else:
                os.environ["TRESEKO_FAKE_PSQL_CAPTURE"] = previous_capture

        assert result["stage"] == "rollback_db_restored"
        restored_sql = capture_path.read_text(encoding="utf-8")
        assert "DROP SCHEMA IF EXISTS public CASCADE;" in restored_sql
        assert "CREATE SCHEMA public;" in restored_sql
        assert "SELECT 'rollback-ok';\n" in restored_sql


async def test_extract_package_requires_internal_metadata_to_match_manifest() -> None:
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        settings = UpdateSettings(
            updates_dir=root / "updates",
            backups_dir=root / "backups",
            app_dir=root / "app",
            frontend_dir=root / "frontend",
            engine_dir=root / "engine",
            worker_dir=root / "worker",
            history_file=root / "updates" / "update-history.json",
            database_url="",
        )
        service = UpdateService(settings=settings)
        package_path = root / "valid.tar.gz"
        package_path.write_bytes(_update_package_bytes("1.2.3"))
        manifest = {
            "version": "1.2.3",
            "channel": "community-stable",
            "edition": "community",
            "artifact": "treseko-update-v1.2.3.tar.gz",
        }
        extracted = await service._extract_package(package_path, manifest, "extract-ok")
        assert (extracted / "manifest.json").exists()
        assert (extracted / "VERSION").read_text(encoding="utf-8") == "1.2.3"
        assert (extracted / "CHANGELOG.md").read_text(encoding="utf-8").strip()

        bad_package_path = root / "bad-version.tar.gz"
        bad_package_path.write_bytes(_update_package_bytes("1.2.3", version_file="9.9.9"))
        try:
            await service._extract_package(bad_package_path, manifest, "extract-bad")
        except ValueError as exc:
            assert "version interna" in str(exc)
        else:
            raise AssertionError("package with mismatched internal VERSION was accepted")

        no_changelog_path = root / "no-changelog.tar.gz"
        no_changelog_path.write_bytes(_update_package_bytes("1.2.3", include_changelog=False))
        try:
            await service._extract_package(no_changelog_path, manifest, "extract-no-changelog")
        except ValueError as exc:
            assert "CHANGELOG.md" in str(exc)
        else:
            raise AssertionError("package without CHANGELOG.md was accepted")


async def test_systemd_restart_uses_systemctl_no_block() -> None:
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        calls_path = root / "systemctl-calls.txt"
        fake_systemctl = root / "fake-systemctl.sh"
        fake_systemctl.write_text(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$TRESEKO_FAKE_SYSTEMCTL_CALLS\"\n",
            encoding="utf-8",
        )
        fake_systemctl.chmod(0o755)
        previous_capture = os.environ.get("TRESEKO_FAKE_SYSTEMCTL_CALLS")
        os.environ["TRESEKO_FAKE_SYSTEMCTL_CALLS"] = str(calls_path)
        try:
            settings = UpdateSettings(
                updates_dir=root / "updates",
                backups_dir=root / "backups",
                app_dir=root / "app",
                frontend_dir=root / "frontend",
                engine_dir=root / "engine",
                worker_dir=root / "worker",
                history_file=root / "updates" / "update-history.json",
                database_url="",
                docker_mode=False,
                systemctl_path=str(fake_systemctl),
                systemd_service_name="treseko-backend-test",
            )
            service = UpdateService(settings=settings)
            await service._restart_services()
        finally:
            if previous_capture is None:
                os.environ.pop("TRESEKO_FAKE_SYSTEMCTL_CALLS", None)
            else:
                os.environ["TRESEKO_FAKE_SYSTEMCTL_CALLS"] = previous_capture
        assert calls_path.read_text(encoding="utf-8").strip() == "restart --no-block treseko-backend-test"


def run_checks() -> None:
    test_update_db_history_default_is_enabled_for_production_runtime()
    asyncio.run(test_update_history_survives_service_restart())
    asyncio.run(test_applied_marker_completes_restarting_task_after_boot())
    asyncio.run(test_community_update_check_uses_cache())
    asyncio.run(test_manual_community_update_check_bypasses_cache())
    asyncio.run(test_community_update_ignores_cache_from_previous_installed_version())
    asyncio.run(test_update_step_timeout_fails_fast())
    asyncio.run(test_community_update_check_uses_redis_when_available())
    asyncio.run(test_community_update_check_writes_redis_cache())
    asyncio.run(test_community_update_channel_can_use_smoke_cache())
    asyncio.run(test_update_manifest_normalization_rejects_invalid_source())
    asyncio.run(test_apply_update_queues_legacy_transition_without_host_coordinator())
    asyncio.run(test_update_history_records_operator_context())
    asyncio.run(test_rollback_restores_code_backup_and_clears_ready_flag())
    asyncio.run(test_rollback_database_requires_opt_in_and_streams_backup_to_psql())
    asyncio.run(test_extract_package_requires_internal_metadata_to_match_manifest())
    asyncio.run(test_systemd_restart_uses_systemctl_no_block())
    print("Updater history persistence checks OK")


if __name__ == "__main__":
    run_checks()

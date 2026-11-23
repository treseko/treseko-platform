from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest
import asyncio
from unittest.mock import AsyncMock, patch
from app.services.update_installation_mode import (
    InstallationModeError,
    require_atomic_update_coordinator,
    require_update_runtime,
    resolve,
)


class AtomicUpdateAdmissionTests(unittest.TestCase):
    def test_coordinated_binding_accepts_explicit_install_owner_uid(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            binding = Path(temp_dir).resolve() / "binding.json"
            binding.write_text('{"schema":1,"installation_id":"install-1","mode":"coordinated","owner":"host-update-coordinator","generation":1}\n')
            binding.chmod(0o600)
            with patch.dict(os.environ, {
                "TRESEKO_UPDATE_MODE": "coordinated",
                "TRESEKO_INSTALLATION_BINDING_OWNER_UID": str(os.getuid()),
            }, clear=True), patch(
                "app.services.update_installation_mode.binding_path", return_value=binding,
            ):
                self.assertEqual(resolve("coordinated-serve"), "coordinated")

    def test_coordinated_binding_rejects_owner_uid_mismatch(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            binding = Path(temp_dir).resolve() / "binding.json"
            binding.write_text('{"schema":1,"installation_id":"install-1","mode":"coordinated","owner":"host-update-coordinator","generation":1}\n')
            binding.chmod(0o600)
            wrong_uid = os.getuid() + 1
            with patch.dict(os.environ, {
                "TRESEKO_UPDATE_MODE": "coordinated",
                "TRESEKO_INSTALLATION_BINDING_OWNER_UID": str(wrong_uid),
            }, clear=True), patch(
                "app.services.update_installation_mode.binding_path", return_value=binding,
            ):
                with self.assertRaises(InstallationModeError) as raised:
                    resolve("coordinated-serve")
            self.assertIn(raised.exception.code, {
                "installation_binding_unsafe", "installation_binding_unsafe_parent",
            })

    def test_coordinated_binding_rejects_group_writable_owner_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir).resolve() / "unsafe"
            directory.mkdir(mode=0o700)
            directory.chmod(0o770)
            binding = directory / "binding.json"
            binding.write_text('{"schema":1,"installation_id":"install-1","mode":"coordinated","owner":"host-update-coordinator","generation":1}\n')
            binding.chmod(0o600)
            with patch.dict(os.environ, {
                "TRESEKO_UPDATE_MODE": "coordinated",
                "TRESEKO_INSTALLATION_BINDING_OWNER_UID": str(os.getuid()),
            }, clear=True), patch(
                "app.services.update_installation_mode.binding_path", return_value=binding,
            ):
                with self.assertRaises(InstallationModeError) as raised:
                    resolve("coordinated-serve")
            self.assertEqual(raised.exception.code, "installation_binding_unsafe_parent")

    def test_unbound_installation_cannot_use_in_app_updater(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            missing_binding = Path(temp_dir) / "binding.json"
            with patch.dict(os.environ, {}, clear=True), patch(
                "app.services.update_installation_mode.binding_path",
                return_value=missing_binding,
            ):
                with self.assertRaises(InstallationModeError) as raised:
                    require_atomic_update_coordinator()
        self.assertEqual(raised.exception.code, "atomic_update_coordinator_required")

    def test_systemd_native_installation_uses_the_local_entrypoint_updater(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            missing_binding = Path(temp_dir) / "binding.json"
            with patch.dict(os.environ, {"TRESEKO_DEPLOY_MODE": "systemd"}, clear=True), patch(
                "app.services.update_installation_mode.binding_path",
                return_value=missing_binding,
            ):
                self.assertEqual(require_update_runtime(), "systemd-native")

    def test_systemd_native_apply_queues_without_compose_bridge_config(self):
        from app.services import updater_operations
        from app.services.updater import UpdateService, UpdateSettings

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service = UpdateService(settings=UpdateSettings(
                updates_dir=root / "updates", backups_dir=root / "backups",
                app_dir=root / "app", frontend_dir=root / "frontend",
                engine_dir=root / "engine", worker_dir=root / "worker",
                history_file=root / "updates" / "history.json", database_url="",
                docker_mode=False,
            ))
            service._run_apply = AsyncMock()
            with patch.dict(os.environ, {"TRESEKO_DEPLOY_MODE": "systemd"}, clear=True), patch(
                "app.services.update_installation_mode.binding_path",
                return_value=root / "missing-binding.json",
            ), patch.object(updater_operations, "require_update_runtime", return_value="systemd-native"):
                task_id = asyncio.run(service.apply_update(
                    channel="community-stable",
                    manifest={
                        "version": "1.0.8", "channel": "community-stable",
                        "edition": "community", "package_url": "https://updates.example.test/1.0.8.tar.gz",
                        "checksum_sha256": "a" * 64,
                    },
                ))
            self.assertIn(task_id, service._tasks)
            self.assertEqual(service._tasks[task_id].status, "queued")

    def test_unbound_docker_installation_still_requires_coordinator(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            missing_binding = Path(temp_dir) / "binding.json"
            with patch.dict(os.environ, {"TRESEKO_DEPLOY_MODE": "docker"}, clear=True), patch(
                "app.services.update_installation_mode.binding_path",
                return_value=missing_binding,
            ):
                with self.assertRaises(InstallationModeError) as raised:
                    require_update_runtime()
        self.assertEqual(raised.exception.code, "atomic_update_coordinator_required")

    def test_unbound_installation_is_classified_legacy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            missing_binding = Path(temp_dir) / "binding.json"
            with patch.dict(os.environ, {}, clear=True), patch(
                "app.services.update_installation_mode.binding_path",
                return_value=missing_binding,
            ):
                self.assertEqual(
                    __import__("app.services.update_installation_mode", fromlist=["require"]).require("request"),
                    "legacy",
                )

    def test_community_apply_rejects_legacy_before_creating_task(self):
        from app.services.updater import UpdateService, UpdateSettings

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            missing_binding = root / "binding.json"
            service = UpdateService(settings=UpdateSettings(
                updates_dir=root / "updates", backups_dir=root / "backups",
                app_dir=root / "app", frontend_dir=root / "frontend",
                engine_dir=root / "engine", worker_dir=root / "worker",
                history_file=root / "updates" / "history.json", database_url="",
            ))
            with patch.dict(os.environ, {}, clear=True), patch(
                "app.services.update_installation_mode.binding_path",
                return_value=missing_binding,
            ):
                with self.assertRaises(InstallationModeError) as raised:
                    asyncio.run(service.apply_update(
                        channel="community-stable",
                        manifest={"version": "1.0.7", "channel": "community-stable",
                                  "edition": "community", "package_url": "https://updates.example.test/package.tar.gz",
                                  "checksum_sha256": "a" * 64},
                    ))
            self.assertEqual(raised.exception.code, "atomic_update_coordinator_required")
            self.assertEqual(service._tasks, {})

    def test_legacy_mode_cannot_use_in_app_updater(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            missing_binding = Path(temp_dir) / "binding.json"
            with patch.dict(os.environ, {"TRESEKO_UPDATE_MODE": "legacy"}, clear=True), patch(
                "app.services.update_installation_mode.binding_path",
                return_value=missing_binding,
            ):
                with self.assertRaises(InstallationModeError) as raised:
                    require_atomic_update_coordinator()
        self.assertEqual(raised.exception.code, "atomic_update_coordinator_required")


if __name__ == "__main__":
    unittest.main()

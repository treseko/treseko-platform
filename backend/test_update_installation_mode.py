from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest
import asyncio
from unittest.mock import patch
from app.services.update_installation_mode import (
    InstallationModeError,
    require_atomic_update_coordinator,
)


class AtomicUpdateAdmissionTests(unittest.TestCase):
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

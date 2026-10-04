from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest
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

    def test_legacy_installation_is_admitted_to_transition_lane(self):
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

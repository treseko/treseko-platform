from unittest.mock import patch
import os
import tempfile
from pathlib import Path

from app.services import update_installation_mode


def test_legacy_installation_is_reported_as_not_ota_applicable():
    with patch.object(update_installation_mode, "resolve", return_value="legacy"):
        assert update_installation_mode.update_installation_status() == {
            "apply_supported": False,
            "installation_mode": "legacy",
            "update_block_reason": "atomic_update_coordinator_required",
        }


def test_coordinated_installation_is_reported_as_ota_applicable():
    with patch.object(update_installation_mode, "resolve", return_value="coordinated"):
        assert update_installation_mode.update_installation_status() == {
            "apply_supported": True,
            "installation_mode": "coordinated",
            "update_block_reason": None,
        }


def test_native_systemd_installation_is_reported_as_ota_applicable():
    with patch.object(update_installation_mode, "resolve", return_value="legacy"), patch.dict(
        "os.environ", {"TRESEKO_DEPLOY_MODE": "systemd"}, clear=True
    ):
        assert update_installation_mode.update_installation_status() == {
            "apply_supported": True,
            "installation_mode": "systemd-native",
            "update_block_reason": None,
        }


def test_native_paired_worker_requires_restart_bootstrap():
    with tempfile.TemporaryDirectory() as temp_dir:
        worker_dir = Path(temp_dir)
        with patch.object(update_installation_mode, "resolve", return_value="legacy"), patch.dict(
            os.environ,
            {"TRESEKO_DEPLOY_MODE": "systemd", "TRESEKO_WORKER_DIR": str(worker_dir)},
            clear=True,
        ), patch.object(update_installation_mode, "shutil") as shutil_mock, patch.object(
            update_installation_mode.subprocess, "run"
        ) as run_mock:
            shutil_mock.which.return_value = "/usr/bin/systemctl"
            run_mock.return_value.returncode = 0
            run_mock.return_value.stdout = "LoadState=loaded\nRestart=on-failure\n"
            assert update_installation_mode.update_installation_status() == {
                "apply_supported": False,
                "installation_mode": "systemd-native",
                "update_block_reason": "native_worker_restart_bootstrap_required",
            }


def test_native_paired_worker_is_ready_after_restart_bootstrap():
    with tempfile.TemporaryDirectory() as temp_dir:
        worker_dir = Path(temp_dir)
        with patch.object(update_installation_mode, "resolve", return_value="legacy"), patch.dict(
            os.environ,
            {"TRESEKO_DEPLOY_MODE": "systemd", "TRESEKO_WORKER_DIR": str(worker_dir)},
            clear=True,
        ), patch.object(update_installation_mode, "shutil") as shutil_mock, patch.object(
            update_installation_mode.subprocess, "run"
        ) as run_mock:
            shutil_mock.which.return_value = "/usr/bin/systemctl"
            run_mock.return_value.returncode = 0
            run_mock.return_value.stdout = "LoadState=loaded\nRestart=always\n"
            assert update_installation_mode.update_installation_status() == {
                "apply_supported": True,
                "installation_mode": "systemd-native",
                "update_block_reason": None,
            }


def test_invalid_host_binding_fails_closed_for_ota():
    with patch.object(
        update_installation_mode,
        "resolve",
        side_effect=update_installation_mode.InstallationModeError("installation_binding_unsafe"),
    ):
        assert update_installation_mode.update_installation_status() == {
            "apply_supported": False,
            "installation_mode": "invalid",
            "update_block_reason": "installation_binding_unsafe",
        }

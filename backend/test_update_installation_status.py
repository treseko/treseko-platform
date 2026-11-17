from unittest.mock import patch

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

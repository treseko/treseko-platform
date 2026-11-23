"""Hermetic HTTP contract for update discovery and status endpoints."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.routers import system as system_router
from app.api.routers import system_updates as updates_router
from app.database import engine
from app.main import app
from app.services.premium_runtime.verification_client import PremiumUpdateUnavailable
from test_api_project_http_flow import _create_admin, _login


class _FakeUpdateService:
    def __init__(self):
        self.last_force_refresh = None
        self.apply_calls = 0

    async def check_community_update(self, channel=None, *, force_refresh=False):
        self.last_force_refresh = force_refresh
        return {
            "available": True,
            "current_version": "1.0.0",
            "latest_version": "9.9.9",
            "version": "9.9.9",
            "channel": channel or "community-stable",
            "edition": "community",
            "checksum_sha256": "a" * 64,
            "package_size_bytes": 128,
            "changelog": "Controlled update fixture",
            "manifest": {"version": "9.9.9", "channel": channel or "community-stable"},
            "force_refresh": force_refresh,
        }

    async def get_update_status(self, task_id=None):
        if task_id == "missing":
            return {"task_id": None, "status": "idle", "current_version": "1.0.0", "progress_pct": 0}
        return {
            "task_id": task_id or "current-task",
            "status": "failed",
            "current_version": "1.0.0",
            "progress_pct": 100,
        }

    async def get_update_history(self, _limit):
        return [{"task_id": "previous-task", "status": "done", "current_version": "1.0.0", "progress_pct": 100}]

    async def report_failure(self, task_id):
        return task_id == "current-task"

    def validate_update_request(self, *, channel, manifest):
        assert channel == "community-stable"
        assert manifest["version"] == "9.9.9"

    async def apply_update(self, **kwargs):
        self.apply_calls += 1
        assert kwargs["apply_confirmation"] == "APPLY_UPDATE"
        assert kwargs["channel"] == "community-stable"
        return "controlled-task"

    async def restart_prepared_update(self, task_id):
        assert task_id == "controlled-task"
        return {"task_id": task_id, "status": "restarting", "current_version": "1.0.0", "version": "9.9.9"}

    async def rollback(self, task_id, **kwargs):
        assert task_id == "controlled-task"
        assert kwargs["confirmation"] == "ROLLBACK_UPDATE"
        return {"task_id": task_id, "status": "rolled_back", "current_version": "1.0.0", "version": "1.0.0", "stage": "rollback"}


class _FakeEntitlements:
    def __init__(self):
        self.state = {
            "edition": "community", "state": "active", "valid": True,
            "reason": None, "license": None, "limits": {}, "enabled_features": [],
            "update_channel": "community-stable",
        }

    async def get_state(self, _db):
        return self.state


def test_community_update_discovery_and_status_http_contract(monkeypatch):
    fake_service = _FakeUpdateService()
    fake_entitlements = _FakeEntitlements()
    monkeypatch.setattr(system_router, "get_update_service", lambda: fake_service)
    monkeypatch.setattr(system_router, "get_entitlement_provider", lambda: fake_entitlements)
    monkeypatch.setattr(updates_router, "require_update_runtime", lambda: "coordinated")
    monkeypatch.setattr(updates_router, "update_installation_status", lambda: {
        "apply_supported": True, "installation_mode": "coordinated", "update_block_reason": None,
    })
    manifest_validation = {
        "allowed": True,
        "edition": "community",
        "channel": "community-stable",
        "version": "9.9.9",
        "artifact": "treseko-9.9.9.tar.gz",
        "artifact_type": "treseko-self-hosted",
        "package_size_bytes": 128,
        "package_url": "https://updates.example.test/treseko-9.9.9.tar.gz",
        "checksum_sha256": "a" * 64,
        "download_grant_required": False,
        "update_server_path": None,
    }
    premium_manifest_validation = {
        **manifest_validation,
        "edition": "premium",
        "channel": "premium-stable",
        "update_server_path": "/updates/premium/9.9.9",
        "download_grant_required": True,
    }

    def validate_manifest(manifest, _state):
        return premium_manifest_validation if manifest.get("edition") == "premium" else manifest_validation

    monkeypatch.setattr(system_router, "validate_update_manifest", validate_manifest)
    monkeypatch.setattr(
        system_router,
        "prepare_update_download_grant_request",
        lambda *_args, **_kwargs: {
            "grant_required": False,
            "reason": "Community direct download",
            "update_server_path": None,
            "license": None,
            "manifest": {"version": "9.9.9"},
            "artifact": "treseko-9.9.9.tar.gz",
            "artifact_type": "treseko-self-hosted",
            "package_size_bytes": 128,
            "checksum_sha256": "a" * 64,
        },
    )
    suffix = uuid4().hex
    email = f"updates-flow-{suffix}@example.test"
    password = "UpdatesFlowPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        channels = client.get("/system/updates/channels", headers=headers)
        assert channels.status_code == 200, channels.text
        assert any(item["id"] == "community-stable" and item["allowed"] for item in channels.json()["channels"])
        latest = client.get("/system/updates/latest", headers=headers)
        assert latest.status_code == 200, latest.text
        assert latest.json()["available"] is True
        assert latest.json()["latest_version"] == "9.9.9"
        community = client.get("/system/updates/check-community?force=true", headers=headers)
        assert community.status_code == 200, community.text
        assert community.json()["available"] is True
        assert fake_service.last_force_refresh is True
        current = client.get("/system/updates/status", headers=headers)
        assert current.status_code == 200, current.text
        assert current.json()["task_id"] == "current-task"
        by_id = client.get("/system/updates/status/current-task", headers=headers)
        assert by_id.status_code == 200, by_id.text
        missing = client.get("/system/updates/status/missing", headers=headers)
        assert missing.status_code == 404
        history = client.get("/system/updates/history", headers=headers)
        assert history.status_code == 200, history.text
        assert history.json()["tasks"][0]["task_id"] == "previous-task"
        reported = client.post("/system/updates/report-failure/current-task", headers=headers)
        assert reported.status_code == 200, reported.text
        assert reported.json() == {"status": "reported", "task_id": "current-task"}

        manifest = {
            "edition": "community",
            "channel": "community-stable",
            "version": "9.9.9",
            "artifact": "treseko-9.9.9.tar.gz",
            "artifact_type": "treseko-self-hosted",
            "package_size_bytes": 128,
            "package_url": "https://updates.example.test/treseko-9.9.9.tar.gz",
            "checksum_sha256": "a" * 64,
        }
        checked = client.post("/system/updates/check", headers=headers, json={"manifest": manifest})
        assert checked.status_code == 200, checked.text
        assert checked.json()["version"] == "9.9.9"
        grant = client.post("/system/updates/download-grant-request", headers=headers, json={"manifest": manifest})
        assert grant.status_code == 200, grant.text
        assert grant.json()["grant_required"] is False
        applied = client.post(
            "/system/updates/apply",
            headers=headers,
            json={"channel": "community-stable", "manifest": manifest, "confirmation": "APPLY_UPDATE"},
        )
        assert applied.status_code == 200, applied.text
        assert applied.json() == {"task_id": "controlled-task", "status": "queued"}
        assert fake_service.apply_calls == 1
        restarted = client.post("/system/updates/restart/controlled-task", headers=headers)
        assert restarted.status_code == 200, restarted.text
        assert restarted.json()["status"] == "restarting"
        rolled_back = client.post(
            "/system/updates/rollback/controlled-task",
            headers=headers,
            json={"restore_database": True, "confirmation": "ROLLBACK_UPDATE"},
        )
        assert rolled_back.status_code == 200, rolled_back.text
        assert rolled_back.json()["status"] == "rolled_back"

        # License and Premium update operations are hermetic: all verification
        # calls are replaced with a signed-state fixture, never a live server.
        license_state = {
            "edition": "premium", "state": "active", "valid": True,
            "reason": None,
            "license": {"license_id": "controlled-license", "update_channel": "premium-stable"},
            "limits": {"max_users": 50}, "enabled_features": ["updates.premium"],
            "update_channel": "premium-stable", "online_status": "verified",
        }

        async def install_license(_db, _payload):
            return license_state

        async def installed_license(_db):
            return license_state["license"]

        async def online_activate(_license):
            return license_state

        async def online_heartbeat(_license):
            return {**license_state, "last_check_at": "2026-07-27T00:00:00Z"}

        async def save_online(_db, state):
            return state

        async def fetch_premium(_license, *, current_version):
            assert current_version
            return {
                "edition": "premium", "channel": "premium-stable", "version": "9.9.9",
                "artifact": "treseko-premium-9.9.9.tar.gz", "artifact_type": "treseko-self-hosted",
                "package_size_bytes": 128, "checksum_sha256": "a" * 64,
                "changelog": "Controlled Premium update",
            }

        monkeypatch.setattr(system_router, "install_license", install_license)
        monkeypatch.setattr(system_router, "get_installed_license", installed_license)
        monkeypatch.setattr(system_router, "activate_license_online", online_activate)
        monkeypatch.setattr(system_router, "heartbeat_license_online", online_heartbeat)
        monkeypatch.setattr(system_router, "save_online_license_state", save_online)
        monkeypatch.setattr(system_router, "fetch_latest_premium_update_manifest", fetch_premium)
        fake_entitlements.state = license_state

        installed = client.post("/system/license/install", headers=headers, json={"license": "controlled"})
        assert installed.status_code == 200, installed.text
        assert installed.json()["edition"] == "premium"
        activated = client.post("/system/license/activate", headers=headers)
        assert activated.status_code == 200, activated.text
        heartbeated = client.post("/system/license/heartbeat", headers=headers)
        assert heartbeated.status_code == 200, heartbeated.text
        premium_manifest = {
            "edition": "premium", "key_id": "controlled-update-key", "channel": "premium-stable", "version": "9.9.9",
            "artifact": "treseko-premium-9.9.9.tar.gz", "artifact_type": "treseko-self-hosted",
            "package_size_bytes": 128, "package_url": "https://updates.example.test/premium.tar.gz",
            "checksum_sha256": "a" * 64,
        }
        premium_checked = client.post("/system/updates/check-premium", headers=headers, json={"manifest": premium_manifest})
        assert premium_checked.status_code == 200, premium_checked.text
        assert premium_checked.json()["edition"] == "premium"
        premium_synced = client.post("/system/updates/sync-premium", headers=headers)
        assert premium_synced.status_code == 200, premium_synced.text
        assert premium_synced.json()["edition"] == "premium"
        assert premium_synced.json()["apply_supported"] is True

        monkeypatch.setattr(updates_router, "update_installation_status", lambda: {
            "apply_supported": False, "installation_mode": "legacy",
            "update_block_reason": "atomic_update_coordinator_required",
        })
        legacy_latest = client.get("/system/updates/latest", headers=headers)
        assert legacy_latest.status_code == 200, legacy_latest.text
        assert legacy_latest.json()["available"] is True
        assert legacy_latest.json()["apply_supported"] is False
        assert legacy_latest.json()["installation_mode"] == "legacy"
        assert legacy_latest.json()["update_block_reason"] == "atomic_update_coordinator_required"

        async def no_premium_update(_license, *, current_version):
            assert current_version
            raise PremiumUpdateUnavailable("No hay una version posterior aplicable para este canal.")

        monkeypatch.setattr(system_router, "fetch_latest_premium_update_manifest", no_premium_update)
        premium_current = client.post("/system/updates/sync-premium", headers=headers)
        assert premium_current.status_code == 200, premium_current.text
        assert premium_current.json()["available"] is False
        assert premium_current.json()["latest_version"] is None
        assert premium_current.json()["error"] is None

        grant_calls = 0

        async def forbidden_grant(*_args, **_kwargs):
            nonlocal grant_calls
            grant_calls += 1
            raise AssertionError("A legacy installation must not consume a Premium DownloadGrant")

        def missing_coordinator():
            from app.services.update_installation_mode import InstallationModeError
            raise InstallationModeError("atomic_update_coordinator_required")

        monkeypatch.setattr(updates_router, "require_update_runtime", missing_coordinator)
        blocked_community_apply = client.post(
            "/system/updates/apply",
            headers=headers,
            json={"channel": "community-stable", "manifest": manifest,
                  "confirmation": "APPLY_UPDATE"},
        )
        assert blocked_community_apply.status_code == 409, blocked_community_apply.text
        assert blocked_community_apply.json()["detail"] == "atomic_update_coordinator_required"
        assert fake_service.apply_calls == 1
        monkeypatch.setattr(system_router, "request_premium_download_grant", forbidden_grant)
        blocked_apply = client.post(
            "/system/updates/apply",
            headers=headers,
            json={"channel": "premium-stable", "manifest": premium_manifest,
                  "confirmation": "APPLY_UPDATE"},
        )
        assert blocked_apply.status_code == 409, blocked_apply.text
        assert blocked_apply.json()["detail"] == "atomic_update_coordinator_required"
        assert grant_calls == 0
        client.portal.call(engine.dispose)

"""Hermetic HTTP lifecycle for public and governed system configuration."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from app.services.edition import entitlement_service
from test_api_project_http_flow import _create_admin, _login


async def _premium_features_enabled(*_args, **_kwargs) -> bool:
    return True


def test_system_discovery_and_governed_preferences_http_lifecycle(monkeypatch):
    monkeypatch.setattr(entitlement_service, "is_feature_enabled", _premium_features_enabled)
    suffix = uuid4().hex
    email = f"system-flow-{suffix}@example.test"
    password = "SystemFlowPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        health = client.get("/health")
        assert health.status_code == 200, health.text
        assert health.json()["status"] == "ok"
        version = client.get("/system/version")
        assert version.status_code == 200, version.text
        assert version.json()["product"]
        public_branding = client.get("/system/branding/public")
        assert public_branding.status_code == 200, public_branding.text
        assert public_branding.json()["effective_brand_name"]

        headers = _login(client, email, password)
        edition = client.get("/system/edition", headers=headers)
        assert edition.status_code == 200, edition.text
        assert edition.json()["edition"] in {"community", "premium"}
        features = client.get("/system/features", headers=headers)
        assert features.status_code == 200, features.text
        assert isinstance(features.json()["features"], list)

        branding = client.get("/system/branding", headers=headers)
        assert branding.status_code == 200, branding.text
        assert branding.json()["effective_brand_name"]
        updated_branding = client.patch(
            "/system/branding",
            headers=headers,
            json={
                "brand_name": "Treseko Controlled QA",
                "logo_url": None,
                "enabled": True,
                "primary_color": "#172033",
                "accent_color": "#1677ff",
            },
        )
        assert updated_branding.status_code == 200, updated_branding.text
        assert isinstance(updated_branding.json()["can_customize"], bool)
        # The managed branding upload validates both multipart transport and
        # binary signature.  Remove its deterministic test asset afterwards.
        logo_bytes = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0dIDAT\x08\xd7c\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        uploaded_logo = client.post(
            "/system/branding/logo",
            headers=headers,
            files={"file": ("controlled-logo.png", logo_bytes, "image/png")},
        )
        assert uploaded_logo.status_code == 200, uploaded_logo.text
        assert uploaded_logo.json()["content_type"] == "image/png"
        Path("app" + uploaded_logo.json()["logo_url"]).unlink(missing_ok=True)
        time_settings = client.get("/system/time-settings", headers=headers)
        assert time_settings.status_code == 200, time_settings.text
        updated_time = client.patch(
            "/system/time-settings",
            headers=headers,
            json={"timezone": "America/Argentina/Buenos_Aires"},
        )
        assert updated_time.status_code == 200, updated_time.text
        assert updated_time.json()["timezone"] == "America/Argentina/Buenos_Aires"

        policy = client.get("/system/evidence-sanitization-policy", headers=headers)
        assert policy.status_code == 200, policy.text
        updated_policy = client.patch(
            "/system/evidence-sanitization-policy",
            headers=headers,
            json={"sanitization_enabled": False, "traceability_complete_enabled": True},
        )
        assert updated_policy.status_code == 200, updated_policy.text
        assert updated_policy.json()["sanitization_enabled"] is False
        assert updated_policy.json()["traceability_complete_enabled"] is True

        first_run = client.get("/system/first-run", headers=headers)
        assert first_run.status_code == 200, first_run.text
        completed_first_run = client.post(
            "/system/first-run",
            headers=headers,
            json={
                "terms_accepted": True,
                "terms_version": "test-2026-07",
                "survey": {"source": "http-lifecycle"},
                "telemetry_opt_in": False,
            },
        )
        assert completed_first_run.status_code == 200, completed_first_run.text
        assert completed_first_run.json()["completed"] is True
        license_state = client.get("/system/license", headers=headers)
        assert license_state.status_code == 200, license_state.text
        usage = client.get("/system/license/usage", headers=headers)
        assert usage.status_code == 200, usage.text
        trust = client.get("/system/trust", headers=headers)
        assert trust.status_code == 200, trust.text
        assert "update_keyring" in trust.json()
        monitor = client.get("/system-monitor/summary", headers=headers)
        assert monitor.status_code == 200, monitor.text
        client.portal.call(engine.dispose)

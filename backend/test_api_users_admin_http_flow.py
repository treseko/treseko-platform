"""HTTP lifecycle and privilege boundary for administrative user management."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from app.services.edition import user_limits
from test_api_project_http_flow import _create_admin, _login


def test_global_admin_can_manage_users_and_regular_user_is_denied(monkeypatch):
    async def allow_test_user_creation(*_args, **_kwargs) -> None:
        return None

    monkeypatch.setattr(user_limits, "enforce_active_user_limit", allow_test_user_creation)
    suffix = uuid4().hex
    admin_email = f"users-admin-{suffix}@example.test"
    admin_password = "UsersAdminPassword-2026!"
    _create_admin(admin_email, admin_password)

    with TestClient(app, raise_server_exceptions=False) as client:
        admin_headers = _login(client, admin_email, admin_password)
        preferences = client.patch(
            "/users/me/preferences",
            headers=admin_headers,
            json={"personal_theme": "dark", "profile_settings": {"table_density": "compact"}},
        )
        assert preferences.status_code == 200, preferences.text
        assert preferences.json()["personal_theme"] == "dark"
        profile = client.patch(
            "/users/me/profile",
            headers=admin_headers,
            json={"nombre_completo": "Users API admin updated", "display_name": "Users Admin"},
        )
        assert profile.status_code == 200, profile.text
        assert profile.json()["display_name"] == "Users Admin"

        target_email = f"managed-user-{suffix}@example.test"
        created = client.post(
            "/usuarios/",
            headers=admin_headers,
            json={
                "email": target_email,
                "nombre_completo": "Managed API user",
                "rol": "TESTER",
                "auth_provider": "local",
                "password": "ManagedUserPassword-2026!",
                "send_welcome": True,
            },
        )
        assert created.status_code == 200, created.text
        target_id = created.json()["id"]

        listed = client.get("/usuarios/", headers=admin_headers, params={"q": target_email})
        assert listed.status_code == 200, listed.text
        assert target_id in {item["id"] for item in listed.json()}

        updated = client.patch(
            f"/usuarios/{target_id}",
            headers=admin_headers,
            json={"nombre_completo": "Managed API user updated", "rol": "QA_LEAD"},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["rol"] == "QA_LEAD"

        revoked_welcome = client.post(
            f"/usuarios/{target_id}/welcome/revoke/", headers=admin_headers
        )
        assert revoked_welcome.status_code == 200, revoked_welcome.text
        assert revoked_welcome.json()["ok"] is True

        target_headers = _login(client, target_email, "ManagedUserPassword-2026!")
        forbidden_list = client.get("/usuarios/", headers=target_headers)
        assert forbidden_list.status_code == 403

        deactivated = client.delete(f"/usuarios/{target_id}", headers=admin_headers)
        assert deactivated.status_code == 200, deactivated.text
        assert deactivated.json()["activo"] is False
        client.portal.call(engine.dispose)

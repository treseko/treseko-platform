"""Authorized and invalid HTTP lifecycle for custom RBAC roles."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from app.services.edition import user_limits
from test_api_project_http_flow import _create_admin, _login


def test_global_admin_can_manage_a_custom_role_lifecycle(monkeypatch):
    """Role CRUD remains restricted to a global administrator and is auditable."""
    async def allow_test_user_creation(*_args, **_kwargs) -> None:
        return None

    monkeypatch.setattr(user_limits, "enforce_active_user_limit", allow_test_user_creation)
    suffix = uuid4().hex
    email = f"roles-flow-{suffix}@example.test"
    password = "RolesFlowPassword-2026!"
    _create_admin(email, password)

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            headers = _login(client, email, password)
            role_name = f"API role {suffix}"

            regular_email = f"roles-regular-{suffix}@example.test"
            registered = client.post(
                "/auth/register/",
                json={
                    "email": regular_email,
                    "password": "RegularRolesPassword-2026!",
                    "nombre_completo": "Regular RBAC actor",
                },
            )
            assert registered.status_code == 200, registered.text
            regular_headers = _login(client, regular_email, "RegularRolesPassword-2026!")
            forbidden_create = client.post(
                "/roles/",
                headers=regular_headers,
                json={"nombre": f"Forbidden role {suffix}"},
            )
            assert forbidden_create.status_code == 403

            created = client.post(
                "/roles/",
                headers=headers,
                json={
                    "nombre": role_name,
                    "descripcion": "Role created by the HTTP lifecycle test.",
                    "modulos": ["dashboard"],
                    "permisos": {"dashboard": "read"},
                    "permisos_detallados": {"dashboard.ver": "read"},
                },
            )
            assert created.status_code == 200, created.text
            role_id = created.json()["id"]

            duplicate = client.post(
                "/roles/",
                headers=headers,
                json={"nombre": role_name},
            )
            assert duplicate.status_code == 400

            listed = client.get("/roles/", headers=headers)
            assert listed.status_code == 200, listed.text
            assert role_id in {item["id"] for item in listed.json()}

            updated = client.patch(
                f"/roles/{role_id}",
                headers=headers,
                json={"descripcion": "Updated through the HTTP lifecycle.", "permisos": {"dashboard": "edit"}},
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["permisos"] == {"dashboard": "edit"}

            deactivated = client.delete(f"/roles/{role_id}", headers=headers)
            assert deactivated.status_code == 200, deactivated.text
            assert deactivated.json()["activo"] is False

            active_roles = client.get("/roles/", headers=headers)
            assert active_roles.status_code == 200, active_roles.text
            assert role_id not in {item["id"] for item in active_roles.json()}

            including_inactive = client.get("/roles/", headers=headers, params={"include_inactive": "true"})
            assert including_inactive.status_code == 200, including_inactive.text
            assert role_id in {item["id"] for item in including_inactive.json()}
            client.portal.call(engine.dispose)
    finally:
        # The isolated database is discarded by CI; leaving the actor in place
        # allows every assertion to remain an HTTP interaction.
        pass

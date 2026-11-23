"""Positive and negative HTTP flow for local-account authentication."""

from __future__ import annotations

import hashlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402
from app.database import DATABASE_URL, engine  # noqa: E402
from test_api_project_http_flow import _create_admin, _login  # noqa: E402


def test_local_account_registration_login_identity_and_logout_flow():
    """A newly registered account can authenticate, while bad credentials fail."""
    email = f"api-flow-{uuid4().hex}@example.test"
    password = "FlowPassword-2026!"

    with TestClient(app, raise_server_exceptions=False) as client:
        registered = client.post(
            "/auth/register/",
            json={"email": email, "password": password, "nombre_completo": "API Flow"},
        )
        assert registered.status_code == 200, registered.text
        assert registered.json()["email"] == email
        assert "hashed_password" not in registered.text

        wrong_password = client.post(
            "/auth/login/",
            data={"username": email, "password": "incorrecta-2026"},
        )
        assert wrong_password.status_code == 401

        login = client.post(
            "/auth/login/",
            data={"username": email, "password": password},
        )
        assert login.status_code == 200, login.text
        access_token = login.json()["access_token"]
        assert access_token

        headers = {"Authorization": f"Bearer {access_token}"}
        identity = client.get("/users/me/", headers=headers)
        assert identity.status_code == 200, identity.text
        assert identity.json()["email"] == email

        preferences = client.patch(
            "/users/me/preferences",
            headers=headers,
            json={
                "personal_theme": "dark",
                "profile_settings": {"density": "compact"},
                "project_theme_overrides": {"project-demo": "light"},
            },
        )
        assert preferences.status_code == 403

        profile = client.patch(
            "/users/me/profile",
            headers=headers,
            json={"nombre_completo": "Cuenta API actualizada", "display_name": "API QA"},
        )
        assert profile.status_code == 403

        changed_password = "FlowPassword-2026-Changed!"
        password_change = client.patch(
            "/users/me/password",
            headers=headers,
            json={"current_password": password, "new_password": changed_password},
        )
        assert password_change.status_code == 200, password_change.text
        renewed_token = password_change.json()["access_token"]
        assert renewed_token and renewed_token != access_token

        invalidated_token = client.get("/users/me/", headers=headers)
        assert invalidated_token.status_code == 401
        old_password = client.post(
            "/auth/login/",
            data={"username": email, "password": password},
        )
        assert old_password.status_code == 401
        new_password_login = client.post(
            "/auth/login/",
            data={"username": email, "password": changed_password},
        )
        assert new_password_login.status_code == 200, new_password_login.text

        logout = client.post("/auth/logout/", headers={"Authorization": f"Bearer {renewed_token}"})
        assert logout.status_code == 200, logout.text

        anonymous_identity = client.get("/users/me/")
        assert anonymous_identity.status_code == 401
        client.portal.call(engine.dispose)


def test_admin_can_manage_session_policy_and_personal_preferences():
    """The session policy is an administrative setting, unlike self-registration."""
    email = f"auth-admin-{uuid4().hex}@example.test"
    password = "AuthAdminPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        preferences = client.get("/users/me/preferences", headers=headers)
        assert preferences.status_code == 200, preferences.text

        initial_policy = client.get("/auth/session-config", headers=headers)
        assert initial_policy.status_code == 200, initial_policy.text
        updated_policy = client.put(
            "/auth/session-config",
            headers=headers,
            json={"session_timeout_minutes": 120},
        )
        assert updated_policy.status_code == 200, updated_policy.text
        assert updated_policy.json()["session_timeout_minutes"] == 120

        legacy_policy = client.get("/auth/session-config/", headers=headers)
        assert legacy_policy.status_code == 200, legacy_policy.text
        legacy_update = client.put(
            "/auth/session-config/",
            headers=headers,
            json={"session_timeout_minutes": 240},
        )
        assert legacy_update.status_code == 200, legacy_update.text
        assert legacy_update.json()["session_timeout_minutes"] == 240
        client.portal.call(engine.dispose)


def test_local_welcome_activation_consumes_a_single_use_token():
    """A valid locally-issued invitation activates access exactly once."""
    email = f"activation-{uuid4().hex}@example.test"
    initial_password = "InitialActivationPassword-2026!"
    activated_password = "ActivatedPassword-2026!"
    _create_admin(email, initial_password)
    raw_token = f"activation-{uuid4().hex}{uuid4().hex}"
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    database_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(database_url) as connection:
        user_id = connection.execute("SELECT id FROM usuarios WHERE email = %s", (email,)).fetchone()[0]
        connection.execute(
            """INSERT INTO notification_welcome_invitations
                (id, user_id, token_hash, auth_provider, expires_at)
                VALUES (%s, %s, %s, %s, %s)""",
            (uuid4(), user_id, token_hash, "local", datetime.now(timezone.utc) + timedelta(hours=1)),
        )

    with TestClient(app, raise_server_exceptions=False) as client:
        activated = client.post(
            "/auth/activate/", json={"token": raw_token, "password": activated_password}
        )
        assert activated.status_code == 200, activated.text
        assert activated.json() == {"ok": True}
        reused = client.post(
            "/auth/activate/", json={"token": raw_token, "password": activated_password}
        )
        assert reused.status_code == 400
        login = client.post("/auth/login/", data={"username": email, "password": activated_password})
        assert login.status_code == 200, login.text
        client.portal.call(engine.dispose)

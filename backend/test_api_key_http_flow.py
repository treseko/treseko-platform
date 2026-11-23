"""HTTP contract for externally-consumable API-key lifecycle."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import auth  # noqa: E402
from app.database import DATABASE_URL, engine  # noqa: E402
from app.main import app  # noqa: E402


def _seed_admin(email: str, password: str) -> None:
    """Only the actor is seeded; key lifecycle is exercised via HTTP."""
    database_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO usuarios (
                    id, email, hashed_password, nombre_completo, rol, activo,
                    auth_provider, modulos, permisos, permisos_detallados,
                    avatar_provider, profile_settings, personal_theme,
                    project_theme_overrides, session_version
                ) VALUES (
                    %s, %s, %s, %s, 'ADMIN', TRUE, 'local', %s::json, %s::json, %s::json,
                    'gravatar', %s::json, 'system', %s::json, 0
                )
                """,
                (uuid4(), email, auth.get_password_hash(password), "API key flow admin", json.dumps([]), json.dumps({}), json.dumps({}), json.dumps({}), json.dumps({})),
            )


def test_api_key_creation_listing_revocation_and_missing_key_rejection():
    suffix = uuid4().hex
    email = f"api-key-flow-{suffix}@example.test"
    password = "ApiKeyFlowPassword-2026!"
    _seed_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        login = client.post("/auth/login/", data={"username": email, "password": password})
        assert login.status_code == 200, login.text
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        created = client.post(
            "/users/me/api-keys/",
            headers=headers,
            json={"nombre": "CI external automation"},
        )
        assert created.status_code == 200, created.text
        created_payload = created.json()
        assert created_payload["api_key"]
        assert created_payload["activo"] is True
        assert created_payload["estado"] == "ACTIVE"
        api_key_id = created_payload["id"]

        listed = client.get("/users/me/api-keys/", headers=headers)
        assert listed.status_code == 200, listed.text
        stored = next(item for item in listed.json() if item["id"] == api_key_id)
        assert stored["activo"] is True
        assert stored["estado"] == "ACTIVE"
        assert "api_key" not in stored

        paused = client.patch(
            f"/users/me/api-keys/{api_key_id}/",
            headers=headers,
            json={"estado": "PAUSED"},
        )
        assert paused.status_code == 200, paused.text
        assert paused.json()["activo"] is False
        assert paused.json()["estado"] == "PAUSED"

        resumed = client.patch(
            f"/users/me/api-keys/{api_key_id}/",
            headers=headers,
            json={"estado": "ACTIVE"},
        )
        assert resumed.status_code == 200, resumed.text
        assert resumed.json()["activo"] is True
        assert resumed.json()["estado"] == "ACTIVE"

        missing = client.delete(f"/users/me/api-keys/{uuid4()}/", headers=headers)
        assert missing.status_code == 404

        revoked = client.delete(f"/users/me/api-keys/{api_key_id}/", headers=headers)
        assert revoked.status_code == 200, revoked.text
        assert revoked.json()["activo"] is False
        assert revoked.json()["estado"] == "REVOKED"

        listed_after_revoke = client.get("/users/me/api-keys/", headers=headers)
        assert listed_after_revoke.status_code == 200, listed_after_revoke.text
        stored_after_revoke = next(item for item in listed_after_revoke.json() if item["id"] == api_key_id)
        assert stored_after_revoke["activo"] is False
        assert stored_after_revoke["estado"] == "REVOKED"
        client.portal.call(engine.dispose)

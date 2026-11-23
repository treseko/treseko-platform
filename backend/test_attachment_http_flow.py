"""HTTP contract for attachment configuration and safe file uploads."""

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
    sync_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(sync_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO usuarios (
                    id, email, hashed_password, nombre_completo, rol, activo, auth_provider,
                    modulos, permisos, permisos_detallados, avatar_provider, profile_settings,
                    personal_theme, project_theme_overrides, session_version
                ) VALUES (%s, %s, %s, %s, 'ADMIN', TRUE, 'local', %s::json, %s::json, %s::json,
                    'gravatar', %s::json, 'system', %s::json, 0)""",
                (uuid4(), email, auth.get_password_hash(password), "Attachment flow admin",
                 json.dumps([]), json.dumps({}), json.dumps({}), json.dumps({}), json.dumps({})),
            )


def _headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    login = client.post("/auth/login/", data={"username": email, "password": password})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _project_scope(client: TestClient, headers: dict[str, str], suffix: str) -> str:
    projects = client.get("/proyectos/", headers=headers)
    assert projects.status_code == 200, projects.text
    if projects.json():
        return projects.json()[0]["id"]
    organizations = client.get("/organizaciones/", headers=headers)
    assert organizations.status_code == 200, organizations.text
    if organizations.json():
        organization_id = organizations.json()[0]["id"]
    else:
        organization = client.post("/organizaciones/", headers=headers, json={"nombre": f"Attachment org {suffix}", "tipo": "Interna"})
        assert organization.status_code == 200, organization.text
        organization_id = organization.json()["id"]
    project = client.post("/proyectos/", headers=headers, json={"nombre": f"Attachment project {suffix}", "organizacion_id": organization_id})
    assert project.status_code == 200, project.text
    return project.json()["id"]


def test_attachment_config_and_safe_upload_lifecycle():
    suffix = uuid4().hex
    email = f"attachments-{suffix}@example.test"
    password = "AttachmentFlowPassword-2026!"
    _seed_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _headers(client, email, password)
        project_id = _project_scope(client, headers, suffix)

        config = client.get("/attachments/config/", headers=headers)
        assert config.status_code == 200, config.text
        assert "text/plain" in config.json()["allowed_mime_types"]

        saved_config = client.patch("/attachments/config/", headers=headers, json=config.json())
        assert saved_config.status_code == 200, saved_config.text

        missing_project = client.post(
            "/attachments/", headers=headers, params={"project_id": str(uuid4())},
            files={"file": ("evidence.txt", b"QA evidence", "text/plain")},
        )
        assert missing_project.status_code == 404

        type_mismatch = client.post(
            "/attachments/", headers=headers, params={"project_id": project_id},
            files={"file": ("evidence.pdf", b"not a PDF", "application/pdf")},
        )
        assert type_mismatch.status_code == 400

        uploaded = client.post(
            "/attachments/", headers=headers,
            params={"project_id": project_id, "scope": "CASE_EVIDENCE"},
            files={"file": ("evidence.txt", b"QA evidence for controlled flow", "text/plain")},
        )
        assert uploaded.status_code == 200, uploaded.text
        payload = uploaded.json()
        assert payload["filename_original"] == "evidence.txt"
        assert payload["content_type"] == "text/plain"
        assert payload["proyecto_id"] == project_id
        assert payload["available"] is True

        legacy_png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
            b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
            b"\x00\x00\x00\x0dIDAT\x08\xd7c\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        legacy_upload = client.post(
            "/attachments/legacy/",
            headers=headers,
            params={"project_id": project_id},
            files={"file": ("legacy-proof.png", legacy_png, "image/png")},
        )
        assert legacy_upload.status_code == 200, legacy_upload.text
        assert legacy_upload.json()["url"].startswith("/static/evidencias/")
        assert legacy_upload.json()["filename"].endswith(".png")
        client.portal.call(engine.dispose)

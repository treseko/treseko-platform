"""End-to-end HTTP contract for importing, exporting and reverting cases."""

from __future__ import annotations

import base64
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
                (
                    uuid4(), email, auth.get_password_hash(password), "Portability flow admin",
                    json.dumps([]), json.dumps({}), json.dumps({}), json.dumps({}), json.dumps({}),
                ),
            )


def _headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    login = client.post("/auth/login/", data={"username": email, "password": password})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _project_component_scope(client: TestClient, headers: dict[str, str], suffix: str) -> tuple[str, str]:
    projects = client.get("/proyectos/", headers=headers)
    assert projects.status_code == 200, projects.text
    if projects.json():
        project_id = projects.json()[0]["id"]
    else:
        organizations = client.get("/organizaciones/", headers=headers)
        assert organizations.status_code == 200, organizations.text
        if organizations.json():
            organization_id = organizations.json()[0]["id"]
        else:
            organization = client.post(
                "/organizaciones/", headers=headers,
                json={"nombre": f"Portability organization {suffix}", "tipo": "Interna"},
            )
            assert organization.status_code == 200, organization.text
            organization_id = organization.json()["id"]
        project = client.post(
            "/proyectos/", headers=headers,
            json={"nombre": f"Portability project {suffix}", "organizacion_id": organization_id},
        )
        assert project.status_code == 200, project.text
        project_id = project.json()["id"]

    components = client.get(f"/proyectos/{project_id}/componentes/", headers=headers)
    assert components.status_code == 200, components.text
    if components.json():
        return project_id, components.json()[0]["id"]
    component = client.post(
        "/componentes/", headers=headers,
        json={"nombre": f"Portability component {suffix}", "proyecto_id": project_id},
    )
    assert component.status_code == 200, component.text
    return project_id, component.json()["id"]


def test_case_portability_template_preview_import_export_and_rollback():
    suffix = uuid4().hex
    email = f"portability-flow-{suffix}@example.test"
    password = "PortabilityFlowPassword-2026!"
    _seed_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _headers(client, email, password)
        project_id, component_id = _project_component_scope(client, headers, suffix)

        profiles = client.get("/case-portability/profiles", headers=headers)
        assert profiles.status_code == 200, profiles.text
        assert profiles.json()["export_format"] == "treseko.test-cases-package/v1"
        assert "treseko/tcases-v1" in {profile["id"] for profile in profiles.json()["profiles"]}
        assert "treseko/legacy-project-v1" in {profile["id"] for profile in profiles.json()["profiles"]}

        legacy_payload = {
            "version_formato": "1.0",
            "suites": [{"id": "legacy-root", "parent_id": None, "nombre": "Legacy"}],
            "casos": [{"master_id": "legacy-http-1", "suite_id": "legacy-root", "codigo": "TC-LEGACY-HTTP", "titulo": "Legacy HTTP case", "version": 2, "prioridad": "MEDIA", "tipo_prueba": "MANUAL", "estado_caso": "ACTIVO", "pasos": [{"accion": "Open", "resultado_esperado": "Visible"}]}],
        }
        legacy_preview = client.post(
            f"/case-portability/projects/{project_id}/preview", headers=headers,
            json={"profile_id": "treseko/legacy-project-v1", "content_base64": base64.b64encode(json.dumps(legacy_payload).encode()).decode(), "file_name": "legacy.treseko", "component_id": component_id},
        )
        assert legacy_preview.status_code == 200, legacy_preview.text
        assert legacy_preview.json()["summary"]["total"] == 1
        assert legacy_preview.json()["diagnostics"]["legacy_format_version"] == "1.0"

        template = client.get("/case-portability/templates/tcases-example", headers=headers)
        assert template.status_code == 200, template.text
        assert template.headers["content-type"].startswith("application/zip")
        content_base64 = base64.b64encode(template.content).decode("ascii")
        payload = {
            "profile_id": "treseko/tcases-v1",
            "content_base64": content_base64,
            "file_name": "casos-ejemplo.tcases",
            "component_id": component_id,
        }

        preview = client.post(f"/case-portability/projects/{project_id}/preview", headers=headers, json=payload)
        assert preview.status_code == 200, preview.text
        assert preview.json()["summary"]["total"] >= 1

        wrong_extension = client.post(
            f"/case-portability/projects/{project_id}/preview", headers=headers,
            json={**payload, "file_name": "casos-ejemplo.csv"},
        )
        assert wrong_extension.status_code == 422

        imported = client.post(f"/case-portability/projects/{project_id}/import", headers=headers, json=payload)
        assert imported.status_code == 200, imported.text
        assert imported.json()["status"] == "COMPLETED"
        batch_id = imported.json()["batch_id"]

        batches = client.get(f"/case-portability/projects/{project_id}/batches", headers=headers)
        assert batches.status_code == 200, batches.text
        batch = next(item for item in batches.json() if item["id"] == batch_id)
        assert batch["rollback_available"] is True

        exported = client.get(
            f"/case-portability/projects/{project_id}/export",
            headers=headers,
            params={"component_id": component_id},
        )
        assert exported.status_code == 200, exported.text
        assert exported.headers["content-type"].startswith("application/zip")
        assert exported.content.startswith(b"PK")

        reverted = client.post(f"/case-portability/batches/{batch_id}/rollback", headers=headers)
        assert reverted.status_code == 200, reverted.text
        assert reverted.json()["status"] == "ROLLED_BACK"
        client.portal.call(engine.dispose)

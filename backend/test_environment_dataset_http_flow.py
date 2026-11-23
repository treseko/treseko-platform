"""HTTP lifecycle contract for project environments and their datasets."""

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
                (uuid4(), email, auth.get_password_hash(password), "Environment flow admin",
                 json.dumps([]), json.dumps({}), json.dumps({}), json.dumps({}), json.dumps({})),
            )


def _login(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post("/auth/login/", data={"username": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _project_id(client: TestClient, headers: dict[str, str], suffix: str) -> str:
    projects = client.get("/proyectos/", headers=headers)
    assert projects.status_code == 200, projects.text
    if projects.json():
        return projects.json()[0]["id"]
    organizations = client.get("/organizaciones/", headers=headers)
    assert organizations.status_code == 200, organizations.text
    if organizations.json():
        organization_id = organizations.json()[0]["id"]
    else:
        organization = client.post("/organizaciones/", headers=headers, json={"nombre": f"Environment organization {suffix}", "tipo": "Interna"})
        assert organization.status_code == 200, organization.text
        organization_id = organization.json()["id"]
    project = client.post("/proyectos/", headers=headers, json={"nombre": f"Environment project {suffix}", "organizacion_id": organization_id})
    assert project.status_code == 200, project.text
    return project.json()["id"]


def test_environment_and_dataset_lifecycle_with_invalid_targets_rejected():
    suffix = uuid4().hex
    email = f"environment-flow-{suffix}@example.test"
    password = "EnvironmentFlowPassword-2026!"
    _seed_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        project_id = _project_id(client, headers, suffix)

        invalid_environment = client.post(
            "/entornos/", headers=headers,
            json={"proyecto_id": project_id, "nombre": "Invalid", "url": "not-a-url"},
        )
        assert invalid_environment.status_code == 422

        created = client.post(
            "/entornos/", headers=headers,
            json={
                "proyecto_id": project_id, "nombre": "QA", "url": "https://qa.example.test",
                "status": "Healthy", "version": "2026.7", "variables": {"BASE_URL": "https://qa.example.test"},
            },
        )
        assert created.status_code == 200, created.text
        environment_id = created.json()["id"]
        assert created.json()["variables"] == {"BASE_URL": "https://qa.example.test"}

        listed = client.get(f"/proyectos/{project_id}/entornos/", headers=headers)
        assert listed.status_code == 200, listed.text
        assert environment_id in {item["id"] for item in listed.json()}

        updated = client.patch(
            f"/entornos/{environment_id}", headers=headers,
            json={"status": "Degraded", "variables": {"BASE_URL": "https://qa-v2.example.test"}},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["status"] == "Degraded"
        assert updated.json()["variables"]["BASE_URL"] == "https://qa-v2.example.test"

        missing_dataset = client.post(
            f"/entornos/{uuid4()}/datasets/", headers=headers,
            json={"nombre": "Missing"},
        )
        assert missing_dataset.status_code == 404

        dataset = client.post(
            f"/entornos/{environment_id}/datasets/", headers=headers,
            json={"nombre": "Smoke", "descripcion": "Minimal QA data", "variables": {"user": "qa"}, "es_default": True},
        )
        assert dataset.status_code == 200, dataset.text
        dataset_id = dataset.json()["id"]
        assert dataset.json()["es_default"] is True

        datasets = client.get(f"/entornos/{environment_id}/datasets/", headers=headers)
        assert datasets.status_code == 200, datasets.text
        assert dataset_id in {item["id"] for item in datasets.json()}

        edited_dataset = client.patch(
            f"/entorno-datasets/{dataset_id}/", headers=headers,
            json={"nombre": "Regression", "es_default": False, "variables": {"user": "regression"}},
        )
        assert edited_dataset.status_code == 200, edited_dataset.text
        assert edited_dataset.json()["nombre"] == "Regression"
        assert edited_dataset.json()["variables"] == {"user": "regression"}

        deleted_dataset = client.delete(f"/entorno-datasets/{dataset_id}/", headers=headers)
        assert deleted_dataset.status_code == 200, deleted_dataset.text
        assert deleted_dataset.json() == {"ok": True}

        deleted_environment = client.delete(f"/entornos/{environment_id}", headers=headers)
        assert deleted_environment.status_code == 200, deleted_environment.text
        assert deleted_environment.json() == {"ok": True}
        client.portal.call(engine.dispose)

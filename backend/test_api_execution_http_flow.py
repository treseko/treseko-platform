"""Regression coverage for the API execution flow exposed by the UI.

This is intentionally an HTTP integration test: the API editor can be valid
while the execution route still fails when it creates the TestRun, resolves
the dataset, or persists the API evidence.
"""

from __future__ import annotations

import json
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException

from app import auth
from app.api.routers import organizations as organizations_router
from app.api.routers import api_tests as api_tests_router
from app.api.routers import projects as projects_router
from app.database import DATABASE_URL
from app.main import app


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
                    %s, %s, %s, %s, 'ADMIN', TRUE, 'local', %s::json, %s::json,
                    %s::json, 'gravatar', %s::json, 'system', %s::json, 0
                )
                """,
                (
                    uuid4(),
                    email,
                    auth.get_password_hash(password),
                    "API execution regression admin",
                    json.dumps([]),
                    json.dumps({}),
                    json.dumps({}),
                    json.dumps({}),
                    json.dumps({}),
                ),
            )


def _login(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post("/auth/login/", data={"username": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


class _ControlledApiExecutor:
    async def execute(self, config, environment, dataset_variables=None, shared_variables=None):
        assert config["request"]["method"] == "GET"
        assert dataset_variables["customer_name"] == "QA regression"
        return {
            "schema_version": "treseko.api-result/v1",
            "status": "PASSED",
            "duration_ms": 8,
            "steps": [{
                "index": 1,
                "status": "PASSED",
                "request": {"method": "GET", "url": "https://api.example.test/health"},
                "assertions": [{"name": "HTTP 200", "status": "PASSED"}],
            }],
            "api_variables": {},
            "persistent_variables": {},
        }


def test_api_execution_uses_manual_capability_for_manual_origin(monkeypatch):
    user = object()
    checks = []

    def has_capability(_user, capability, level):
        checks.append((capability, level))
        return capability == "ejecutar.manual"

    monkeypatch.setattr(api_tests_router.auth, "has_capability_permission", has_capability)
    api_tests_router._require_api_execution_capability(user, "MANUAL")
    assert checks == [("ejecutar.manual", "edit")]

    with pytest.raises(HTTPException) as error:
        api_tests_router._require_api_execution_capability(user, "AUTOMATIZADA")
    assert error.value.status_code == 403


async def _allow_controlled_tenant_limit(*_args, **_kwargs) -> None:
    """Keep the integration flow independent from Community quota fixtures."""


def test_api_suite_execution_creates_evidence_and_keeps_classic_runs_separate(monkeypatch):
    suffix = uuid4().hex
    email = f"api-execution-regression-{suffix}@example.test"
    password = "ApiExecutionRegressionPassword-2026!"
    _seed_admin(email, password)
    monkeypatch.setattr(api_tests_router, "get_api_test_executor", lambda: _ControlledApiExecutor())
    monkeypatch.setattr(organizations_router, "enforce_limit", _allow_controlled_tenant_limit)
    monkeypatch.setattr(projects_router, "enforce_limit", _allow_controlled_tenant_limit)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)

        organization = client.post(
            "/organizaciones/", headers=headers,
            json={"nombre": f"API regression organization {suffix}", "tipo": "Interna"},
        )
        assert organization.status_code == 200, organization.text
        project = client.post(
            "/proyectos/", headers=headers,
            json={"nombre": f"API regression project {suffix}", "organizacion_id": organization.json()["id"]},
        )
        assert project.status_code == 200, project.text
        project_id = project.json()["id"]
        component = client.post(
            "/componentes/", headers=headers,
            json={"nombre": "API", "proyecto_id": project_id, "tech_stack": "HTTP"},
        )
        assert component.status_code == 200, component.text
        component_id = component.json()["id"]
        suite = client.post(
            "/suites/", headers=headers,
            json={"nombre": "API execution regression", "proyecto_id": project_id, "componente_id": component_id},
        )
        assert suite.status_code == 200, suite.text
        suite_id = suite.json()["id"]

        environment = client.post(
            "/entornos/", headers=headers,
            json={
                "proyecto_id": project_id,
                "nombre": "API QA",
                "url": "https://api.example.test",
                "status": "Online",
                "variables": {"base_url": "https://api.example.test"},
                "configuracion_api": {"allowed_hosts": ["api.example.test"]},
            },
        )
        assert environment.status_code == 200, environment.text
        environment_id = environment.json()["id"]
        dataset = client.post(
            f"/entornos/{environment_id}/datasets/", headers=headers,
            json={"nombre": "API QA dataset", "variables": {"customer_name": "QA regression"}, "es_default": True},
        )
        assert dataset.status_code == 200, dataset.text
        dataset_id = dataset.json()["id"]

        api_case = client.post(
            "/casos/", headers=headers,
            json={
                "proyecto_id": project_id,
                "suite_id": suite_id,
                "componente_id": component_id,
                "codigo": "TC-API-REG-001",
                "titulo": "API execution regression",
                "prioridad": "MEDIA",
                "criticidad": "MEDIA",
                "tipo_prueba": "AUTOMATIZADA",
                "formato_prueba": "API",
                "configuracion_api": {
                    "schema_version": "treseko.api-test/v1",
                    "request": {"method": "GET", "url": "{{base_url}}/health"},
                    "assertions": [{"source": "response.status", "operator": "equals", "expected": 200}],
                },
            },
        )
        assert api_case.status_code == 200, api_case.text
        api_case_id = api_case.json()["id"]

        classic_case = client.post(
            "/casos/", headers=headers,
            json={
                "proyecto_id": project_id,
                "suite_id": suite_id,
                "componente_id": component_id,
                "codigo": "TC-CLASSIC-REG-001",
                "titulo": "Classic execution regression",
                "prioridad": "MEDIA",
                "criticidad": "MEDIA",
                "tipo_prueba": "MANUAL",
                "formato_prueba": "CLASICA",
                "pasos": [{"numero_paso": 1, "accion": "Open the page", "resultado_esperado": "The page is visible"}],
            },
        )
        assert classic_case.status_code == 200, classic_case.text
        classic_case_id = classic_case.json()["id"]

        build = client.post(
            "/builds/", headers=headers,
            json={"nombre": "API execution regression build", "proyecto_id": project_id, "componente_id": component_id, "estado": "ACTIVA", "activo": True},
        )
        assert build.status_code == 200, build.text
        build_id = build.json()["id"]
        assigned = client.put(
            f"/builds/{build_id}/casos/", headers=headers,
            json={"caso_ids": [api_case_id, classic_case_id]},
        )
        assert assigned.status_code == 200, assigned.text

        api_execution = client.post(
            f"/proyectos/{project_id}/api-tests/execute",
            headers=headers,
            json={"build_id": build_id, "entorno_id": environment_id, "dataset_id": dataset_id, "case_ids": [api_case_id], "origen": "MANUAL"},
        )
        assert api_execution.status_code == 200, api_execution.text
        api_payload = api_execution.json()
        assert api_payload["status"] == "PASSED"
        assert api_payload["executions"][0]["status"] == "PASO"

        classic_execution = client.post(
            "/test-runs/", headers=headers,
            json={"nombre": "Classic regression", "entorno": "API QA", "proyecto_id": project_id, "build_id": build_id, "entorno_id": environment_id, "dataset_id": dataset_id, "caso_ids": [classic_case_id]},
        )
        assert classic_execution.status_code == 200, classic_execution.text

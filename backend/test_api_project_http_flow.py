"""End-to-end HTTP contract for the core QA project lifecycle.

The test deliberately exercises the public API rather than repository helpers:
an administrator authenticates and creates the minimum valid chain required to
execute a manual case.  It also proves that cross-project component references
are rejected before a build is created.
"""

from __future__ import annotations

import json
import shutil
import sys
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
import psycopg


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import auth  # noqa: E402
from app.api.routers import organizations as organizations_router  # noqa: E402
from app.api.routers import projects as projects_router  # noqa: E402
from app.database import DATABASE_URL, engine  # noqa: E402
from app.repositories import project_write_policy
from app.main import app  # noqa: E402
from app.repositories import ai_execution_callbacks  # noqa: E402
from app.services.edition import entitlement_service  # noqa: E402


def _assert_report_pdf(response, pdf_available: bool) -> None:
    if pdf_available:
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("application/pdf")
    else:
        assert response.status_code == 503, response.text
        assert response.json()["detail"] == "Exportacion PDF no disponible en este entorno"


def _create_admin(email: str, password: str) -> None:
    """Seed only the authenticated actor; all QA data is created through HTTP."""
    sync_database_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    with psycopg.connect(sync_database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO usuarios (
                    id, email, hashed_password, nombre_completo, rol, activo,
                    auth_provider, modulos, permisos, permisos_detallados,
                    avatar_provider, profile_settings, personal_theme,
                    project_theme_overrides, session_version
                ) VALUES (
                    %s, %s, %s, %s, %s, TRUE, 'local', %s::json, %s::json, %s::json,
                    'gravatar', %s::json, 'system', %s::json, 0
                )
                """,
                (
                    uuid4(),
                    email,
                    auth.get_password_hash(password),
                    "API project flow admin",
                    "ADMIN",
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


async def _premium_features_enabled(*_args, **_kwargs) -> bool:
    return True


async def _community_features_disabled(*_args, **_kwargs) -> bool:
    return False


async def _allow_controlled_tenant_limit(*_args, **_kwargs) -> None:
    """Keep this complete lifecycle independent from prior Community fixtures."""


def test_admin_can_create_and_execute_a_complete_manual_qa_chain(monkeypatch):
    pdf_available = any(shutil.which(binary) for binary in ("google-chrome", "chromium", "chromium-browser"))
    monkeypatch.setattr(organizations_router, "enforce_limit", _allow_controlled_tenant_limit)
    monkeypatch.setattr(project_write_policy, "enforce_limit", _allow_controlled_tenant_limit)
    suffix = uuid4().hex
    email = f"project-flow-{suffix}@example.test"
    password = "ProjectFlowPassword-2026!"
    _create_admin(email, password)

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            headers = _login(client, email, password)

            organization = client.post(
                "/organizaciones/",
                headers=headers,
                json={"nombre": f"Organization {suffix}", "tipo": "Cliente"},
            )
            assert organization.status_code == 200, organization.text
            organization_id = organization.json()["id"]
            updated_organization = client.patch(
                f"/organizaciones/{organization_id}",
                headers=headers,
                json={"nombre": f"Organization updated {suffix}"},
            )
            assert updated_organization.status_code == 200, updated_organization.text
            assert updated_organization.json()["nombre"] == f"Organization updated {suffix}"

            project = client.post(
                "/proyectos/",
                headers=headers,
                json={
                    "nombre": f"Project {suffix}",
                    "descripcion": "Created by the API lifecycle contract.",
                    "organizacion_id": organization_id,
                },
            )
            assert project.status_code == 200, project.text
            project_id = project.json()["id"]

            project_detail = client.get(f"/proyectos/{project_id}", headers=headers)
            assert project_detail.status_code == 200, project_detail.text
            assert project_detail.json()["nombre"] == f"Project {suffix}"
            updated_project = client.patch(
                f"/proyectos/{project_id}",
                headers=headers,
                json={"descripcion": "Updated by the API lifecycle contract."},
            )
            assert updated_project.status_code == 200, updated_project.text
            assert updated_project.json()["descripcion"] == "Updated by the API lifecycle contract."

            member = client.post(
                "/usuarios/",
                headers=headers,
                json={
                    "email": f"project-member-{suffix}@example.test",
                    "nombre_completo": "Project flow member",
                    "rol": "TESTER",
                    "auth_provider": "local",
                    "password": "ProjectMemberPassword-2026!",
                },
            )
            assert member.status_code == 200, member.text
            member_id = member.json()["id"]
            organization_member = client.post(
                f"/organizaciones/{organization_id}/miembros/",
                headers=headers,
                json={"usuario_id": member_id, "rol_cliente": "MEMBER"},
            )
            assert organization_member.status_code == 200, organization_member.text
            organization_members = client.get(
                f"/organizaciones/{organization_id}/miembros/", headers=headers
            )
            assert organization_members.status_code == 200, organization_members.text
            assert member_id in {item["usuario_id"] for item in organization_members.json()}
            project_member = client.post(
                f"/proyectos/{project_id}/miembros/",
                headers=headers,
                json={"usuario_id": member_id, "rol_proyecto": "TESTER"},
            )
            assert project_member.status_code == 200, project_member.text
            project_members = client.get(f"/proyectos/{project_id}/miembros/", headers=headers)
            assert project_members.status_code == 200, project_members.text
            assert member_id in {item["usuario_id"] for item in project_members.json()}

            device = client.post(
                "/infraestructura/dispositivos/",
                headers=headers,
                json={
                    "nombre": f"Chrome QA device {suffix}",
                    "tipo": "Desktop",
                    "browser": "Chrome",
                    "resolucion": "1920x1080",
                    "es_simulador": True,
                },
            )
            assert device.status_code == 200, device.text
            devices = client.get("/infraestructura/dispositivos/", headers=headers)
            assert devices.status_code == 200, devices.text
            assert device.json()["id"] in {item["id"] for item in devices.json()}
            nodes = client.get("/infraestructura/nodos/", headers=headers)
            assert nodes.status_code == 200, nodes.text

            asset = client.post(
                "/infraestructura/activos/",
                headers=headers,
                params={"proyecto_id": project_id},
                json={
                    "nombre": f"QA API {suffix}",
                    "tipo": "API",
                    "naturaleza": "digital",
                    "estado": "Online",
                    "criticidad": "Alta",
                    "metadata": {"owner": "qa"},
                    "endpoints": [{"tipo": "url", "valor": "https://qa.example.test", "principal": True}],
                },
            )
            assert asset.status_code == 200, asset.text
            asset_id = asset.json()["id"]
            endpoint_id = asset.json()["endpoints"][0]["id"]
            listed_assets = client.get(
                "/infraestructura/activos/", headers=headers, params={"proyecto_id": project_id, "q": "QA API"}
            )
            assert listed_assets.status_code == 200, listed_assets.text
            assert asset_id in {item["id"] for item in listed_assets.json()}
            asset_detail = client.get(f"/infraestructura/activos/{asset_id}", headers=headers)
            assert asset_detail.status_code == 200, asset_detail.text
            updated_asset = client.patch(
                f"/infraestructura/activos/{asset_id}",
                headers=headers,
                json={"estado": "Mantenimiento", "metadata": {"owner": "qa", "revision": 1}},
            )
            assert updated_asset.status_code == 200, updated_asset.text
            assert updated_asset.json()["estado"] == "Mantenimiento"
            extra_endpoint = client.post(
                f"/infraestructura/activos/{asset_id}/endpoints/",
                headers=headers,
                json={"tipo": "puerto", "valor": "8443", "puerto": 8443, "protocolo": "https"},
            )
            assert extra_endpoint.status_code == 200, extra_endpoint.text
            updated_endpoint = client.patch(
                f"/infraestructura/endpoints/{endpoint_id}",
                headers=headers,
                json={"valor": "https://qa-updated.example.test"},
            )
            assert updated_endpoint.status_code == 200, updated_endpoint.text
            deleted_endpoint = client.delete(
                f"/infraestructura/endpoints/{extra_endpoint.json()['id']}", headers=headers
            )
            assert deleted_endpoint.status_code == 200, deleted_endpoint.text

            # Notifications are a Premium feature: Community must reject the
            # whole domain consistently even for an authenticated ADMIN.
            notification_preferences = client.patch(
                "/users/me/notification-preferences/",
                headers=headers,
                json=[{"event_type": "case.failed", "channel": "inbox", "enabled": True, "frequency": "immediate"}],
            )
            assert notification_preferences.status_code == 403

            wiki_page = client.post(
                "/wiki/",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "titulo": "API lifecycle notes",
                    "contenido": "Initial project documentation.",
                },
            )
            assert wiki_page.status_code == 200, wiki_page.text
            wiki_id = wiki_page.json()["id"]
            wiki_list = client.get(f"/proyectos/{project_id}/wiki/", headers=headers)
            assert wiki_list.status_code == 200, wiki_list.text
            assert wiki_id in {page["id"] for page in wiki_list.json()}
            wiki_detail = client.get(f"/wiki/{wiki_id}", headers=headers)
            assert wiki_detail.status_code == 200, wiki_detail.text
            assert wiki_detail.json()["titulo"] == "API lifecycle notes"
            wiki_updated = client.patch(
                f"/wiki/{wiki_id}",
                headers=headers,
                json={"contenido": "Updated project documentation.", "comentario_cambio": "API flow update"},
            )
            assert wiki_updated.status_code == 200, wiki_updated.text
            assert wiki_updated.json()["contenido"] == "Updated project documentation."
            wiki_history = client.get(f"/wiki/{wiki_id}/history/", headers=headers)
            assert wiki_history.status_code == 200, wiki_history.text
            assert wiki_history.json()[0]["comentario_cambio"] == "API flow update"

            component = client.post(
                "/componentes/",
                headers=headers,
                json={"nombre": "Web", "proyecto_id": project_id, "tech_stack": "React"},
            )
            assert component.status_code == 200, component.text
            component_id = component.json()["id"]
            project_components = client.get(f"/proyectos/{project_id}/componentes/", headers=headers)
            assert project_components.status_code == 200, project_components.text
            assert component_id in {item["id"] for item in project_components.json()}
            updated_component = client.patch(
                f"/componentes/{component_id}", headers=headers, json={"tech_stack": "React + TypeScript"}
            )
            assert updated_component.status_code == 200, updated_component.text
            assert updated_component.json()["tech_stack"] == "React + TypeScript"

            suite = client.post(
                "/suites/",
                headers=headers,
                json={"nombre": "Authentication", "proyecto_id": project_id, "componente_id": component_id},
            )
            assert suite.status_code == 200, suite.text
            suite_id = suite.json()["id"]
            project_suites = client.get(
                f"/proyectos/{project_id}/suites/", headers=headers, params={"componente_id": component_id}
            )
            assert project_suites.status_code == 200, project_suites.text
            assert suite_id in {item["id"] for item in project_suites.json()}
            with monkeypatch.context() as premium:
                premium.setattr(entitlement_service, "is_feature_enabled", _premium_features_enabled)
                redmine_config = client.post(
                    f"/proyectos/{project_id}/redmine/",
                    headers=headers,
                    json={
                        "url": "https://redmine.example.test",
                        "api_key": "controlled-redmine-key",
                        "project_identifier": f"qa-{suffix[:8]}",
                        "custom_fields": {"environment": "controlled"},
                    },
                )
                assert redmine_config.status_code == 200, redmine_config.text
                assert redmine_config.json()["api_key"] == "********"
                redmine_read = client.get(f"/proyectos/{project_id}/redmine/", headers=headers)
                assert redmine_read.status_code == 200, redmine_read.text
                assert redmine_read.json()["project_identifier"] == f"qa-{suffix[:8]}"
                scheduled_run = client.post(
                    "/schedules/",
                    headers=headers,
                    json={
                        "nombre": "Controlled nightly QA",
                        "proyecto_id": project_id,
                        "suite_id": suite_id,
                        "cron_expression": "0 2 * * *",
                        "activo": True,
                    },
                )
                assert scheduled_run.status_code == 200, scheduled_run.text
                schedules = client.get(f"/proyectos/{project_id}/schedules/", headers=headers)
                assert schedules.status_code == 200, schedules.text
                assert scheduled_run.json()["id"] in {item["id"] for item in schedules.json()}
            updated_suite = client.patch(
                f"/suites/{suite_id}", headers=headers, json={"nombre": "Authentication lifecycle"}
            )
            assert updated_suite.status_code == 200, updated_suite.text
            assert updated_suite.json()["nombre"] == "Authentication lifecycle"

            cloned_suite = client.post(
                f"/suites/{suite_id}/clone",
                headers=headers,
                json={"nuevo_nombre": "Authentication lifecycle copy", "include_cases": False},
            )
            assert cloned_suite.status_code == 200, cloned_suite.text
            cloned_suite_id = cloned_suite.json()["suite"]["id"]
            assert cloned_suite.json()["casos_copiados"] == 0
            reordered_suites = client.patch(
                "/suites/reorder", headers=headers, json={"orden": [suite_id, cloned_suite_id]}
            )
            assert reordered_suites.status_code == 200, reordered_suites.text

            moved_suite = client.patch(
                f"/suites/{cloned_suite_id}/move", headers=headers, json={"parent_id": suite_id}
            )
            assert moved_suite.status_code == 200, moved_suite.text
            archived_suite = client.patch(
                f"/suites/{cloned_suite_id}/archive", headers=headers, json={"archivado": True}
            )
            assert archived_suite.status_code == 200, archived_suite.text
            restored_suite = client.patch(
                f"/suites/{cloned_suite_id}/archive", headers=headers, json={"archivado": False}
            )
            assert restored_suite.status_code == 200, restored_suite.text
            deleted_cloned_suite = client.delete(f"/suites/{cloned_suite_id}", headers=headers)
            assert deleted_cloned_suite.status_code == 200, deleted_cloned_suite.text

            automated_function = client.post(
                "/funciones/",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "suite_id": suite_id,
                    "componente_id": component_id,
                    "nombre": "Fill valid credentials",
                    "descripcion": "Reusable login helper created by the HTTP lifecycle.",
                    "codigo": "await page.fill('#email', user);",
                    "parametros": ["user"],
                    "framework": "playwright",
                    "scope": "PROYECTO",
                },
            )
            assert automated_function.status_code == 200, automated_function.text
            function_master_id = automated_function.json()["master_id"]

            project_functions = client.get(
                f"/proyectos/{project_id}/funciones/", headers=headers, params={"suite_id": suite_id}
            )
            assert project_functions.status_code == 200, project_functions.text
            assert function_master_id in {item["master_id"] for item in project_functions.json()}

            function_detail = client.get(f"/funciones/{function_master_id}/", headers=headers)
            assert function_detail.status_code == 200, function_detail.text
            assert function_detail.json()["version"] == 1

            updated_function = client.put(
                f"/funciones/{function_master_id}/",
                headers=headers,
                json={"descripcion": "Versioned reusable login helper.", "parametros": ["user", "password"]},
            )
            assert updated_function.status_code == 200, updated_function.text
            assert updated_function.json()["version"] == 2
            function_versions = client.get(f"/funciones/{function_master_id}/versions/", headers=headers)
            assert function_versions.status_code == 200, function_versions.text
            assert [item["version"] for item in function_versions.json()] == [2, 1]

            deleted_function = client.delete(f"/funciones/{function_master_id}/", headers=headers)
            assert deleted_function.status_code == 200, deleted_function.text
            assert deleted_function.json() == {"ok": True}

            case = client.post(
                "/casos/",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "suite_id": suite_id,
                    "componente_id": component_id,
                    "titulo": "A user can sign in",
                    "prioridad": "ALTA",
                    "criticidad": "MEDIA",
                    "tipo_prueba": "MANUAL",
                    "pasos": [
                        {
                            "numero_paso": 1,
                            "accion": "Enter valid credentials",
                            "datos": "user=qa@example.test",
                            "resultado_esperado": "The dashboard is displayed",
                        }
                    ],
                },
            )
            assert case.status_code == 200, case.text
            case_id = case.json()["id"]

            case_detail = client.get(f"/casos/{case_id}", headers=headers)
            assert case_detail.status_code == 200, case_detail.text
            assert case_detail.json()["pasos"][0]["accion"] == "Enter valid credentials"
            step_id = case_detail.json()["pasos"][0]["id"]

            step_attachment = client.post(
                "/attachments/",
                headers=headers,
                params={"project_id": project_id, "scope": "CASE_EVIDENCE"},
                files={"file": ("case-evidence.txt", b"Controlled case evidence", "text/plain")},
            )
            assert step_attachment.status_code == 200, step_attachment.text
            step_attachment_id = step_attachment.json()["id"]
            linked_step_attachment = client.post(
                f"/pasos/{step_id}/attachments/",
                headers=headers,
                json={"attachment_id": step_attachment_id, "tipo": "evidence"},
            )
            assert linked_step_attachment.status_code == 200, linked_step_attachment.text
            listed_step_attachments = client.get(f"/pasos/{step_id}/attachments/", headers=headers)
            assert listed_step_attachments.status_code == 200, listed_step_attachments.text
            assert [item["attachment_id"] for item in listed_step_attachments.json()] == [step_attachment_id]
            unlinked_step_attachment = client.delete(
                f"/pasos/{step_id}/attachments/{step_attachment_id}/", headers=headers
            )
            assert unlinked_step_attachment.status_code == 200, unlinked_step_attachment.text
            assert unlinked_step_attachment.json() == {"ok": True}

            found_cases = client.get(
                f"/proyectos/{project_id}/casos/search",
                headers=headers,
                params={"q": "sign in", "component_id": component_id},
            )
            assert found_cases.status_code == 200, found_cases.text
            assert case_id in {item["id"] for item in found_cases.json()["items"]}

            cloned_case = client.post(f"/casos/{case_id}/clone", headers=headers, params={"suite_id": suite_id})
            assert cloned_case.status_code == 200, cloned_case.text
            clone_id = cloned_case.json()["id"]
            assert clone_id != case_id

            archived_clone = client.patch(
                f"/casos/{clone_id}/metadata",
                headers=headers,
                json={"estado_caso": "ARCHIVADO", "etiquetas": ["API", "api"]},
            )
            assert archived_clone.status_code == 200, archived_clone.text
            assert archived_clone.json()["estado_caso"] == "ARCHIVADO"
            assert archived_clone.json()["etiquetas"] == ["API"]

            visible_cases = client.get(f"/proyectos/{project_id}/casos/", headers=headers)
            assert visible_cases.status_code == 200, visible_cases.text
            assert clone_id not in {item["id"] for item in visible_cases.json()}
            all_cases = client.get(
                f"/proyectos/{project_id}/casos/", headers=headers, params={"include_archived": "true"}
            )
            assert all_cases.status_code == 200, all_cases.text
            assert clone_id in {item["id"] for item in all_cases.json()}

            invalid_move = client.patch(
                f"/casos/{case_id}/move", headers=headers, json={"suite_id": str(uuid4())}
            )
            assert invalid_move.status_code == 400

            versioned_case = client.put(
                f"/casos/{case.json()['master_id']}",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "suite_id": suite_id,
                    "componente_id": component_id,
                    "titulo": "A user can sign in - revised",
                    "prioridad": "ALTA",
                    "criticidad": "MEDIA",
                    "tipo_prueba": "MANUAL",
                    "pasos": [
                        {
                            "numero_paso": 1,
                            "accion": "Enter valid credentials",
                            "datos": "user=qa@example.test",
                            "resultado_esperado": "The dashboard is displayed",
                        },
                        {
                            "numero_paso": 2,
                            "accion": "Confirm the welcome message",
                            "resultado_esperado": "The signed-in identity is visible",
                        },
                    ],
                },
            )
            assert versioned_case.status_code == 200, versioned_case.text
            # Until a case has executions, edits deliberately update v1 in
            # place.  The service creates a new version only to preserve an
            # already executed case as immutable evidence.
            assert versioned_case.json()["version"] == 1
            case_id = versioned_case.json()["id"]

            versions = client.get(f"/casos/{case.json()['master_id']}/versions", headers=headers)
            assert versions.status_code == 200, versions.text
            assert [item["version"] for item in versions.json()] == [1]

            build = client.post(
                "/builds/",
                headers=headers,
                json={
                    "nombre": "1.0 API flow",
                    "proyecto_id": project_id,
                    "componente_id": component_id,
                    "estado": "ACTIVA",
                    "activo": True,
                },
            )
            assert build.status_code == 200, build.text
            build_id = build.json()["id"]
            project_builds = client.get(f"/proyectos/{project_id}/builds/", headers=headers)
            assert project_builds.status_code == 200, project_builds.text
            assert build_id in {item["id"] for item in project_builds.json()}
            component_builds = client.get(f"/componentes/{component_id}/builds/", headers=headers)
            assert component_builds.status_code == 200, component_builds.text
            assert build_id in {item["id"] for item in component_builds.json()}
            updated_build = client.patch(
                f"/builds/{build_id}", headers=headers, json={"nombre": "1.0 API flow revised"}
            )
            assert updated_build.status_code == 200, updated_build.text
            assert updated_build.json()["nombre"] == "1.0 API flow revised"

            assigned_cases = client.put(
                f"/builds/{build_id}/casos/",
                headers=headers,
                json={"caso_ids": [case_id]},
            )
            assert assigned_cases.status_code == 200, assigned_cases.text
            assert [item["id"] for item in assigned_cases.json()] == [case_id]
            build_cases = client.get(f"/builds/{build_id}/casos/", headers=headers)
            assert build_cases.status_code == 200, build_cases.text
            assert [item["id"] for item in build_cases.json()] == [case_id]
            project_build_cases = client.get(f"/proyectos/{project_id}/build-casos/", headers=headers)
            assert project_build_cases.status_code == 200, project_build_cases.text
            assert case_id in project_build_cases.json()[build_id]
            latest_build_results = client.get(f"/builds/{build_id}/casos/ultimos-resultados/", headers=headers)
            assert latest_build_results.status_code == 200, latest_build_results.text
            previous_failed_cases = client.get(f"/builds/{build_id}/casos/fallos-previos/", headers=headers)
            assert previous_failed_cases.status_code == 200, previous_failed_cases.text
            resolved_dataset = client.post(
                f"/casos/{case_id}/dataset/resolve",
                headers=headers,
                json={"build_id": build_id},
            )
            assert resolved_dataset.status_code == 200, resolved_dataset.text
            assert resolved_dataset.json()["caso_id"] == case_id

            automated_case = client.post(
                "/casos/",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "suite_id": suite_id,
                    "componente_id": component_id,
                    "titulo": "Automated controlled smoke",
                    "tipo_prueba": "AUTOMATIZADA",
                    "prioridad": "MEDIA",
                    "framework": "playwright",
                    "script_automatizado": "const { test } = require('@playwright/test'); test('smoke', async () => {});",
                    "pasos": [{"numero_paso": 1, "accion": "Execute smoke", "resultado_esperado": "Smoke passes"}],
                },
            )
            assert automated_case.status_code == 200, automated_case.text
            automated_case_id = automated_case.json()["id"]
            expanded_build_cases = client.put(
                f"/builds/{build_id}/casos/", headers=headers, json={"caso_ids": [case_id, automated_case_id]}
            )
            assert expanded_build_cases.status_code == 200, expanded_build_cases.text
            # An external runner uses a user-owned API key and reports against
            # the same governed solution/project/component/build chain.
            monkeypatch.setattr(entitlement_service, "is_feature_enabled", _premium_features_enabled)
            external_api_key = client.post(
                "/users/me/api-keys/", headers=headers, json={"nombre": "Controlled external runner"}
            )
            assert external_api_key.status_code == 200, external_api_key.text
            external_report = client.post(
                "/external/executions/report",
                headers={"X-QA-API-Key": external_api_key.json()["api_key"]},
                json={
                    "solution_code": organization.json()["codigo"],
                    "project_code": project.json()["codigo"],
                    "component_code": component.json()["codigo"],
                    "build_code": build.json()["codigo"],
                    "external_run_id": f"external-{suffix[:12]}",
                    "environment": "qa",
                    "cases": [{
                        "case_code": case.json()["codigo"], "status": "PASO", "duration_seconds": 1,
                        "steps": [
                            {"number": 1, "status": "PASO", "observations": "External controlled pass."},
                            {"number": 2, "status": "PASO", "observations": "External controlled confirmation."},
                        ],
                    }],
                },
            )
            assert external_report.status_code == 200, external_report.text
            assert external_report.json()["processed"] == 1
            monkeypatch.setattr(entitlement_service, "is_feature_enabled", _community_features_disabled)
            automated_run = client.post(
                "/test-runs/",
                headers=headers,
                json={
                    "nombre": "Automated scheduling contract",
                    "entorno": "QA",
                    "proyecto_id": project_id,
                    "build_id": build_id,
                    "caso_ids": [automated_case_id],
                },
            )
            assert automated_run.status_code == 200, automated_run.text
            scheduled_automation = client.post(
                f"/casos/{automated_case_id}/ejecutar-automatizada/",
                headers=headers,
                params={"test_run_id": automated_run.json()["id"]},
            )
            assert scheduled_automation.status_code == 200, scheduled_automation.text
            assert scheduled_automation.json()["caso_id"] == automated_case_id
            assert scheduled_automation.json()["job_id"]
            automated_executions = client.get(
                f"/test-runs/{automated_run.json()['id']}/ejecuciones/", headers=headers
            )
            assert automated_executions.status_code == 200, automated_executions.text
            triggered_automation = client.post(
                f"/ejecuciones/{automated_executions.json()[0]['id']}/automatizar/", headers=headers
            )
            assert triggered_automation.status_code == 200, triggered_automation.text
            assert triggered_automation.json()["mode"] == "AUTOMATIZADA_WORKER"

            manual_run = client.post(
                "/test-runs/",
                headers=headers,
                json={
                    "nombre": "Manual API lifecycle",
                    "entorno": "QA",
                    "proyecto_id": project_id,
                    "build_id": build_id,
                    "caso_ids": [case_id],
                },
            )
            assert manual_run.status_code == 200, manual_run.text
            run_id = manual_run.json()["id"]

            listed_runs = client.get(
                f"/proyectos/{project_id}/test-runs/",
                headers=headers,
                params={"build_id": build_id, "case_query": "sign in", "origin": "MANUAL"},
            )
            assert listed_runs.status_code == 200, listed_runs.text
            assert len(listed_runs.json()) == 1
            assert listed_runs.json()[0]["id"] == run_id

            run_detail = client.get(f"/test-runs/{run_id}/detalle/", headers=headers)
            assert run_detail.status_code == 200, run_detail.text
            assert run_detail.json()["id"] == run_id

            executions = client.get(f"/test-runs/{run_id}/ejecuciones/", headers=headers)
            assert executions.status_code == 200, executions.text
            assert len(executions.json()) == 1
            assert executions.json()[0]["caso_id"] == case_id
            execution_id = executions.json()[0]["id"]

            manual_ai_report = client.get(f"/ejecuciones/{execution_id}/ai-report/", headers=headers)
            assert manual_ai_report.status_code == 404

            # Recovery is only valid for a durable IA execution still marked
            # in progress.  The Engine HTTP client is isolated with a proved
            # terminal-evidence response.
            class _RecoveryResponse:
                is_success = True
                headers = {"content-type": "application/json"}

                @staticmethod
                def json():
                    return {"recoverable": True, "status": "PASO", "passed_steps": [1], "summary": "Engine evidence recovered."}

            class _RecoveryClient:
                def __init__(self, *_args, **_kwargs):
                    pass

                async def __aenter__(self):
                    return self

                async def __aexit__(self, *_args):
                    return False

                async def get(self, *_args, **_kwargs):
                    return _RecoveryResponse()

            monkeypatch.setattr(ai_execution_callbacks.httpx, "AsyncClient", _RecoveryClient)
            sync_database_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
            with psycopg.connect(sync_database_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "UPDATE ejecuciones_casos SET estado_resultado = 'EJECUTANDO_AI', execution_mode = 'IA', ai_report = '{}'::jsonb WHERE id = %s",
                        (execution_id,),
                    )
            recovered = client.post(f"/ai-engine/executions/{execution_id}/recover-from-engine-log", headers=headers)
            assert recovered.status_code == 200, recovered.text
            assert recovered.json()["recovered"] is True

            # Simulate the authenticated terminal callback of an IA worker.
            # The resulting report, trace and two review aliases remain HTTP
            # contracts rather than repository-only assertions.
            delivery_id = f"controlled-delivery-{uuid4().hex}"
            callback_token = auth.create_access_token(
                data={"sub": "ai-engine", "scope": "ai-engine-callback", "execution_id": str(execution_id)},
                expires_delta=timedelta(hours=1),
                token_type="engine_callback",
            )
            engine_callback_payload = {
                    "status": "FALLO",
                    "duration_seconds": 3,
                    "observations": "El motor controlado detectó un fallo.",
                    "metadata": {"terminal_delivery_id": delivery_id},
                    "ai_report": {
                        "summary": "Fallo controlado de IA.", "confidence": 83,
                        "consensus": "FALLO", "human_review_required": True,
                        "workflow_traces": [{"status": "SUCCESS", "metrics": {"implementation": "controlled-http-flow"}}],
                    },
                    "steps": [{"number": 1, "status": "FALLO", "observations": "Paso controlado falló."}],
            }
            for callback_headers in ({}, {"X-AI-Engine-Token": "wrong-engine-token", "X-Idempotency-Key": delivery_id}):
                denied_engine_result = client.post(
                    f"/ai-engine/executions/{execution_id}/result",
                    headers=callback_headers,
                    json=engine_callback_payload,
                )
                assert denied_engine_result.status_code == 403, denied_engine_result.text
            engine_result = client.post(
                f"/ai-engine/executions/{execution_id}/result",
                headers={"X-AI-Engine-Token": callback_token, "X-Idempotency-Key": delivery_id},
                json=engine_callback_payload,
            )
            assert engine_result.status_code == 200, engine_result.text
            assert engine_result.json()["report_complete"] is True
            ai_report = client.get(f"/ejecuciones/{execution_id}/ai-report/", headers=headers)
            assert ai_report.status_code == 200, ai_report.text
            assert ai_report.json()["execution_mode"] == "IA"
            traces = client.get(f"/ai-engine/executions/{execution_id}/traces", headers=headers)
            assert traces.status_code == 200, traces.text
            assert isinstance(traces.json(), list)
            reviewed = client.post(
                f"/ejecuciones/{execution_id}/ai-review", headers=headers, json={"note": "Revisión controlada."}
            )
            assert reviewed.status_code == 200, reviewed.text
            reviewed_alias = client.post(
                f"/ejecuciones/{execution_id}/ai-review/", headers=headers, json={"note": "Alias revisado."}
            )
            assert reviewed_alias.status_code == 200, reviewed_alias.text

            snapshots = client.get(f"/ejecuciones/{execution_id}/snapshots/", headers=headers)
            assert snapshots.status_code == 200, snapshots.text
            assert len(snapshots.json()) == 2
            snapshot_id = snapshots.json()[0]["id"]
            bulk_snapshot_update = client.patch(
                f"/ejecuciones/{execution_id}/snapshots/",
                headers=headers,
                json={"snapshots": [{"id": snapshot_id, "estado": "PASO", "comentarios": "Evidencia revisada en lote."}]},
            )
            assert bulk_snapshot_update.status_code == 200, bulk_snapshot_update.text
            assert bulk_snapshot_update.json()[0]["id"] == snapshot_id
            general_evidence_snapshot = client.post(
                f"/ejecuciones/{execution_id}/general-evidence-snapshot/", headers=headers
            )
            assert general_evidence_snapshot.status_code == 200, general_evidence_snapshot.text

            evidence = client.post(
                "/attachments/",
                headers=headers,
                params={"project_id": project_id, "scope": "EXECUTION_EVIDENCE"},
                files={"file": ("execution-evidence.txt", b"Controlled execution evidence", "text/plain")},
            )
            assert evidence.status_code == 200, evidence.text
            evidence_id = evidence.json()["id"]

            linked_evidence = client.post(
                f"/snapshots/{snapshot_id}/attachments/",
                headers=headers,
                json={"attachment_id": evidence_id, "tipo": "evidence"},
            )
            assert linked_evidence.status_code == 200, linked_evidence.text
            assert linked_evidence.json()["attachment_id"] == evidence_id

            snapshot_evidence = client.get(f"/snapshots/{snapshot_id}/attachments/", headers=headers)
            assert snapshot_evidence.status_code == 200, snapshot_evidence.text
            assert [item["attachment_id"] for item in snapshot_evidence.json()] == [evidence_id]
            grouped_evidence = client.get(f"/ejecuciones/{execution_id}/snapshot-attachments/", headers=headers)
            assert grouped_evidence.status_code == 200, grouped_evidence.text
            assert grouped_evidence.json()[snapshot_id][0]["attachment_id"] == evidence_id

            unlinked_evidence = client.delete(
                f"/snapshots/{snapshot_id}/attachments/{evidence_id}/", headers=headers
            )
            assert unlinked_evidence.status_code == 200, unlinked_evidence.text
            assert unlinked_evidence.json() == {"ok": True}

            completed_snapshot = client.patch(
                f"/snapshots/{snapshot_id}/",
                headers=headers,
                params={"estado": "FALLO", "comentarios": "The dashboard did not load."},
            )
            assert completed_snapshot.status_code == 200, completed_snapshot.text
            assert completed_snapshot.json()["estado_paso"] == "FALLO"

            unknown_snapshot = client.patch(
                f"/ejecuciones/{execution_id}/snapshots/",
                headers=headers,
                json={"snapshots": [{"id": str(uuid4()), "estado": "PASO"}]},
            )
            assert unknown_snapshot.status_code == 400
            assert "no pertenecen" in unknown_snapshot.json()["detail"].lower()

            completed_execution = client.patch(
                f"/ejecuciones/{execution_id}/",
                headers=headers,
                params={"estado": "FALLO", "duracion": 12, "comentarios": "Manual flow documented a failure."},
            )
            assert completed_execution.status_code == 200, completed_execution.text
            assert completed_execution.json()["estado_resultado"] == "FALLO"
            case_execution_history = client.get(
                f"/casos/{case_id}/historial", headers=headers, params={"build_id": build_id}
            )
            assert case_execution_history.status_code == 200, case_execution_history.text
            assert len(case_execution_history.json()) == 2
            assert execution_id in {item["id"] for item in case_execution_history.json()}

            preserved_version = client.put(
                f"/casos/{case.json()['master_id']}",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "suite_id": suite_id,
                    "componente_id": component_id,
                    "titulo": "A user can sign in - after execution",
                    "prioridad": "ALTA",
                    "criticidad": "MEDIA",
                    "tipo_prueba": "MANUAL",
                    "pasos": [{
                        "numero_paso": 1,
                        "accion": "Enter valid credentials again",
                        "resultado_esperado": "The dashboard is displayed",
                    }],
                },
            )
            assert preserved_version.status_code == 200, preserved_version.text
            assert preserved_version.json()["version"] == 2
            promoted_cases = client.post(
                f"/builds/{build_id}/casos/promote-version/",
                headers=headers,
                json={"old_caso_id": case_id, "new_caso_id": preserved_version.json()["id"]},
            )
            assert promoted_cases.status_code == 200, promoted_cases.text
            assert preserved_version.json()["id"] in {item["id"] for item in promoted_cases.json()}
            preserved_versions = client.get(f"/casos/{case.json()['master_id']}/versions", headers=headers)
            assert preserved_versions.status_code == 200, preserved_versions.text
            assert [item["version"] for item in preserved_versions.json()] == [2, 1]

            bug = client.post(
                f"/snapshots/{snapshot_id}/bugs/",
                headers=headers,
                json={"titulo": "Dashboard unavailable after login", "severidad": "ALTA", "prioridad": "P1"},
            )
            assert bug.status_code == 200, bug.text
            bug_id = bug.json()["id"]
            assert bug.json()["snapshot_id"] == snapshot_id
            assert bug.json()["estado"] == "ABIERTO"

            manual_bug = client.post(
                "/bugs/",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "componente_id": component_id,
                    "build_id": build_id,
                    "caso_id": case_id,
                    "titulo": "Manual duplicate candidate",
                    "descripcion": "Created through the direct Bug Tracker contract.",
                    "resultado_esperado": "The dashboard is displayed after valid sign in.",
                    "resultado_obtenido": "The dashboard remains unavailable.",
                    "severidad": "MEDIA",
                    "prioridad": "P2",
                },
            )
            assert manual_bug.status_code == 200, manual_bug.text
            manual_bug_id = manual_bug.json()["id"]
            linked_execution = client.post(
                f"/bugs/{manual_bug_id}/link-execution/",
                headers=headers,
                json={
                    "ejecucion_id": execution_id,
                    "attachment_ids": [evidence_id],
                    "comentario": "Linked by the controlled lifecycle.",
                },
            )
            assert linked_execution.status_code == 200, linked_execution.text
            assert linked_execution.json()["id"] == manual_bug_id

            execution_bug = client.post(
                f"/ejecuciones/{execution_id}/bugs/",
                headers=headers,
                json={
                    "titulo": "Execution-scoped API finding",
                    "descripcion": "Created from the controlled execution contract.",
                    "resultado_esperado": "The execution completes successfully.",
                    "resultado_obtenido": "A controlled finding was recorded.",
                    "severidad": "BAJA",
                    "prioridad": "P3",
                },
            )
            assert execution_bug.status_code == 200, execution_bug.text

            # Los vínculos externos son Premium. El flujo debe comprobar el
            # ciclo completo (crear, consultar y eliminar) sin dejar un
            # ticket ficticio asociado al bug que se reutiliza más abajo.
            with monkeypatch.context() as premium:
                premium.setattr(entitlement_service, "is_feature_enabled", _premium_features_enabled)
                dedupe_suggestions = client.get(
                    f"/proyectos/{project_id}/bugs/dedupe-suggestions/",
                    headers=headers,
                    params={"q": "Dashboard"},
                )
                assert dedupe_suggestions.status_code == 200, dedupe_suggestions.text
                external_link = client.post(
                    f"/bugs/{bug_id}/external-links/",
                    headers=headers,
                    json={
                        "provider_id": "redmine",
                        "external_issue_id": f"QA-{suffix[:8]}",
                        "external_issue_url": "https://redmine.example.test/issues/100",
                        "metadata_json": {"origin": "api-lifecycle"},
                    },
                )
                assert external_link.status_code == 200, external_link.text
                external_link_id = external_link.json()["id"]

                external_links = client.get(f"/bugs/{bug_id}/external-links/", headers=headers)
                assert external_links.status_code == 200, external_links.text
                assert external_link_id in {item["id"] for item in external_links.json()}

                deleted_external_link = client.delete(
                    f"/bugs/{bug_id}/external-links/{external_link_id}/", headers=headers
                )
                assert deleted_external_link.status_code == 200, deleted_external_link.text
                assert deleted_external_link.json() == {"ok": True}
                external_preview = client.post(
                    f"/bugs/{bug_id}/external-preview/", headers=headers, json={"provider_id": "redmine"}
                )
                assert external_preview.status_code == 200, external_preview.text
                assert external_preview.json()["provider_id"] == "redmine"
                marked_duplicate = client.post(
                    f"/bugs/{manual_bug_id}/mark-duplicate/",
                    headers=headers,
                    json={"duplicate_of_id": bug_id, "comentario": "Same controlled issue."},
                )
                assert marked_duplicate.status_code == 200, marked_duplicate.text
                assert marked_duplicate.json()["estado"] == "DUPLICADO"

            bug_attachment = client.post(
                f"/bugs/{bug_id}/attachments",
                headers=headers,
                json={"attachment_id": evidence_id, "tipo": "BUG_EVIDENCE"},
            )
            assert bug_attachment.status_code == 200, bug_attachment.text
            bug_attachments = client.get(f"/bugs/{bug_id}/attachments/", headers=headers)
            assert bug_attachments.status_code == 200, bug_attachments.text
            assert [item["attachment_id"] for item in bug_attachments.json()] == [evidence_id]
            deleted_bug_attachment = client.delete(
                f"/bugs/{bug_id}/attachments/{evidence_id}/", headers=headers
            )
            assert deleted_bug_attachment.status_code == 200, deleted_bug_attachment.text
            assert deleted_bug_attachment.json() == {"ok": True}
            bug_attachment_trailing = client.post(
                f"/bugs/{bug_id}/attachments/",
                headers=headers,
                json={"attachment_id": evidence_id, "tipo": "BUG_EVIDENCE"},
            )
            assert bug_attachment_trailing.status_code == 200, bug_attachment_trailing.text
            deleted_bug_attachment_trailing = client.delete(
                f"/bugs/{bug_id}/attachments/{evidence_id}/", headers=headers
            )
            assert deleted_bug_attachment_trailing.status_code == 200, deleted_bug_attachment_trailing.text

            bug_comment = client.post(
                f"/bugs/{bug_id}/comments",
                headers=headers,
                json={"comentario": "Reproduced from the execution snapshot."},
            )
            assert bug_comment.status_code == 200, bug_comment.text
            bug_comment_trailing = client.post(
                f"/bugs/{bug_id}/comments/",
                headers=headers,
                json={"comentario": "The trailing-slash contract also preserves the audit trail."},
            )
            assert bug_comment_trailing.status_code == 200, bug_comment_trailing.text

            bug_detail = client.get(f"/bugs/{bug_id}/", headers=headers)
            assert bug_detail.status_code == 200, bug_detail.text
            assert bug_detail.json()["id"] == bug_id
            updated_bug = client.patch(
                f"/bugs/{bug_id}", headers=headers,
                json={"prioridad": "P2", "notas_qa": "Triaged from the API lifecycle flow."},
            )
            assert updated_bug.status_code == 200, updated_bug.text
            assert updated_bug.json()["prioridad"] == "P2"
            in_progress = client.post(
                f"/bugs/{bug_id}/transition/", headers=headers,
                json={"estado": "EN_PROGRESO"},
            )
            assert in_progress.status_code == 200, in_progress.text
            assert in_progress.json()["estado"] == "EN_PROGRESO"
            bug_history = client.get(f"/bugs/{bug_id}/history/", headers=headers)
            assert bug_history.status_code == 200, bug_history.text
            assert "EN_PROGRESO" in {entry["to_status"] for entry in bug_history.json()}
            bug_comments = client.get(f"/bugs/{bug_id}/comments/", headers=headers)
            assert bug_comments.status_code == 200, bug_comments.text
            assert bug_comments.json()[0]["comentario"] == "Reproduced from the execution snapshot."

            related_bugs = client.get(f"/casos/{case_id}/bugs/relacionados/", headers=headers)
            assert related_bugs.status_code == 200, related_bugs.text
            assert bug_id in {item["id"] for item in related_bugs.json()}

            listed_bugs = client.get(
                f"/proyectos/{project_id}/bugs/",
                headers=headers,
                params={"snapshot_id": snapshot_id},
            )
            assert listed_bugs.status_code == 200, listed_bugs.text
            assert listed_bugs.json()["total"] == 1
            assert listed_bugs.json()["items"][0]["id"] == bug_id

            listed_bugs_without_trailing_slash = client.get(
                f"/proyectos/{project_id}/bugs",
                headers=headers,
                params={"q": "Dashboard", "estado": "EN_PROGRESO"},
            )
            assert listed_bugs_without_trailing_slash.status_code == 200, listed_bugs_without_trailing_slash.text
            assert listed_bugs_without_trailing_slash.json()["total"] == 1

            bug_summary = client.get(f"/proyectos/{project_id}/bugs/summary/", headers=headers)
            assert bug_summary.status_code == 200, bug_summary.text
            assert bug_summary.json()["total"] == 2
            assert bug_summary.json()["by_estado"]["EN_PROGRESO"] == 1

            manual_bug = client.post(
                "/bugs",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "componente_id": component_id,
                    "build_id": build_id,
                    "caso_id": case_id,
                    "titulo": "Manual lifecycle bug",
                    "descripcion": "Created through the generic bug endpoint.",
                    "resultado_esperado": "The manual workflow completes successfully.",
                    "resultado_obtenido": "The manual workflow stops before completion.",
                    "severidad": "BAJA",
                    "prioridad": "P3",
                },
            )
            assert manual_bug.status_code == 200, manual_bug.text
            assert manual_bug.json()["origen"] == "manual"

            deleted_wiki = client.delete(f"/wiki/{wiki_id}", headers=headers)
            assert deleted_wiki.status_code == 200, deleted_wiki.text
            assert deleted_wiki.json() == {"ok": True}

            metrics = client.get(
                f"/proyectos/{project_id}/metrics/",
                headers=headers,
                params={"build_id": build_id},
            )
            assert metrics.status_code == 200, metrics.text
            assert metrics.json()["total_casos_asignados"] == 2

            dashboard = client.get(
                "/dashboard/summary",
                headers=headers,
                params={"proyecto_id": project_id, "build_id": build_id, "component_id": component_id},
            )
            assert dashboard.status_code == 200, dashboard.text

            report_settings_gate = client.get(
                f"/proyectos/{project_id}/report-settings", headers=headers
            )
            assert report_settings_gate.status_code == 403
            with monkeypatch.context() as premium:
                premium.setattr(entitlement_service, "is_feature_enabled", _premium_features_enabled)
                report_settings = client.get(f"/proyectos/{project_id}/report-settings", headers=headers)
                assert report_settings.status_code == 200, report_settings.text
                updated_report_settings = client.patch(
                    f"/proyectos/{project_id}/report-settings",
                    headers=headers,
                    json={"executive": {"sections": {"summary": True, "kpis": False}}},
                )
                assert updated_report_settings.status_code == 200, updated_report_settings.text
                assert updated_report_settings.json()["executive"]["sections"]["summary"] is True

                shared_reports = client.post(
                    "/reports/share",
                    headers=headers,
                    json={
                        "proyecto_id": project_id,
                        "build_id": build_id,
                        "componente_id": component_id,
                        "requested_report_type": "executive",
                        "build_definition": "APROBADA",
                        "qa_comment": "QA contract snapshot.",
                    },
                )
                assert shared_reports.status_code == 200, shared_reports.text
                shared_report_body = shared_reports.json()
                report_token = shared_report_body["tokens"]["executive"]
                assert "payload" not in shared_report_body
                assert all("payload" not in snapshot for snapshot in shared_report_body["snapshots"])
                report_history = client.get("/reports/share/history", headers=headers, params={"proyecto_id": project_id})
                assert report_history.status_code == 200, report_history.text
                assert report_token in {item["tokens"].get("executive") for item in report_history.json()}
                report_status = client.get(f"/reports/share/{report_token}/status", headers=headers)
                assert report_status.status_code == 200, report_status.text
                public_markdown = client.get(f"/s/reports/{report_token}.md")
                assert public_markdown.status_code == 200, public_markdown.text
                assert public_markdown.headers["content-type"].startswith("text/markdown")
                public_csv = client.get(f"/s/reports/{report_token}.csv")
                assert public_csv.status_code == 200, public_csv.text
                assert public_csv.headers["content-type"].startswith("text/csv")
                public_html = client.get(f"/s/reports/{report_token}")
                assert public_html.status_code == 200, public_html.text
                assert public_html.headers["content-type"].startswith("text/html")
                public_pdf = client.get(f"/s/reports/{report_token}.pdf")
                _assert_report_pdf(public_pdf, pdf_available)
                public_thumbnail = client.get(f"/s/reports/{report_token}/thumbnail.svg")
                assert public_thumbnail.status_code == 200, public_thumbnail.text
                assert public_thumbnail.headers["content-type"].startswith("image/svg+xml")
                pretty_base = f"/informes/solution/project/build/executive/{report_token}"
                assert client.get(pretty_base).status_code == 200
                assert client.get(f"{pretty_base}.md").status_code == 200
                assert client.get(f"{pretty_base}.csv").status_code == 200
                pretty_pdf = client.get(f"{pretty_base}.pdf")
                _assert_report_pdf(pretty_pdf, pdf_available)
                assert client.get(f"{pretty_base}/preview.svg").status_code == 200

                internal_reports = client.post(
                    "/reports/share",
                    headers=headers,
                    json={
                        "proyecto_id": project_id,
                        "build_id": build_id,
                        "componente_id": component_id,
                        "requested_report_type": "internal",
                        "build_definition": "APROBADA",
                        "qa_comment": "Internal QA contract snapshot.",
                    },
                )
                assert internal_reports.status_code == 200, internal_reports.text
                internal_token = internal_reports.json()["tokens"]["internal"]
                internal_base = f"/reports/internal/{internal_token}"
                for report_suffix in ("", ".md", ".csv", ".pdf"):
                    internal_response = client.get(f"{internal_base}{report_suffix}", headers=headers)
                    if report_suffix == ".pdf":
                        _assert_report_pdf(internal_response, pdf_available)
                    else:
                        assert internal_response.status_code == 200, internal_response.text
                pretty_internal_base = f"/informes-internos/solution/project/build/{internal_token}"
                for report_suffix in ("", ".md", ".csv", ".pdf"):
                    internal_response = client.get(f"{pretty_internal_base}{report_suffix}", headers=headers)
                    if report_suffix == ".pdf":
                        _assert_report_pdf(internal_response, pdf_available)
                    else:
                        assert internal_response.status_code == 200, internal_response.text
                deleted_shared_report = client.delete(f"/reports/share/{report_token}", headers=headers)
                assert deleted_shared_report.status_code == 200, deleted_shared_report.text

            requirement = client.post(
                "/requisitos/",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "titulo": "Authenticated users can access the dashboard",
                    "estado": "ACTIVO",
                    "prioridad": "ALTA",
                    "componente_ids": [component_id],
                },
            )
            assert requirement.status_code == 200, requirement.text
            requirement_id = requirement.json()["id"]
            requirement_detail = client.get(f"/requisitos/{requirement_id}", headers=headers)
            assert requirement_detail.status_code == 200, requirement_detail.text
            assert requirement_detail.json()["titulo"] == "Authenticated users can access the dashboard"

            listed_requirements = client.get(
                f"/proyectos/{project_id}/requisitos/", headers=headers, params={"estado": "ACTIVO"}
            )
            assert listed_requirements.status_code == 200, listed_requirements.text
            assert requirement_id in {item["id"] for item in listed_requirements.json()}
            updated_requirement = client.patch(
                f"/requisitos/{requirement_id}",
                headers=headers,
                json={"descripcion_markdown": "Updated by the traceability lifecycle."},
            )
            assert updated_requirement.status_code == 200, updated_requirement.text
            requirement_history = client.get(f"/requisitos/{requirement_id}/history/", headers=headers)
            assert requirement_history.status_code == 200, requirement_history.text
            assert requirement_history.json()

            story = client.post(
                "/historias/",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "requisito_id": requirement_id,
                    "titulo": "Dashboard access after sign in",
                    "estado": "LISTA_PARA_QA",
                    "acceptance_criteria": [{
                        "local_id": "AC-1",
                        "type": "FUNCTIONAL",
                        "title": "Show the dashboard",
                        "given": "A valid user",
                        "when": "They sign in",
                        "then": ["The dashboard is displayed"],
                    }],
                },
            )
            assert story.status_code == 200, story.text
            story_id = story.json()["id"]
            story_detail = client.get(f"/historias/{story_id}", headers=headers)
            assert story_detail.status_code == 200, story_detail.text
            assert story_detail.json()["titulo"] == "Dashboard access after sign in"
            with monkeypatch.context() as premium:
                premium.setattr(entitlement_service, "is_feature_enabled", _premium_features_enabled)
                criterion_coverage = client.get(
                    f"/historias/{story_id}/criterios-cobertura", headers=headers
                )
                assert criterion_coverage.status_code == 200, criterion_coverage.text
                coverage_payload = criterion_coverage.json()
                assert coverage_payload["historia_id"] == story_id
                assert len(coverage_payload["criterios"]) == 1
                assert coverage_payload["criterios"][0]["titulo"] == "Show the dashboard"

            updated_story = client.patch(
                f"/historias/{story_id}",
                headers=headers,
                json={"descripcion_markdown": "Updated story description."},
            )
            assert updated_story.status_code == 200, updated_story.text
            requirement_stories = client.get(f"/requisitos/{requirement_id}/historias/", headers=headers)
            assert requirement_stories.status_code == 200, requirement_stories.text
            assert story_id in {item["id"] for item in requirement_stories.json()}
            story_history = client.get(f"/historias/{story_id}/history/", headers=headers)
            assert story_history.status_code == 200, story_history.text
            assert story_history.json()

            linked_stories = client.put(
                f"/casos/{case.json()['master_id']}/historias/",
                headers=headers,
                json={"historia_ids": [story_id]},
            )
            assert linked_stories.status_code == 200, linked_stories.text
            assert linked_stories.json()[0]["historia_id"] == story_id
            case_stories = client.get(
                f"/casos/{case.json()['master_id']}/historias/", headers=headers
            )
            assert case_stories.status_code == 200, case_stories.text
            assert case_stories.json()[0]["historia_id"] == story_id

            confirmed_review = client.post(
                f"/casos/{case.json()['master_id']}/historias/{story_id}/confirmar-revision",
                headers=headers,
            )
            assert confirmed_review.status_code == 200, confirmed_review.text
            assert confirmed_review.json()[0]["historia_id"] == story_id

            story_cases = client.get(f"/historias/{story_id}/casos/", headers=headers)
            assert story_cases.status_code == 200, story_cases.text
            assert story_cases.json()[0]["master_id"] == case.json()["master_id"]

            traceability = client.get(f"/proyectos/{project_id}/trazabilidad/cobertura/", headers=headers)
            assert traceability.status_code == 200, traceability.text
            assert traceability.json()["requisitos_con_historias"] == 1
            assert traceability.json()["historias_con_casos"] == 1

            archived_story = client.post(
                f"/historias/{story_id}/archive", headers=headers, json={"archivado": True}
            )
            assert archived_story.status_code == 200, archived_story.text
            visible_stories = client.get(f"/proyectos/{project_id}/historias/", headers=headers)
            assert visible_stories.status_code == 200, visible_stories.text
            assert story_id not in {item["id"] for item in visible_stories.json()}
            restored_story = client.post(
                f"/historias/{story_id}/archive", headers=headers, json={"archivado": False}
            )
            assert restored_story.status_code == 200, restored_story.text

            archived_requirement = client.post(
                f"/requisitos/{requirement_id}/archive", headers=headers, json={"archivado": True}
            )
            assert archived_requirement.status_code == 200, archived_requirement.text
            visible_requirements = client.get(f"/proyectos/{project_id}/requisitos/", headers=headers)
            assert visible_requirements.status_code == 200, visible_requirements.text
            assert requirement_id not in {item["id"] for item in visible_requirements.json()}
            archived_requirements = client.get(
                f"/proyectos/{project_id}/requisitos/", headers=headers, params={"include_archived": "true"}
            )
            assert archived_requirements.status_code == 200, archived_requirements.text
            assert requirement_id in {item["id"] for item in archived_requirements.json()}
            restored_requirement = client.post(
                f"/requisitos/{requirement_id}/archive", headers=headers, json={"archivado": False}
            )
            assert restored_requirement.status_code == 200, restored_requirement.text

            projects = client.get("/proyectos/", headers=headers)
            assert projects.status_code == 200, projects.text
            assert project_id in {item["id"] for item in projects.json()}

            other_project = client.post(
                "/proyectos/",
                headers=headers,
                json={"nombre": f"Other {suffix}", "organizacion_id": organization_id},
            )
            assert other_project.status_code == 200, other_project.text
            invalid_build = client.post(
                "/builds/",
                headers=headers,
                json={
                    "nombre": "Invalid cross-project build",
                    "proyecto_id": other_project.json()["id"],
                    "componente_id": component_id,
                    "estado": "ACTIVA",
                    "activo": True,
                },
            )
            assert invalid_build.status_code == 400
            assert "no pertenece" in invalid_build.json()["detail"].lower()
            foreign_build_metrics = client.get(
                f"/proyectos/{project_id}/metrics/",
                headers=headers,
                params={"build_id": other_project.json()["id"]},
            )
            assert foreign_build_metrics.status_code == 404

            invalid_requirement = client.post(
                "/requisitos/",
                headers=headers,
                json={
                    "proyecto_id": other_project.json()["id"],
                    "titulo": "Cross-project requirement",
                    "componente_ids": [component_id],
                },
            )
            assert invalid_requirement.status_code == 400
            assert "pertenecer" in invalid_requirement.json()["detail"].lower()

            invalid_story = client.post(
                "/historias/",
                headers=headers,
                json={
                    "proyecto_id": other_project.json()["id"],
                    "requisito_id": requirement_id,
                    "titulo": "Cross-project story",
                },
            )
            assert invalid_story.status_code == 400
            assert "pertenece" in invalid_story.json()["detail"].lower()
            removed_project_member = client.delete(
                f"/proyectos/{project_id}/miembros/{member_id}", headers=headers
            )
            assert removed_project_member.status_code == 200, removed_project_member.text
            removed_organization_member = client.delete(
                f"/organizaciones/{organization_id}/miembros/{member_id}", headers=headers
            )
            assert removed_organization_member.status_code == 200, removed_organization_member.text
            deleted_asset = client.delete(f"/infraestructura/activos/{asset_id}", headers=headers)
            assert deleted_asset.status_code == 200, deleted_asset.text
            exported_project = client.get(f"/proyectos/{project_id}/export/", headers=headers)
            assert exported_project.status_code == 200, exported_project.text
            assert exported_project.json()["proyecto"]["nombre"] == f"Project {suffix}"
            imported_project = client.post("/proyectos/import/", headers=headers, json=exported_project.json())
            assert imported_project.status_code == 200, imported_project.text
            assert imported_project.json()["id"] != project_id

            # A disposable chain isolates destructive contracts from the main
            # QA lifecycle, whose case and build deliberately retain history.
            disposable_component = client.post(
                "/componentes/",
                headers=headers,
                json={"nombre": f"Disposable {suffix}", "proyecto_id": project_id},
            )
            assert disposable_component.status_code == 200, disposable_component.text
            disposable_component_id = disposable_component.json()["id"]
            disposable_suite = client.post(
                "/suites/",
                headers=headers,
                json={
                    "nombre": f"Disposable suite {suffix}",
                    "proyecto_id": project_id,
                    "componente_id": disposable_component_id,
                },
            )
            assert disposable_suite.status_code == 200, disposable_suite.text
            disposable_case = client.post(
                "/casos/",
                headers=headers,
                json={
                    "proyecto_id": project_id,
                    "suite_id": disposable_suite.json()["id"],
                    "componente_id": disposable_component_id,
                    "titulo": f"Disposable case {suffix}",
                    "prioridad": "MEDIA",
                    "criticidad": "MEDIA",
                    "tipo_prueba": "MANUAL",
                    "pasos": [{
                        "numero_paso": 1,
                        "accion": "No ejecutar",
                        "datos": "fixture de limpieza",
                        "resultado_esperado": "No hay historial",
                    }],
                },
            )
            assert disposable_case.status_code == 200, disposable_case.text
            disposable_target_suite = client.post(
                "/suites/",
                headers=headers,
                json={
                    "nombre": f"Disposable target suite {suffix}",
                    "proyecto_id": project_id,
                    "componente_id": disposable_component_id,
                },
            )
            assert disposable_target_suite.status_code == 200, disposable_target_suite.text
            moved_disposable_case = client.patch(
                f"/casos/{disposable_case.json()['id']}/move",
                headers=headers,
                json={"suite_id": disposable_target_suite.json()["id"]},
            )
            assert moved_disposable_case.status_code == 200, moved_disposable_case.text
            assert moved_disposable_case.json()["suite_id"] == disposable_target_suite.json()["id"]
            disposable_build = client.post(
                "/builds/",
                headers=headers,
                json={
                    "nombre": f"Disposable build {suffix}",
                    "proyecto_id": project_id,
                    "componente_id": disposable_component_id,
                    "estado": "ACTIVA",
                    "activo": True,
                },
            )
            assert disposable_build.status_code == 200, disposable_build.text
            assert client.delete(f"/casos/{disposable_case.json()['id']}", headers=headers).status_code == 200
            assert client.delete(f"/suites/{disposable_suite.json()['id']}", headers=headers).status_code == 200
            assert client.delete(f"/suites/{disposable_target_suite.json()['id']}", headers=headers).status_code == 200
            assert client.delete(f"/builds/{disposable_build.json()['id']}", headers=headers).status_code == 200
            # Deleted cases/suites are archived and still need their component context.
            assert client.delete(f"/componentes/{disposable_component_id}", headers=headers).status_code == 409
            assert disposable_component_id in {c["id"] for c in client.get(f"/proyectos/{project_id}/componentes/", headers=headers).json()}
            client.portal.call(engine.dispose)
    finally:
        pass

"""HTTP lifecycle for the local extension catalog and plugin instances."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import engine
from app.repositories import project_write_policy
from app.main import app
from app.api.routers import organizations as organizations_router
from app.api.routers import projects as projects_router
from test_api_project_http_flow import _create_admin, _login


async def _allow_controlled_tenant_limit(*_args, **_kwargs) -> None:
    return None


def test_plugin_catalog_install_configuration_enable_test_and_disable_http_lifecycle():
    suffix = uuid4().hex
    email = f"extensions-flow-{suffix}@example.test"
    password = "ExtensionsFlowPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        plugins = client.get("/plugins/catalog", headers=headers)
        assert plugins.status_code == 200, plugins.text
        catalog_ids = {item["id"] for item in plugins.json()["items"]}
        assert {"bug_tracker", "motor_llm", "com.treseko.case-portability"} <= catalog_ids
        all_extensions = client.get("/extensions/catalog", headers=headers)
        assert all_extensions.status_code == 200, all_extensions.text
        integrations = client.get("/integrations/catalog", headers=headers)
        assert integrations.status_code == 200, integrations.text

        installed = client.post(
            "/extensions/ai_case_generator/install",
            headers=headers,
            json={},
        )
        assert installed.status_code == 200, installed.text
        instance_id = installed.json()["id"]
        assert installed.json()["enabled"] is False
        configured = client.patch(
            f"/extensions/{instance_id}",
            headers=headers,
            json={"config_json": {"mode": "controlled", "source": "http-lifecycle"}},
        )
        assert configured.status_code == 200, configured.text
        assert configured.json()["config_json"]["mode"] == "controlled"
        secrets = client.post(
            f"/extensions/{instance_id}/secrets",
            headers=headers,
            json={"secrets": {"api_token": "controlled-secret-not-returned"}},
        )
        assert secrets.status_code == 200, secrets.text
        secret_metadata = secrets.json()["secrets_configured"]["api_token"]
        assert secret_metadata["configured"] is True
        assert "fingerprint" not in secret_metadata
        assert "updated_at" not in secret_metadata
        assert "controlled-secret" not in secrets.text
        enabled = client.post(f"/extensions/{instance_id}/enable", headers=headers)
        assert enabled.status_code == 200, enabled.text
        assert enabled.json()["enabled"] is True
        tested = client.post(f"/extensions/{instance_id}/test", headers=headers)
        assert tested.status_code == 200, tested.text
        assert tested.json()["ok"] is True
        assert tested.json()["instance"]["id"] == instance_id
        disabled = client.post(f"/extensions/{instance_id}/disable", headers=headers)
        assert disabled.status_code == 200, disabled.text
        assert disabled.json()["enabled"] is False
        client.portal.call(engine.dispose)


def test_project_scoped_extension_is_hidden_and_rejected_for_another_project_member(monkeypatch):
    monkeypatch.setattr(organizations_router, "enforce_limit", _allow_controlled_tenant_limit)
    monkeypatch.setattr(project_write_policy, "enforce_limit", _allow_controlled_tenant_limit)
    suffix = uuid4().hex
    admin_email = f"extensions-admin-{suffix}@example.test"
    member_email = f"extensions-member-{suffix}@example.test"
    password = "ExtensionsScopePassword-2026!"
    _create_admin(admin_email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        admin_headers = _login(client, admin_email, password)

        organization_ids = []
        project_ids = []
        for index in (1, 2):
            organization = client.post(
                "/organizaciones/",
                headers=admin_headers,
                json={"nombre": f"Extension scope organization {index} {suffix}", "tipo": "Cliente"},
            )
            assert organization.status_code == 200, organization.text
            organization_ids.append(organization.json()["id"])
            project = client.post(
                "/proyectos/",
                headers=admin_headers,
                json={
                    "nombre": f"Extension scope project {index} {suffix}",
                    "organizacion_id": organization.json()["id"],
                },
            )
            assert project.status_code == 200, project.text
            project_ids.append(project.json()["id"])

        member = client.post(
            "/usuarios/",
            headers=admin_headers,
            json={
                "email": member_email,
                "nombre_completo": "Extension project member",
                "rol": "TESTER",
                "auth_provider": "local",
                "password": password,
                "permisos_detallados": {
                    "plugins.catalogo": "read",
                    "plugins.instalar": "edit",
                    "plugins.configurar": "edit",
                    "plugins.gestionar_secretos": "edit",
                    "plugins.habilitar": "edit",
                    "plugins.auditoria": "read",
                    "plugins.desinstalar": "edit",
                },
            },
        )
        assert member.status_code == 200, member.text
        member_id = member.json()["id"]
        organization_member = client.post(
            f"/organizaciones/{organization_ids[0]}/miembros/",
            headers=admin_headers,
            json={"usuario_id": member_id, "rol_cliente": "MEMBER"},
        )
        assert organization_member.status_code == 200, organization_member.text
        project_member = client.post(
            f"/proyectos/{project_ids[0]}/miembros/",
            headers=admin_headers,
            json={"usuario_id": member_id, "rol_proyecto": "TESTER"},
        )
        assert project_member.status_code == 200, project_member.text

        installed = client.post(
            "/extensions/ai_case_generator/install",
            headers=admin_headers,
            json={"organizacion_id": organization_ids[1], "proyecto_id": project_ids[1]},
        )
        assert installed.status_code == 200, installed.text
        instance_id = installed.json()["id"]

        visible_install = client.post(
            "/extensions/ai_case_generator/install",
            headers=admin_headers,
            json={"organizacion_id": organization_ids[0], "proyecto_id": project_ids[0]},
        )
        assert visible_install.status_code == 200, visible_install.text
        visible_instance_id = visible_install.json()["id"]
        visible_secret = client.post(
            f"/extensions/{visible_instance_id}/secrets",
            headers=admin_headers,
            json={"secrets": {"api_token": "catalog-redaction-secret"}},
        )
        assert visible_secret.status_code == 200, visible_secret.text

        member_headers = _login(client, member_email, password)
        catalog = client.get("/plugins/catalog", headers=member_headers)
        assert catalog.status_code == 200, catalog.text
        catalog_item = next(item for item in catalog.json()["items"] if item["id"] == "ai_case_generator")
        assert not catalog_item["instance"] or catalog_item["instance"]["id"] != instance_id
        visible_summary = next(item for item in catalog_item["instances"] if item["id"] == visible_instance_id)
        assert visible_summary["secrets_configured"] == {"api_token": {"configured": True}}

        cross_project_install = client.post(
            "/extensions/ai_case_generator/install",
            headers=member_headers,
            json={"organizacion_id": organization_ids[1], "proyecto_id": project_ids[1]},
        )
        assert cross_project_install.status_code == 403, cross_project_install.text

        cross_project_update = client.patch(
            f"/extensions/{instance_id}",
            headers=member_headers,
            json={"config_json": {"should_not": "persist"}},
        )
        assert cross_project_update.status_code == 403, cross_project_update.text
        for method, path, payload in (
            ("post", f"/extensions/{instance_id}/secrets", {"secrets": {"api_token": "denied"}}),
            ("post", f"/extensions/{instance_id}/enable", None),
            ("post", f"/extensions/{instance_id}/disable", None),
            ("post", f"/extensions/{instance_id}/test", None),
            ("post", f"/plugins/store/{instance_id}/invoke", None),
            ("get", f"/plugins/store/{instance_id}/audit", None),
            ("delete", f"/plugins/store/{instance_id}", None),
        ):
            response = getattr(client, method)(path, headers=member_headers, json=payload) if payload is not None else getattr(client, method)(path, headers=member_headers)
            assert response.status_code == 403, f"{method.upper()} {path}: {response.text}"
        client.portal.call(engine.dispose)

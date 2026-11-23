"""Hermetic HTTP lifecycle for governed AI engine administration.

The flow intentionally avoids calling a real LLM or model endpoint.  It
exercises the public API that persists configuration, encrypted provider
credentials, provider profiles and a draft workflow.  The Premium/edition
gate is enabled only in this process; production entitlement behaviour stays
covered by the Community-gate assertions elsewhere.
"""

from __future__ import annotations

from datetime import datetime, timezone
import base64
import io
import json
import zipfile
from uuid import uuid4

from fastapi.testclient import TestClient

from app import schemas
from app.api.routers import ai_engine as ai_engine_router
from app.api.routers import ai_dry_run as ai_dry_run_router
from app.database import engine
from app.main import app
from app.repositories.ai_universal_agents import _legacy_contract
from app.services.edition import entitlement_service
from test_api_project_http_flow import _create_admin, _login


async def _ai_engine_enabled(*_args, **_kwargs) -> bool:
    return True


def test_ai_engine_configuration_vault_profiles_and_workflow_http_lifecycle(monkeypatch):
    """An administrator can govern IA data without leaking credentials."""
    monkeypatch.setattr(entitlement_service, "is_feature_enabled", _ai_engine_enabled)
    monkeypatch.setenv("AI_CREDENTIALS_MASTER_KEY", "ci-ai-credentials-master-key-2026-0123456789")
    suffix = uuid4().hex
    email = f"ai-engine-{suffix}@example.test"
    password = "AiEnginePassword-2026!"
    _create_admin(email, password)

    async def fake_profile_test(_db, profile_id):
        return {"status": "ok", "profile_id": str(profile_id), "detail": "Controlled provider probe."}

    async def fake_model_scan(_db, payload):
        return {
            "status": "ok",
            "detail": "Controlled catalog probe.",
            "provider": payload.provider or "openai",
            "llm_endpoint": payload.llm_endpoint,
            "models": [{"id": "controlled-model", "name": "Controlled model", "provider": payload.provider or "openai"}],
            "scanned_at": datetime.now(timezone.utc),
            "requires_api_key": False,
            "api_key_configured": True,
        }

    async def fake_dry_run(_db, _payload, **_kwargs):
        return schemas.AiEngineDryRunResult(
            status="PASO",
            duration_seconds=1,
            observations="Dry-run controlado completado.",
            ai_report={"summary": "Dry-run controlado"},
            steps=[{"number": 1, "status": "PASO", "observations": "Paso controlado."}],
        )

    monkeypatch.setattr(ai_engine_router.crud, "test_ai_provider_profile", fake_profile_test)
    monkeypatch.setattr(ai_engine_router.crud, "scan_ai_engine_models", fake_model_scan)
    monkeypatch.setattr(ai_engine_router.crud, "run_ai_engine_dry_run", fake_dry_run)
    monkeypatch.setattr(ai_dry_run_router.crud, "run_ai_engine_dry_run", fake_dry_run)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)

        organizations = client.get("/organizaciones/", headers=headers)
        assert organizations.status_code == 200, organizations.text
        if organizations.json():
            organization_id = organizations.json()[0]["id"]
        else:
            organization = client.post(
                "/organizaciones/",
                headers=headers,
                json={"nombre": f"AI engine organization {suffix}", "tipo": "Interna"},
            )
            assert organization.status_code == 200, organization.text
            organization_id = organization.json()["id"]
        projects = client.get("/proyectos/", headers=headers)
        assert projects.status_code == 200, projects.text
        if projects.json():
            project_id = projects.json()[0]["id"]
        else:
            project = client.post(
                "/proyectos/",
                headers=headers,
                json={"nombre": f"AI engine project {suffix}", "organizacion_id": organization_id},
            )
            assert project.status_code == 200, project.text
            project_id = project.json()["id"]
        ai_queue = client.get(
            "/ai-engine/queue",
            headers=headers,
            params={"proyecto_id": project_id},
        )
        assert ai_queue.status_code == 200, ai_queue.text
        assert isinstance(ai_queue.json(), list)
        dry_run_payload = {
            "proyecto_id": project_id,
            "titulo": "Dry-run HTTP controlado",
            "pasos": [{"numero": 1, "accion": "Abrir pantalla", "resultado_esperado": "Pantalla visible"}],
        }
        dry_run = client.post("/ai-engine/dry-run", headers=headers, json=dry_run_payload)
        assert dry_run.status_code == 200, dry_run.text
        assert dry_run.json()["status"] == "PASO"
        queued_dry_run = client.post("/ai-engine/dry-run/start", headers=headers, json=dry_run_payload)
        assert queued_dry_run.status_code == 200, queued_dry_run.text
        assert queued_dry_run.json()["status"] == "RUNNING"

        health = client.get("/ai-engine/health", headers=headers)
        assert health.status_code == 200, health.text
        assert "status" in health.json()
        contract_schema = client.get("/ai-universal-agents/contract-schema", headers=headers)
        assert contract_schema.status_code == 200, contract_schema.text
        assert contract_schema.json()["$id"] == "treseko.universal-agent/v1"
        universal_agents = client.get("/ai-universal-agents/", headers=headers)
        assert universal_agents.status_code == 200, universal_agents.text
        source_key = f"controlled-source-{suffix[:12]}"
        source_contract = _legacy_contract("PLANNER", name="Controlled source", description="Hermetic portable agent.")
        source_contract.update({"key": source_key, "version": "1.0.0", "name": "Controlled source"})
        source_created = client.post(
            "/ai-universal-agents/",
            headers=headers,
            json={
                "key": source_key,
                "name": "Controlled source",
                "description": "Hermetic portable agent.",
                "category": "planning",
                "origin_type": "user",
                "version": "1.0.0",
                "contract": source_contract,
            },
        )
        assert source_created.status_code == 200, source_created.text
        source_agent = source_created.json()
        source_version = source_agent["versions"][0]
        exported_agent = client.get(
            f"/ai-universal-agents/{source_agent['id']}/versions/{source_version['id']}/export",
            headers=headers,
        )
        assert exported_agent.status_code == 200, exported_agent.text
        imported_agent = client.post(
            "/ai-universal-agents/import",
            headers=headers,
            json={"package_base64": exported_agent.json()["package_base64"], "key_override": f"controlled-agent-{suffix[:12]}"},
        )
        assert imported_agent.status_code == 200, imported_agent.text
        imported_agent_id = imported_agent.json()["id"]
        imported_contract = imported_agent.json()["versions"][0]["contract_json"]
        variant_key = f"controlled-variant-{suffix[:12]}"
        variant_contract = dict(imported_contract)
        variant_contract.update({"key": variant_key, "version": "1.0.0", "name": "Controlled variant"})
        variant = client.post(
            f"/ai-universal-agents/{imported_agent_id}/variants",
            headers=headers,
            json={
                "key": variant_key,
                "name": "Controlled variant",
                "description": "Variant created through the HTTP contract.",
                "category": "custom",
                "origin_type": "variant",
                "version": "1.0.0",
                "contract": variant_contract,
            },
        )
        assert variant.status_code == 200, variant.text
        version_contract = dict(imported_contract)
        version_contract["version"] = "1.0.1"
        created_agent_version = client.post(
            f"/ai-universal-agents/{imported_agent_id}/versions",
            headers=headers,
            json={"version": "1.0.1", "changelog": "Controlled version", "contract": version_contract},
        )
        assert created_agent_version.status_code == 200, created_agent_version.text
        published_agent_version = client.post(
            f"/ai-universal-agents/{imported_agent_id}/versions/{created_agent_version.json()['id']}/publish",
            headers=headers,
        )
        assert published_agent_version.status_code == 200, published_agent_version.text
        assert published_agent_version.json()["status"] == "PUBLISHED"
        capabilities = client.get("/ai-universal-capabilities/", headers=headers)
        assert capabilities.status_code == 200, capabilities.text
        assert any(item["key"] == "integration.mcp_call" for item in capabilities.json())
        assert client.get("/ai-agent-definitions/", headers=headers).status_code == 200

        initial_config = client.get("/ai-engine/config", headers=headers)
        assert initial_config.status_code == 200, initial_config.text
        config_payload = initial_config.json()
        assert config_payload["provider_api_keys"] == {}
        available_workflows = client.get("/ai-workflows/", headers=headers)
        assert available_workflows.status_code == 200, available_workflows.text
        active_default = next(
            item for item in available_workflows.json()
            if item.get("is_default") and item.get("status") == "ACTIVE"
        )
        config_payload.update({
            "provider_label": "Controlled test profile",
            "timeout_seconds": 120,
            "workflow_id": active_default["id"],
        })
        updated_config = client.put("/ai-engine/config", headers=headers, json=config_payload)
        assert updated_config.status_code == 200, updated_config.text
        assert updated_config.json()["provider_label"] == "Controlled test profile"
        assert updated_config.json()["provider_api_keys"] == {}

        migrated_credentials = client.post("/ai-provider-credentials/migrate-legacy", headers=headers)
        assert migrated_credentials.status_code == 200, migrated_credentials.text
        assert migrated_credentials.json()["migrated_count"] == 0
        scanned_models = client.post(
            "/ai-engine/models/scan",
            headers=headers,
            json={"provider": "openai", "llm_endpoint": "https://api.example.test/v1"},
        )
        assert scanned_models.status_code == 200, scanned_models.text
        assert scanned_models.json()["models"][0]["id"] == "controlled-model"

        created_credential = client.post(
            "/ai-provider-credentials/",
            headers=headers,
            json={"provider": "openai", "label": "CI vault credential", "secret": "ci-secret-must-not-leak"},
        )
        assert created_credential.status_code == 200, created_credential.text
        credential = created_credential.json()
        credential_id = credential["id"]
        assert credential["configured"] is True
        assert "secret" not in credential
        listed_credentials = client.get("/ai-provider-credentials/", headers=headers)
        assert listed_credentials.status_code == 200, listed_credentials.text
        assert credential_id in {item["id"] for item in listed_credentials.json()}
        renamed_credential = client.patch(
            f"/ai-provider-credentials/{credential_id}",
            headers=headers,
            json={"label": "CI vault credential v2"},
        )
        assert renamed_credential.status_code == 200, renamed_credential.text
        assert renamed_credential.json()["label"] == "CI vault credential v2"
        rotated_credential = client.put(
            f"/ai-provider-credentials/{credential_id}",
            headers=headers,
            json={"secret": "ci-rotated-secret-must-not-leak"},
        )
        assert rotated_credential.status_code == 200, rotated_credential.text
        assert rotated_credential.json()["configured"] is True

        created_profile = client.post(
            "/ai-provider-profiles/",
            headers=headers,
            json={
                "name": f"Controlled OpenAI {suffix}",
                "provider": "openai",
                "adapter": "openai-responses",
                "endpoint": "https://api.example.test/v1",
                "model": "controlled-model",
                "credential_id": credential_id,
                "request_timeout_seconds": 120,
            },
        )
        assert created_profile.status_code == 200, created_profile.text
        profile_id = created_profile.json()["id"]
        assert created_profile.json()["credential_configured"] is True
        activated_profile = client.post(f"/ai-provider-profiles/{profile_id}/activate", headers=headers)
        assert activated_profile.status_code == 200, activated_profile.text
        assert activated_profile.json()["profile"]["active_runtime"] is True
        profiles = client.get("/ai-provider-profiles/", headers=headers)
        assert profiles.status_code == 200, profiles.text
        assert profile_id in {item["id"] for item in profiles.json()}
        updated_profile = client.patch(
            f"/ai-provider-profiles/{profile_id}",
            headers=headers,
            json={"name": f"Controlled OpenAI updated {suffix}"},
        )
        assert updated_profile.status_code == 200, updated_profile.text
        assert updated_profile.json()["name"] == f"Controlled OpenAI updated {suffix}"
        tested_profile = client.post(f"/ai-provider-profiles/{profile_id}/test", headers=headers)
        assert tested_profile.status_code == 200, tested_profile.text
        assert tested_profile.json()["status"] == "ok"

        presets = client.get("/ai-agent-presets/", headers=headers)
        assert presets.status_code == 200, presets.text
        preset = client.post(
            "/ai-agent-presets/",
            headers=headers,
            json={
                "name": f"Controlled preset {suffix}",
                "type": "llm_agent",
                "category": "integration",
                "description": "Hermetic workflow preset.",
                "prompt_template": "Summarize {{input}}.",
                "config_json": {"temperature": 0},
            },
        )
        assert preset.status_code == 200, preset.text
        preset_id = preset.json()["id"]
        updated_preset = client.put(
            f"/ai-agent-presets/{preset_id}",
            headers=headers,
            json={"description": "Updated hermetic workflow preset."},
        )
        assert updated_preset.status_code == 200, updated_preset.text
        assert updated_preset.json()["description"] == "Updated hermetic workflow preset."

        workflow = client.post(
            "/ai-workflows/",
            headers=headers,
            json={
                "name": f"Controlled workflow {suffix}",
                "status": "DRAFT",
                "workflow_format": "block_v2",
                "workflow_purpose": "test_execution",
                "provider_profile_id": profile_id,
                "nodes": [],
                "edges": [],
                "changelog": "Created in the public HTTP lifecycle test.",
            },
        )
        assert workflow.status_code == 200, workflow.text
        workflow_id = workflow.json()["id"]
        assert workflow.json()["status"] == "INVALID"
        workflows = client.get("/ai-workflows/", headers=headers)
        assert workflows.status_code == 200, workflows.text
        assert workflow_id in {item["id"] for item in workflows.json()}
        workflow_detail = client.get(f"/ai-workflows/{workflow_id}", headers=headers)
        assert workflow_detail.status_code == 200, workflow_detail.text
        workflow_versions = client.get(f"/ai-workflows/{workflow_id}/versions", headers=headers)
        assert workflow_versions.status_code == 200, workflow_versions.text
        workflow_with_preset = client.post(
            f"/ai-workflows/{workflow_id}/nodes/from-preset",
            headers=headers,
            json={"preset_id": preset_id, "position_x": 160, "position_y": 120},
        )
        assert workflow_with_preset.status_code == 200, workflow_with_preset.text
        assert workflow_with_preset.json()["nodes"]
        validation = client.post(f"/ai-workflows/{workflow_id}/validate", headers=headers)
        assert validation.status_code == 200, validation.text
        assert validation.json()["valid"] is False
        assert validation.json()["issues"]
        renamed_workflow = client.put(
            f"/ai-workflows/{workflow_id}",
            headers=headers,
            json={"name": f"Controlled workflow renamed {suffix}", "changelog": "Rename draft."},
        )
        assert renamed_workflow.status_code == 200, renamed_workflow.text
        duplicate = client.post(f"/ai-workflows/{workflow_id}/duplicate", headers=headers)
        assert duplicate.status_code == 200, duplicate.text
        assert duplicate.json()["source_workflow_id"] is None
        exported = client.get(f"/ai-workflows/{workflow_id}/export", headers=headers)
        assert exported.status_code == 200, exported.text
        assert exported.json()["workflow"]["id"] == workflow_id
        assert {"workflow", "nodes", "edges", "prompt_versions", "workflow_versions"}.issubset(exported.json())
        imported_workflow = client.post("/ai-workflows/import", headers=headers, json=exported.json())
        assert imported_workflow.status_code == 200, imported_workflow.text
        assert imported_workflow.json()["id"] != workflow_id

        published_version = client.post(
            f"/ai-workflows/{workflow_id}/versions",
            headers=headers,
            json={"changelog": "Controlled immutable workflow version."},
        )
        assert published_version.status_code == 200, published_version.text
        version_number = published_version.json()["version"]
        version_detail = client.get(
            f"/ai-workflows/{workflow_id}/versions/{version_number}", headers=headers
        )
        assert version_detail.status_code == 200, version_detail.text
        restored_draft = client.post(
            f"/ai-workflows/{workflow_id}/versions/{version_number}/rollback",
            headers=headers,
            json={"changelog": "Restore controlled version."},
        )
        assert restored_draft.status_code == 200, restored_draft.text

        copied_as_blocks = client.post(f"/ai-workflows/{workflow_id}/copy-as-blocks", headers=headers)
        assert copied_as_blocks.status_code == 200, copied_as_blocks.text
        portable_source = client.post(
            "/ai-workflows/",
            headers=headers,
            json={
                "name": f"Portable source {suffix}",
                "status": "DRAFT",
                "workflow_format": "block_v2",
                "workflow_purpose": "test_execution",
                "nodes": [],
                "edges": [],
                "changelog": "Source without legacy-only adapters.",
            },
        )
        assert portable_source.status_code == 200, portable_source.text
        copied_as_universal = client.post(
            f"/ai-workflows/{portable_source.json()['id']}/copy-as-universal", headers=headers
        )
        assert copied_as_universal.status_code == 200, copied_as_universal.text
        universal_package = client.get(
            f"/ai-workflows/{copied_as_universal.json()['id']}/export-universal-package",
            headers=headers,
        )
        assert universal_package.status_code == 200, universal_package.text
        package_bytes = base64.b64decode(universal_package.json()["package_base64"])
        with zipfile.ZipFile(io.BytesIO(package_bytes)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            portable_graph = json.loads(archive.read("workflow.json"))
        assert manifest["workflow_format"] == "universal_v2"
        assert portable_graph["workflow"]["workflow_format"] == "universal_v2"
        imported_universal_workflow = client.post(
            "/ai-workflows/import-universal-package",
            headers=headers,
            json={"package_base64": universal_package.json()["package_base64"]},
        )
        assert imported_universal_workflow.status_code == 200, imported_universal_workflow.text
        assert imported_universal_workflow.json()["id"] != copied_as_universal.json()["id"]
        assert imported_universal_workflow.json()["workflow_format"] == "universal_v2"
        archived_workflow = client.post(
            f"/ai-workflows/{imported_workflow.json()['id']}/archive", headers=headers
        )
        assert archived_workflow.status_code == 200, archived_workflow.text
        assert archived_workflow.json()["status"] == "ARCHIVED"

        default_workflow = next(item for item in workflows.json() if item["is_default"])
        default_versions = client.get(f"/ai-workflows/{default_workflow['id']}/versions", headers=headers)
        assert default_versions.status_code == 200, default_versions.text
        default_version = default_versions.json()[0]["version"]
        activated_version = client.post(
            f"/ai-workflows/{default_workflow['id']}/versions/{default_version}/activate",
            headers=headers,
            json={"confirm_running": True},
        )
        assert activated_version.status_code == 200, activated_version.text
        rollback_activated = client.post(
            f"/ai-workflows/{default_workflow['id']}/versions/{default_version}/rollback-activate",
            headers=headers,
            json={"confirm_running": True},
        )
        assert rollback_activated.status_code == 200, rollback_activated.text
        restored_default = client.post(
            f"/ai-workflows/{portable_source.json()['id']}/restore-default", headers=headers
        )
        assert restored_default.status_code == 200, restored_default.text
        assert restored_default.json()["is_default"] is True

        disabled_profile = client.delete(f"/ai-provider-profiles/{profile_id}", headers=headers)
        assert disabled_profile.status_code == 200, disabled_profile.text
        assert disabled_profile.json()["enabled"] is False
        disabled_credential = client.delete(f"/ai-provider-credentials/{credential_id}", headers=headers)
        assert disabled_credential.status_code == 200, disabled_credential.text
        assert disabled_credential.json()["active"] is False
        client.portal.call(engine.dispose)

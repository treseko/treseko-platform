"""Regression contract for the two supported workflow portability surfaces."""

from __future__ import annotations

from fastapi.routing import APIRoute

from app import schemas
from app.api.routers.ai_engine import router
from app.main import app
from app.repositories.ai_builtin_workflows import BUILTIN_WORKFLOW_SLUGS, build_builtin_workflow_package
from app.repositories.ai_workflow_versions import _redact_ai_workflow_export_payload


def _route(method: str, path: str) -> APIRoute:
    for candidate in router.routes:
        if isinstance(candidate, APIRoute) and candidate.path == path and method in candidate.methods:
            return candidate
    raise AssertionError(f"Missing {method} {path} compatibility route")


def test_historical_json_workflow_routes_remain_publicly_declared():
    """Existing installations must keep the JSON backup contract available."""
    import_route = _route("POST", "/ai-workflows/import")
    export_route = _route("GET", "/ai-workflows/{workflow_id}/export")

    assert import_route.response_model.__name__ == "AiWorkflowResponse"
    assert export_route.response_model.__name__ == "AiWorkflowExport"
    assert import_route.endpoint.__name__ == "import_ai_workflow"
    assert export_route.endpoint.__name__ == "export_ai_workflow"


def test_universal_workflow_package_routes_remain_publicly_declared():
    """The ZIP-based contract remains available for interoperable transfers."""
    import_route = _route("POST", "/ai-workflows/import-universal-package")
    export_route = _route("GET", "/ai-workflows/{workflow_id}/export-universal-package")

    assert import_route.response_model.__name__ == "AiWorkflowResponse"
    assert import_route.endpoint.__name__ == "import_ai_universal_workflow_package"
    assert export_route.endpoint.__name__ == "export_ai_universal_workflow_package"


def test_all_workflow_portability_routes_survive_application_openapi_mount():
    """Protect the public document, not only the source router declaration."""
    paths = app.openapi()["paths"]

    assert {
        "/ai-workflows/import",
        "/ai-workflows/{workflow_id}/export",
        "/ai-workflows/import-universal-package",
        "/ai-workflows/{workflow_id}/export-universal-package",
    }.issubset(paths)
    assert "post" in paths["/ai-workflows/import"]
    assert "get" in paths["/ai-workflows/{workflow_id}/export"]
    assert "post" in paths["/ai-workflows/import-universal-package"]
    assert "get" in paths["/ai-workflows/{workflow_id}/export-universal-package"]


def test_historical_export_payload_is_still_a_valid_import_payload():
    """Legacy JSON remains a lossless transport envelope between schemas."""
    payload = {
        "workflow": {"name": "Historical workflow", "version": 3, "legacy_flag": True},
        "nodes": [{"id": "legacy-node", "config_json": {"enabled": True}}],
        "edges": [],
        "prompt_versions": [{"version": 1, "template": "legacy prompt"}],
        "workflow_versions": [{"version": 3, "snapshot_json": {"nodes": []}}],
    }

    exported = schemas.AiWorkflowExport.model_validate(payload)
    imported = schemas.AiWorkflowImport.model_validate(exported.model_dump())

    assert imported.workflow == payload["workflow"]
    assert imported.nodes == payload["nodes"]
    assert imported.prompt_versions == payload["prompt_versions"]
    assert imported.workflow_versions == payload["workflow_versions"]


def test_historical_export_keeps_legacy_fields_while_redacting_secrets():
    """Compatibility must preserve unknown JSON fields without exporting secrets."""
    payload = {
        "workflow": {
            "name": "Legacy backup",
            "version": 7,
            "legacy_runtime_option": {"mode": "compat"},
            "provider_api_key": "must-not-cross-the-boundary",
        },
        "nodes": [{"id": "legacy-node", "prompt": "Keep this legacy alias", "auth_token": "secret"}],
        "edges": [],
        "prompt_versions": [],
        "workflow_versions": [],
    }

    exported = _redact_ai_workflow_export_payload(payload)
    imported = schemas.AiWorkflowImport.model_validate({
        "workflow": {"name": payload["workflow"]["name"], "version": payload["workflow"]["version"], "legacy_runtime_option": payload["workflow"]["legacy_runtime_option"]},
        "nodes": [{"id": payload["nodes"][0]["id"], "prompt": payload["nodes"][0]["prompt"]}],
        "edges": [],
    })

    assert imported.workflow["legacy_runtime_option"] == {"mode": "compat"}
    assert imported.nodes[0]["prompt"] == "Keep this legacy alias"
    assert exported["workflow"]["provider_api_key"] == "[redacted]"
    assert exported["nodes"][0]["auth_token"] == "[redacted]"


def test_checked_in_universal_packages_keep_importable_contract_metadata():
    """Every built-in portable package remains a valid universal regression fixture."""
    import json
    import zipfile
    from io import BytesIO
    from hashlib import sha256

    for slug in BUILTIN_WORKFLOW_SLUGS:
        package = build_builtin_workflow_package(slug)
        with zipfile.ZipFile(BytesIO(package["bytes"])) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            workflow_bytes = archive.read("workflow.json")
            workflow = json.loads(workflow_bytes)
            archive_names = archive.namelist()

        assert manifest["package_format"] == "treseko.workflow-package/v1"
        assert manifest["workflow_format"] == "universal_v2"
        assert manifest["integrity"]["sha256"] == sha256(workflow_bytes).hexdigest()
        assert workflow["workflow"]["workflow_format"] == "universal_v2"
        assert workflow["workflow"]["workflow_purpose"] in {
            "test_execution",
            "story_generation",
            "test_case_generation",
            "chatbot_evaluation",
        }
        assert all(
            not name.startswith(("executions/", "evidence/", "credentials/", "provider-profiles/"))
            for name in archive_names
        )

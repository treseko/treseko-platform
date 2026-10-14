"""Input schema builders for the governed Treseko MCP tool catalog."""
from typing import Any

from .mcp_workspace_contracts import SPECS as WORKSPACE_SPECS


def input_schema(tool: Any) -> dict[str, Any]:
    if tool.name == "treseko.web.open":
        return {"type": "object", "additionalProperties": False, "required": ["project_id", "url"], "properties": {"project_id": {"type": "string", "format": "uuid"}, "url": {"type": "string", "pattern": "^https?://", "format": "uri", "minLength": 8, "maxLength": 2000}}}
    if tool.name in {"treseko.web.inspect", "treseko.web.close"}:
        return {"type": "object", "additionalProperties": False, "required": ["project_id", "browser_id"], "properties": {"project_id": {"type": "string", "format": "uuid"}, "browser_id": {"type": "string", "format": "uuid"}}}
    if tool.name == "treseko.web.act":
        base = {"project_id": {"type": "string", "format": "uuid"}, "browser_id": {"type": "string", "format": "uuid"}}
        version = {"type": "integer", "minimum": 1}
        nav = {"type": "object", "additionalProperties": False, "required": ["action", "url"], "properties": {**base, "action": {"const": "navigate"}, "url": {"type": "string", "pattern": "^https?://", "format": "uri", "maxLength": 2000}}}
        observed_target = {"target_id": {"type": "string", "pattern": "^t[1-9][0-9]{0,2}$"}, "target_name": {"type": "string", "maxLength": 500}}
        target_action = {"type": "object", "additionalProperties": False, "required": ["action", "browser_id", "project_id", "snapshot_version", "target_id", "target_name"], "properties": {**base, "snapshot_version": version, **observed_target, "action": {"const": "click"}}}
        press_action = {"type": "object", "additionalProperties": False, "required": ["action", "browser_id", "project_id", "snapshot_version", "target_id", "target_name", "key"], "properties": {**base, "snapshot_version": version, **observed_target, "action": {"const": "press"}, "key": {"type": "string", "enum": ["Enter", "Tab", "Escape", "Space", "ArrowDown", "ArrowUp"]}}}
        fill_action = {"type": "object", "additionalProperties": False, "required": ["action", "browser_id", "project_id", "snapshot_version", "target_id", "target_name", "secret_value"], "properties": {**base, "snapshot_version": version, **observed_target, "action": {"const": "fill"}, "secret_value": {"type": "string", "maxLength": 4000, "description": "Escritura efímera; redactada de los logs MCP/Engine."}}}
        select_action = {"type": "object", "additionalProperties": False, "required": ["action", "browser_id", "project_id", "snapshot_version", "target_id", "target_name", "option_label"], "properties": {**base, "snapshot_version": version, **observed_target, "action": {"const": "select"}, "option_label": {"type": "string", "minLength": 1, "maxLength": 200}}}
        wait_action = {"type": "object", "additionalProperties": False, "required": ["action", "browser_id", "project_id", "snapshot_version"], "properties": {**base, "snapshot_version": version, "action": {"const": "wait"}, "wait_ms": {"type": "integer", "minimum": 100, "maximum": 5000}}}
        return {"type": "object", "oneOf": [nav, target_action, press_action, fill_action, select_action, wait_action]}
    if tool.handler_key in WORKSPACE_SPECS:
        return WORKSPACE_SPECS[tool.handler_key]["schema"]
    if tool.name == "treseko.builds.cases.list":
        return {"type": "object", "required": ["project_id", "build_id"], "additionalProperties": False, "properties": {
            "project_id": {"type": "string", "format": "uuid"},
            "build_id": {"type": "string", "format": "uuid"},
            "include_inactive": {"type": "boolean"},
            "include_steps": {"type": "boolean", "description": "Incluye acción, datos y resultado esperado de cada paso del caso."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            "offset": {"type": "integer", "minimum": 0, "maximum": 10000},
        }}
    if tool.handler_key in {"builds.list", "evidence.list", "environments.list", "datasets.list", "cases.versions.list", "quality.trends"}:
        props = {"project_id": {"type": "string", "format": "uuid"}, "limit": {"type": "integer", "minimum": 1, "maximum": 1000 if tool.handler_key == "builds.list" else 50 if tool.handler_key == "quality.trends" else 100}, "offset": {"type": "integer", "minimum": 0}}
        required = ["project_id"]
        target = {"evidence.list": "snapshot_id", "datasets.list": "environment_id", "cases.versions.list": "case_id"}.get(tool.handler_key)
        if target:
            props[target] = {"type": "string", "format": "uuid"}
            required.append(target)
        return {"type": "object", "required": required, "additionalProperties": False, "properties": props}
    mutation_shapes = {
        "treseko.components.create": (["project_id", "name", "confirmation", "idempotency_key"], {"name": {"type": "string", "minLength": 1, "maxLength": 100}, "description": {"type": "string", "maxLength": 4000}, "tech_stack": {"type": "string", "maxLength": 255}, "confirmation": {"type": "string", "const": "CREATE_COMPONENT"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}),
        "treseko.builds.create": (["project_id", "component_id", "name", "confirmation", "idempotency_key"], {"component_id": {"type": "string", "format": "uuid"}, "name": {"type": "string", "minLength": 1, "maxLength": 150}, "change_context": {"type": "string", "maxLength": 10000}, "status": {"type": "string", "enum": ["PREPARACION", "ACTIVA"]}, "confirmation": {"type": "string", "const": "CREATE_BUILD"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}),
        "treseko.test-runs.create": (["project_id", "name", "environment", "build_id", "case_ids", "confirmation", "idempotency_key"], {"name": {"type": "string", "maxLength": 256}, "environment": {"type": "string", "maxLength": 256}, "environment_id": {"type": "string", "format": "uuid"}, "dataset_id": {"type": "string", "format": "uuid"}, "build_id": {"type": "string", "format": "uuid"}, "case_ids": {"type": "array", "maxItems": 100, "items": {"type": "string", "format": "uuid"}}, "origin": {"type": "string", "enum": ["MANUAL", "AUTOMATIZADA"]}, "confirmation": {"type": "string", "const": "CREATE_TEST_RUN"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}),
        "treseko.test-runs.execute": (["project_id", "run_id", "confirmation", "idempotency_key"], {"run_id": {"type": "string", "format": "uuid"}, "confirmation": {"type": "string", "const": "EXECUTE_TEST_RUN"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}),
        "treseko.test-runs.status": (["project_id", "run_id"], {"run_id": {"type": "string", "format": "uuid"}}),
        "treseko.test-runs.cancel": (["project_id", "run_id", "confirmation", "idempotency_key"], {"run_id": {"type": "string", "format": "uuid"}, "confirmation": {"type": "string", "const": "CANCEL_TEST_RUN"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}),
    }
    if tool.name == "treseko.test-results.record-manual":
        step_result = {"type": "object", "required": ["number", "status"], "additionalProperties": False, "properties": {
            "number": {"type": "integer", "minimum": 1, "maximum": 1000},
            "status": {"type": "string", "enum": ["PASO", "FALLO", "BLOQUEADO"]},
            "comments": {"type": "string", "maxLength": 2000},
            "evidence_url": {"type": "string", "maxLength": 2000},
        }}
        return {"type": "object", "required": ["project_id", "execution_id", "status", "steps", "confirmation", "idempotency_key"], "additionalProperties": False, "properties": {
            "project_id": {"type": "string", "format": "uuid"}, "execution_id": {"type": "string", "format": "uuid"},
            "status": {"type": "string", "enum": ["PASO", "FALLO", "BLOQUEADO"]},
            "steps": {"type": "array", "maxItems": 100, "items": step_result},
            "notes": {"type": "string", "maxLength": 4000}, "duration_seconds": {"type": "integer", "minimum": 0, "maximum": 86400},
            "confirmation": {"type": "string", "const": "RECORD_MANUAL_RESULT"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128},
        }}
    if tool.name == "treseko.suites.list":
        return {"type": "object", "required": ["project_id"], "additionalProperties": False, "properties": {
            "project_id": {"type": "string", "format": "uuid"},
            "component_id": {"type": "string", "format": "uuid"},
            "include_archived": {"type": "boolean"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            "offset": {"type": "integer", "minimum": 0, "maximum": 10000},
        }}
    if tool.name in mutation_shapes:
        required, extra = mutation_shapes[tool.name]
        return {"type": "object", "required": required, "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, **extra}}
    if tool.name in {"treseko.cases.create", "treseko.cases.update", "treseko.cases.archive", "treseko.bugs.create-from-result", "treseko.bugs.create-from-snapshot", "treseko.bugs.update", "treseko.bugs.transition", "treseko.bugs.close"}:
        required = ["project_id", "confirmation", "idempotency_key"]
        if tool.name == "treseko.cases.create":
            required.append("title")
        if tool.name in {"treseko.bugs.create-from-result", "treseko.bugs.create-from-snapshot"}:
            required.append("bug")
        if tool.name.endswith(".update") or tool.name.endswith(".archive") or tool.name.endswith(".transition") or tool.name.endswith(".close"):
            required.insert(1, "case_id" if tool.name.startswith("treseko.cases") else "bug_id")
        if tool.name in {"treseko.bugs.transition", "treseko.bugs.close"}: required.append("transition")
        if "from-result" in tool.name: required.insert(1, "execution_id")
        if "from-snapshot" in tool.name: required.insert(1, "snapshot_id")
        confirmation = {"type": "string", "const": {"treseko.cases.create": "CREATE_CASE", "treseko.cases.update": "UPDATE_CASE", "treseko.cases.archive": "ARCHIVE_CASE", "treseko.bugs.create-from-result": "CREATE_BUG_FROM_RESULT", "treseko.bugs.create-from-snapshot": "CREATE_BUG_FROM_SNAPSHOT", "treseko.bugs.update": "UPDATE_BUG", "treseko.bugs.transition": "TRANSITION_BUG", "treseko.bugs.close": "CLOSE_BUG"}.get(tool.name, "MUTATE")}
        step = {"type": "object", "required": ["action", "expected_result"], "additionalProperties": False, "properties": {"number": {"type": "integer", "minimum": 1, "maximum": 1000}, "action": {"type": "string", "minLength": 1, "maxLength": 10000}, "data": {"anyOf": [{"type": "string", "maxLength": 10000}, {"type": "null"}]}, "expected_result": {"type": "string", "minLength": 1, "maxLength": 10000}}}
        bug_update = {"type": "object", "additionalProperties": False, "properties": {"title": {"type": "string", "minLength": 1, "maxLength": 255}, "description": {"type": "string", "maxLength": 20000}, "severity": {"type": "string", "maxLength": 30}, "priority": {"type": "string", "maxLength": 30}, "status": {"type": "string", "maxLength": 30}, "expected_result": {"type": "string", "maxLength": 20000}, "actual_result": {"type": "string", "maxLength": 20000}, "test_data": {"type": "string", "maxLength": 20000}, "comment": {"type": "string", "maxLength": 10000}}}
        transition = {"type": "object", "required": ["status"], "additionalProperties": False, "properties": {"status": {"type": "string", "minLength": 1, "maxLength": 30}, "resolution_build_id": {"type": "string", "format": "uuid"}, "resolution": {"type": "string", "maxLength": 20000}, "close_reason": {"type": "string", "maxLength": 20000}}}
        properties = {"project_id": {"type": "string", "format": "uuid"}, "case_id": {"type": "string", "format": "uuid"}, "bug_id": {"type": "string", "format": "uuid"}, "execution_id": {"type": "string", "format": "uuid"}, "snapshot_id": {"type": "string", "format": "uuid"}, "confirmation": confirmation, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}, "name": {"type": "string", "maxLength": 256}, "title": {"type": "string", "minLength": 1, "maxLength": 255}, "description": {"type": "string", "maxLength": 20000}, "priority": {"type": "string", "maxLength": 30}, "criticality": {"type": "string", "maxLength": 30}, "test_type": {"type": "string", "enum": ["MANUAL", "AUTOMATIZADA", "AUTOMATIZADA_AI"]}, "format": {"type": "string", "enum": ["CLASICA", "API"]}, "steps": {"type": "array", "maxItems": 100, "items": step}, "dataset": {"type": "array", "maxItems": 100}, "api_configuration": {"type": "object", "description": "Contrato treseko.api-test/v1, validado por el runner API declarativo."}, "bug": bug_update, "transition": transition}
        if tool.name == "treseko.cases.create":
            properties.update({key: {"type": "string", "format": "uuid"} for key in ("component_id", "suite_id", "build_id")})
            properties.update({
                "automation_script": {"type": "string", "maxLength": 48000},
                "automation_framework": {"type": "string", "maxLength": 120},
            })
            properties.update({
                "story_ids": {"type": "array", "maxItems": 50, "items": {"type": "string", "format": "uuid"}},
                "acceptance_criteria_ids": {"type": "array", "maxItems": 100, "items": {"type": "string", "format": "uuid"}},
            })
        elif tool.name == "treseko.cases.update":
            properties.update({
                "automation_script": {"type": "string", "maxLength": 48000},
                "automation_framework": {"type": "string", "maxLength": 120},
                "story_ids": {"type": "array", "maxItems": 50, "items": {"type": "string", "format": "uuid"}, "description": "Conjunto completo de historias vinculadas tras la actualización."},
                "acceptance_criteria_ids": {"type": "array", "maxItems": 100, "items": {"type": "string", "format": "uuid"}, "description": "Conjunto completo de criterios vinculados tras la actualización."},
            })
        return {"type": "object", "required": required, "additionalProperties": False, "properties": properties}
    schemas = {
        "treseko.evidence.list": (["project_id", "snapshot_id"], {"snapshot_id": {"type": "string", "format": "uuid"}}),
        "treseko.evidence.get": (["project_id", "evidence_id"], {"evidence_id": {"type": "string", "format": "uuid"}}),
        "treseko.environments.list": (["project_id"], {}),
        "treseko.environments.get": (["project_id", "environment_id"], {"environment_id": {"type": "string", "format": "uuid"}}),
        "treseko.datasets.list": (["project_id", "environment_id"], {"environment_id": {"type": "string", "format": "uuid"}}),
        "treseko.datasets.get": (["project_id", "dataset_id"], {"dataset_id": {"type": "string", "format": "uuid"}}),
        "treseko.cases.versions.list": (["project_id", "case_id"], {"case_id": {"type": "string", "format": "uuid"}}),
        "treseko.quality.trends": (["project_id"], {"limit": {"type": "integer", "minimum": 1, "maximum": 50}}),
        "treseko.quality.compare": (["project_id", "baseline_build_id", "candidate_build_id"], {"baseline_build_id": {"type": "string", "format": "uuid"}, "candidate_build_id": {"type": "string", "format": "uuid"}}),
    }
    if tool.name in schemas:
        required, extra = schemas[tool.name]
        return {"type": "object", "required": required, "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, **extra}}
    if tool.name == "treseko.cases.list":
        return {"type": "object", "required": ["project_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0, "maximum": 10000}}}
    if tool.name == "treseko.cases.get":
        return {"type": "object", "required": ["project_id", "case_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "case_id": {"type": "string", "format": "uuid"}}}
    if tool.name == "treseko.test-runs.list":
        return {"type": "object", "required": ["project_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0, "maximum": 10000}}}
    if tool.name == "treseko.test-runs.get":
        return {"type": "object", "required": ["project_id", "run_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "run_id": {"type": "string", "format": "uuid"}}}
    if tool.name == "treseko.test-results.list":
        return {"type": "object", "required": ["project_id", "run_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "run_id": {"type": "string", "format": "uuid"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0, "maximum": 10000}}}
    if tool.name == "treseko.test-results.get":
        return {"type": "object", "required": ["project_id", "execution_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "execution_id": {"type": "string", "format": "uuid"}}}
    if tool.name == "treseko.bugs.list":
        return {"type": "object", "required": ["project_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "build_id": {"type": "string", "format": "uuid"}, "estado": {"type": "string", "maxLength": 30}, "severidad": {"type": "string", "maxLength": 20}, "prioridad": {"type": "string", "maxLength": 20}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0, "maximum": 10000}}}
    if tool.name == "treseko.bugs.get":
        return {"type": "object", "required": ["project_id", "bug_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "bug_id": {"type": "string", "format": "uuid"}}}
    if tool.name == "treseko.quality.summary":
        return {"type": "object", "required": ["project_id", "build_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "build_id": {"type": "string", "format": "uuid"}}}
    if tool.operation == "preview":
        return {
            "type": "object",
            "required": ["project_id", "profile_id", "content_base64"],
            "additionalProperties": False,
            "properties": {
                "project_id": {"type": "string", "format": "uuid"},
                "profile_id": {"type": "string", "minLength": 1, "maxLength": 100},
                "content_base64": {"type": "string", "minLength": 1, "maxLength": 12000000},
                "file_name": {"type": "string", "maxLength": 255},
                "component_id": {"type": "string", "format": "uuid"},
                "build_id": {"type": "string", "format": "uuid"},
            },
        }
    if tool.operation == "commit":
        return {"type": "object", "required": ["project_id", "profile_id", "content_base64", "component_id", "confirmation", "preview_token", "package_sha256", "idempotency_key"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "profile_id": {"type": "string", "minLength": 1, "maxLength": 100}, "content_base64": {"type": "string", "minLength": 1, "maxLength": 12000000}, "file_name": {"type": "string", "maxLength": 255}, "selected_external_ids": {"type": "array", "maxItems": 500, "items": {"type": "string", "maxLength": 255}}, "component_id": {"type": "string", "format": "uuid"}, "build_id": {"type": "string", "format": "uuid"}, "confirmation": {"type": "string", "const": "APPLY_CASE_IMPORT"}, "preview_token": {"type": "string", "minLength": 1, "maxLength": 128}, "package_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}}
    if tool.operation == "rollback":
        return {"type": "object", "required": ["project_id", "batch_id", "commit_receipt", "rollback_token", "confirmation", "idempotency_key"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}, "batch_id": {"type": "string", "format": "uuid"}, "commit_receipt": {"type": "string", "maxLength": 128}, "rollback_token": {"type": "string", "maxLength": 128}, "confirmation": {"type": "string", "const": "ROLLBACK_CASE_IMPORT"}, "idempotency_key": {"type": "string", "minLength": 1, "maxLength": 128}}}
    return {"type": "object", "required": ["project_id"], "additionalProperties": False, "properties": {"project_id": {"type": "string", "format": "uuid"}}}

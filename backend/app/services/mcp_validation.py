from __future__ import annotations
from typing import Any
from uuid import UUID

def validate_tool_arguments(tool: McpTool, arguments: Any):
    """Validate the small typed boundary before accessing any argument.

    MCP clients are untrusted; malformed JSON must be rejected as a client
    error, never allowed to turn into an internal AttributeError/500.
    """
    if not isinstance(arguments, dict):
        raise ValueError("arguments debe ser un objeto JSON")  # noqa: TRY004
    if tool.operation == "commit" or tool.name in {"treseko.test-runs.create", "treseko.test-runs.execute", "treseko.test-runs.cancel", "treseko.cases.create", "treseko.cases.update", "treseko.cases.archive", "treseko.bugs.create-from-result", "treseko.bugs.create-from-snapshot", "treseko.bugs.update", "treseko.bugs.transition", "treseko.bugs.close"}:
        allowed = set(tool.input_schema.get("properties", {}))
        if set(arguments) - allowed:
            raise ValueError("arguments contiene campos no permitidos")
        missing = [name for name in tool.input_schema.get("required", []) if name not in arguments]
        if missing:
            raise ValueError("faltan argumentos obligatorios")
        result = dict(arguments)
        try: result["project_id"] = str(UUID(str(arguments["project_id"]).strip()))
        except (KeyError, ValueError, TypeError, AttributeError): raise ValueError("project_id debe ser UUID") from None
        for key in ("case_id", "bug_id", "run_id", "execution_id", "snapshot_id", "build_id", "environment_id", "dataset_id"):
            if key in result:
                try: result[key] = str(UUID(str(result[key]).strip()))
                except (ValueError, TypeError, AttributeError): raise ValueError(f"{key} debe ser UUID") from None
        expected = {"test-runs.create": "CREATE_TEST_RUN", "test-runs.execute": "EXECUTE_TEST_RUN", "test-runs.cancel": "CANCEL_TEST_RUN", "cases.create": "CREATE_CASE", "cases.update": "UPDATE_CASE", "cases.archive": "ARCHIVE_CASE", "bugs.create-from-result": "CREATE_BUG_FROM_RESULT", "bugs.create-from-snapshot": "CREATE_BUG_FROM_SNAPSHOT", "bugs.update": "UPDATE_BUG", "bugs.transition": "TRANSITION_BUG", "bugs.close": "TRANSITION_BUG", "cases.import.commit": "APPLY_CASE_IMPORT", "cases.import.rollback": "ROLLBACK_CASE_IMPORT"}.get(tool.handler_key)
        if tool.operation == "commit" and (arguments.get("confirmation") != expected or not str(arguments.get("idempotency_key") or "").strip()): raise ValueError("confirmación e idempotency_key obligatorios")
        return result
    allowed = {"project_id"}
    if tool.name == "treseko.cases.list":
        allowed |= {"limit", "offset"}
    elif tool.name == "treseko.cases.get":
        allowed |= {"case_id"}
    elif tool.name == "treseko.test-runs.list":
        allowed |= {"limit", "offset"}
    elif tool.name == "treseko.test-results.list":
        allowed |= {"run_id", "limit", "offset"}
    elif tool.name in {"treseko.test-runs.get", "treseko.test-runs.status"}:
        allowed |= {"run_id"}
    elif tool.name == "treseko.test-results.get":
        allowed |= {"execution_id"}
    elif tool.name == "treseko.bugs.list":
        allowed |= {"build_id", "estado", "severidad", "prioridad", "limit", "offset"}
    elif tool.name == "treseko.bugs.get":
        allowed |= {"bug_id"}
    elif tool.name == "treseko.quality.summary":
        allowed |= {"build_id"}
    elif tool.name in {"treseko.evidence.list", "treseko.evidence.get", "treseko.environments.list", "treseko.environments.get", "treseko.datasets.list", "treseko.datasets.get", "treseko.cases.versions.list", "treseko.quality.trends", "treseko.quality.compare"}:
        allowed |= {"snapshot_id", "evidence_id", "environment_id", "dataset_id", "case_id", "baseline_build_id", "candidate_build_id", "limit"}
    if tool.operation in {"preview", "commit"}:
        allowed |= {"profile_id", "content_base64", "file_name", "component_id", "build_id"}
    if tool.operation == "commit":
        allowed |= {"selected_external_ids", "confirmation", "preview_token", "package_sha256", "idempotency_key"}
    if tool.operation == "rollback":
        allowed |= {"batch_id", "commit_receipt", "rollback_token", "confirmation", "idempotency_key"}
    unexpected = set(arguments) - allowed
    if unexpected:
        raise ValueError("arguments contiene campos no permitidos")
    project_id = arguments.get("project_id")
    if not isinstance(project_id, str) or not project_id.strip():
        raise ValueError("project_id es obligatorio")
    try:
        normalized_project_id = str(UUID(project_id.strip()))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("project_id debe ser UUID") from None
    result = {"project_id": normalized_project_id}
    if tool.name in {"treseko.evidence.list", "treseko.evidence.get", "treseko.environments.get", "treseko.datasets.list", "treseko.datasets.get", "treseko.cases.versions.list", "treseko.quality.compare"}:
        required_ids = {
            "treseko.evidence.list": ("snapshot_id",), "treseko.evidence.get": ("evidence_id",),
            "treseko.environments.get": ("environment_id",), "treseko.datasets.list": ("environment_id",),
            "treseko.datasets.get": ("dataset_id",), "treseko.cases.versions.list": ("case_id",),
            "treseko.quality.compare": ("baseline_build_id", "candidate_build_id"),
        }[tool.name]
        for key in required_ids:
            try:
                result[key] = str(UUID(str(arguments[key]).strip()))
            except (KeyError, ValueError, TypeError, AttributeError):
                raise ValueError(f"{key} debe ser UUID") from None
    if tool.name == "treseko.quality.trends":
        limit = arguments.get("limit", 20)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50:
            raise ValueError("limit fuera de rango")
        result["limit"] = limit
    if tool.name in {"treseko.bugs.get", "treseko.quality.summary"} or (tool.name == "treseko.bugs.list" and "build_id" in arguments):
        key = "bug_id" if tool.name == "treseko.bugs.get" else "build_id"
        try:
            result[key] = str(UUID(str(arguments[key]).strip()))
        except (KeyError, ValueError, TypeError, AttributeError):
            raise ValueError(f"{key} debe ser UUID") from None
    if tool.name == "treseko.quality.summary" and "build_id" not in result:
        raise ValueError("build_id es obligatorio")
    if tool.name == "treseko.bugs.list":
        limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100: raise ValueError("limit fuera de rango")
        if isinstance(offset, bool) or not isinstance(offset, int) or not 0 <= offset <= 10000: raise ValueError("offset fuera de rango")
        for key, maximum in (("estado", 30), ("severidad", 20), ("prioridad", 20)):
            if key in arguments and (not isinstance(arguments[key], str) or len(arguments[key]) > maximum):
                raise ValueError(f"{key} inválido")
        result.update({key: arguments[key] for key in ("estado", "severidad", "prioridad") if key in arguments})
        result.update(limit=limit, offset=offset)
    if tool.name == "treseko.cases.list":
        limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("limit fuera de rango")
        if isinstance(offset, bool) or not isinstance(offset, int) or not 0 <= offset <= 10000:
            raise ValueError("offset fuera de rango")
        result.update(limit=limit, offset=offset)
    elif tool.name == "treseko.cases.get":
        case_id = arguments.get("case_id")
        if not isinstance(case_id, str) or not case_id.strip():
            raise ValueError("case_id es obligatorio")
        try:
            result["case_id"] = str(UUID(case_id.strip()))
        except (ValueError, TypeError, AttributeError):
            raise ValueError("case_id debe ser UUID") from None
    elif tool.name in {"treseko.test-runs.get", "treseko.test-results.get"}:
        key = "run_id" if tool.name.endswith("test-runs.get") else "execution_id"
        value = arguments.get(key)
        if not isinstance(value, str):
            raise ValueError(f"{key} debe ser UUID")
        try:
            result[key] = str(UUID(value.strip()))
        except (ValueError, TypeError, AttributeError):
            raise ValueError(f"{key} debe ser UUID") from None
    elif tool.name in {"treseko.test-runs.list", "treseko.test-results.list"}:
        if tool.name.endswith("test-results.list"):
            try:
                result["run_id"] = str(UUID(str(arguments["run_id"]).strip()))
            except (KeyError, ValueError, TypeError, AttributeError):
                raise ValueError("run_id debe ser UUID") from None
        limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("limit fuera de rango")
        if isinstance(offset, bool) or not isinstance(offset, int) or not 0 <= offset <= 10000:
            raise ValueError("offset fuera de rango")
        result.update(limit=limit, offset=offset)
    if tool.operation in {"preview", "commit"}:
        for name in ("profile_id", "content_base64", "file_name"):
            if name in arguments and not isinstance(arguments[name], str):
                raise ValueError(f"{name} debe ser texto")
        for name in ("profile_id", "content_base64"):
            if not str(arguments.get(name) or "").strip():
                raise ValueError(f"{name} es obligatorio")
        for name in ("component_id", "build_id"):
            if arguments.get(name) is not None:
                try:
                    result[name] = str(UUID(str(arguments[name]).strip()))
                except (ValueError, TypeError, AttributeError):
                    raise ValueError(f"{name} debe ser UUID") from None
        for name in ("profile_id", "content_base64", "file_name"):
            if name in arguments:
                result[name] = arguments[name]
        if tool.operation == "commit":
            if arguments.get("confirmation") != "APPLY_CASE_IMPORT":
                raise ValueError("confirmación explícita requerida")
            for name in ("preview_token", "package_sha256", "idempotency_key"):
                if not isinstance(arguments.get(name), str) or not arguments[name].strip():
                    raise ValueError(f"{name} es obligatorio")
                result[name] = arguments[name]
            result["confirmation"] = arguments["confirmation"]
            if "selected_external_ids" in arguments:
                if not isinstance(arguments["selected_external_ids"], list) or any(not isinstance(x, str) for x in arguments["selected_external_ids"]):
                    raise ValueError("selected_external_ids debe ser una lista")
                result["selected_external_ids"] = arguments["selected_external_ids"][:500]
    if tool.operation == "rollback":
        for name in ("batch_id", "commit_receipt", "rollback_token", "confirmation", "idempotency_key"):
            if not isinstance(arguments.get(name), str) or not arguments[name].strip():
                raise ValueError(f"{name} es obligatorio")
            result[name] = arguments[name]
        if arguments["confirmation"] != "ROLLBACK_CASE_IMPORT":
            raise ValueError("confirmación explícita requerida")
        try:
            result["batch_id"] = str(UUID(arguments["batch_id"].strip()))
        except (ValueError, TypeError, AttributeError):
            raise ValueError("batch_id debe ser UUID") from None
    return result



def sanitize_arguments(value: Any, *, depth: int = 0) -> Any:
    """Bound and redact audit arguments; never persist a prompt or secret."""
    secret_tokens = ("token", "secret", "password", "api_key", "authorization", "cookie", "content_base64")
    if depth > 4:
        return "[max-depth]"
    if isinstance(value, dict):
        result = {}
        for key, item in list(value.items())[:32]:
            key_text = str(key)[:80]
            result[key_text] = "[redacted]" if any(token in key_text.lower() for token in secret_tokens) else sanitize_arguments(item, depth=depth + 1)
        return result
    if isinstance(value, list):
        return [sanitize_arguments(item, depth=depth + 1) for item in value[:32]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value if not isinstance(value, str) else value[:500]
    return str(value)[:200]

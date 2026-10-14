from typing import Any

from .. import models


def _api_progress_status(execution: models.EjecucionCaso) -> str:
    """Map the persisted execution/result state to the API monitor contract."""
    result_status = str((execution.api_resultado or {}).get("status") or "").upper()
    if result_status in {"RUNNING", "ERROR"}:
        return result_status
    execution_status = execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else str(execution.estado_resultado or "")
    return {
        models.EstadoResultado.PASO.value: "PASSED",
        models.EstadoResultado.FALLO.value: "FAILED",
        models.EstadoResultado.BLOQUEADO.value: "BLOCKED",
        models.EstadoResultado.EJECUTANDO_AI.value: "RUNNING",
    }.get(execution_status, "PENDING")


def _api_progress_item(execution: models.EjecucionCaso, case: models.CasoPrueba) -> dict[str, Any]:
    result = execution.api_resultado or {}
    steps = result.get("steps") or []
    definition = getattr(execution, "api_config_snapshot", None) or getattr(case, "configuracion_api", None) or {}
    schema_version = str(definition.get("schema_version") or "treseko.api-test/v1")
    framework_version = schema_version.rsplit("/v", 1)[-1] if "/v" in schema_version else "1"
    assertions = [
        assertion
        for step in steps
        if isinstance(step, dict)
        for assertion in (step.get("assertions") or [])
        if isinstance(assertion, dict)
    ]
    errors = result.get("errors") or []
    error_message = errors[0].get("error") if errors and isinstance(errors[0], dict) else (str(errors[0]) if errors else None)
    assertion_passed = sum(1 for item in assertions if str(item.get("status")).upper() == "PASSED")
    assertion_failed = sum(1 for item in assertions if str(item.get("status")).upper() == "FAILED")
    return {
        "case_id": str(case.id),
        "case_code": case.codigo,
        "case_title": case.titulo,
        "status": _api_progress_status(execution),
        "framework": f"HTTP/REST · v{framework_version}",
        "executor": "API runner",
        "http_status": next(
            (step.get("response", {}).get("status") for step in steps if isinstance(step, dict) and isinstance(step.get("response"), dict)),
            None,
        ),
        "duration_ms": result.get("duration_ms") or max(0, int(execution.duracion_segundos or 0) * 1000),
        "assertions_passed": assertion_passed,
        "assertions_failed": assertion_failed,
        "message": execution.observaciones or error_message,
    }

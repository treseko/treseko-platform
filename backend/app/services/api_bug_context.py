"""Build a safe, structured evidence view for API execution bugs.

API executions already persist their request/response result on
``EjecucionCaso``.  This resolver keeps that evidence out of the generic bug
summary while making it available to the Bug Tracker and report previews.
"""
from __future__ import annotations

import json
import re
from hashlib import sha256
from typing import Any

from ..services.api_test_runner import sanitize_api_config
from ..services.api_evidence_policy import public_api_evidence_enabled, evidence_policy_marker
from ..services.ai_report_sanitizer import sanitize_ai_report_payload
from ..time_utils import isoformat_utc


VARIABLE_PATTERN = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
SENSITIVE_VARIABLE = re.compile(r"token|secret|password|passwd|authorization|api[-_]?key|cookie", re.IGNORECASE)


def _collect_variable_names(value: Any, names: set[str] | None = None) -> set[str]:
    if names is None:
        names = set()
    if isinstance(value, str):
        names.update(match.group(1).strip() for match in VARIABLE_PATTERN.finditer(value))
    elif isinstance(value, list):
        for item in value:
            _collect_variable_names(item, names)
    elif isinstance(value, dict):
        for item in value.values():
            _collect_variable_names(item, names)
    return names


def _used_variables(config: dict[str, Any], variables: dict[str, Any], *, redact: bool = True) -> dict[str, Any]:
    used: dict[str, Any] = {}
    for name in sorted(_collect_variable_names(config)):
        if name not in variables:
            used[name] = "[SIN VALOR]"
        elif redact and SENSITIVE_VARIABLE.search(name):
            used[name] = "[REDACTADO]"
        else:
            used[name] = _safe_json(variables[name], redact=redact)
    return used


def is_api_case(case: Any) -> bool:
    value = getattr(getattr(case, "formato_prueba", None), "value", getattr(case, "formato_prueba", ""))
    return str(value or "").upper() == "API"


def _safe_json(value: Any, *, redact: bool = True) -> Any:
    if isinstance(value, (dict, list)):
        return sanitize_ai_report_payload(value) if redact else value
    if value is None:
        return None
    return str(value)


def _normalize_step(step: Any, position: int, *, redact: bool = True) -> dict[str, Any]:
    item = step if isinstance(step, dict) else {}
    request = item.get("request") if isinstance(item.get("request"), dict) else {}
    response = item.get("response") if isinstance(item.get("response"), dict) else {}
    status_code = (
        response.get("status_code")
        or response.get("statusCode")
        or response.get("status")
        or item.get("status_code")
        or item.get("statusCode")
    )
    latency = (
        item.get("latency_ms")
        or item.get("latencyMs")
        or (response.get("timings") or {}).get("total_ms")
    )
    return _safe_json({
        "index": int(item.get("index") or position + 1),
        "visible_index": int(item.get("index") or position + 1),
        "name": item.get("name") or f"Solicitud {position + 1}",
        "status": item.get("status") or "NOT_EXECUTED",
        "request": request,
        "response": response,
        "status_code": status_code,
        "latency_ms": latency,
        "assertions": item.get("assertions") or [],
        "errors": item.get("errors") or ([item.get("error")] if item.get("error") else []),
        "observed": item.get("observed") or item.get("response_text") or item.get("responseText"),
        "expected": item.get("expected") or item.get("expected_result") or {},
        "tools": item.get("tools") or [],
    }, redact=redact)


def build_api_context(*, bug_id: Any, execution: Any, run: Any, case: Any, environment: Any = None) -> dict[str, Any]:
    config = execution.api_config_snapshot if isinstance(execution.api_config_snapshot, dict) else {}
    result = execution.api_resultado if isinstance(execution.api_resultado, dict) else {}
    public_evidence = public_api_evidence_enabled(environment=environment, config=config, result=result)
    redact_evidence = not public_evidence
    steps = [_normalize_step(item, index, redact=redact_evidence) for index, item in enumerate(result.get("steps") or [])]
    failed_steps = [item for item in steps if str(item.get("status") or "").upper() in {"FAILED", "BLOCKED"}]
    execution_snapshot = _safe_json({
        "run_id": str(run.id),
        "execution_id": str(execution.id),
        "run_name": run.nombre,
        "project_id": str(run.proyecto_id),
        "build_id": str(run.build_id) if run.build_id else None,
        "environment_id": str(run.entorno_id) if run.entorno_id else None,
        "dataset_id": str(run.dataset_id) if run.dataset_id else None,
        "environment_name": getattr(environment, "nombre", None) or run.entorno,
        "environment_url": getattr(environment, "url", None),
        "mode": getattr(execution.execution_mode, "value", execution.execution_mode),
        "status": getattr(execution.estado_resultado, "value", execution.estado_resultado),
        "duration_seconds": execution.duracion_segundos,
        "executed_at": isoformat_utc(execution.fecha_ejecucion),
        "observations": execution.observaciones,
        "resolved_variables": run.variables_resueltas or {},
        "resolved_dataset": (run.datasets_resueltos or {}).get(str(case.id), []),
        "variables_used": result.get("variables_used") or _used_variables(config, run.variables_resueltas or {}, redact=redact_evidence),
        # Keep the generated Postman-style values with the frozen execution
        # context. The runner applies the same explicit evidence policy before
        # persisting the result, so public synthetic fixtures retain the exact
        # seed/value pair while ordinary environments remain redacted.
        "dynamic_variables": result.get("dynamic_variables") or {},
    }, redact=redact_evidence)
    case_snapshot = _safe_json({
        "id": str(case.id),
        "code": case.codigo,
        "title": case.titulo,
        "version": execution.version_ejecutada,
        "suite_id": str(case.suite_id) if case.suite_id else None,
        "component_id": str(case.componente_id) if case.componente_id else None,
        "description": case.descripcion,
        "objective": case.descripcion,
        "preconditions": case.precondiciones,
        "postconditions": case.postcondiciones,
    }, redact=redact_evidence)
    technical = _safe_json({
        "schema_version": result.get("schema_version"),
        "duration_ms": result.get("duration_ms"),
        "variables_extracted": result.get("variables_extracted") or {},
        "cleanup": result.get("cleanup") or {},
        "errors": result.get("errors") or [],
        "failed_step_indexes": [item.get("visible_index") for item in failed_steps],
    }, redact=redact_evidence)
    payload = {
        "bug_id": bug_id,
        "schema_version": 1,
        "format": "API",
        "case_snapshot": case_snapshot,
        "execution_snapshot": execution_snapshot,
        "api_config_snapshot": sanitize_api_config(config, redact=redact_evidence),
        "api_resultado": _safe_json(result, redact=redact_evidence),
        "steps": steps,
        "technical_evidence": technical,
        "evidence_refs": [
            {"type": "execution", "id": str(execution.id)},
            {"type": "run", "id": str(run.id)},
        ],
        **evidence_policy_marker(public_evidence),
    }
    digest_payload = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    payload["evidence_sha256"] = sha256(digest_payload.encode("utf-8")).hexdigest()
    return payload


async def resolve_bug_api_context(db: Any, bug: Any) -> dict[str, Any] | None:
    from sqlalchemy import select
    from .. import models

    query = (
        select(models.EjecucionCaso, models.TestRun, models.CasoPrueba)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
    )
    if getattr(bug, "ejecucion_id", None):
        query = query.where(models.EjecucionCaso.id == bug.ejecucion_id)
    elif getattr(bug, "caso_id", None):
        query = query.where(models.EjecucionCaso.caso_id == bug.caso_id)
        if getattr(bug, "test_run_id", None):
            query = query.where(models.EjecucionCaso.test_run_id == bug.test_run_id)
        query = query.order_by(models.EjecucionCaso.fecha_ejecucion.desc())
    else:
        return None
    row = (await db.execute(query.limit(1))).first()
    if not row:
        return None
    execution, run, case = row
    if not is_api_case(case) or not isinstance(execution.api_resultado, dict):
        return None
    environment = await db.get(models.Entorno, run.entorno_id) if run.entorno_id else None
    build = await db.get(models.Build, run.build_id) if run.build_id else None
    dataset = await db.get(models.EntornoDataset, run.dataset_id) if run.dataset_id else None
    context = build_api_context(bug_id=bug.id, execution=execution, run=run, case=case, environment=environment)
    snapshot = context.get("execution_snapshot") or {}
    snapshot["build_name"] = build.nombre if build else None
    snapshot["build_code"] = build.codigo if build else None
    snapshot["dataset_name"] = dataset.nombre if dataset else None
    return context

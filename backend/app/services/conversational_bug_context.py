from hashlib import sha256
import json
from typing import Any

from ..services.ai_report_sanitizer import sanitize_ai_report_payload
from ..services.api_evidence_policy import evidence_policy_marker, public_test_data_evidence_enabled
from .chatbot_turns import configured_turn_index, executed_turn_index
from ..time_utils import isoformat_utc


def conversational_context_row_values(context: dict[str, Any]) -> dict[str, Any]:
    """Map the context envelope to the persisted context model explicitly."""
    technical_evidence = dict(context.get("technical_evidence") or {})
    evidence_policy = context.get("evidence_policy")
    if evidence_policy:
        technical_evidence.setdefault("evidence_policy", evidence_policy)
    return {
        "schema_version": context.get("schema_version", 1),
        "case_snapshot": context.get("case_snapshot") or {},
        "execution_snapshot": context.get("execution_snapshot") or {},
        "conversation_turns": context.get("conversation_turns") or [],
        "evaluation": context.get("evaluation") or {},
        "technical_evidence": technical_evidence,
        "evidence_refs": context.get("evidence_refs") or [],
        "evidence_sha256": context.get("evidence_sha256"),
    }


def _configured_turns(config: dict[str, Any]) -> list[dict[str, Any]]:
    conversation = config.get("conversation") if isinstance(config, dict) else {}
    configured = conversation.get("turns") if isinstance(conversation, dict) else []
    configured = configured if isinstance(configured, list) else []
    result: list[dict[str, Any]] = []
    opening = conversation.get("opening_message") if isinstance(conversation, dict) else None
    if isinstance(opening, dict) and opening.get("text") and not configured:
        result.append({"input": opening, "legacy_opening": True})
    result.extend(item if isinstance(item, dict) else {} for item in configured)
    return result


def _turn_message(item: dict[str, Any]) -> str | None:
    input_data = item.get("input") if isinstance(item.get("input"), dict) else {}
    return input_data.get("text") or item.get("message") or item.get("user_message")


def _turn_expected(item: dict[str, Any]) -> Any:
    return item.get("expected") or item.get("expected_response") or item.get("response_expected") or item.get("assertions") or None


def is_conversational_case(case: Any) -> bool:
    return str(getattr(getattr(case, "formato_prueba", None), "value", getattr(case, "formato_prueba", "")) or "").upper() == "CONVERSACIONAL"


def infer_chatbot_finding_type(chatbot_result: dict[str, Any], requested_turn: int | None = None, fallback: str | None = None) -> str:
    """Infer the most useful category for legacy executions without mutating them."""
    if fallback:
        return str(fallback).strip().upper()
    turns = chatbot_result.get("turns") if isinstance(chatbot_result.get("turns"), list) else []
    candidates = turns if requested_turn is None else [item for index, item in enumerate(turns) if isinstance(item, dict) and index == requested_turn]
    for turn in candidates:
        if not isinstance(turn, dict):
            continue
        status_code = int(turn.get("status_code") or turn.get("statusCode") or 0)
        if status_code >= 400:
            return "HTTP_FAILURE"
        if turn.get("error") or turn.get("timeout"):
            return "NO_RESPONSE"
        assertions = turn.get("assertions") if isinstance(turn.get("assertions"), list) else []
        if any(isinstance(item, dict) and item.get("passed") is False for item in assertions):
            return "TURN_EXPECTATION_MISMATCH"
        if turn.get("status") in {"FAILED", "BLOCKED"}:
            return "INVALID_RESPONSE"
    if any(isinstance(item, dict) and item.get("status") in {"FAILED", "BLOCKED"} for item in (chatbot_result.get("tools") or [])):
        return "TOOL_FAILURE"
    return "OTHER"


def build_conversational_context(*, execution, run, case, chatbot_config: dict[str, Any], chatbot_result: dict[str, Any], requested_turn: int | None, finding_type: str, environment: Any = None, public_evidence: bool | None = None) -> dict[str, Any]:
    if public_evidence is None:
        public_evidence = public_test_data_evidence_enabled(
            environment=environment,
            case=case,
            execution=execution,
            config=chatbot_config,
            result=chatbot_result,
        )
    safe = lambda payload: payload if public_evidence else sanitize_ai_report_payload(payload)
    safe_config = safe(chatbot_config)
    configured_turns = _configured_turns(chatbot_config)
    executed_turns = chatbot_result.get("turns") if isinstance(chatbot_result.get("turns"), list) else []
    executed_by_index = {
        executed_turn_index(item, index): item
        for index, item in enumerate(executed_turns)
        if isinstance(item, dict)
    }
    conversation_turns: list[dict[str, Any]] = []
    for position, configured in enumerate(configured_turns):
        index = configured_turn_index(configured, position)
        observed = executed_by_index.get(index)
        conversation_turns.append(safe({
            "index": index,
            "technical_index": index,
            "turn_number": index + 1,
            "message": _turn_message(configured) or (observed or {}).get("message"),
            "expected": _turn_expected(configured) or (observed or {}).get("expected"),
            "observed": observed,
            "status": (observed or {}).get("status") or ("EXECUTED" if observed is not None else "NOT_EXECUTED"),
            "failure_type": (observed or {}).get("failure_type"),
            "assertions": (observed or {}).get("assertions") or [],
            "request": (observed or {}).get("request"),
            "response": (observed or {}).get("response"),
            "response_text": (observed or {}).get("responseText") or (observed or {}).get("response_text"),
            "response_json_valid": (observed or {}).get("response_json_valid"),
            "latency_ms": (observed or {}).get("latencyMs") or (observed or {}).get("latency_ms"),
            "status_code": (observed or {}).get("statusCode") or (observed or {}).get("status_code"),
            "tools": (observed or {}).get("tools") or [],
            "memory_checks": (observed or {}).get("memory_checks") or [],
            "observation": (observed or {}).get("failure_reason") or (observed or {}).get("error"),
        }))
    if not conversation_turns:
        for position, observed in enumerate(executed_turns):
            if not isinstance(observed, dict):
                continue
            index = executed_turn_index(observed, position)
            conversation_turns.append(safe({
                "index": index, "technical_index": index, "turn_number": index + 1,
                "message": observed.get("message") or observed.get("user_message"),
                "expected": observed.get("expected") or observed.get("expected_response"),
                "observed": observed, "status": observed.get("status") or "EXECUTED",
                "failure_type": observed.get("failure_type"), "assertions": observed.get("assertions") or [],
                "request": observed.get("request"), "response": observed.get("response"),
                "response_text": observed.get("responseText") or observed.get("response_text"),
                "latency_ms": observed.get("latencyMs") or observed.get("latency_ms"),
                "status_code": observed.get("statusCode") or observed.get("status_code"),
                "tools": observed.get("tools") or [], "memory_checks": observed.get("memory_checks") or [],
                "observation": observed.get("failure_reason") or observed.get("error"),
            }))
    case_snapshot = safe({
        "id": str(case.id), "code": case.codigo, "title": case.titulo,
        "version": execution.version_ejecutada, "suite_id": str(case.suite_id) if case.suite_id else None,
        "component_id": str(case.componente_id) if case.componente_id else None,
        "description": case.descripcion, "objective": case.descripcion,
        "preconditions": case.precondiciones, "postconditions": case.postcondiciones,
        "chatbot_config": safe_config,
    })
    execution_snapshot = safe({
        "run_id": str(run.id), "execution_id": str(execution.id), "project_id": str(run.proyecto_id),
        "build_id": str(run.build_id) if run.build_id else None, "environment_id": str(run.entorno_id) if run.entorno_id else None,
        "dataset_id": str(run.dataset_id) if run.dataset_id else None, "run_name": run.nombre,
        "environment_name": run.entorno, "mode": getattr(execution.execution_mode, "value", execution.execution_mode),
        "status": getattr(execution.estado_resultado, "value", execution.estado_resultado),
        "duration_seconds": execution.duracion_segundos, "executed_at": isoformat_utc(execution.fecha_ejecucion),
        "resolved_variables": run.variables_resueltas or {},
        "resolved_dataset": (run.datasets_resueltos or {}).get(str(case.id), []),
        "session_id": chatbot_result.get("session_id"),
        "protocol": chatbot_result.get("protocol"),
        "conversation_strategy": chatbot_result.get("conversation_strategy"),
    })
    evaluation = safe({
        "status": chatbot_result.get("status") or getattr(execution.estado_resultado, "value", execution.estado_resultado),
        "failure_category": chatbot_result.get("failure_category") or execution.ai_failure_category,
        "confidence": chatbot_result.get("confidence") or execution.ai_confidence,
        "consensus": chatbot_result.get("consensus") or execution.ai_consensus,
        "human_review_required": bool(chatbot_result.get("human_review_required") or execution.ai_human_review_required),
        "review_status": getattr(execution.ai_review_status, "value", execution.ai_review_status),
        "review_note": execution.ai_review_note, "human_evaluation": chatbot_result.get("human_evaluation") or {},
        "model": chatbot_result.get("model") or chatbot_result.get("model_name"), "provider": chatbot_result.get("provider"),
        "workflow_version": chatbot_result.get("workflow_version") or chatbot_config.get("workflow_version"),
        "finding_type": finding_type, "turn_index": requested_turn,
    })
    technical = safe({
        "protocol": chatbot_result.get("protocol"), "session_id": chatbot_result.get("session_id"),
        "performance": chatbot_result.get("performance") or {}, "assertions": chatbot_result.get("assertions") or [],
        "tools": chatbot_result.get("tools") or [], "memory_checks": chatbot_result.get("memory_checks") or [],
        "security_findings": chatbot_result.get("security_findings") or [], "error_code": chatbot_result.get("error_code"),
        "request_response": chatbot_result.get("request_response") or chatbot_result.get("traces") or {},
        "session_id": chatbot_result.get("session_id"),
        "conversation": chatbot_result.get("conversation") or [],
    })
    evidence_refs = [{"type": "execution", "id": str(execution.id)}, {"type": "run", "id": str(run.id)}]
    serialized = json.dumps({"case": case_snapshot, "execution": execution_snapshot, "turns": conversation_turns, "evaluation": evaluation, "technical": technical}, ensure_ascii=False, sort_keys=True, default=str)
    return {
        "schema_version": 1, "case_snapshot": case_snapshot, "execution_snapshot": execution_snapshot,
        "conversation_turns": conversation_turns, "evaluation": evaluation, "technical_evidence": technical,
        "evidence_refs": evidence_refs, "evidence_sha256": sha256(serialized.encode("utf-8")).hexdigest(),
        **evidence_policy_marker(public_evidence),
    }


async def infer_bug_is_conversational(db, bug) -> bool:
    """Classify a bug without persisting a migration/backfill."""
    if str(getattr(bug, "tipo_contexto", "CLASICO") or "CLASICO").upper() == "CONVERSACIONAL":
        return True
    if not getattr(bug, "caso_id", None):
        return False
    from sqlalchemy import select
    from .. import models
    case = (await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == bug.caso_id))).scalar_one_or_none()
    return bool(case and is_conversational_case(case))


async def resolve_bug_conversational_context(db, bug) -> dict[str, Any] | Any | None:
    """Return persisted context or reconstruct legacy context from execution evidence."""
    existing = getattr(bug, "conversational_context", None)
    if existing is not None:
        return existing

    from sqlalchemy import select
    from .. import models

    query = (
        select(models.EjecucionCaso, models.TestRun, models.CasoPrueba)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
    )
    if getattr(bug, "ejecucion_id", None):
        query = query.filter(models.EjecucionCaso.id == bug.ejecucion_id)
    elif getattr(bug, "caso_id", None):
        query = query.filter(models.EjecucionCaso.caso_id == bug.caso_id)
        if getattr(bug, "test_run_id", None):
            query = query.filter(models.EjecucionCaso.test_run_id == bug.test_run_id)
        query = query.order_by(models.EjecucionCaso.fecha_ejecucion.desc())
    else:
        return None
    row = (await db.execute(query.limit(1))).first()
    if not row:
        return None
    execution, run, case = row
    if not is_conversational_case(case):
        return None
    chatbot_result = execution.chatbot_resultado if isinstance(execution.chatbot_resultado, dict) else {}
    turns = chatbot_result.get("turns") if isinstance(chatbot_result.get("turns"), list) else []
    if not turns:
        return None
    chatbot_config = execution.chatbot_config_snapshot if isinstance(execution.chatbot_config_snapshot, dict) else {}
    environment = await db.get(models.Entorno, run.entorno_id) if run.entorno_id else None
    requested_turn = getattr(bug, "chatbot_turn_index", None)
    finding_type = infer_chatbot_finding_type(
        chatbot_result,
        requested_turn=requested_turn,
        fallback=getattr(bug, "chatbot_finding_type", None),
    )
    context = build_conversational_context(
        execution=execution,
        run=run,
        case=case,
        chatbot_config=chatbot_config,
        chatbot_result=chatbot_result,
        requested_turn=requested_turn,
        finding_type=finding_type,
        environment=environment,
    )
    context["bug_id"] = bug.id
    context["created_at"] = getattr(bug, "created_at", None)
    context["updated_at"] = getattr(bug, "updated_at", None)
    context["execution_snapshot"]["reconstructed"] = True
    context["execution_snapshot"]["source_bug_id"] = str(bug.id)
    return context

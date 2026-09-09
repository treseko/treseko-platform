from copy import deepcopy

from fastapi import APIRouter

from ...main_context import *
from ...services.chatbot_http import response_path, send_chatbot_turn
from ...services.api_dynamic_variables import (
    DynamicVariableContext,
    derive_case_dynamic_seed,
    safe_dynamic_values,
)
from ...services.chatbot_manual_evaluation import evaluate_manual_chatbot_turn, manual_result_suggestion
from ...services.ai_report_sanitizer import sanitize_ai_report_payload
from ...services.api_evidence_policy import evidence_policy_marker, public_test_data_evidence_enabled
from ...repositories.chatbot_execution import merge_chatbot_config
from .test_runs import _require_execution_access


router = APIRouter(tags=["Test Runs"])


async def _load_context(db: AsyncSession, execution: models.EjecucionCaso, run: models.TestRun):
    case = await db.get(models.CasoPrueba, execution.caso_id)
    if not case or case.formato_prueba != models.FormatoPrueba.CONVERSACIONAL:
        raise HTTPException(status_code=400, detail="La ejecución no corresponde a un caso Chatbot")
    if run.build_id:
        build = await db.get(models.Build, run.build_id)
        if build and not access_control.is_build_active(build):
            raise HTTPException(status_code=409, detail="La build está inactiva. No se puede modificar la ejecución.")
    resolved = await crud.resolve_case_dataset(db, case.id, run.build_id, run.entorno_id, run.dataset_id)
    variables = resolved.get("variables_resueltas", {}) if resolved else (run.variables_resueltas or {})
    dataset = resolved.get("dataset_resuelto", []) if resolved else (run.datasets_resueltos or {}).get(str(case.id), [])
    environment_config = (resolved or {}).get("configuracion_chatbot_ambiente") or {}
    base_url = crud.get_ai_base_url_from_context(variables, []) or ""
    dynamic_context = DynamicVariableContext(
        execution.dynamic_seed or derive_case_dynamic_seed(getattr(run, "dynamic_seed", None), str(case.id))
    )
    if isinstance(execution.dynamic_variables, dict):
        dynamic_context.values.update(
            value for value in execution.dynamic_variables.items()
            if value[1] != "[REDACTED]"
        )
    execution.dynamic_seed = dynamic_context.seed
    context = crud.build_chatbot_context(
        case, run, variables, dataset, base_url, environment_config, dynamic_variables=dynamic_context
    )
    errors = crud.validate_chatbot_execution_config(case, environment_config=environment_config, variables=variables)
    if errors:
        raise HTTPException(status_code=400, detail="No se puede ejecutar el Chatbot: " + " ".join(errors))
    frozen_config = merge_chatbot_config(environment_config or {}, case.configuracion_chatbot or {})
    environment = await db.get(models.Entorno, run.entorno_id) if run.entorno_id else None
    public_evidence = public_test_data_evidence_enabled(
        environment=environment,
        case=case,
        execution=execution,
        config=context.get("config"),
        result=execution.chatbot_resultado if isinstance(execution.chatbot_resultado, dict) else None,
    )
    execution.evidence_policy = evidence_policy_marker(public_evidence)["evidence_policy"]
    return case, context, dynamic_context, frozen_config, environment, public_evidence


def _manual_evidence_payload(payload: dict, *, public_evidence: bool) -> dict:
    """Return the exact persisted manual evidence allowed by the frozen policy."""
    if public_evidence:
        return deepcopy(payload)
    return sanitize_ai_report_payload(payload)


def _manual_dynamic_values(dynamic_context: DynamicVariableContext, *, public_evidence: bool) -> dict:
    return deepcopy(dynamic_context.values) if public_evidence else safe_dynamic_values(dynamic_context)


def _history(result: dict) -> list[dict]:
    history = result.get("conversation") if isinstance(result, dict) else None
    if isinstance(history, list):
        return history
    history = []
    for turn in (result.get("turns", []) if isinstance(result, dict) else []):
        if not isinstance(turn, dict):
            continue
        if turn.get("message") is not None:
            history.append({"role": "user", "content": turn["message"]})
        reply = turn.get("responseText") or turn.get("response_text")
        if reply is not None:
            history.append({"role": "assistant", "content": reply})
    return history


def _configured_manual_message(
    config: dict,
    turn_index: int,
    dynamic_variables: DynamicVariableContext | None = None,
) -> str:
    """Return the only message accepted for the next manual turn.

    Manual execution is an evaluation of the saved case definition. The
    server therefore derives the expected turn from the frozen configuration
    instead of trusting a client-provided turn number or message.
    """
    conversation = config.get("conversation") if isinstance(config, dict) else {}
    turns = conversation.get("turns") if isinstance(conversation, dict) else []
    turns = turns if isinstance(turns, list) else []
    if turn_index >= len(turns):
        raise HTTPException(status_code=409, detail="La conversación ya envió todos los turnos configurados.")
    configured_turn = turns[turn_index] if isinstance(turns[turn_index], dict) else {}
    input_payload = configured_turn.get("input") if isinstance(configured_turn.get("input"), dict) else {}
    mode = str(input_payload.get("mode") or "fixed")
    if mode != "fixed":
        raise HTTPException(
            status_code=409,
            detail="Este turno se genera con IA y no puede enviarse desde la consola manual. Ejecutá con IA o configurá un mensaje fijo.",
        )
    expected = str(input_payload.get("text") or "").strip()
    if dynamic_variables is not None:
        expected = dynamic_variables.resolve_string(expected, source=f"chatbot.turn.{turn_index + 1}")
    if not expected:
        raise HTTPException(status_code=409, detail=f"El turno {turn_index + 1} no tiene un mensaje fijo configurado.")
    return expected


def _result_base(execution: models.EjecucionCaso, context: dict, existing: dict | None = None) -> dict:
    current = existing if isinstance(existing, dict) else {}
    return {
        "schema_version": 1,
        "protocol": "treseko.chatbot/v1",
        "execution_id": str(execution.id),
        "case_id": str(execution.caso_id),
        "execution_mode": "MANUAL",
        "conversation_strategy": "manual",
        "session_id": current.get("session_id"),
        "status": current.get("status") or "IN_PROGRESS",
        "turns": current.get("turns") if isinstance(current.get("turns"), list) else [],
        "conversation": _history(current),
        "assertions": current.get("assertions") if isinstance(current.get("assertions"), list) else [],
        "security_findings": current.get("security_findings") if isinstance(current.get("security_findings"), list) else [],
        "tools": current.get("tools") if isinstance(current.get("tools"), list) else [],
        "performance": current.get("performance") if isinstance(current.get("performance"), dict) else {},
        "human_evaluation": current.get("human_evaluation") or {},
        "profile": context.get("config", {}).get("profile") or {},
        "variables": context.get("variables") or {},
        "dynamic_seed": execution.dynamic_seed,
        "dynamic_variables": execution.dynamic_variables or {},
    }


def _require_manual_turn(result: dict) -> None:
    turns = result.get("turns") if isinstance(result, dict) else None
    if not isinstance(turns, list) or not turns:
        raise HTTPException(status_code=409, detail="Debés enviar al menos un turno antes de finalizar la evaluación Chatbot.")


@router.post("/ejecuciones/{ejecucion_id}/chatbot/manual/turn")
async def send_chatbot_manual_turn(
    ejecucion_id: UUID,
    payload: schemas.ChatbotManualTurnRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.manual", "edit")),
):
    execution, run = await _require_execution_access(db, current_user, ejecucion_id, "edit")
    if execution.estado_resultado in {models.EstadoResultado.PASO, models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}:
        raise HTTPException(status_code=409, detail="La ejecución Chatbot ya fue finalizada")
    case, context, dynamic_context, frozen_config, environment, public_evidence = await _load_context(db, execution, run)
    result = _result_base(execution, context, execution.chatbot_resultado if isinstance(execution.chatbot_resultado, dict) else {})
    history = _history(result)
    expected_message = _configured_manual_message(context["config"], len(result["turns"]), dynamic_context)
    # The UI shows the frozen template (for example ``{{$randomUUID}}``),
    # while ``context["config"]`` already contains its resolved execution
    # value. Validate against both representations, but always send the
    # resolved value below.
    configured_message = _configured_manual_message(frozen_config, len(result["turns"]))
    if payload.message.strip() not in {expected_message, configured_message}:
        raise HTTPException(
            status_code=409,
            detail=f"El mensaje no coincide con el turno {len(result['turns']) + 1} configurado. Editá y guardá el caso antes de iniciar la ejecución.",
        )
    turn = await send_chatbot_turn(
        config=context["config"], variables=context.get("variables") or {}, message=expected_message,
        session_id=result.get("session_id"), history=history, turn_index=len(result["turns"]) + 1,
        base_url=context.get("baseUrl") or "",
        dynamic_variables=dynamic_context,
        environment=environment,
    )
    mapping = (context.get("config", {}).get("connection") or {}).get("response_mapping") or {}
    session_id = str(response_path(turn.get("response"), mapping.get("session_id_path") or "") or result.get("session_id") or "")
    turn["session_id"] = session_id
    # ``index`` is kept one-based for transport compatibility; the API and
    # bug workflow use the explicit zero-based technical index.
    technical_index = len(result["turns"])
    turn = evaluate_manual_chatbot_turn(turn, context["config"], technical_index, result["turns"])
    result["session_id"] = session_id
    result["turns"].append(turn)
    result["conversation"] = history + [{"role": "user", "content": expected_message}, {"role": "assistant", "content": turn.get("responseText") or ""}]
    latencies = [int(item.get("latencyMs") or 0) for item in result["turns"]]
    result["performance"] = {
        "turn_count": len(result["turns"]), "total_latency_ms": sum(latencies),
        "p95_latency_ms": sorted(latencies)[max(0, min(len(latencies) - 1, int(len(latencies) * 0.95) - 1))] if latencies else 0,
        "http_error_count": sum(1 for item in result["turns"] if item.get("status") != "PASSED"),
    }
    suggested_status, suggested_finding = manual_result_suggestion(result)
    result["suggested_status"] = suggested_status
    result["suggested_failure_type"] = suggested_finding
    result["dynamic_seed"] = dynamic_context.seed
    result["dynamic_variables"] = _manual_dynamic_values(dynamic_context, public_evidence=public_evidence)
    result["requires_human_review"] = any(
        bool(item.get("automatic_evaluation", {}).get("requires_human_review"))
        for item in result["turns"]
    )
    policy = evidence_policy_marker(public_evidence)["evidence_policy"]
    context["evidence_policy"] = policy
    result["evidence_policy"] = policy
    execution.evidence_policy = policy
    execution.execution_mode = models.ExecutionMode.MANUAL
    execution.chatbot_config_snapshot = _manual_evidence_payload(context, public_evidence=public_evidence)
    execution.chatbot_resultado = _manual_evidence_payload(result, public_evidence=public_evidence)
    execution.dynamic_variables = _manual_dynamic_values(dynamic_context, public_evidence=public_evidence)
    execution.observaciones = f"Conversación manual: {len(result['turns'])} turno(s)."
    await db.commit()
    if len(result["turns"]) == 1:
        await notification_event_service.emit_event(
            db=db, event_type="chatbot.evaluation.started", actor_user_id=current_user.id,
            proyecto_id=run.proyecto_id, entity_type="execution", entity_id=execution.id, severity="info",
            payload={"execution": {"id": str(execution.id), "mode": "MANUAL"}, "caso": {"id": str(case.id), "codigo": case.codigo, "formato_prueba": "CONVERSACIONAL"}},
            dedupe_key=f"chatbot.evaluation.started:{execution.id}",
        )
    persisted_result = execution.chatbot_resultado
    return {"execution_id": str(execution.id), "turn": persisted_result.get("turns", [])[-1], "chatbot_resultado": persisted_result}


@router.post("/ejecuciones/{ejecucion_id}/chatbot/manual/complete")
async def complete_chatbot_manual_execution(
    ejecucion_id: UUID,
    payload: schemas.ChatbotManualCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.manual", "edit")),
):
    execution, run = await _require_execution_access(db, current_user, ejecucion_id, "edit")
    case, context, dynamic_context, _frozen_config, _environment, public_evidence = await _load_context(db, execution, run)
    result = _result_base(execution, context, execution.chatbot_resultado if isinstance(execution.chatbot_resultado, dict) else {})
    _require_manual_turn(result)
    result["status"] = payload.status
    result["completed_at"] = utc_now().isoformat()
    result["human_evaluation"] = {"status": payload.status, "notes": payload.notes or "", "evaluator_id": str(current_user.id)}
    policy = evidence_policy_marker(public_evidence)["evidence_policy"]
    context["evidence_policy"] = policy
    result["evidence_policy"] = policy
    execution.evidence_policy = policy
    execution.execution_mode = models.ExecutionMode.MANUAL
    execution.estado_resultado = models.EstadoResultado(payload.status)
    snapshot = execution.chatbot_config_snapshot if isinstance(execution.chatbot_config_snapshot, dict) else context
    execution.chatbot_config_snapshot = _manual_evidence_payload(snapshot, public_evidence=public_evidence)
    execution.chatbot_resultado = _manual_evidence_payload(result, public_evidence=public_evidence)
    execution.dynamic_seed = dynamic_context.seed
    execution.dynamic_variables = _manual_dynamic_values(dynamic_context, public_evidence=public_evidence)
    execution.observaciones = payload.notes or f"Evaluación manual Chatbot finalizada: {payload.status}."
    execution.fecha_ejecucion = utc_now()
    case.ultimo_resultado = payload.status
    case.ultima_ejecucion_por = current_user.id
    case.ultima_ejecucion_fecha = execution.fecha_ejecucion
    pending = await db.execute(select(models.EjecucionCaso.id).filter(
        models.EjecucionCaso.test_run_id == run.id,
        models.EjecucionCaso.estado_resultado.in_([models.EstadoResultado.SIN_CORRER, models.EstadoResultado.EJECUTANDO_AI]),
        models.EjecucionCaso.id != execution.id,
    ).limit(1))
    if pending.scalar_one_or_none() is None:
        run.estado_run = models.EstadoRun.CERRADO
        run.fecha_cierre = execution.fecha_ejecucion
    await db.commit()
    event_type = "chatbot.evaluation.completed" if payload.status == "PASO" else "chatbot.evaluation.failed"
    await notification_event_service.emit_event(
        db=db, event_type=event_type, actor_user_id=current_user.id, proyecto_id=run.proyecto_id,
        entity_type="execution", entity_id=execution.id, severity="info" if payload.status == "PASO" else "warning",
        payload={"execution": {"id": str(execution.id), "mode": "MANUAL", "estado": payload.status}, "caso": {"id": str(case.id), "codigo": case.codigo, "formato_prueba": "CONVERSACIONAL"}},
        dedupe_key=f"{event_type}:{execution.id}",
    )
    return {"execution_id": str(execution.id), "status": payload.status, "chatbot_resultado": execution.chatbot_resultado}

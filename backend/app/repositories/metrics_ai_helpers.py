from .legacy_common import *


async def _emit_ai_engine_unavailable_event(
    db: AsyncSession,
    ejec: Optional[models.EjecucionCaso],
    case: Optional[models.CasoPrueba],
    detail: str,
) -> None:
    from ..services.notifications import event_service

    run = None
    if ejec and ejec.test_run_id:
        run = (await db.execute(select(models.TestRun).filter(models.TestRun.id == ejec.test_run_id))).scalar_one_or_none()
    await event_service.emit_event(
        db=db,
        event_type="ai.engine.unavailable",
        proyecto_id=run.proyecto_id if run else None,
        entity_type="ai_engine",
        entity_id=ejec.id if ejec else None,
        severity="warning",
        payload={
            "ai_engine": {"status": "unavailable", "detail": detail},
            "execution": {"id": str(ejec.id), "estado": ejec.estado_resultado.value if ejec.estado_resultado else None} if ejec else {},
            "caso": {"id": str(case.id), "codigo": case.codigo, "titulo": case.titulo} if case else {},
            "message": f"Motor IA no disponible: {detail}",
        },
        dedupe_key=f"ai.engine.unavailable:{str(ejec.id) if ejec else 'unknown'}:{utc_now().strftime('%Y%m%d%H%M')}",
    )

AI_PROVIDER_PRESET_MODELS = {
    "openai": [
        {"id": "gpt-4.1", "name": "gpt-4.1", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1047576, "notes": "Preset OpenAI general."}},
        {"id": "gpt-4.1-mini", "name": "gpt-4.1-mini", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1047576, "notes": "Preset OpenAI rapido."}},
    ],
    "gemini": [
        {"id": "gemini-2.5-pro", "name": "gemini-2.5-pro", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1000000, "notes": "Preset Google Gemini Pro."}},
        {"id": "gemini-2.5-flash", "name": "gemini-2.5-flash", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": True, "context_window": 1000000, "notes": "Preset Google Gemini Flash."}},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4", "name": "claude-sonnet-4", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": False, "context_window": 200000, "notes": "Preset Anthropic Sonnet."}},
        {"id": "claude-opus-4", "name": "claude-opus-4", "capabilities": {"vision": True, "reasoning": True, "tools": True, "json_mode": False, "context_window": 200000, "notes": "Preset Anthropic Opus."}},
    ],
}

AI_WORKFLOW_NAMESPACE = uuid.UUID("0c4d4546-4c4f-4f57-8f00-000000000001")

DEFAULT_AI_WORKFLOW_NODES = [
    {"key": "ContextResolver", "type": "ContextResolver", "name": "Context Resolver", "agent_key": "CONTEXT_RESOLVER", "position_x": 80, "position_y": 120, "prompt_template": "Resuelve contexto, URL base, datos y variables disponibles para la prueba."},
    {"key": "Observer", "type": "Observer", "name": "Observer", "agent_key": "OBSERVER", "position_x": 300, "position_y": 120, "prompt_template": "Observa el navegador, resume DOM visible, errores, URL actual y estado de carga."},
    {"key": "Planner", "type": "Planner", "name": "Planner", "agent_key": "AI_AGENT", "position_x": 520, "position_y": 120, "prompt_template": DEFAULT_AI_AGENT_WORKFLOW[0]["prompt"]},
    {"key": "SecurityGuard", "type": "SecurityGuard", "name": "Security Guard", "agent_key": "QA_GUARD", "position_x": 740, "position_y": 120, "prompt_template": DEFAULT_AI_AGENT_WORKFLOW[1]["prompt"]},
    {"key": "Executor", "type": "Executor", "name": "Executor", "agent_key": "SENTINEL", "position_x": 960, "position_y": 40, "prompt_template": DEFAULT_AI_AGENT_WORKFLOW[2]["prompt"], "retry_policy": {"max_retries": 2}, "timeout_sec": 900},
    {"key": "Validator", "type": "Validator", "name": "Validator", "agent_key": "VALIDATOR", "position_x": 1180, "position_y": 40, "prompt_template": "Valida si la accion ejecutada produjo el resultado esperado del paso actual."},
    {"key": "Recovery", "type": "Recovery", "name": "Recovery", "agent_key": "RECOVERY", "position_x": 960, "position_y": 220, "prompt_template": "Determina si se puede reintentar, ajustar la estrategia o bloquear la prueba."},
    {"key": "Auditor", "type": "Auditor", "name": "Auditor", "agent_key": "AUDITOR", "position_x": 1400, "position_y": 120, "prompt_template": DEFAULT_AI_AGENT_WORKFLOW[3]["prompt"]},
    {"key": "Reporter", "type": "Reporter", "name": "Reporter", "agent_key": "REPORTER", "position_x": 1620, "position_y": 120, "prompt_template": "Construye el reporte final, resumen, metricas y trazabilidad para la ejecucion."},
]

DEFAULT_AI_WORKFLOW_EDGES = [
    ("ContextResolver", "Observer", "always", {}, 10, 1),
    ("Observer", "Auditor", "on_blocked", {"reason": "no_more_steps"}, 5, 1),
    ("Observer", "Planner", "always", {}, 20, 100),
    ("Planner", "SecurityGuard", "always", {}, 10, 100),
    ("SecurityGuard", "Executor", "on_success", {}, 10, 100),
    ("SecurityGuard", "Recovery", "on_rejected", {}, 20, 100),
    ("Executor", "Validator", "on_success", {}, 10, 100),
    ("Executor", "Recovery", "on_failed", {}, 20, 100),
    ("Validator", "Observer", "on_success", {}, 10, 100),
    ("Validator", "Recovery", "on_failed", {}, 20, 100),
    ("Recovery", "Observer", "retry_count_lt", {"max": 3}, 10, 100),
    ("Recovery", "Auditor", "on_blocked", {}, 20, 1),
    ("Auditor", "Reporter", "always", {}, 10, 1),
]

BASE_AI_WORKFLOW_NODE_TYPES = {
    "ContextResolver",
    "Observer",
    "Planner",
    "SecurityGuard",
    "Executor",
    "Validator",
    "Recovery",
    "Auditor",
    "Reporter",
}

def _metric_number(payload: Dict[str, Any], *keys: str) -> float:
    for key in keys:
        value = payload.get(key)
        if value is not None:
            try:
                return float(value or 0)
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def _metric_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return ensure_utc(value)
    if isinstance(value, str):
        try:
            normalized = value.replace("Z", "+00:00")
            return ensure_utc(datetime.fromisoformat(normalized))
        except ValueError:
            return None
    return None


def _trace_duration_ms(trace: Dict[str, Any]) -> int:
    started = _metric_datetime(trace.get("started_at"))
    ended = _metric_datetime(trace.get("ended_at"))
    if started and ended:
        return max(0, int((ended - started).total_seconds() * 1000))
    return 0


def _empty_ai_metrics() -> Dict[str, Any]:
    return {
        "executions": 0,
        "passed": 0,
        "failed": 0,
        "blocked": 0,
        "human_review_required": 0,
        "human_review_reviewed": 0,
        "human_review_pending": 0,
        "avg_confidence": 0,
        "tokens_reported_executions": 0,
        "tokens_missing_executions": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "estimated_cost": 0.0,
        "latency_ms": 0,
        "avg_latency_ms": 0,
        "workflow_traces": 0,
        "workflow_nodes_configured": 0,
        "workflow_base_nodes_configured": 0,
        "workflow_custom_nodes_configured": 0,
        "models": {},
        "failure_categories": {},
        "error_codes": {},
        "by_status": {},
    }


def _empty_bug_metrics() -> Dict[str, Any]:
    return {
        "total": 0,
        "open": 0,
        "closed": 0,
        "by_status": {},
        "by_severity": {},
    }


AI_ERROR_CODES = {
    "timeout": "AI_TIMEOUT",
    "model_unavailable": "AI_MODEL_UNAVAILABLE",
    "invalid_json": "AI_INVALID_JSON",
    "low_confidence": "AI_LOW_CONFIDENCE",
    "browser_action_failed": "AI_BROWSER_ACTION_FAILED",
    "workflow_blocked": "AI_WORKFLOW_BLOCKED",
    "human_review_required": "AI_HUMAN_REVIEW_REQUIRED",
    "missing_base_url": "AI_WORKFLOW_BLOCKED",
}


def _enum_value(value: Any) -> str:
    return value.value if hasattr(value, "value") else str(value or "")


def _has_ai_execution_data(execution: models.EjecucionCaso) -> bool:
    report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
    return bool(
        report
        or execution.ai_confidence is not None
        or execution.ai_consensus
        or execution.ai_failure_category
        or execution.ai_human_review_required
        or _enum_value(execution.estado_resultado) == "EJECUTANDO_AI"
    )


def _run_origin_execution_mode(run_origin: Optional[str]) -> Optional[str]:
    origin = str(run_origin or "").upper()
    if origin in {"IA", "AUTOMATIZADA_AI"}:
        return models.ExecutionMode.IA.value
    if origin in {"AUTOMATIZADA", "AUTOMATIZADA_WORKER"}:
        return models.ExecutionMode.AUTOMATIZADA.value
    if origin == "EXTERNAL_API":
        return models.ExecutionMode.EXTERNA.value
    return None


def _execution_mode_value(
    execution: models.EjecucionCaso,
    case: Optional[models.CasoPrueba] = None,
    run_origin: Optional[str] = None,
) -> str:
    raw_mode = getattr(execution, "execution_mode", None)
    mode = _enum_value(raw_mode).upper()
    origin_mode = _run_origin_execution_mode(run_origin)
    if mode in {
        models.ExecutionMode.IA.value,
        models.ExecutionMode.AUTOMATIZADA.value,
        models.ExecutionMode.EXTERNA.value,
    }:
        return mode
    if origin_mode:
        return origin_mode
    if _has_ai_execution_data(execution):
        return models.ExecutionMode.IA.value
    return models.ExecutionMode.MANUAL.value


def _execution_mode_key(mode: str) -> str:
    normalized = str(mode or "").upper()
    if normalized == models.ExecutionMode.IA.value:
        return "ia"
    if normalized == models.ExecutionMode.AUTOMATIZADA.value:
        return "automatizada"
    if normalized == models.ExecutionMode.EXTERNA.value:
        return "externa"
    return "manual"


def _execution_mode_label(mode: str) -> str:
    normalized = str(mode or "").upper()
    if normalized == models.ExecutionMode.IA.value:
        return "IA"
    if normalized == models.ExecutionMode.AUTOMATIZADA.value:
        return "Automatizada"
    if normalized == models.ExecutionMode.EXTERNA.value:
        return "Externa"
    if normalized == "MIXTO":
        return "Mixto"
    return "Manual"


def _execution_modes_summary(mode_counts: Dict[str, int]) -> Dict[str, Any]:
    active = {key: value for key, value in mode_counts.items() if value > 0}
    if not active:
        return {
            "execution_mode_summary": models.ExecutionMode.MANUAL.value,
            "execution_mode_label": "Manual",
            "execution_mode_detail": "Manual 0",
        }
    if len(active) == 1:
        key = next(iter(active.keys()))
        mode = {
            "ia": models.ExecutionMode.IA.value,
            "automatizada": models.ExecutionMode.AUTOMATIZADA.value,
            "externa": models.ExecutionMode.EXTERNA.value,
            "manual": models.ExecutionMode.MANUAL.value,
        }.get(key, models.ExecutionMode.MANUAL.value)
        return {
            "execution_mode_summary": mode,
            "execution_mode_label": _execution_mode_label(mode),
            "execution_mode_detail": f"{_execution_mode_label(mode)} {active[key]}",
        }
    labels = {
        "manual": "Manual",
        "ia": "IA",
        "automatizada": "Auto",
        "externa": "Externa",
    }
    detail = " · ".join(f"{labels.get(key, key)} {value}" for key, value in active.items())
    return {
        "execution_mode_summary": "MIXTO",
        "execution_mode_label": "Mixto",
        "execution_mode_detail": detail,
    }


def _case_type_key(case: models.CasoPrueba) -> str:
    tipo = _enum_value(case.tipo_prueba).upper()
    if tipo == "AUTOMATIZADA_AI":
        return "automatizada_ia"
    if tipo == "AUTOMATIZADA":
        return "automatizada"
    return "manual"


def _case_type_label(case: Optional[models.CasoPrueba]) -> str:
    if not case:
        return "Manual"
    tipo = _enum_value(case.tipo_prueba).upper()
    if tipo == "AUTOMATIZADA_AI":
        return "Automatizada IA"
    if tipo == "AUTOMATIZADA":
        return "Automatizada"
    return "Manual"


def _review_status_for_execution(execution: models.EjecucionCaso) -> str:
    status = _enum_value(getattr(execution, "ai_review_status", None)).upper()
    if status in {
        models.AiReviewStatus.REQUIERE_REVISION.value,
        models.AiReviewStatus.REVISADA.value,
    }:
        return status
    report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
    if bool(execution.ai_human_review_required or report.get("human_review_required")):
        return models.AiReviewStatus.REQUIERE_REVISION.value
    if status:
        return status
    return models.AiReviewStatus.NO_REQUIERE_REVISION.value


def _ai_error_code_from_report(report: Dict[str, Any], final_status: Optional[models.EstadoResultado] = None) -> Optional[str]:
    existing = report.get("error_code") or report.get("ai_error_code")
    if existing:
        return str(existing)[:80]
    category = str(report.get("failure_category") or "").lower()
    for fragment, code in AI_ERROR_CODES.items():
        if fragment in category:
            return code
    if bool(report.get("human_review_required")):
        return "AI_HUMAN_REVIEW_REQUIRED"
    if final_status == models.EstadoResultado.BLOQUEADO:
        return "AI_WORKFLOW_BLOCKED"
    if final_status == models.EstadoResultado.FALLO:
        return "AI_BROWSER_ACTION_FAILED"
    return None


async def _build_bug_metrics(db: AsyncSession, proyecto_id: UUID, build_id: Optional[UUID]) -> Dict[str, Any]:
    metrics = _empty_bug_metrics()
    if not build_id:
        return metrics
    result = await db.execute(
        select(models.BugIssue).filter(
            models.BugIssue.proyecto_id == proyecto_id,
            models.BugIssue.build_id == build_id,
        )
    )
    bugs = result.scalars().all()
    closed_statuses = {"CERRADO", "RESUELTO"}
    metrics["total"] = len(bugs)
    for bug in bugs:
        status = str(bug.estado or "SIN_ESTADO").upper()
        severity = str(bug.severidad or "SIN_SEVERIDAD").upper()
        metrics["by_status"][status] = metrics["by_status"].get(status, 0) + 1
        metrics["by_severity"][severity] = metrics["by_severity"].get(severity, 0) + 1
        if status in closed_statuses:
            metrics["closed"] += 1
        else:
            metrics["open"] += 1
    return metrics

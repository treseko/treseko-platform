from .repository_context import *
from .bug_version_metrics import apply_bug_history_metrics, bug_history_version_fields, load_bug_history_context
from .project_metrics_bug_context import build_bug_evidence_context
from .project_metrics_suite import build_suite_tree
from .project_metrics_history import build_project_history
from .project_metrics_rules import _qa_decision, _risk_level
from .project_metrics_derived import build_derived_metrics
from .project_metrics_formats import _empty_format_metrics, _empty_format_mode_metrics, _finalize_format_metrics, _finalize_format_mode_metrics
BUG_OPEN_STATES = {"ABIERTO", "TRIAGE", "ASIGNADO", "EN_PROGRESO", "LISTO_PARA_RETEST", "EN_RETEST", "REABIERTO", "BLOQUEADO"}
BUG_CLOSED_STATES = {"RESUELTO", "CERRADO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}
BUG_SLA_HOURS = {"CRITICA": 24, "ALTA": 48, "MEDIA": 120, "BAJA": 240, "COSMETICA": 240}
def _safe_iso(value):
    return value.isoformat() if value else None
def _hours_between(start, end):
    if not start or not end:
        return None
    return round(max((end - start).total_seconds(), 0) / 3600, 2)
def _safe_percent(numerator: int, denominator: int) -> float:
    return round((numerator / denominator) * 100, 2) if denominator else 0.0


def _chatbot_result_metrics(result: Any) -> dict[str, Any]:
    result = result if isinstance(result, dict) else {}
    turns = [item for item in (result.get("turns") or []) if isinstance(item, dict)]
    performance = result.get("performance") if isinstance(result.get("performance"), dict) else {}
    assertions = [item for item in (result.get("assertions") or []) if isinstance(item, dict)]
    failed_assertions = [item for item in assertions if item.get("passed") is False]
    security = [item for item in (result.get("security_findings") or []) if isinstance(item, dict)]
    memory_checks = [item for item in (result.get("memory_checks") or []) if isinstance(item, dict)]
    tool_results = [item for item in (result.get("tools") or []) if isinstance(item, dict)]
    http_errors = [item for item in (result.get("http_errors") or [])]
    latencies = sorted(float(item.get("latencyMs") or item.get("latency_ms") or 0) for item in turns)
    p95 = float(performance.get("p95_latency_ms") or (latencies[min(len(latencies) - 1, max(0, int(len(latencies) * .95) - 1))] if latencies else 0))
    return {
        "turn_count": int(performance.get("turn_count") or len(turns)),
        "total_latency_ms": float(performance.get("total_latency_ms") or sum(latencies)),
        "p95_latency_ms": p95,
        "http_error_count": len(http_errors),
        "validation_failure_count": len(failed_assertions) + int(result.get("failed_assertions") or 0 if isinstance(result.get("failed_assertions"), int) else 0),
        "security_finding_count": len(security),
        "memory_failure_count": len([item for item in memory_checks if item.get("passed") is False or item.get("status") == "FAILED"]),
        "tool_failure_count": len([item for item in tool_results if item.get("status") == "FAILED"]),
        "tool_not_observable_count": len([item for item in tool_results if item.get("status") == "NOT_OBSERVABLE"]),
        "tool_blocked_count": len([item for item in tool_results if item.get("status") == "BLOCKED"]),
        "semantic": result.get("judge") if isinstance(result.get("judge"), dict) else {},
        "status": result.get("status"),
    }


def _api_result_metrics(result: Any) -> dict[str, Any]:
    """Aggregate deterministic metrics from one persisted API execution."""
    result = result if isinstance(result, dict) else {}
    steps = [item for item in (result.get("steps") or []) if isinstance(item, dict)]
    latencies = sorted(
        float((item.get("response") or {}).get("timings", {}).get("total_ms") or 0)
        for item in steps
    )
    statuses = [
        int((item.get("response") or {}).get("status"))
        for item in steps
        if isinstance((item.get("response") or {}).get("status"), (int, float))
    ]
    assertions = [
        assertion
        for item in steps
        for assertion in (item.get("assertions") or [])
        if isinstance(assertion, dict)
    ]
    failed_assertions = [item for item in assertions if item.get("status") == "FAILED" or item.get("passed") is False]
    error_items = [error for step in steps for error in (step.get("errors") or []) if isinstance(error, dict)]
    # The API runner may expose the same failed assertion in both
    # ``assertions`` and ``errors``. Count it once in the report metrics.
    failed_assertion_ids = {
        str(item.get("id"))
        for item in failed_assertions
        if item.get("id") is not None
    }
    additional_errors = [
        error for error in error_items
        if error.get("id") is None or str(error.get("id")) not in failed_assertion_ids
    ]
    http_errors = [status for status in statuses if status >= 400]
    http_errors += [None for item in steps if item.get("response") is None]
    return {
        "requests": len(steps),
        "total_latency_ms": float(result.get("duration_ms") or sum(latencies)),
        "p95_latency_ms": latencies[min(len(latencies) - 1, max(0, int(len(latencies) * .95) - 1))] if latencies else 0,
        "http_errors": len(http_errors),
        "validation_failures": len(failed_assertions) + len(additional_errors),
        "status_2xx": len([status for status in statuses if 200 <= status < 300]),
        "status_4xx": len([status for status in statuses if 400 <= status < 500]),
        "status_5xx": len([status for status in statuses if status >= 500]),
    }


def _empty_chatbot_metrics() -> dict[str, Any]:
    return {
        "total": 0, "passed": 0, "failed": 0, "blocked": 0, "pending": 0,
        "turns": 0, "total_latency_ms": 0, "p95_latency_ms": 0,
        "http_errors": 0, "validation_failures": 0, "security_findings": 0,
        "memory_failures": 0, "tool_failures": 0, "tools_not_observable": 0, "tools_blocked": 0,
    }


def _seconds_to_hours(seconds: Optional[int]) -> float:
    return round(float(seconds or 0) / 3600, 2)

def _bug_status_is_open(status: Any) -> bool:
    return str(status or "").upper() in BUG_OPEN_STATES

def _empty_control_center_payload() -> Dict[str, Any]:
    return {
        "build_context": {},
        "calculation_rules": {
            "coverage": "ejecutados / total asignados",
            "success_executed": "pasados / ejecutados",
            "success_total": "pasados / total asignados",
            "pending": "total asignados - ejecutados",
        },
        "qa_status": {
            "state": "EN_EVALUACION",
            "label": "En evaluacion",
            "risk": "MEDIO",
            "reasons": ["Sin casos asignados o sin datos suficientes para calcular decision QA"],
            "recommend_release": False,
        },
        "temporal_metrics": {},
        "bug_traceability": {},
        "bugs": [],
        "failures_and_blockers": [],
        "evidence_summary": {"total": 0, "complete": 0, "insufficient": 0, "missing": 0},
        "evidence_items": [],
        "comparison": {},
    }


async def get_project_metrics(db: AsyncSession, proyecto_id: UUID, build_id: Optional[UUID] = None, component_id: Optional[UUID] = None):
    from sqlalchemy import and_, or_

    if build_id:
        result = await db.execute(select(models.Build).filter(models.Build.id == build_id))
        build = result.scalar_one_or_none()
        if build and component_id and build.componente_id != component_id:
            build = None
    else:
        build_filters = [
            models.Build.proyecto_id == proyecto_id,
            models.Build.activo == True,
        ]
        if component_id:
            build_filters.append(models.Build.componente_id == component_id)
        result = await db.execute(
            select(models.Build)
            .filter(*build_filters)
            .order_by(models.Build.fecha_inicio.desc().nullslast(), models.Build.fecha_creacion.desc(), models.Build.id.desc())
            .limit(1)
        )
        build = result.scalar_one_or_none()

    if not build:
        return {
            "build_id": None,
            "build_name": None,
            "total_casos_asignados": 0,
            "total_ejecutados": 0,
            "cobertura_porcentaje": 0.0,
            "stats": {"pasados": 0, "fallados": 0, "bloqueados": 0, "pendientes": 0},
            "por_tipo_ejecucion": {"manual": 0, "automatizada": 0, "ia": 0, "externa": 0},
            "por_modo_ejecucion": {"manual": 0, "automatizada": 0, "ia": 0, "externa": 0},
            "por_tipo_prueba": {"manual": 0, "automatizada": 0, "automatizada_ia": 0},
            "por_formato_prueba": {"CLASICA": 0, "API": 0, "PERFORMANCE": 0, "CONVERSACIONAL": 0},
            "chatbot_metrics": _empty_chatbot_metrics(),
            "metricas_por_formato": _empty_format_metrics(),
            "metricas_por_formato_y_modo": _empty_format_mode_metrics(),
            "por_prioridad": {},
            "por_suite": {},
            "por_suite_tree": [],
            "historico_versions": [],
            "ai_metrics": _empty_ai_metrics(),
            "bug_metrics": _empty_bug_metrics(),
            **_empty_control_center_payload(),
        }

    result_casos = await db.execute(
        select(models.BuildCaso).filter(models.BuildCaso.build_id == build.id)
    )
    build_casos = result_casos.scalars().all()
    caso_ids = [bc.caso_id for bc in build_casos]

    if not caso_ids:
        return {
            "build_id": str(build.id),
            "build_name": build.nombre,
            "total_casos_asignados": 0,
            "total_ejecutados": 0,
            "cobertura_porcentaje": 0.0,
            "stats": {"pasados": 0, "fallados": 0, "bloqueados": 0, "pendientes": 0},
            "por_tipo_ejecucion": {"manual": 0, "automatizada": 0, "ia": 0, "externa": 0},
            "por_modo_ejecucion": {"manual": 0, "automatizada": 0, "ia": 0, "externa": 0},
            "por_tipo_prueba": {"manual": 0, "automatizada": 0, "automatizada_ia": 0},
            "por_formato_prueba": {"CLASICA": 0, "API": 0, "PERFORMANCE": 0, "CONVERSACIONAL": 0},
            "chatbot_metrics": _empty_chatbot_metrics(),
            "metricas_por_formato": _empty_format_metrics(),
            "metricas_por_formato_y_modo": _empty_format_mode_metrics(),
            "por_prioridad": {},
            "por_suite": {},
            "por_suite_tree": [],
            "historico_versions": [],
            "ai_metrics": _empty_ai_metrics(),
            "bug_metrics": _empty_bug_metrics(),
            **_empty_control_center_payload(),
        }

    result_casos_info = await db.execute(
        select(models.CasoPrueba).filter(
            models.CasoPrueba.id.in_(caso_ids),
            *_visible_case_filter(),
        )
    )
    casos_info = {c.id: c for c in result_casos_info.scalars().all()}
    assigned_by_master = {c.master_id: c for c in casos_info.values()}
    assigned_master_ids = set(assigned_by_master.keys())
    total_asignados = len(assigned_master_ids)

    if total_asignados == 0:
        return {
            "build_id": str(build.id),
            "build_name": build.nombre,
            "total_casos_asignados": 0,
            "total_ejecutados": 0,
            "cobertura_porcentaje": 0.0,
            "stats": {"pasados": 0, "fallados": 0, "bloqueados": 0, "pendientes": 0},
            "por_tipo_ejecucion": {"manual": 0, "automatizada": 0, "ia": 0, "externa": 0},
            "por_modo_ejecucion": {"manual": 0, "automatizada": 0, "ia": 0, "externa": 0},
            "por_tipo_prueba": {"manual": 0, "automatizada": 0, "automatizada_ia": 0},
            "por_formato_prueba": {"CLASICA": 0, "API": 0, "PERFORMANCE": 0, "CONVERSACIONAL": 0},
            "chatbot_metrics": _empty_chatbot_metrics(),
            "metricas_por_formato": _empty_format_metrics(),
            "metricas_por_formato_y_modo": _empty_format_mode_metrics(),
            "por_prioridad": {},
            "por_suite": {},
            "por_suite_tree": [],
            "historico_versions": [],
            "ai_metrics": _empty_ai_metrics(),
            "bug_metrics": _empty_bug_metrics(),
            **_empty_control_center_payload(),
        }

    result_case_versions = await db.execute(
        select(models.CasoPrueba.id, models.CasoPrueba.master_id).filter(
            models.CasoPrueba.master_id.in_(assigned_master_ids),
            *_visible_case_filter(),
        )
    )
    master_by_version_id = {
        case_id: master_id
        for case_id, master_id in result_case_versions.all()
    }
    version_case_ids = list(master_by_version_id.keys())

    result_all_suites = await db.execute(
        select(models.Suite)
        .filter(models.Suite.proyecto_id == proyecto_id, models.Suite.activo == True)
        .order_by(models.Suite.orden, models.Suite.nombre)
    )
    suites_by_id = {str(s.id): s for s in result_all_suites.scalars().all()}

    def suite_breadcrumb(suite_id: Optional[str]):
        if not suite_id or suite_id == "sin_suite":
            return "Sin Suite"
        names = []
        current = suites_by_id.get(suite_id)
        visited = set()
        while current and str(current.id) not in visited:
            visited.add(str(current.id))
            names.append(current.nombre)
            current = suites_by_id.get(str(current.parent_id)) if current.parent_id else None
        return " / ".join(reversed(names)) if names else "Sin Suite"

    result_ejecuciones = await db.execute(
        select(models.EjecucionCaso, models.TestRun).join(models.TestRun).filter(
            models.TestRun.build_id == build.id,
            models.EjecucionCaso.caso_id.in_(version_case_ids),
            models.EjecucionCaso.estado_resultado != models.EstadoResultado.SIN_CORRER,
        )
    )
    ejecucion_rows = result_ejecuciones.all()
    ejecuciones = [ejecucion for ejecucion, _run in ejecucion_rows]
    run_origin_by_execution_id = {
        str(ejecucion.id): run.origen
        for ejecucion, run in ejecucion_rows
    }

    ejecutados_masters = set()
    stats = {"pasados": 0, "fallados": 0, "bloqueados": 0, "pendientes": total_asignados}
    por_modo_ejecucion = {"manual": 0, "automatizada": 0, "ia": 0, "externa": 0}
    por_tipo_prueba = {"manual": 0, "automatizada": 0, "automatizada_ia": 0}
    por_formato_prueba = {"CLASICA": 0, "API": 0, "PERFORMANCE": 0, "CONVERSACIONAL": 0}
    metricas_por_formato = _empty_format_metrics()
    metricas_por_formato_y_modo = _empty_format_mode_metrics()
    chatbot_metrics = _empty_chatbot_metrics()
    por_prioridad = {}
    por_suite = {}
    caso_ultimo_estado = {}
    casos_detalle_por_master = {}
    ai_metrics = _empty_ai_metrics()

    for caso in casos_info.values():
        prioridad = caso.prioridad.value if hasattr(caso.prioridad, 'value') else caso.prioridad
        if prioridad not in por_prioridad:
            por_prioridad[prioridad] = {"total": 0, "pasados": 0, "fallados": 0, "bloqueados": 0, "pendientes": 0}
        por_prioridad[prioridad]["total"] += 1
        por_prioridad[prioridad]["pendientes"] += 1

    # The case cards use the latest result per logical case, but the execution
    # matrix and API telemetry must retain every mode executed for this build.
    # Otherwise the last mode (for example EXTERNA) hides MANUAL, AUTOMATIZADA
    # and IA from the report.
    for ejecucion, run in ejecucion_rows:
        caso_ejecutado = casos_info.get(ejecucion.caso_id)
        if not caso_ejecutado:
            continue
        formato_ejecutado = str(
            caso_ejecutado.formato_prueba.value
            if hasattr(caso_ejecutado.formato_prueba, "value")
            else caso_ejecutado.formato_prueba or "CLASICA"
        ).upper()
        formato_ejecutado = formato_ejecutado if formato_ejecutado in por_formato_prueba else "CLASICA"
        modo_ejecutado = _execution_mode_value(
            ejecucion,
            caso_ejecutado,
            run.origen,
        )
        matrix_metrics = metricas_por_formato_y_modo[formato_ejecutado][modo_ejecutado]
        matrix_metrics["total"] += 1
        matrix_metrics["executed"] += 1
        estado_ejecutado = ejecucion.estado_resultado.value if hasattr(ejecucion.estado_resultado, "value") else ejecucion.estado_resultado
        if estado_ejecutado == "PASO":
            matrix_metrics["passed"] += 1
        elif estado_ejecutado == "FALLO":
            matrix_metrics["failed"] += 1
        elif estado_ejecutado == "BLOQUEADO":
            matrix_metrics["blocked"] += 1
        if formato_ejecutado == "API":
            api_detail = _api_result_metrics(ejecucion.api_resultado if isinstance(ejecucion.api_resultado, dict) else {})
            api_specific = metricas_por_formato["API"]["specific"]
            for key in api_specific:
                if key == "p95_latency_ms":
                    api_specific[key] = max(api_specific[key], api_detail[key])
                else:
                    api_specific[key] += api_detail[key]

    # Obtener nombres de usuarios para las ejecuciones
    ejecutor_ids = set(ejec.ejecutado_por for ejec in ejecuciones if ejec.ejecutado_por)
    usuarios_info = {}
    if ejecutor_ids:
        result_usuarios = await db.execute(
            select(models.Usuario).filter(models.Usuario.id.in_(ejecutor_ids))
        )
        usuarios_info = {str(u.id): u for u in result_usuarios.scalars().all()}

    for ejec in ejecuciones:
        master_id = master_by_version_id.get(ejec.caso_id)
        if not master_id:
            continue

        ejecutados_masters.add(master_id)
        estado = ejec.estado_resultado.value if hasattr(ejec.estado_resultado, 'value') else ejec.estado_resultado
        ejecutor = usuarios_info.get(str(ejec.ejecutado_por))

        if master_id not in caso_ultimo_estado or ejec.fecha_ejecucion > caso_ultimo_estado[master_id]['fecha']:
            caso_ultimo_estado[master_id] = {
                'estado': estado,
                'fecha': ejec.fecha_ejecucion,
                'ejecucion': ejec,
                'ejecutor': ejecutor
            }

    for master_id, caso in assigned_by_master.items():
        info = caso_ultimo_estado.get(master_id)
        estado = info['estado'] if info else "SIN_CORRER"
        ejecucion = info['ejecucion'] if info else None
        ejecutor = info['ejecutor'] if info else None

        prioridad = caso.prioridad.value if hasattr(caso.prioridad, 'value') else caso.prioridad
        version_actual = caso.version or (ejecucion.version_ejecutada if ejecucion else None)
        version_ejecutada = ejecucion.version_ejecutada if ejecucion else version_actual
        run_origin = run_origin_by_execution_id.get(str(ejecucion.id)) if ejecucion else None
        execution_mode = _execution_mode_value(ejecucion, caso, run_origin) if ejecucion else None
        # Datos detallados del caso
        caso_detalle = {
            "id": str(caso.id),
            "execution_id": str(ejecucion.id) if ejecucion else None,
            "execution_case_id": str(ejecucion.caso_id) if ejecucion else None,
            "master_id": str(master_id),
            "codigo": caso.codigo or str(caso.id)[:8].upper(),
            "titulo": caso.titulo,
            "descripcion": caso.descripcion or "",
            "prioridad": prioridad,
            "tipo_prueba": caso.tipo_prueba.value if hasattr(caso.tipo_prueba, 'value') else caso.tipo_prueba,
            "formato_prueba": caso.formato_prueba.value if hasattr(caso.formato_prueba, 'value') else caso.formato_prueba,
            "execution_mode": execution_mode,
            "review_status": _review_status_for_execution(ejecucion) if ejecucion else None,
            "estado": estado,
            "fecha_ejecucion": ejecucion.fecha_ejecucion.isoformat() if ejecucion and ejecucion.fecha_ejecucion else None,
            "ejecutado_por": (ejecutor.nombre_completo or ejecutor.email) if ejecutor else None,
            "duracion_segundos": ejecucion.duracion_segundos if ejecucion else None,
            "version_ejecutada": version_ejecutada,
            "version_actual": version_actual,
            "is_outdated_result": bool(ejecucion and version_ejecutada != version_actual),
            "observaciones": ejecucion.observaciones if ejecucion and ejecucion.observaciones else "",
            "evidencia_url": None,
            "evidencias": [],
            "snapshots": [],
            "bugs": [],
        }
        formato = str(caso.formato_prueba.value if hasattr(caso.formato_prueba, 'value') else caso.formato_prueba or "CLASICA").upper()
        formato = formato if formato in por_formato_prueba else "CLASICA"
        por_formato_prueba[formato] += 1
        format_metrics = metricas_por_formato[formato]
        format_metrics["total"] += 1
        format_metrics["pending"] += 1
        if ejecucion:
            format_metrics["executed"] += 1
            format_metrics["duration_seconds"] += int(ejecucion.duracion_segundos or 0)
            format_metrics["pending"] = max(int(format_metrics["pending"] or 0) - 1, 0)
            if estado == "PASO":
                format_metrics["passed"] += 1
            elif estado == "FALLO":
                format_metrics["failed"] += 1
            elif estado == "BLOQUEADO":
                format_metrics["blocked"] += 1
        ai_report = (
            ejecucion.ai_report
            if ejecucion and isinstance(ejecucion.ai_report, dict)
            else {}
        )
        is_ai_execution = bool(
            ejecucion
            and (
                execution_mode == models.ExecutionMode.IA.value
                or (isinstance(ai_report, dict) and bool(ai_report))
            )
        )
        if is_ai_execution:
            error_code = _ai_error_code_from_report(ai_report, ejecucion.estado_resultado)
            caso_detalle["ai"] = {
                "confidence": ejecucion.ai_confidence or ai_report.get("confidence"),
                "consensus": ejecucion.ai_consensus or ai_report.get("consensus"),
                "failure_category": ejecucion.ai_failure_category or ai_report.get("failure_category"),
                "error_code": error_code,
                "review_status": _review_status_for_execution(ejecucion),
                "human_review_required": bool(ejecucion.ai_human_review_required or ai_report.get("human_review_required")),
                "model": ai_report.get("model") or (ai_report.get("parameters") or {}).get("model"),
                "metrics": ai_report.get("metrics") if isinstance(ai_report.get("metrics"), dict) else {},
                "workflow_trace_count": len(ai_report.get("workflow_traces") or ai_report.get("timeline") or []),
            }
            _accumulate_ai_metrics(ai_metrics, ejecucion, estado)
        if formato == "CONVERSACIONAL":
            chatbot_result = (ejecucion.chatbot_resultado if ejecucion and isinstance(ejecucion.chatbot_resultado, dict) else {})
            chatbot_config = (ejecucion.chatbot_config_snapshot if ejecucion and isinstance(ejecucion.chatbot_config_snapshot, dict) else (caso.configuracion_chatbot if isinstance(caso.configuracion_chatbot, dict) else {}))
            chatbot_detail = _chatbot_result_metrics(chatbot_result)
            chatbot_conversation = chatbot_config.get("conversation") if isinstance(chatbot_config.get("conversation"), dict) else {}
            caso_detalle["chatbot"] = {
                "config_snapshot": chatbot_config,
                "resultado": chatbot_result,
                "workflow_version": chatbot_result.get("workflow_version") or chatbot_config.get("workflow_version"),
                "metrics": chatbot_detail,
                "transcription": chatbot_result.get("turns") or [],
                "variables": chatbot_result.get("variables") or {},
                "profile": chatbot_result.get("profile") or chatbot_config.get("profile") or {},
                "opening_message": chatbot_result.get("opening_message") or chatbot_conversation.get("opening_message", {}),
                "memory_checks": chatbot_result.get("memory_checks") or [],
                "tools": chatbot_result.get("tools") or [],
                "human_review_status": _review_status_for_execution(ejecucion) if ejecucion else None,
            }
            chatbot_metrics["total"] += 1
            chatbot_metrics["turns"] += chatbot_detail["turn_count"]
            chatbot_metrics["total_latency_ms"] += chatbot_detail["total_latency_ms"]
            chatbot_metrics["p95_latency_ms"] = max(chatbot_metrics["p95_latency_ms"], chatbot_detail["p95_latency_ms"])
            chatbot_metrics["http_errors"] += chatbot_detail["http_error_count"]
            chatbot_metrics["validation_failures"] += chatbot_detail["validation_failure_count"]
            chatbot_metrics["security_findings"] += chatbot_detail["security_finding_count"]
            chatbot_metrics["memory_failures"] += chatbot_detail["memory_failure_count"]
            chatbot_metrics["tool_failures"] += chatbot_detail["tool_failure_count"]
            chatbot_metrics["tools_not_observable"] += chatbot_detail["tool_not_observable_count"]
            chatbot_metrics["tools_blocked"] += chatbot_detail["tool_blocked_count"]
            conversational_specific = metricas_por_formato["CONVERSACIONAL"]["specific"]
            conversational_specific["turns"] += chatbot_detail["turn_count"]
            conversational_specific["total_latency_ms"] += chatbot_detail["total_latency_ms"]
            conversational_specific["p95_latency_ms"] = max(conversational_specific["p95_latency_ms"], chatbot_detail["p95_latency_ms"])
            conversational_specific["http_errors"] += chatbot_detail["http_error_count"]
            conversational_specific["validation_failures"] += chatbot_detail["validation_failure_count"]
            conversational_specific["security_findings"] += chatbot_detail["security_finding_count"]
            conversational_specific["memory_failures"] += chatbot_detail["memory_failure_count"]
            conversational_specific["tool_failures"] += chatbot_detail["tool_failure_count"]
            conversational_specific["tools_not_observable"] += chatbot_detail["tool_not_observable_count"]
            conversational_specific["tools_blocked"] += chatbot_detail["tool_blocked_count"]
            if estado == "PASO": chatbot_metrics["passed"] += 1
            elif estado == "FALLO": chatbot_metrics["failed"] += 1
            elif estado == "BLOQUEADO": chatbot_metrics["blocked"] += 1
            else: chatbot_metrics["pending"] += 1
        if ejecucion:
            details = await get_execution_history_details(db, ejecucion.id)
            caso_detalle["evidencia_url"] = details.get("evidencia_url")
            caso_detalle["evidencias"] = details.get("evidencias", [])
            caso_detalle["snapshots"] = details.get("snapshots", [])

        # Agrupar por suite
        suite_id = str(caso.suite_id) if caso.suite_id else "sin_suite"
        if suite_id not in por_suite:
            suite = suites_by_id.get(suite_id)
            por_suite[suite_id] = {
                "id": suite_id,
                "nombre": suite.nombre if suite else "Sin Suite",
                "parent_id": str(suite.parent_id) if suite and suite.parent_id else None,
                "breadcrumb": suite_breadcrumb(suite_id),
                "total": 0,
                "pasados": 0,
                "fallados": 0,
                "bloqueados": 0,
                "pendientes": 0,
                "duracion_segundos": 0,
                "ultima_ejecucion": None,
                "casos": []
            }
        caso_detalle["suite_id"] = suite_id
        caso_detalle["suite_nombre"] = por_suite[suite_id]["nombre"]
        caso_detalle["suite_breadcrumb"] = por_suite[suite_id]["breadcrumb"]
        casos_detalle_por_master[str(master_id)] = caso_detalle
        por_suite[suite_id]["total"] += 1
        por_suite[suite_id]["casos"].append(caso_detalle)
        if ejecucion:
            por_suite[suite_id]["duracion_segundos"] += int(ejecucion.duracion_segundos or 0)
            if not por_suite[suite_id]["ultima_ejecucion"] or ejecucion.fecha_ejecucion > por_suite[suite_id]["ultima_ejecucion"]:
                por_suite[suite_id]["ultima_ejecucion"] = ejecucion.fecha_ejecucion

        if estado == "PASO":
            stats["pasados"] += 1
            stats["pendientes"] -= 1
            por_prioridad[prioridad]["pasados"] += 1
            por_prioridad[prioridad]["pendientes"] -= 1
            por_suite[suite_id]["pasados"] += 1
            por_modo_ejecucion[_execution_mode_key(execution_mode)] += 1
            por_tipo_prueba[_case_type_key(caso)] += 1
        elif estado == "FALLO":
            stats["fallados"] += 1
            stats["pendientes"] -= 1
            por_prioridad[prioridad]["fallados"] += 1
            por_prioridad[prioridad]["pendientes"] -= 1
            por_suite[suite_id]["fallados"] += 1
            por_modo_ejecucion[_execution_mode_key(execution_mode)] += 1
            por_tipo_prueba[_case_type_key(caso)] += 1
        elif estado == "BLOQUEADO":
            stats["bloqueados"] += 1
            stats["pendientes"] -= 1
            por_prioridad[prioridad]["bloqueados"] += 1
            por_prioridad[prioridad]["pendientes"] -= 1
            por_suite[suite_id]["bloqueados"] += 1
            por_modo_ejecucion[_execution_mode_key(execution_mode)] += 1
            por_tipo_prueba[_case_type_key(caso)] += 1
        else:
            por_suite[suite_id]["pendientes"] += 1

    for master_id, caso in assigned_by_master.items():
        if master_id in caso_ultimo_estado:
            continue
        formato_sin_ejecucion = str(
            caso.formato_prueba.value if hasattr(caso.formato_prueba, "value") else caso.formato_prueba or "CLASICA"
        ).upper()
        formato_sin_ejecucion = formato_sin_ejecucion if formato_sin_ejecucion in por_formato_prueba else "CLASICA"
        metricas_por_formato_y_modo[formato_sin_ejecucion]["SIN_EJECUTAR"]["total"] += 1
        metricas_por_formato_y_modo[formato_sin_ejecucion]["SIN_EJECUTAR"]["pending"] += 1

    total_ejecutados = len(ejecutados_masters)
    cobertura = round((total_ejecutados / total_asignados) * 100, 2) if total_asignados > 0 else 0.0
    metricas_por_formato = _finalize_format_metrics(metricas_por_formato)
    metricas_por_formato_y_modo = _finalize_format_mode_metrics(metricas_por_formato_y_modo)
    bug_metrics = await _build_bug_metrics(db, proyecto_id, build.id)

    project_result = await db.execute(
        select(models.Proyecto)
        .options(selectinload(models.Proyecto.organizacion))
        .filter(models.Proyecto.id == proyecto_id)
    )
    project = project_result.scalar_one_or_none()
    component = None
    if build.componente_id:
        component_result = await db.execute(select(models.Componente).filter(models.Componente.id == build.componente_id))
        component = component_result.scalar_one_or_none()

    case_master_by_version = dict(master_by_version_id)
    related_case_ids = set(version_case_ids)
    bug_context = await build_bug_evidence_context({
        "db": db, "build": build, "proyecto_id": proyecto_id, "project": project, "component": component,
        "case_master_by_version": case_master_by_version, "related_case_ids": related_case_ids,
        "casos_detalle_por_master": casos_detalle_por_master, "ejecuciones": ejecuciones,
        "caso_ultimo_estado": caso_ultimo_estado, "bug_metrics": bug_metrics,
    })
    related_bugs = bug_context["related_bugs"]; project_bug_history = bug_context["project_bug_history"]; now = bug_context["now"]
    bug_items = bug_context["bug_items"]; first_comment_hours = bug_context["first_comment_hours"]; bugs_without_evidence = bug_context["bugs_without_evidence"]
    reopened = bug_context["reopened"]; overdue = bug_context["overdue"]; bugs_by_origin_build = bug_context["bugs_by_origin_build"]
    failure_items = bug_context["failure_items"]; evidence_items = bug_context["evidence_items"]; failures_with_bug = bug_context["failures_with_bug"]; evidence_summary = bug_context["evidence_summary"]
    derived = build_derived_metrics({
        "ejecuciones": ejecuciones, "related_bugs": related_bugs, "build": build,
        "total_ejecutados": total_ejecutados, "now": now, "stats": stats, "bug_metrics": bug_metrics,
        "project": project, "component": component, "usuarios_info": usuarios_info,
        "caso_ultimo_estado": caso_ultimo_estado, "cobertura": cobertura,
        "first_comment_hours": first_comment_hours, "reopened": reopened,
        "bugs_without_evidence": bugs_without_evidence, "failure_items": failure_items,
        "failures_with_bug": failures_with_bug, "overdue": overdue,
        "bugs_by_origin_build": bugs_by_origin_build, "casos_detalle_por_master": casos_detalle_por_master,
        "bug_items": bug_items, "por_prioridad": por_prioridad, "ai_metrics": ai_metrics,
    })
    temporal_metrics = derived["temporal_metrics"]
    build_context = derived["build_context"]
    bug_traceability = derived["bug_traceability"]
    qa_status = derived["qa_status"]
    por_prioridad = derived["por_prioridad"]
    ai_metrics = derived["ai_metrics"]
    open_bug_items = derived["open_bug_items"]

    suite_context = build_suite_tree({
        "suites_by_id": suites_by_id, "por_suite": por_suite, "suite_breadcrumb": suite_breadcrumb,
        "open_bug_items": open_bug_items,
    })
    root_nodes = suite_context["root_nodes"]
    por_suite = suite_context["por_suite"]
    """Legacy inline suite construction moved to project_metrics_suite.py."""

    history_context = await build_project_history({"db": db, "proyecto_id": proyecto_id, "build": build, "project_bug_history": project_bug_history, "stats": stats, "cobertura": cobertura, "total_ejecutados": total_ejecutados, "qa_status": qa_status, "bug_metrics": bug_metrics})
    historico = history_context["historico"]
    comparison = history_context["comparison"]
    return {
        "build_id": str(build.id),
        "build_name": build.nombre,
        "total_casos_asignados": total_asignados,
        "total_ejecutados": total_ejecutados,
        "cobertura_porcentaje": cobertura,
        "exito_sobre_ejecutados_porcentaje": _safe_percent(stats["pasados"], total_ejecutados),
        "exito_sobre_total_porcentaje": _safe_percent(stats["pasados"], total_asignados),
        "stats": stats,
        "por_tipo_ejecucion": por_modo_ejecucion,
        "por_modo_ejecucion": por_modo_ejecucion,
        "por_tipo_prueba": por_tipo_prueba,
        "por_formato_prueba": por_formato_prueba,
        "metricas_por_formato": metricas_por_formato,
        "metricas_por_formato_y_modo": metricas_por_formato_y_modo,
        "chatbot_metrics": chatbot_metrics,
        "por_prioridad": por_prioridad,
        "por_suite": por_suite,
        "por_suite_tree": root_nodes,
        "historico_versions": historico,
        "ai_metrics": ai_metrics,
        "bug_metrics": bug_metrics,
        "build_context": build_context,
        "calculation_rules": {
            "coverage": "ejecutados / total asignados",
            "success_executed": "pasados / ejecutados",
            "success_total": "pasados / total asignados",
            "pending": "total asignados - ejecutados",
            "bug_open_time": "fecha actual o cierre - fecha creacion",
            "bug_resolution_time": "fecha cierre - fecha creacion",
        },
        "qa_status": qa_status,
        "temporal_metrics": temporal_metrics,
        "bug_traceability": bug_traceability,
        "bugs": bug_items,
        "failures_and_blockers": failure_items,
        "evidence_summary": evidence_summary,
        "evidence_items": evidence_items,
        "comparison": comparison,
    }

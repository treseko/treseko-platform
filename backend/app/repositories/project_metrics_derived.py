from .repository_context import *
from .project_metrics_rules import _qa_decision, _risk_level
BUG_SLA_HOURS = {"CRITICA": 24, "ALTA": 48, "MEDIA": 120, "BAJA": 240, "COSMETICA": 240}
def _safe_iso(value): return value.isoformat() if value else None
def _hours_between(start, end): return round(max((end - start).total_seconds(), 0) / 3600, 2) if start and end else None
def _safe_percent(numerator, denominator): return round((numerator / denominator) * 100, 2) if denominator else 0.0
def _seconds_to_hours(seconds): return round(float(seconds or 0) / 3600, 2)
def build_derived_metrics(context):
    ejecuciones = context["ejecuciones"]; related_bugs = context["related_bugs"]; build = context["build"]; total_ejecutados = context["total_ejecutados"]; now = context["now"]
    stats = context["stats"]; bug_metrics = context["bug_metrics"]; project = context["project"]; component = context["component"]; usuarios_info = context["usuarios_info"]; caso_ultimo_estado = context["caso_ultimo_estado"]; cobertura = context["cobertura"]
    first_comment_hours = context["first_comment_hours"]; reopened = context["reopened"]; bugs_without_evidence = context["bugs_without_evidence"]; failure_items = context["failure_items"]; failures_with_bug = context["failures_with_bug"]; overdue = context["overdue"]; bugs_by_origin_build = context["bugs_by_origin_build"]; casos_detalle_por_master = context["casos_detalle_por_master"]; bug_items = context["bug_items"]; por_prioridad = context["por_prioridad"]; ai_metrics = context["ai_metrics"]
    execution_dates = [item.fecha_ejecucion for item in ejecuciones if item.fecha_ejecucion]
    first_execution = min(execution_dates) if execution_dates else None
    last_execution = max(execution_dates) if execution_dates else None
    total_execution_seconds = sum(int(item.duracion_segundos or 0) for item in ejecuciones)
    executions_by_day: Dict[str, int] = {}
    for item in ejecuciones:
        if item.fecha_ejecucion:
            key = item.fecha_ejecucion.date().isoformat()
            executions_by_day[key] = executions_by_day.get(key, 0) + 1
    latest_bug_update = max([bug.updated_at for bug in related_bugs if bug.updated_at], default=None)
    last_activity = max([value for value in [last_execution, latest_bug_update, build.fecha_creacion] if value], default=None)
    avg_seconds_per_case = round(total_execution_seconds / total_ejecutados) if total_ejecutados else 0
    temporal_metrics = {
        "build_to_first_execution_hours": _hours_between(build.fecha_creacion, first_execution),
        "first_to_last_execution_hours": _hours_between(first_execution, last_execution),
        "qa_cycle_hours": _hours_between(build.fecha_creacion, last_execution or now),
        "total_execution_seconds": total_execution_seconds,
        "total_execution_hours": _seconds_to_hours(total_execution_seconds),
        "average_seconds_per_executed_case": avg_seconds_per_case,
        "executions_by_day": [{"date": day, "executions": count} for day, count in sorted(executions_by_day.items())],
        "last_activity_at": _safe_iso(last_activity),
        "days_without_activity": round(((now - last_activity).total_seconds() / 86400), 2) if last_activity else None,
        "estimated_remaining_seconds": avg_seconds_per_case * int(stats.get("pendientes") or 0) if avg_seconds_per_case else None,
    }

    primary_owner = None
    if usuarios_info:
        owner_counts: Dict[str, int] = {}
        for info in caso_ultimo_estado.values():
            executor = info.get("ejecutor")
            if executor:
                label = executor.nombre_completo or executor.email
                owner_counts[label] = owner_counts.get(label, 0) + 1
        if owner_counts:
            primary_owner = sorted(owner_counts.items(), key=lambda item: item[1], reverse=True)[0][0]

    risk = _risk_level(
        coverage=cobertura,
        failed=int(stats.get("fallados") or 0),
        blocked=int(stats.get("bloqueados") or 0),
        pending=int(stats.get("pendientes") or 0),
        high_open_bugs=int(bug_metrics.get("high_open") or 0),
        bugs_without_evidence=bugs_without_evidence,
    )
    qa_status = _qa_decision(risk, stats, cobertura, bug_metrics)
    build_context = {
        "organization": project.organizacion.nombre if project and project.organizacion else None,
        "project": project.nombre if project else None,
        "component": component.nombre if component else None,
        "build": build.nombre,
        "build_code": build.codigo,
        "platform": (component.variables or {}).get("platform") if component and isinstance(component.variables, dict) else None,
        "build_created_at": _safe_iso(build.fecha_creacion),
        "execution_started_at": _safe_iso(first_execution),
        "last_execution_at": _safe_iso(last_execution),
        "elapsed_since_build_creation_hours": _hours_between(build.fecha_creacion, now),
        "total_execution_seconds": total_execution_seconds,
        "responsible": primary_owner,
        "qa_state": qa_status.get("label"),
    }

    bug_traceability = {
        "mttr_hours": bug_metrics.get("avg_resolution_hours"),
        "avg_bug_open_hours": bug_metrics.get("avg_open_hours"),
        "avg_first_comment_hours": round(sum(first_comment_hours) / len(first_comment_hours), 2) if first_comment_hours else None,
        "reopened_percent": _safe_percent(reopened, len(related_bugs)),
        "with_evidence_percent": _safe_percent(len(related_bugs) - bugs_without_evidence, len(related_bugs)),
        "failures_with_bug_percent": _safe_percent(failures_with_bug, len(failure_items)),
        "bugs_overdue_sla": overdue,
        "bugs_by_severity": bug_metrics.get("by_severity") or {},
        "bugs_by_status": bug_metrics.get("by_status") or {},
        "bugs_by_origin_build": bugs_by_origin_build,
        "sla_hours": BUG_SLA_HOURS,
    }

    open_bug_items = [item for item in bug_items if item.get("is_open")]
    case_priority_by_code = {
        case.get("codigo"): str(case.get("prioridad") or "SIN_PRIORIDAD").upper()
        for case in casos_detalle_por_master.values()
    }
    open_bugs_by_priority: Dict[str, int] = {}
    high_open_by_priority: Dict[str, int] = {}
    for bug in open_bug_items:
        priority_key = case_priority_by_code.get(bug.get("case_code"), str(bug.get("prioridad") or "SIN_PRIORIDAD").upper())
        open_bugs_by_priority[priority_key] = open_bugs_by_priority.get(priority_key, 0) + 1
        if str(bug.get("severidad") or "").upper() in {"CRITICA", "ALTA"}:
            high_open_by_priority[priority_key] = high_open_by_priority.get(priority_key, 0) + 1
    for priority, data in por_prioridad.items():
        executed = int(data.get("pasados") or 0) + int(data.get("fallados") or 0) + int(data.get("bloqueados") or 0)
        total = int(data.get("total") or 0)
        key = str(priority or "SIN_PRIORIDAD").upper()
        data["ejecutados"] = executed
        data["cobertura_porcentaje"] = _safe_percent(executed, total)
        data["exito_sobre_ejecutados_porcentaje"] = _safe_percent(int(data.get("pasados") or 0), executed)
        data["exito_sobre_total_porcentaje"] = _safe_percent(int(data.get("pasados") or 0), total)
        data["bugs_abiertos"] = open_bugs_by_priority.get(key, 0)
        data["riesgo"] = _risk_level(
            coverage=data["cobertura_porcentaje"],
            failed=int(data.get("fallados") or 0),
            blocked=int(data.get("bloqueados") or 0),
            pending=int(data.get("pendientes") or 0),
            high_open_bugs=high_open_by_priority.get(key, 0),
        )
    if ai_metrics["executions"] > 0:
        confidence_count = int(ai_metrics.pop("_confidence_count", 0) or 0)
        confidence_sum = float(ai_metrics.pop("_confidence_sum", 0) or 0)
        ai_metrics["avg_confidence"] = round(confidence_sum / confidence_count, 2) if confidence_count else 0
        ai_metrics["avg_latency_ms"] = round(ai_metrics["latency_ms"] / ai_metrics["executions"]) if ai_metrics["executions"] else 0
        ai_metrics["estimated_cost"] = round(float(ai_metrics["estimated_cost"]), 6)
    return {"temporal_metrics": temporal_metrics, "build_context": build_context, "bug_traceability": bug_traceability, "qa_status": qa_status, "risk": risk, "ai_metrics": ai_metrics, "por_prioridad": por_prioridad, "open_bug_items": open_bug_items}

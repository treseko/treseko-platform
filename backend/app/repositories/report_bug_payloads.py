from .repository_context import *
from .core_settings_ai_workflow_helpers import _attachment_to_dict

def _bug_issue_snapshot_dict(bug: models.BugIssue) -> Dict[str, Any]:
    return {
        "id": str(bug.id),
        "codigo": bug.codigo,
        "titulo": _report_sanitize_text(bug.titulo, 260),
        "descripcion": _report_sanitize_text(bug.descripcion, 1200),
        "precondiciones": _report_sanitize_text(bug.precondiciones, 900),
        "pasos_reproduccion": _report_sanitize_text(bug.pasos_reproduccion, 1600),
        "datos_prueba": _report_sanitize_text(bug.datos_prueba, 900),
        "resultado_esperado": _report_sanitize_text(bug.resultado_esperado, 900),
        "resultado_obtenido": _report_sanitize_text(bug.resultado_obtenido, 1200),
        "comportamiento_actual": _report_sanitize_text(bug.comportamiento_actual, 900),
        "url_afectada": _report_sanitize_text(bug.url_afectada, 300),
        "navegador": bug.navegador,
        "dispositivo": bug.dispositivo,
        "sistema_operativo": bug.sistema_operativo,
        "ambiente_nombre": bug.ambiente_nombre,
        "version_app": bug.version_app,
        "logs_relevantes": _report_sanitize_text(bug.logs_relevantes or bug.error_tecnico, 1200),
        "notas_qa": _report_sanitize_text(bug.notas_qa, 900),
        "reproducibilidad": bug.reproducibilidad,
        "frecuencia": bug.frecuencia,
        "criticidad": bug.criticidad,
        "bloquea_release": bool(bug.bloquea_release),
        "bloquea_caso": bool(bug.bloquea_caso),
        "numero_paso": bug.numero_paso,
        "execution_mode": bug.execution_mode,
        "case_code": bug.case_code,
        "build_code": bug.build_code,
        "estado": bug.estado,
        "severidad": bug.severidad,
        "prioridad": bug.prioridad,
        "origen": bug.origen,
        "proyecto_id": str(bug.proyecto_id),
        "componente_id": str(bug.componente_id) if bug.componente_id else None,
        "build_id": str(bug.build_id) if bug.build_id else None,
        "caso_id": str(bug.caso_id) if bug.caso_id else None,
        "ejecucion_id": str(bug.ejecucion_id) if bug.ejecucion_id else None,
        "snapshot_id": str(bug.snapshot_id) if bug.snapshot_id else None,
        "external_provider": bug.external_provider,
        "external_issue_id": bug.external_issue_id,
        "created_at": bug.created_at.isoformat() if bug.created_at else None,
        "updated_at": bug.updated_at.isoformat() if bug.updated_at else None,
        "comments": [
            {
                "id": str(comment.id),
                "comentario": _report_sanitize_text(comment.comentario, 900),
                "autor_id": str(comment.autor_id) if comment.autor_id else None,
                "created_at": comment.created_at.isoformat() if comment.created_at else None,
            }
            for comment in (bug.comments or [])
        ],
        "attachments": [
            {
                "id": str(link.id),
                "tipo": link.tipo,
                "attachment": _attachment_to_dict(link.attachment) if link.attachment else None,
            }
            for link in (bug.attachments or [])
        ],
    }

REPORT_CLOSED_BUG_STATUSES = {"CERRADO", "RESUELTO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE", "CLOSED", "DONE", "RESOLVED"}

def _report_bug_is_active(value: Any) -> bool:
    return str(value or "").upper() not in REPORT_CLOSED_BUG_STATUSES

def _report_sanitize_text(value: Any, max_len: int = 420) -> str:
    text_value = str(value or "").replace("\x00", "").strip()
    text_value = re.sub(r"(?i)\bauthorization\s*:\s*(?:bearer\s+)?[^\s,;]+", "authorization=[redacted]", text_value)
    text_value = re.sub(r"(?i)(token|authorization|api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", text_value)
    text_value = re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", "[ip-redacted]", text_value)
    text_value = re.sub(r"(?i)\bhost(?:name)?\s*[:=]\s*[^\s,;]+", "host=[redacted]", text_value)
    text_value = re.sub(r"(?i)\bpid\s*[:=]\s*\d+", "pid=[redacted]", text_value)
    if len(text_value) > max_len:
        return f"{text_value[:max_len].rstrip()}..."
    return text_value

def _report_bug_group_key(bug: Dict[str, Any]) -> str:
    provider = str(bug.get("external_provider") or "").strip().lower()
    external_id = str(bug.get("external_issue_id") or "").strip().lower()
    if provider and external_id:
        return f"external:{provider}:{external_id}"
    case_id = str(bug.get("caso_id") or "").strip()
    if case_id:
        return f"case:{case_id}"
    title = re.sub(r"\s+", " ", str(bug.get("titulo") or bug.get("codigo") or "bug").strip().lower())
    return f"title:{title}"

def _report_bugs_digest(bugs: List[models.BugIssue]) -> Dict[str, Any]:
    by_status: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    for bug in bugs:
        status = str(bug.estado or "SIN_ESTADO").upper()
        severity = str(bug.severidad or "SIN_SEVERIDAD").upper()
        by_status[status] = by_status.get(status, 0) + 1
        by_severity[severity] = by_severity.get(severity, 0) + 1
    return {"total": len(bugs), "by_status": by_status, "by_severity": by_severity}

def _report_merge_bug_snapshot(summary: Dict[str, Any], detail: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(summary or {})
    merged.update({key: value for key, value in (detail or {}).items() if value not in (None, "")})
    return merged

def _report_development_bug_snapshots(
    metric_bugs: List[Dict[str, Any]],
    full_bugs: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    metric_by_id = {str(item.get("id")): item for item in metric_bugs or [] if item.get("id")}
    metric_by_code = {str(item.get("codigo")): item for item in metric_bugs or [] if item.get("codigo")}
    items: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for detail in full_bugs or []:
        if not _report_bug_is_active(detail.get("estado")):
            continue
        key = str(detail.get("id") or detail.get("codigo") or "")
        if key and key in seen:
            continue
        summary = metric_by_id.get(str(detail.get("id"))) or metric_by_code.get(str(detail.get("codigo"))) or {}
        items.append(_report_merge_bug_snapshot(summary, detail))
        if key:
            seen.add(key)
    return items

def _bug_list_items(result: Any) -> List[models.BugIssue]:
    if isinstance(result, dict):
        items = result.get("items") or []
        return list(items) if isinstance(items, list) else []
    return list(result or [])

def _report_quality_summary(metrics: Dict[str, Any], bugs: List[Dict[str, Any]]) -> Dict[str, Any]:
    qa_status = metrics.get("qa_status") or {}
    if qa_status:
        return {
            "risk": qa_status.get("risk") or "N/D",
            "decision": qa_status.get("label") or qa_status.get("state") or "N/D",
            "summary": " · ".join(qa_status.get("reasons") or []) or "Diagnóstico de calidad calculado desde métricas trazables del build.",
            "open_bugs": int((metrics.get("bug_metrics") or {}).get("open") or 0),
            "high_bugs": int((metrics.get("bug_metrics") or {}).get("high_open") or 0),
            "recommend_release": bool(qa_status.get("recommend_release")),
            "state": qa_status.get("state"),
            "reasons": qa_status.get("reasons") or [],
        }
    stats = metrics.get("stats") or {}
    failed = int(stats.get("fallados") or 0)
    blocked = int(stats.get("bloqueados") or 0)
    pending = int(stats.get("pendientes") or 0)
    coverage = float(metrics.get("cobertura_porcentaje") or 0)
    open_bugs = [bug for bug in bugs if str(bug.get("estado") or "").upper() not in REPORT_CLOSED_BUG_STATUSES]
    high_bugs = [
        bug for bug in open_bugs
        if str(bug.get("severidad") or "").upper() in {"ALTA", "CRITICA", "CRITICAL", "HIGH"}
    ]
    if blocked > 0 or high_bugs or coverage < 70:
        risk = "Alto"
        decision = "No recomendado" if failed > 0 or blocked > 0 or high_bugs else "Requiere re-ejecucion"
    elif failed > 0 or pending > 0 or coverage < 90 or open_bugs:
        risk = "Medio"
        decision = "Apto con observaciones"
    else:
        risk = "Bajo"
        decision = "Apto"
    summary = (
        f"Build con cobertura {coverage}%, {int(metrics.get('total_ejecutados') or 0)} de "
        f"{int(metrics.get('total_casos_asignados') or 0)} casos ejecutados. "
        f"Resultado: {failed} fallidas, {blocked} bloqueadas y {pending} sin ejecutar."
    )
    return {
        "risk": risk,
        "decision": decision,
        "summary": summary,
        "open_bugs": len(open_bugs),
        "high_bugs": len(high_bugs),
        "recommend_release": decision == "Apto",
        "state": decision,
        "reasons": [summary],
    }

def _report_primary_failure(case: Dict[str, Any]) -> Dict[str, Any]:
    snapshots = case.get("snapshots") or []
    relevant = [
        snap for snap in snapshots
        if str(snap.get("estado_paso") or "").upper() in {"FALLO", "BLOQUEADO"}
    ]
    snap = (relevant or snapshots[:1] or [{}])[0]
    detail = snap.get("error_log") or snap.get("comentarios") or case.get("observaciones") or ""
    return {
        "step": snap.get("numero_paso"),
        "status": snap.get("estado_paso") or case.get("estado"),
        "action": _report_sanitize_text(snap.get("accion_congelada"), 220),
        "expected": _report_sanitize_text(snap.get("resultado_esperado_congelado"), 220),
        "observed": _report_sanitize_text(detail, 360),
        "evidencias": (snap.get("evidencias") or case.get("evidencias") or [])[:3],
        "evidencia_url": snap.get("evidencia_url") or case.get("evidencia_url"),
    }

def _report_recommendation(case: Dict[str, Any], failure: Dict[str, Any]) -> str:
    status = str(case.get("estado") or failure.get("status") or "").upper()
    if status == "BLOQUEADO":
        return "Revisar precondiciones, datos o disponibilidad del entorno antes de re-ejecutar."
    if case.get("ai", {}).get("human_review_required") or case.get("review_status") == "REQUIERE_REVISION":
        return "Revisar evidencia IA, confirmar criterio esperado y marcar revision humana."
    if case.get("evidencias") or failure.get("evidencias"):
        return "Crear o asociar ticket con evidencia y validar correccion en el proximo build."
    return "Reproducir el fallo, adjuntar evidencia y asociar bug antes de cerrar el ciclo."

def _report_development_case(case: Dict[str, Any]) -> Dict[str, Any]:
    failure = _report_primary_failure(case)
    return {
        "codigo": case.get("codigo"),
        "titulo": case.get("titulo"),
        "suite_breadcrumb": case.get("suite_breadcrumb"),
        "prioridad": case.get("prioridad"),
        "estado": case.get("estado"),
        "tipo_prueba": case.get("tipo_prueba"),
        "execution_mode": case.get("execution_mode"),
        "failure": failure,
        "recommendation": _report_recommendation(case, failure),
    }

def _report_bug_tracking(bugs: List[Dict[str, Any]], build_names: Dict[str, str], current_build_id: Optional[str]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for bug in bugs:
        grouped.setdefault(_report_bug_group_key(bug), []).append(bug)
    items = []
    for group_bugs in grouped.values():
        ordered = sorted(group_bugs, key=lambda item: item.get("created_at") or "")
        latest = sorted(group_bugs, key=lambda item: item.get("updated_at") or item.get("created_at") or "")[-1]
        affected_ids = []
        for bug in ordered:
            build_id = str(bug.get("build_id") or "")
            if build_id and build_id not in affected_ids:
                affected_ids.append(build_id)
        first_build_id = affected_ids[0] if affected_ids else None
        last_build_id = affected_ids[-1] if affected_ids else None
        comments = latest.get("comments") or []
        last_comment = sorted(comments, key=lambda item: item.get("created_at") or "")[-1] if comments else None
        items.append({
            "codigo": latest.get("codigo"),
            "titulo": latest.get("titulo"),
            "severidad": latest.get("severidad"),
            "prioridad": latest.get("prioridad"),
            "estado": latest.get("estado"),
            "caso_id": latest.get("caso_id"),
            "ejecucion_id": latest.get("ejecucion_id"),
            "external_provider": latest.get("external_provider"),
            "external_issue_id": latest.get("external_issue_id"),
            "first_seen_build": build_names.get(first_build_id or "", first_build_id),
            "last_seen_build": build_names.get(last_build_id or "", last_build_id),
            "current_status": "Sigue abierto" if str(latest.get("estado") or "").upper() not in REPORT_CLOSED_BUG_STATUSES else "Resuelto",
            "affected_builds": [build_names.get(build_id, build_id) for build_id in affected_ids],
            "affects_current_build": bool(current_build_id and current_build_id in affected_ids),
            "last_comment": _report_sanitize_text((last_comment or {}).get("comentario"), 220) if last_comment else None,
            "updated_at": latest.get("updated_at") or latest.get("created_at"),
        })
    return sorted(items, key=lambda item: (item["current_status"] != "Sigue abierto", item.get("severidad") or "", item.get("codigo") or ""))

def _report_regressions(development_cases: List[Dict[str, Any]], bug_tracking: List[Dict[str, Any]], metrics: Dict[str, Any]) -> Dict[str, Any]:
    history = metrics.get("historico_versions") or []
    current_failed_titles = {case.get("titulo") for case in development_cases if case.get("titulo")}
    repeated_builds = sum(1 for item in history if int(item.get("fallados") or 0) > 0 or int(item.get("bloqueados") or 0) > 0)
    persistent_bugs = [
        item for item in bug_tracking
        if item.get("current_status") == "Sigue abierto" and len(item.get("affected_builds") or []) > 1
    ]
    return {
        "failed_cases_current": sorted(current_failed_titles),
        "builds_with_failures_in_history": repeated_builds,
        "persistent_bugs": persistent_bugs,
    }

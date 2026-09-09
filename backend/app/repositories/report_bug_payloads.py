from .repository_context import *
import hashlib
import json
from .core_settings_ai_workflow_helpers import _attachment_to_dict
from ..services.conversational_bug_context import (
    infer_bug_is_conversational,
    resolve_bug_conversational_context,
)
from ..services.api_bug_context import resolve_bug_api_context
from ..services.api_evidence_policy import public_test_data_evidence_enabled

def _bug_issue_snapshot_dict(bug: models.BugIssue) -> Dict[str, Any]:
    metadata = bug.metadata_json if isinstance(getattr(bug, "metadata_json", None), dict) else {}
    evidence_policy = metadata.get("evidence_policy") if isinstance(metadata.get("evidence_policy"), dict) else {}
    context_type = str(getattr(bug, "tipo_contexto", None) or "CLASICO").upper()
    # Bugs created by older API flows may predate the explicit column. Keep
    # those snapshots on the API report path when their frozen metadata or
    # stable case code identifies the format; otherwise they incorrectly use
    # the classic renderer and every API field appears as N/D.
    metadata_format = str(metadata.get("format") or metadata.get("formato_prueba") or "").upper()
    case_code = str(getattr(bug, "case_code", None) or "").upper()
    if context_type == "CLASICO" and (metadata_format == "API" or case_code.startswith("TC-API-")):
        context_type = "API"
    public_test_data_evidence = (
        context_type in {"API", "CLASICO", "CONVERSACIONAL"}
        and public_test_data_evidence_enabled(metadata=metadata)
    )
    text = lambda value, max_len: _report_sanitize_text(value, max_len, redact=not public_test_data_evidence)

    # API execution evidence is normally resolved from the persisted
    # EjecucionCaso below. These fields are intentionally kept in the frozen
    # bug snapshot as a safe fallback for legacy executions whose run or
    # execution row is no longer available. Do not copy the complete metadata
    # blob: it can contain internal implementation details unrelated to
    # reproducing the request.
    api_variables = metadata.get("api_variables_used") if isinstance(metadata.get("api_variables_used"), dict) else {}
    safe_api_variables = {
        str(name): (
            value
            if public_test_data_evidence and isinstance(value, (dict, list, int, float, bool))
            else value
            if public_test_data_evidence
            else "[REDACTADO]"
            if re.search(r"(?i)token|secret|password|passwd|authorization|api[-_]?key|cookie", str(name))
            else _report_sanitize_text(value, 1200, redact=True)
        )
        for name, value in list(api_variables.items())[:100]
    }
    linked_execution_occurrences = metadata.get("linked_execution_occurrences")
    if not isinstance(linked_execution_occurrences, list):
        linked_execution_occurrences = []
    return {
        "id": str(bug.id),
        "codigo": bug.codigo,
        "titulo": text(bug.titulo, 260),
        "descripcion": text(bug.descripcion, 1200),
        "precondiciones": text(bug.precondiciones, 900),
        "pasos_reproduccion": text(bug.pasos_reproduccion, 1600),
        "datos_prueba": text(bug.datos_prueba, 900),
        "resultado_esperado": text(bug.resultado_esperado, 900),
        "resultado_obtenido": text(bug.resultado_obtenido, 1200),
        "comportamiento_actual": text(bug.comportamiento_actual, 900),
        "url_afectada": text(bug.url_afectada, 300),
        "navegador": text(bug.navegador, 180),
        "dispositivo": text(bug.dispositivo, 180),
        "resolucion": text(getattr(bug, "resolucion", None), 120),
        "sistema_operativo": text(bug.sistema_operativo, 180),
        "ambiente_nombre": text(bug.ambiente_nombre, 220),
        "ambiente_url": text(getattr(bug, "ambiente_url", None), 500),
        "entorno_id": str(getattr(bug, "entorno_id", None)) if getattr(bug, "entorno_id", None) else None,
        "dataset_id": str(getattr(bug, "dataset_id", None)) if getattr(bug, "dataset_id", None) else None,
        "dataset_name": text(metadata.get("dataset_name"), 220),
        "asignado_a": str(getattr(bug, "asignado_a", None)) if getattr(bug, "asignado_a", None) else None,
        "resolved_build_id": str(getattr(bug, "resolved_build_id", None)) if getattr(bug, "resolved_build_id", None) else None,
        "build_corregido_id": str(getattr(bug, "resolved_build_id", None)) if getattr(bug, "resolved_build_id", None) else None,
        "version_app": text(bug.version_app, 160),
        "logs_relevantes": text(bug.logs_relevantes or bug.error_tecnico, 1200),
        "error_tecnico": text(bug.error_tecnico, 1400),
        "stack_trace": text(getattr(bug, "stack_trace", None), 6000),
        "notas_qa": text(bug.notas_qa, 900),
        "postcondiciones": text(metadata.get("case_postconditions"), 900),
        "impacto_negocio": text(getattr(bug, "impacto_negocio", None), 900),
        "modulo_funcional": text(getattr(bug, "modulo_funcional", None), 220),
        "frecuencia": text(getattr(bug, "frecuencia", None), 120),
        "resolucion_bug": text(getattr(bug, "resolucion", None), 1200),
        "motivo_cierre": text(getattr(bug, "motivo_cierre", None), 900),
        "api_evidence_policy": evidence_policy,
        "evidence_policy": evidence_policy,
        "public_test_data": public_test_data_evidence,
        "reproducibilidad": bug.reproducibilidad,
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
        "test_run_id": str(getattr(bug, "test_run_id", None)) if getattr(bug, "test_run_id", None) else None,
        "ejecucion_id": str(bug.ejecucion_id) if bug.ejecucion_id else None,
        "tipo_contexto": context_type,
        "api_variables_used": safe_api_variables if context_type == "API" else {},
        "api_dynamic_variables": metadata.get("api_dynamic_variables") if context_type == "API" and public_test_data_evidence else {},
        "api_evidence_schema": metadata.get("api_evidence_schema") if context_type == "API" else None,
        "api_evidence_sha256": metadata.get("api_evidence_sha256") if context_type == "API" else None,
        "api_assertions_count": metadata.get("api_assertions_count") if context_type == "API" else None,
        "chatbot_turn_index": getattr(bug, "chatbot_turn_index", None),
        "chatbot_finding_type": getattr(bug, "chatbot_finding_type", None),
        "snapshot_id": str(getattr(bug, "snapshot_id", None)) if getattr(bug, "snapshot_id", None) else None,
        "external_provider": getattr(bug, "external_provider", None),
        "external_issue_id": getattr(bug, "external_issue_id", None),
        "external_issue_url": getattr(bug, "external_issue_url", None),
        "case_title": text(metadata.get("case_title") or bug.titulo, 300),
        "component_name": text(metadata.get("component_name"), 220),
        "component_code": text(metadata.get("component_code"), 120),
        "linked_execution_occurrences": [dict(item) for item in linked_execution_occurrences if isinstance(item, dict)],
        "created_at": getattr(bug, "created_at", None).isoformat() if getattr(bug, "created_at", None) else None,
        "updated_at": getattr(bug, "updated_at", None).isoformat() if getattr(bug, "updated_at", None) else None,
        "comments": [
            {
                "id": str(comment.id),
                "comentario": text(comment.comentario, 900),
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
        "case_snapshot": {
            "code": bug.case_code or metadata.get("case_code"),
            "title": text(metadata.get("case_title") or bug.titulo, 300),
            "version": text(metadata.get("case_version"), 120),
            "description": text(metadata.get("case_description") or bug.descripcion, 1200),
            "preconditions": text(metadata.get("case_preconditions") or bug.precondiciones, 900),
            "postconditions": text(metadata.get("case_postconditions") or metadata.get("postcondiciones"), 900),
        },
    }


def _conversational_context_snapshot(context: Any) -> Dict[str, Any] | None:
    """Convert the persisted or reconstructed context to report JSON."""
    if not context:
        return None
    if isinstance(context, dict):
        return context
    return {
        "schema_version": getattr(context, "schema_version", 1),
        "evidence_policy": getattr(context, "evidence_policy", {}) or {},
        "case_snapshot": getattr(context, "case_snapshot", {}) or {},
        "execution_snapshot": getattr(context, "execution_snapshot", {}) or {},
        "conversation_turns": getattr(context, "conversation_turns", []) or [],
        "evaluation": getattr(context, "evaluation", {}) or {},
        "technical_evidence": getattr(context, "technical_evidence", {}) or {},
        "evidence_refs": getattr(context, "evidence_refs", []) or [],
        "evidence_sha256": getattr(context, "evidence_sha256", None),
    }


async def _enrich_conversational_bug_snapshots(
    db: AsyncSession,
    snapshots: List[Dict[str, Any]],
    bugs_by_id: Dict[str, models.BugIssue],
) -> List[Dict[str, Any]]:
    """Attach readable Chatbot evidence while leaving classic snapshots intact."""
    for snapshot in snapshots:
        bug = bugs_by_id.get(str(snapshot.get("id")))
        if not bug:
            continue

        # Older bugs were created before tipo_contexto/contexto conversacional
        # existed.  Do not require a migration to make their reports readable:
        # the case format is the authoritative signal for this classification.
        is_conversational = (
            str(snapshot.get("tipo_contexto") or "CLASICO").upper() == "CONVERSACIONAL"
            or await infer_bug_is_conversational(db, bug)
        )
        if not is_conversational:
            continue
        snapshot["tipo_contexto"] = "CONVERSACIONAL"
        context = _conversational_context_snapshot(await resolve_bug_conversational_context(db, bug))
        if not context:
            continue
        if not context.get("evidence_policy"):
            metadata = bug.metadata_json if isinstance(getattr(bug, "metadata_json", None), dict) else {}
            context["evidence_policy"] = metadata.get("evidence_policy") or {}
        snapshot["conversational_context"] = context
        snapshot["conversation_turns"] = context.get("conversation_turns") or []
        snapshot["chatbot_evaluation"] = context.get("evaluation") or {}
        snapshot["chatbot_technical_evidence"] = context.get("technical_evidence") or {}
    return snapshots


async def _enrich_api_bug_snapshots(
    db: AsyncSession,
    snapshots: List[Dict[str, Any]],
    bugs_by_id: Dict[str, models.BugIssue],
) -> List[Dict[str, Any]]:
    """Attach safe, frozen API execution evidence to shared report snapshots."""
    for snapshot in snapshots:
        bug = bugs_by_id.get(str(snapshot.get("id")))
        if not bug:
            continue
        context = await resolve_bug_api_context(db, bug)
        if not context:
            continue
        snapshot["tipo_contexto"] = "API"
        snapshot["api_context"] = context
    return snapshots

REPORT_CLOSED_BUG_STATUSES = {"CERRADO", "RESUELTO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE", "CLOSED", "DONE", "RESOLVED"}

def _report_bug_is_active(value: Any) -> bool:
    return str(value or "").upper() not in REPORT_CLOSED_BUG_STATUSES

def _report_sanitize_text(value: Any, max_len: int = 420, *, redact: bool = True) -> str:
    text_value = str(value or "").replace("\x00", "").strip()
    if not redact:
        return f"{text_value[:max_len].rstrip()}..." if len(text_value) > max_len else text_value
    text_value = re.sub(r"(?i)\bauthorization\s*:\s*(?:bearer\s+)?[^\s,;]+", "authorization=[redacted]", text_value)
    text_value = re.sub(r"(?i)(token|authorization|api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", text_value)
    text_value = re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", "[ip-redacted]", text_value)
    text_value = re.sub(r"(?i)\bhost(?:name)?\s*[:=]\s*[^\s,;]+", "host=[redacted]", text_value)
    text_value = re.sub(r"(?i)\bpid\s*[:=]\s*\d+", "pid=[redacted]", text_value)
    if len(text_value) > max_len:
        return f"{text_value[:max_len].rstrip()}..."
    return text_value

def _report_bug_group_key(bug: Dict[str, Any]) -> str:
    # A case or title is not a bug identity: two defects can intentionally be
    # reported for the same occurrence. Prefer the immutable local identity,
    # then an explicit external link only for legacy records without one.
    bug_id = str(bug.get("id") or bug.get("bug_id") or "").strip()
    if bug_id:
        return f"bug:{bug_id}"
    provider = str(bug.get("external_provider") or "").strip().lower()
    external_id = str(bug.get("external_issue_id") or "").strip().lower()
    if provider and external_id:
        return f"external:{provider}:{external_id}"
    code = str(bug.get("codigo") or "").strip()
    if code:
        return f"bug-code:{code}"
    occurrence_key = ":".join(
        str(bug.get(field) or "").strip()
        for field in ("ejecucion_id", "snapshot_id", "chatbot_turn_index", "chatbot_finding_type")
    )
    if occurrence_key.strip(":"):
        return f"occurrence:{occurrence_key}"
    # Keep otherwise unidentifiable records separate in this in-memory report;
    # never collapse them by case, title, or symptom text.
    return f"unidentified:{id(bug)}"

def _report_bugs_digest(bugs: List[models.BugIssue]) -> Dict[str, Any]:
    by_status: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    fingerprints = []
    for bug in bugs:
        status = str(bug.estado or "SIN_ESTADO").upper()
        severity = str(bug.severidad or "SIN_SEVERIDAD").upper()
        by_status[status] = by_status.get(status, 0) + 1
        by_severity[severity] = by_severity.get(severity, 0) + 1
        metadata = bug.metadata_json if isinstance(getattr(bug, "metadata_json", None), dict) else {}
        fingerprints.append({
            "id": str(bug.id),
            "updated_at": bug.updated_at.isoformat() if getattr(bug, "updated_at", None) else None,
            "status": status,
            "severity": severity,
            "title": bug.titulo,
            "description": bug.descripcion,
            "preconditions": bug.precondiciones,
            "expected": bug.resultado_esperado,
            "obtained": bug.resultado_obtenido,
            "execution_id": str(bug.ejecucion_id) if bug.ejecucion_id else None,
            "evidence_policy": metadata.get("evidence_policy"),
            "evidence_hash": metadata.get("api_evidence_sha256"),
        })
    fingerprints.sort(key=lambda item: item["id"])
    digest = hashlib.sha256(json.dumps(fingerprints, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")).hexdigest()
    return {"total": len(bugs), "by_status": by_status, "by_severity": by_severity, "content_sha256": digest}

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

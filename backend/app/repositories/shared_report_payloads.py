from .legacy_common import *
import html


REPORT_SETTINGS_VERSION = "project-report-settings-v1"

DEFAULT_PROJECT_REPORT_SETTINGS: Dict[str, Any] = {
    "version": REPORT_SETTINGS_VERSION,
    "executive": {
        "sections": {
            "summary": True,
            "kpis": True,
            "risks": True,
            "trend": True,
            "findings": True,
        }
    },
    "development": {
        "sections": {
            "summary": True,
            "distribution": True,
            "failures": True,
            "bugs": True,
            "bug_details": True,
            "bug_tracking": True,
            "regressions": True,
            "actions": True,
        }
    },
    "internal": {
        "sections": {
            "summary": True,
            "distribution": True,
            "integrity": True,
            "temporal": True,
            "traceability": True,
            "trend": True,
            "failures": True,
            "failed_steps": True,
            "bugs": True,
            "evidence": True,
            "bug_tracking": True,
            "cases": True,
        }
    },
}

def normalize_project_report_settings(value: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    normalized = json.loads(json.dumps(DEFAULT_PROJECT_REPORT_SETTINGS, sort_keys=True, default=str, ensure_ascii=False))
    normalized["version"] = str(raw.get("version") or REPORT_SETTINGS_VERSION)
    for report_type in ("executive", "development", "internal"):
        incoming = raw.get(report_type) if isinstance(raw.get(report_type), dict) else {}
        incoming_sections = incoming.get("sections") if isinstance(incoming.get("sections"), dict) else {}
        normalized[report_type]["sections"].update({
            key: bool(value)
            for key, value in incoming_sections.items()
            if key in normalized[report_type]["sections"]
        })
    return normalized

async def get_project_report_settings(db: AsyncSession, proyecto_id: UUID) -> Optional[Dict[str, Any]]:
    project = (await db.execute(select(models.Proyecto).filter(models.Proyecto.id == proyecto_id))).scalar_one_or_none()
    if not project:
        return None
    return normalize_project_report_settings(project.report_settings or {})

async def update_project_report_settings(db: AsyncSession, proyecto_id: UUID, settings: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    project = (await db.execute(select(models.Proyecto).filter(models.Proyecto.id == proyecto_id))).scalar_one_or_none()
    if not project:
        return None
    project.report_settings = normalize_project_report_settings(settings)
    await db.commit()
    await db.refresh(project)
    return normalize_project_report_settings(project.report_settings or {})

def _report_metrics_fingerprint(metrics: Dict[str, Any], report_type: str = "executive", bugs_digest: Optional[Dict[str, Any]] = None) -> str:
    comparable = {
        "report_type": report_type or "executive",
        "build_id": metrics.get("build_id"),
        "total_casos_asignados": metrics.get("total_casos_asignados"),
        "total_ejecutados": metrics.get("total_ejecutados"),
        "cobertura_porcentaje": metrics.get("cobertura_porcentaje"),
        "stats": metrics.get("stats") or {},
        "por_tipo_ejecucion": metrics.get("por_tipo_ejecucion") or {},
        "por_prioridad": metrics.get("por_prioridad") or {},
        "bugs": bugs_digest or {},
    }
    raw = json.dumps(comparable, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

REPORT_SNAPSHOT_BUNDLE_VERSION = "qa-report-bundle-v2"
REPORT_BUNDLE_TYPES = ("executive", "development", "internal")

REPORT_BUNDLE_VOLATILE_KEYS = {
    "avg_bug_open_hours",
    "avg_open_hours",
    "days_without_activity",
    "elapsed_since_build_creation_hours",
    "estimated_remaining_seconds",
    "oldest_open_bug",
    "qa_cycle_hours",
    "time_since_detection_hours",
}

REPORT_BUNDLE_STABLE_TEMPORAL_KEYS = {
    "average_seconds_per_executed_case",
    "build_to_first_execution_hours",
    "executions_by_day",
    "first_to_last_execution_hours",
    "last_activity_at",
    "total_execution_seconds",
}

def _report_stable_fingerprint_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _report_stable_fingerprint_value(item)
            for key, item in value.items()
            if key not in REPORT_BUNDLE_VOLATILE_KEYS
        }
    if isinstance(value, list):
        return [_report_stable_fingerprint_value(item) for item in value]
    return value

def _report_stable_temporal_metrics(metrics: Dict[str, Any]) -> Dict[str, Any]:
    temporal = metrics.get("temporal_metrics") if isinstance(metrics.get("temporal_metrics"), dict) else {}
    return {
        key: _report_stable_fingerprint_value(temporal.get(key))
        for key in REPORT_BUNDLE_STABLE_TEMPORAL_KEYS
        if key in temporal
    }

def _report_bug_snapshot_digest(bugs: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_status: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    for bug in bugs or []:
        if not isinstance(bug, dict):
            continue
        status = str(bug.get("estado") or "SIN_ESTADO").upper()
        severity = str(bug.get("severidad") or "SIN_SEVERIDAD").upper()
        by_status[status] = by_status.get(status, 0) + 1
        by_severity[severity] = by_severity.get(severity, 0) + 1
    return {"total": len([bug for bug in bugs or [] if isinstance(bug, dict)]), "by_status": by_status, "by_severity": by_severity}

def _report_bundle_fingerprint(metrics: Dict[str, Any], bugs_digest: Optional[Dict[str, Any]] = None, report_settings: Optional[Dict[str, Any]] = None) -> str:
    comparable = {
        "snapshot_bundle_version": REPORT_SNAPSHOT_BUNDLE_VERSION,
        "build_id": metrics.get("build_id"),
        "total_casos_asignados": metrics.get("total_casos_asignados"),
        "total_ejecutados": metrics.get("total_ejecutados"),
        "cobertura_porcentaje": metrics.get("cobertura_porcentaje"),
        "stats": metrics.get("stats") or {},
        "por_tipo_ejecucion": metrics.get("por_tipo_ejecucion") or {},
        "por_prioridad": metrics.get("por_prioridad") or {},
        "por_suite_tree": _report_stable_fingerprint_value(metrics.get("por_suite_tree") or []),
        "qa_status": metrics.get("qa_status") or {},
        "temporal_metrics": _report_stable_temporal_metrics(metrics),
        "bug_metrics": _report_stable_fingerprint_value(metrics.get("bug_metrics") or {}),
        "bug_traceability": _report_stable_fingerprint_value(metrics.get("bug_traceability") or {}),
        "failures_and_blockers": _report_stable_fingerprint_value(metrics.get("failures_and_blockers") or []),
        "evidence_summary": metrics.get("evidence_summary") or {},
        "comparison": _report_stable_fingerprint_value(metrics.get("comparison") or {}),
        "bugs": bugs_digest or {},
        "report_settings": normalize_project_report_settings(report_settings or {}),
    }
    raw = json.dumps(comparable, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def _shared_report_payload_bundle_hash(payload: Dict[str, Any]) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}
    if not metrics:
        return None
    return _report_bundle_fingerprint(
        metrics,
        _report_bug_snapshot_digest(payload.get("bugs") or []),
        payload.get("report_settings") if isinstance(payload.get("report_settings"), dict) else {},
    )

def _legacy_report_metrics_fingerprint(metrics: Dict[str, Any]) -> str:
    comparable = {
        "build_id": metrics.get("build_id"),
        "total_casos_asignados": metrics.get("total_casos_asignados"),
        "total_ejecutados": metrics.get("total_ejecutados"),
        "cobertura_porcentaje": metrics.get("cobertura_porcentaje"),
        "stats": metrics.get("stats") or {},
        "por_tipo_ejecucion": metrics.get("por_tipo_ejecucion") or {},
        "por_prioridad": metrics.get("por_prioridad") or {},
    }
    raw = json.dumps(comparable, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def _short_report_slug(value: Optional[str], fallback: str, max_len: int = 8) -> str:
    source = str(value or fallback).strip().lower()
    source = re.sub(r"[^a-z0-9]+", "-", source).strip("-")
    source = re.sub(r"-+", "-", source)
    return (source or fallback)[:max_len].strip("-") or fallback

def _short_report_token(
    project: models.Proyecto,
    component: Optional[models.Componente],
    build: Optional[models.Build],
    metrics_hash: str,
) -> str:
    project_part = _short_report_slug(project.codigo or project.nombre, "proy", 8)
    component_part = _short_report_slug(
        (component.codigo or component.nombre) if component else None,
        "gen",
        6,
    )
    build_part = _short_report_slug(
        (build.codigo or build.nombre) if build else None,
        "build",
        8,
    )
    revision_mark = (metrics_hash or "x")[:2]
    secret = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8]
    return f"{project_part}-{component_part}-{build_part}-{revision_mark}{secret}"

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

def _shared_report_thumbnail_svg(payload: Dict[str, Any]) -> str:
    meta = payload.get("metadata") or {}
    metrics = payload.get("metrics") or {}
    stats = metrics.get("stats") or {}
    proyecto = html.escape(str(meta.get("proyecto") or "Proyecto QA")[:48], quote=False)
    build = html.escape(str(meta.get("build") or "Build activa")[:40], quote=False)
    pasados = int(stats.get("pasados") or 0)
    fallados = int(stats.get("fallados") or 0)
    bloqueados = int(stats.get("bloqueados") or 0)
    cobertura = metrics.get("cobertura_porcentaje") or 0
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0f172a"/>
  <rect x="48" y="48" width="1104" height="534" rx="28" fill="#ffffff"/>
  <text x="92" y="125" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#0f172a">{proyecto}</text>
  <text x="92" y="175" font-family="Arial, sans-serif" font-size="26" fill="#475569">{build}</text>
  <text x="92" y="260" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#334155">Snapshot de calidad</text>
  <rect x="92" y="315" width="280" height="140" rx="18" fill="#dcfce7"/>
  <text x="122" y="370" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#166534">PASADAS</text>
  <text x="122" y="430" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#15803d">{pasados}</text>
  <rect x="420" y="315" width="280" height="140" rx="18" fill="#fee2e2"/>
  <text x="450" y="370" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#991b1b">FALLIDAS</text>
  <text x="450" y="430" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#dc2626">{fallados}</text>
  <rect x="748" y="315" width="280" height="140" rx="18" fill="#dbeafe"/>
  <text x="778" y="370" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#1e3a8a">BLOQUEADAS</text>
  <text x="778" y="430" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="#2563eb">{bloqueados}</text>
  <text x="92" y="535" font-family="Arial, sans-serif" font-size="24" fill="#475569">Cobertura: {cobertura}%</text>
</svg>"""

def _shared_report_metadata(snapshot: models.SharedReportSnapshot) -> Dict[str, Any]:
    payload = snapshot.payload or {}
    metadata = payload.get("metadata") or {}
    return metadata if isinstance(metadata, dict) else {}

def _shared_report_group_id(snapshot: models.SharedReportSnapshot) -> str:
    metadata = _shared_report_metadata(snapshot)
    return str(metadata.get("snapshot_group_id") or f"legacy:{snapshot.id}")

def _shared_report_type(snapshot: models.SharedReportSnapshot) -> str:
    metadata = _shared_report_metadata(snapshot)
    report_type = str(metadata.get("report_type") or "executive").lower()
    return report_type if report_type in set(REPORT_BUNDLE_TYPES) else "executive"

def _derive_report_payload(base_payload: Dict[str, Any], report_type: str) -> Dict[str, Any]:
    derived = json.loads(json.dumps(base_payload, sort_keys=True, default=str, ensure_ascii=False))
    metadata = derived.setdefault("metadata", {})
    metadata["report_type"] = report_type
    if report_type == "executive":
        derived["development"] = {}
        derived["internal"] = {}
    elif report_type == "development":
        derived["internal"] = {}
    else:
        derived["internal"] = {
            "cases": _flatten_report_suite_cases(derived.get("metrics", {}).get("por_suite_tree") or []),
            "notes": "Vista interna autenticada con detalle operativo del snapshot.",
        }
    return derived

def _flatten_report_suite_cases(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cases: List[Dict[str, Any]] = []
    stack = list(nodes or [])
    while stack:
        current = stack.pop()
        cases.extend(current.get("casos") or [])
        stack.extend(current.get("children") or [])
    return cases

async def _find_active_shared_report_bundle(
    db: AsyncSession,
    proyecto_id: UUID,
    build_id: Optional[UUID],
    componente_id: Optional[UUID],
    metrics_hash: str,
    manual_definition: Optional[Dict[str, Any]] = None,
) -> Optional[List[models.SharedReportSnapshot]]:
    query = (
        select(models.SharedReportSnapshot)
        .filter(models.SharedReportSnapshot.proyecto_id == proyecto_id)
        .filter(models.SharedReportSnapshot.build_id == build_id)
        .filter(models.SharedReportSnapshot.componente_id == componente_id)
        .filter(models.SharedReportSnapshot.metrics_hash == metrics_hash)
        .filter(models.SharedReportSnapshot.activo == True)  # noqa: E712
        .order_by(models.SharedReportSnapshot.created_at.desc())
    )
    result = await db.execute(query)
    snapshots = result.scalars().all()
    groups: Dict[str, List[models.SharedReportSnapshot]] = {}
    for snapshot in snapshots:
        group_id = _shared_report_group_id(snapshot)
        if group_id.startswith("legacy:"):
            continue
        groups.setdefault(group_id, []).append(snapshot)
    for group_snapshots in groups.values():
        report_types = {_shared_report_type(snapshot) for snapshot in group_snapshots}
        if not set(REPORT_BUNDLE_TYPES).issubset(report_types):
            continue
        if manual_definition:
            first_payload = group_snapshots[0].payload or {}
            first_manual = first_payload.get("manual_definition") or (first_payload.get("metadata") or {})
            same_definition = (
                str(first_manual.get("build_definition") or "") == str(manual_definition.get("build_definition") or "")
                and str(first_manual.get("qa_comment") or "") == str(manual_definition.get("qa_comment") or "")
                and str(first_manual.get("requested_report_type") or "") == str(manual_definition.get("requested_report_type") or "")
            )
            if not same_definition:
                continue
        return sorted(group_snapshots, key=lambda item: item.created_at)
    return None

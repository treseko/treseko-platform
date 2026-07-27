from .repository_context import *


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

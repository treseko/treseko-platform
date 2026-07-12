from .legacy_common import *
import logging
from zoneinfo import ZoneInfo

from ..services.error_sanitizer import sanitize_external_error


logger = logging.getLogger(__name__)
LEGACY_AI_ENGINE_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _build_evaluation_window(build: Optional[models.Build]):
    if not build:
        return None
    now = utc_now()
    start = ensure_utc(build.fecha_inicio)
    end = ensure_utc(build.fecha_fin)
    status = "sin_fechas"
    total_days = elapsed_days = remaining_days = None
    progress = None
    if start and end:
        total_seconds = max(0, (end - start).total_seconds())
        elapsed_seconds = min(max(0, (now - start).total_seconds()), total_seconds)
        remaining_seconds = max(0, (end - now).total_seconds())
        total_days = int(total_seconds // 86400) + (1 if total_seconds % 86400 else 0)
        elapsed_days = int(elapsed_seconds // 86400)
        remaining_days = int(remaining_seconds // 86400) + (1 if remaining_seconds % 86400 else 0)
        progress = round((elapsed_seconds / total_seconds) * 100, 2) if total_seconds else 100
        if now < start:
            status = "no_iniciada"
        elif now > end:
            status = "vencida"
            progress = 100
            remaining_days = 0
        else:
            status = "en_curso"
    elif start and now < start:
        status = "no_iniciada"
    elif end and now > end:
        status = "vencida"
    elif start or end:
        status = "en_curso"
    return {
        "build_id": str(build.id),
        "build_name": build.nombre,
        "fecha_inicio": isoformat_utc(start),
        "fecha_fin": isoformat_utc(end),
        "status": status,
        "total_days": total_days,
        "elapsed_days": elapsed_days,
        "remaining_days": remaining_days,
        "progress_percent": progress,
    }

async def get_dashboard_summary(
    db: AsyncSession,
    proyecto_id: UUID,
    current_user: models.Usuario,
    build_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
):
    metrics = await get_project_metrics(db, proyecto_id=proyecto_id, build_id=build_id, component_id=component_id)
    target_build_id = build_id or (UUID(metrics["build_id"]) if metrics.get("build_id") else None)
    build = None
    if target_build_id:
        build = (await db.execute(select(models.Build).filter(models.Build.id == target_build_id))).scalar_one_or_none()

    query = (
        select(models.EjecucionCaso, models.TestRun, models.CasoPrueba)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .filter(models.TestRun.proyecto_id == proyecto_id, *_visible_case_filter())
    )
    if target_build_id:
        query = query.filter(models.TestRun.build_id == target_build_id)
    if component_id:
        query = query.filter(models.CasoPrueba.componente_id == component_id)
    if date_from:
        query = query.filter(models.EjecucionCaso.fecha_ejecucion >= ensure_utc(date_from))
    if date_to:
        query = query.filter(models.EjecucionCaso.fecha_ejecucion <= ensure_utc(date_to))
    result = await db.execute(query.order_by(models.EjecucionCaso.fecha_ejecucion.desc()))
    rows = result.all()
    time_settings = await config_service.get_system_time_settings(db)
    system_timezone = ZoneInfo(time_settings["timezone"])

    def _is_pending_execution(row: Any) -> bool:
        status = row[0].estado_resultado
        status_value = status.value if hasattr(status, "value") else status
        return status_value == "SIN_CORRER"

    today_local_start = utc_now().astimezone(system_timezone).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = today_local_start.astimezone(timezone.utc)
    today_end = (today_local_start + timedelta(days=1)).astimezone(timezone.utc)
    executed_rows = [row for row in rows if not _is_pending_execution(row)]
    pending_rows = [row for row in rows if _is_pending_execution(row)]
    rows_today = [
        row for row in rows
        if row[0].fecha_ejecucion
        and ensure_utc(row[0].fecha_ejecucion) >= today_start
        and ensure_utc(row[0].fecha_ejecucion) < today_end
    ]
    executions_today = [row for row in rows_today if not _is_pending_execution(row)]
    pending_today = [row for row in rows_today if _is_pending_execution(row)]
    my_tests_today = [
        row for row in executions_today
        if row[0].ejecutado_por == current_user.id
    ]
    my_pending_today = [
        row for row in pending_today
        if row[0].ejecutado_por == current_user.id
    ]
    status_counts = {"PASO": 0, "FALLO": 0, "BLOQUEADO": 0, "SIN_CORRER": 0}
    executions_by_type = {"manual": 0, "automatizada": 0, "ia": 0, "externa": 0}
    durations = []
    recent = []
    failed_recent = []
    for execution, run, case in rows:
        status_value = execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else execution.estado_resultado
        status_counts[status_value] = status_counts.get(status_value, 0) + 1
    for execution, run, case in executed_rows:
        status_value = execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else execution.estado_resultado
        if execution.duracion_segundos is not None:
            durations.append(max(0, int(execution.duracion_segundos or 0)))
        origin = str(run.origen or "").upper()
        if origin in {"IA", "AUTOMATIZADA_AI"}:
            executions_by_type["ia"] += 1
        elif origin in {"AUTOMATIZADA", "AUTOMATIZADA_WORKER"}:
            executions_by_type["automatizada"] += 1
        elif origin in {"EXTERNAL_API", "EXTERNA"}:
            executions_by_type["externa"] += 1
        else:
            executions_by_type["manual"] += 1
        item = {
            "execution_id": str(execution.id),
            "run_id": str(run.id),
            "run_name": run.nombre,
            "case_id": str(case.id),
            "case_code": case.codigo or str(case.id)[:8].upper(),
            "case_title": case.titulo,
            "status": status_value,
            "duration_seconds": execution.duracion_segundos or 0,
            "executed_at": execution.fecha_ejecucion.isoformat() if execution.fecha_ejecucion else None,
            "origin": run.origen,
            "observations": execution.observaciones,
        }
        if len(recent) < 10:
            recent.append(item)
        if status_value in {"FALLO", "BLOQUEADO"} and len(failed_recent) < 10:
            failed_recent.append(item)

    bugs = _bug_list_items(await list_project_bugs(db, proyecto_id))
    if target_build_id:
        bugs = [bug for bug in bugs if not bug.build_id or bug.build_id == target_build_id]
    if component_id:
        bugs = [bug for bug in bugs if not bug.componente_id or bug.componente_id == component_id]
    open_bugs = [bug for bug in bugs if bug.estado not in {"CERRADO", "RESUELTO"}]
    bugs_by_status: Dict[str, int] = {}
    bugs_by_severity: Dict[str, int] = {}
    for bug in open_bugs:
        bugs_by_status[bug.estado] = bugs_by_status.get(bug.estado, 0) + 1
        bugs_by_severity[bug.severidad] = bugs_by_severity.get(bug.severidad, 0) + 1

    return {
        "filters": {
            "proyecto_id": str(proyecto_id),
            "build_id": str(target_build_id) if target_build_id else None,
            "component_id": str(component_id) if component_id else None,
            "date_from": isoformat_utc(date_from),
            "date_to": isoformat_utc(date_to),
            "timezone": time_settings["timezone"],
            "today_start": isoformat_utc(today_start),
            "today_end": isoformat_utc(today_end),
        },
        "available_widgets": [
            "quality_summary",
            "my_tests_today",
            "build_executions",
            "recent_executions",
            "build_window",
            "trend_by_build",
            "open_bugs",
            "average_duration",
            "execution_type_distribution",
            "recent_failed_cases",
        ],
        "quality_summary": metrics.get("stats") or {},
        "project_metrics": metrics,
        "my_tests_today": {
            "count": len(my_tests_today),
            "mine": len(my_tests_today),
            "pending": len(my_pending_today),
        },
        "executions_today": {
            "count": len(executions_today),
            "mine": len(my_tests_today),
            "pending": len(pending_today),
        },
        "build_executions": {
            "count": len(executed_rows),
            "pending": len(pending_rows),
            "total_records": len(rows),
            "status_counts": status_counts,
        },
        "recent_executions": recent,
        "build_window": _build_evaluation_window(build),
        "trend_by_build": metrics.get("historico_versions") or [],
        "open_bugs": {
            "total": len(open_bugs),
            "by_status": bugs_by_status,
            "by_severity": bugs_by_severity,
            "items": [
                {
                    "id": str(bug.id),
                    "code": bug.codigo,
                    "title": bug.titulo,
                    "severity": bug.severidad,
                    "status": bug.estado,
                    "external_provider": bug.external_provider,
                    "external_issue_id": bug.external_issue_id,
                }
                for bug in open_bugs[:10]
            ],
        },
        "average_duration": {
            "seconds": round(sum(durations) / len(durations), 2) if durations else 0,
            "sample_size": len(durations),
        },
        "execution_type_distribution": executions_by_type,
        "recent_failed_cases": failed_recent,
    }

# --- IA ENGINE ---
AI_BASE_URL_KEYS = (
    "base_url",
    "BASE_URL",
    "url",
    "URL",
    "web_url",
    "WEB_URL",
    "URL_BASE",
    "ENV.BASE_URL",
    "ENV.URL_BASE",
    "ENV.URL",
)
AI_URL_RE = re.compile(r"(https?://[^\s\"'<>),;]+|www\.[^\s\"'<>),;]+)", re.IGNORECASE)

def _normalize_ai_url(value: Any) -> Optional[str]:
    raw = str(value or "").strip().rstrip("./")
    if not raw:
        return None
    match = AI_URL_RE.search(raw)
    candidate = match.group(0).rstrip("./") if match else raw
    if candidate.lower().startswith("www."):
        return f"https://{candidate}"
    if candidate.lower().startswith(("http://", "https://")):
        return candidate
    return None

def _snapshot_value(snapshot: Any, key: str, default: Any = None) -> Any:
    if isinstance(snapshot, dict):
        return snapshot.get(key, default)
    return getattr(snapshot, key, default)

def _snapshot_step_number(snapshot: Any) -> Optional[int]:
    value = _snapshot_value(snapshot, "numero_paso")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None

def _snapshot_id(snapshot: Any) -> Optional[str]:
    value = _snapshot_value(snapshot, "id")
    return str(value) if value else None

def _snapshot_step_data(snapshot: Any) -> Optional[str]:
    return (
        _snapshot_value(snapshot, "datos_resueltos")
        or _snapshot_value(snapshot, "datos_congelados")
    )

def get_ai_base_url_from_context(variables: Optional[Dict[str, Any]], snapshots: Optional[List[Any]] = None) -> Optional[str]:
    variables = variables or {}
    # El caso/paso es la fuente principal. El ambiente solo completa datos faltantes.
    for snapshot in snapshots or []:
        candidates = [
            _snapshot_value(snapshot, "datos_resueltos"),
            _snapshot_value(snapshot, "datos_congelados"),
            _snapshot_value(snapshot, "datos"),
            _snapshot_value(snapshot, "data"),
            _snapshot_value(snapshot, "accion_congelada"),
            _snapshot_value(snapshot, "accion"),
            _snapshot_value(snapshot, "action"),
            _snapshot_value(snapshot, "resultado_esperado_congelado"),
            _snapshot_value(snapshot, "resultado_esperado"),
            _snapshot_value(snapshot, "expected"),
        ]
        for candidate in candidates:
            normalized = _normalize_ai_url(candidate)
            if normalized:
                return normalized

    for key in AI_BASE_URL_KEYS:
        normalized = _normalize_ai_url(variables.get(key))
        if normalized:
            return normalized
    return None

async def _legacy_trigger_ai_execution_unused(ejecucion_id: UUID, db: AsyncSession):
    result = await db.execute(select(models.EjecucionCaso).filter(models.EjecucionCaso.id == ejecucion_id))
    ejec = result.scalar_one_or_none()
    if not ejec: return
    ejec.estado_resultado = models.EstadoResultado.EJECUTANDO_AI
    await db.commit()
    snapshots = await get_snapshots_ejecucion(db, ejecucion_id)
    run_result = await db.execute(select(models.TestRun).filter(models.TestRun.id == ejec.test_run_id))
    run = run_result.scalar_one_or_none()
    dataset_resuelto = []
    variables_resueltas = {}
    if run:
        dataset_resuelto = (run.datasets_resueltos or {}).get(str(ejec.caso_id), [])
        variables_resueltas = run.variables_resueltas or {}
    step_map = {str(s.numero_paso): str(s.id) for s in snapshots}
    guidance = "\n".join([f"{s.numero_paso}. {s.accion_congelada}" for s in snapshots])
    payload = {
        "task": f"Ejecutar prueba: {guidance}",
        "url": "http://localhost:8000",
        "testId": str(ejecucion_id),
        "suite": "auto-run",
        "guidance": guidance,
        "step_map": step_map,
        "environment": run.entorno if run else None,
        "dataset": dataset_resuelto,
        "variables": variables_resueltas,
    }
    try:
        async with httpx.AsyncClient(timeout=LEGACY_AI_ENGINE_TIMEOUT) as client:
            resp = await client.post(f"{ENGINE_URL}/run-task", json=payload)
            if resp.status_code == 200:
                logger.info("IA iniciada para ejecución %s", ejecucion_id)
            else:
                logger.warning(
                    "Engine de IA rechazo ejecución %s con estado %s: %s",
                    ejecucion_id,
                    resp.status_code,
                    sanitize_external_error(getattr(resp, "text", "")),
                )
    except Exception as e:
        logger.warning("Fallo de conexión con el Engine de IA: %s", sanitize_external_error(e))

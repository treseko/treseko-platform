from .repository_context import *
from .bug_version_metrics import apply_bug_history_metrics, bug_history_version_fields, load_bug_history_context
from .project_metrics_bug_context import build_bug_evidence_context
from .project_metrics_suite import build_suite_tree
from .project_metrics_history import build_project_history
from .project_metrics_rules import _qa_decision, _risk_level
from .project_metrics_derived import build_derived_metrics
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

    total_ejecutados = len(ejecutados_masters)
    cobertura = round((total_ejecutados / total_asignados) * 100, 2) if total_asignados > 0 else 0.0
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

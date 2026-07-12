from .legacy_common import *


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


def _risk_level(
    *,
    coverage: float,
    failed: int,
    blocked: int,
    pending: int,
    high_open_bugs: int,
    bugs_without_evidence: int = 0,
) -> str:
    if blocked > 0 or high_open_bugs > 0 or coverage < 70:
        return "ALTO"
    if failed > 0 or pending > 0 or coverage < 90 or bugs_without_evidence > 0:
        return "MEDIO"
    return "BAJO"


def _qa_decision(risk: str, stats: Dict[str, Any], coverage: float, bug_metrics: Dict[str, Any]) -> Dict[str, Any]:
    failed = int(stats.get("fallados") or 0)
    blocked = int(stats.get("bloqueados") or 0)
    pending = int(stats.get("pendientes") or 0)
    open_bugs = int(bug_metrics.get("open") or 0)
    high_open = int(bug_metrics.get("high_open") or 0)
    reasons = []
    if coverage < 70:
        reasons.append("cobertura menor al 70%")
    elif coverage < 90:
        reasons.append("cobertura menor al 90%")
    if failed:
        reasons.append(f"{failed} casos fallidos")
    if blocked:
        reasons.append(f"{blocked} casos bloqueados")
    if high_open:
        reasons.append(f"{high_open} bugs abiertos de severidad alta/critica")
    elif open_bugs:
        reasons.append(f"{open_bugs} bugs abiertos")
    if pending:
        reasons.append(f"{pending} casos sin ejecutar")

    if blocked or high_open or coverage < 70:
        state = "NO_RECOMENDADO"
        label = "No recomendado"
    elif failed or open_bugs or pending or coverage < 90:
        state = "RECOMENDADO_CON_OBSERVACIONES"
        label = "Recomendado con observaciones"
    elif int(stats.get("pasados") or 0) == 0:
        state = "EN_EVALUACION"
        label = "En evaluacion"
    else:
        state = "APROBADO"
        label = "Aprobado"
    if blocked:
        state = "BLOQUEADO"
        label = "Bloqueado"
    return {
        "state": state,
        "label": label,
        "risk": risk,
        "reasons": reasons or ["Sin riesgos relevantes detectados con los datos actuales"],
        "recommend_release": state == "APROBADO",
    }


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
        select(models.EjecucionCaso).join(models.TestRun).filter(
            models.TestRun.build_id == build.id,
            models.EjecucionCaso.caso_id.in_(version_case_ids),
            models.EjecucionCaso.estado_resultado != models.EstadoResultado.SIN_CORRER,
        )
    )
    ejecuciones = result_ejecuciones.scalars().all()

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
            "execution_mode": _execution_mode_value(ejecucion, caso) if ejecucion else None,
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
        ai_report = ejecucion.ai_report if ejecucion else {}
        if ejecucion and isinstance(ai_report, dict) and ai_report:
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
            por_modo_ejecucion[_execution_mode_key(_execution_mode_value(ejecucion, caso))] += 1
            por_tipo_prueba[_case_type_key(caso)] += 1
        elif estado == "FALLO":
            stats["fallados"] += 1
            stats["pendientes"] -= 1
            por_prioridad[prioridad]["fallados"] += 1
            por_prioridad[prioridad]["pendientes"] -= 1
            por_suite[suite_id]["fallados"] += 1
            por_modo_ejecucion[_execution_mode_key(_execution_mode_value(ejecucion, caso))] += 1
            por_tipo_prueba[_case_type_key(caso)] += 1
        elif estado == "BLOQUEADO":
            stats["bloqueados"] += 1
            stats["pendientes"] -= 1
            por_prioridad[prioridad]["bloqueados"] += 1
            por_prioridad[prioridad]["pendientes"] -= 1
            por_suite[suite_id]["bloqueados"] += 1
            por_modo_ejecucion[_execution_mode_key(_execution_mode_value(ejecucion, caso))] += 1
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
    bug_result = await db.execute(
        select(models.BugIssue)
        .options(
            selectinload(models.BugIssue.caso),
            selectinload(models.BugIssue.build),
            selectinload(models.BugIssue.assignee),
            selectinload(models.BugIssue.creator),
            selectinload(models.BugIssue.comments).selectinload(models.BugComment.autor),
            selectinload(models.BugIssue.attachments).selectinload(models.BugAttachment.attachment),
        )
        .filter(
            models.BugIssue.proyecto_id == proyecto_id,
            or_(
                models.BugIssue.build_id == build.id,
                models.BugIssue.caso_id.in_(related_case_ids) if related_case_ids else False,
            ),
        )
        .order_by(models.BugIssue.created_at.desc())
    )
    related_bugs = bug_result.scalars().all()

    now = utc_now()
    bug_items = []
    bugs_by_master: Dict[str, List[Any]] = {}
    bugs_by_execution: Dict[str, List[Any]] = {}
    bugs_by_snapshot: Dict[str, List[Any]] = {}
    bug_by_status: Dict[str, int] = {}
    bug_by_severity: Dict[str, int] = {}
    bug_group_counts: Dict[str, int] = {}
    open_bugs = []
    resolution_hours = []
    open_hours = []
    first_comment_hours = []
    bugs_without_evidence = 0
    bugs_without_case = 0
    bugs_without_responsible = 0
    reopened = 0
    inherited = 0
    new_in_build = 0
    overdue = 0
    oldest_open_bug = None
    bugs_by_origin_build: Dict[str, int] = {}
    for bug in related_bugs:
        bug_master_id = None
        if bug.caso_id and bug.caso_id in case_master_by_version:
            bug_master_id = str(case_master_by_version[bug.caso_id])
        elif bug.caso and getattr(bug.caso, "master_id", None):
            bug_master_id = str(bug.caso.master_id)
        if bug_master_id:
            bugs_by_master.setdefault(bug_master_id, []).append(bug)
        if bug.ejecucion_id:
            bugs_by_execution.setdefault(str(bug.ejecucion_id), []).append(bug)
        if bug.snapshot_id:
            bugs_by_snapshot.setdefault(str(bug.snapshot_id), []).append(bug)
        group_key = bug_master_id or str(bug.external_issue_id or bug.dedupe_hash or bug.titulo or bug.codigo)
        bug_group_counts[group_key] = bug_group_counts.get(group_key, 0) + 1

    for bug in related_bugs:
        status = str(bug.estado or "SIN_ESTADO").upper()
        severity = str(bug.severidad or "SIN_SEVERIDAD").upper()
        priority = str(bug.prioridad or "SIN_PRIORIDAD").upper()
        bug_by_status[status] = bug_by_status.get(status, 0) + 1
        bug_by_severity[severity] = bug_by_severity.get(severity, 0) + 1
        is_open = _bug_status_is_open(status)
        closed_at = bug.closed_at or bug.fecha_resolucion
        end_for_age = closed_at or now
        age_hours = _hours_between(bug.created_at, end_for_age) or 0
        has_evidence = bool(bug.attachments or bug.snapshot_id or bug.external_issue_url or (bug.metadata_json or {}).get("evidence"))
        first_comment = sorted((bug.comments or []), key=lambda item: item.created_at or now)
        first_comment_at = first_comment[0].created_at if first_comment else None
        first_comment_delta = _hours_between(bug.created_at, first_comment_at)
        if first_comment_delta is not None:
            first_comment_hours.append(first_comment_delta)
        if is_open:
            open_bugs.append(bug)
            open_hours.append(age_hours)
            if not oldest_open_bug or (bug.created_at and bug.created_at < oldest_open_bug.created_at):
                oldest_open_bug = bug
            sla_hours = BUG_SLA_HOURS.get(severity, 120)
            if age_hours > sla_hours:
                overdue += 1
        elif closed_at:
            resolution_hours.append(age_hours)
        if not has_evidence:
            bugs_without_evidence += 1
        if not bug.caso_id:
            bugs_without_case += 1
        if not bug.asignado_a:
            bugs_without_responsible += 1
        if int(bug.reopened_count or 0) > 0 or status == "REABIERTO":
            reopened += 1
        if bug.build_id == build.id:
            new_in_build += 1
        else:
            inherited += 1
        origin_build_label = bug.build.nombre if bug.build else (bug.build_code or "Sin build")
        bugs_by_origin_build[origin_build_label] = bugs_by_origin_build.get(origin_build_label, 0) + 1
        bug_master_id = None
        if bug.caso_id and bug.caso_id in case_master_by_version:
            bug_master_id = str(case_master_by_version[bug.caso_id])
        elif bug.caso and getattr(bug.caso, "master_id", None):
            bug_master_id = str(bug.caso.master_id)
        case_detail = casos_detalle_por_master.get(bug_master_id or "")
        assignee = bug.assignee
        bug_items.append({
            "id": str(bug.id),
            "codigo": bug.codigo,
            "titulo": bug.titulo,
            "caso_id": str(bug.caso_id) if bug.caso_id else None,
            "case_code": bug.case_code or (case_detail or {}).get("codigo"),
            "case_title": (bug.caso.titulo if bug.caso else None) or (case_detail or {}).get("titulo"),
            "suite": (case_detail or {}).get("suite_breadcrumb") or "Sin suite",
            "execution_mode": bug.execution_mode or (case_detail or {}).get("execution_mode"),
            "severidad": severity,
            "prioridad": priority,
            "estado": status,
            "is_open": is_open,
            "created_at": _safe_iso(bug.created_at),
            "updated_at": _safe_iso(bug.updated_at),
            "tiempo_abierto_horas": age_hours if is_open else None,
            "tiempo_resolucion_horas": age_hours if not is_open and closed_at else None,
            "build_detectado": origin_build_label,
            "build_corregido": (bug.metadata_json or {}).get("fixed_build") or (bug.metadata_json or {}).get("fixed_build_name"),
            "has_evidence": has_evidence,
            "evidence_count": len(bug.attachments or []),
            "responsable": (assignee.nombre_completo or assignee.email) if assignee else None,
            "reopened_count": int(bug.reopened_count or 0),
            "new_in_build": bug.build_id == build.id,
            "inherited": bug.build_id != build.id,
            "recurrent": bug_group_counts.get(bug_master_id or str(bug.external_issue_id or bug.dedupe_hash or bug.titulo or bug.codigo), 0) > 1,
            "external_issue_url": bug.external_issue_url,
        })

    bug_metrics.update({
        "total": len(related_bugs),
        "by_status": bug_by_status,
        "by_severity": bug_by_severity,
        "closed": len([bug for bug in related_bugs if not _bug_status_is_open(bug.estado)]),
        "open": len(open_bugs),
        "new_in_build": new_in_build,
        "inherited": inherited,
        "reopened": reopened,
        "recurrent": len([item for item in bug_items if item["recurrent"]]),
        "without_evidence": bugs_without_evidence,
        "without_case": bugs_without_case,
        "without_responsible": bugs_without_responsible,
        "high_open": len([bug for bug in open_bugs if str(bug.severidad or "").upper() in {"CRITICA", "ALTA"}]),
        "overdue_sla": overdue,
        "avg_resolution_hours": round(sum(resolution_hours) / len(resolution_hours), 2) if resolution_hours else None,
        "avg_open_hours": round(sum(open_hours) / len(open_hours), 2) if open_hours else None,
        "oldest_open_bug": {
            "codigo": oldest_open_bug.codigo,
            "titulo": oldest_open_bug.titulo,
            "created_at": _safe_iso(oldest_open_bug.created_at),
            "age_hours": _hours_between(oldest_open_bug.created_at, now),
        } if oldest_open_bug else None,
    })

    failure_items = []
    evidence_items = []
    detection_dates_by_master = {
        str(master_id): info.get("fecha")
        for master_id, info in caso_ultimo_estado.items()
        if info.get("fecha")
    }

    def _linked_bugs_for_case(case: Dict[str, Any]) -> List[Any]:
        linked = []
        linked.extend(bugs_by_master.get(case.get("master_id"), []))
        if case.get("execution_id"):
            linked.extend(bugs_by_execution.get(case.get("execution_id"), []))
        for snap in (case.get("snapshots") or []):
            linked.extend(bugs_by_snapshot.get(str(snap.get("id")), []))
        return list({str(bug.id): bug for bug in linked}.values())

    def _serialize_case_bug(bug: Any) -> Dict[str, Any]:
        return {
            "id": str(bug.id),
            "codigo": bug.codigo,
            "titulo": bug.titulo,
            "estado": bug.estado,
            "severidad": bug.severidad,
            "prioridad": bug.prioridad,
            "is_open": _bug_status_is_open(bug.estado),
            "snapshot_id": str(bug.snapshot_id) if bug.snapshot_id else None,
            "ejecucion_id": str(bug.ejecucion_id) if bug.ejecucion_id else None,
        }

    for case in casos_detalle_por_master.values():
        case["bugs"] = [_serialize_case_bug(bug) for bug in _linked_bugs_for_case(case)]

    failures_with_bug = 0
    failures_without_evidence = 0
    blocked_without_reason = 0
    for case in casos_detalle_por_master.values():
        status = str(case.get("estado") or "").upper()
        case_evidence = list(case.get("evidencias") or [])
        for evidence in case_evidence:
            evidence_items.append({
                "case_code": case.get("codigo"),
                "case_title": case.get("titulo"),
                "bug": None,
                "type": evidence.get("content_type") or evidence.get("scope") or "archivo",
                "created_at": evidence.get("created_at"),
                "created_by": evidence.get("created_by"),
                "url": evidence.get("public_url"),
                "name": evidence.get("filename_original"),
                "status": "completa",
            })
        if status not in {"FALLO", "BLOQUEADO"}:
            continue
        linked_bugs = _linked_bugs_for_case(case)
        failed_snapshots = [
            snap for snap in (case.get("snapshots") or [])
            if str(snap.get("estado_paso") or "").upper() in {"FALLO", "BLOQUEADO"}
        ]
        unique_linked = {str(bug.id): bug for bug in linked_bugs}
        active_linked = [bug for bug in unique_linked.values() if _bug_status_is_open(bug.estado)]
        has_evidence = bool(case.get("evidencia_url") or case_evidence or any((snap.get("evidencia_url") or snap.get("evidencias")) for snap in failed_snapshots))
        if active_linked:
            failures_with_bug += 1
        if not has_evidence:
            failures_without_evidence += 1
        primary_snapshot = (failed_snapshots or [{}])[0]
        reason_text = primary_snapshot.get("comentarios") or primary_snapshot.get("error_log") or case.get("observaciones")
        if status == "BLOQUEADO" and not reason_text:
            blocked_without_reason += 1
        failure_items.append({
            "case_id": case.get("id"),
            "case_code": case.get("codigo"),
            "case_title": case.get("titulo"),
            "suite": case.get("suite_breadcrumb"),
            "prioridad": case.get("prioridad"),
            "estado": status,
            "execution_mode": case.get("execution_mode"),
            "failed_step": primary_snapshot.get("numero_paso"),
            "expected": primary_snapshot.get("resultado_esperado_congelado"),
            "obtained": primary_snapshot.get("error_log") or primary_snapshot.get("comentarios") or case.get("observaciones"),
            "diagnosis": reason_text,
            "has_evidence": has_evidence,
            "bug": [
                {"codigo": bug.codigo, "estado": bug.estado, "severidad": bug.severidad}
                for bug in unique_linked.values()
            ],
            "responsable": case.get("ejecutado_por"),
            "execution_at": case.get("fecha_ejecucion"),
            "time_since_detection_hours": _hours_between(detection_dates_by_master.get(str(case.get("master_id"))), now),
            "flags": {
                "sin_evidencia": not has_evidence,
                "sin_bug_asociado": not active_linked,
                "bloqueo_sin_motivo": status == "BLOQUEADO" and not reason_text,
                "no_accionable": status == "BLOQUEADO" and not reason_text,
            },
        })

    for bug_item in bug_items:
        if not bug_item["has_evidence"]:
            evidence_items.append({
                "case_code": bug_item.get("case_code"),
                "case_title": bug_item.get("case_title"),
                "bug": bug_item.get("codigo"),
                "type": "bug",
                "created_at": bug_item.get("created_at"),
                "created_by": None,
                "url": bug_item.get("external_issue_url"),
                "name": "Evidencia de bug",
                "status": "faltante",
            })

    evidence_summary = {
        "total": len(evidence_items),
        "complete": len([item for item in evidence_items if item.get("status") == "completa"]),
        "insufficient": len([item for item in evidence_items if item.get("status") == "insuficiente"]),
        "missing": len([item for item in evidence_items if item.get("status") == "faltante"]),
    }

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

    def empty_suite_node(suite_id: str):
        suite = suites_by_id.get(suite_id)
        entry = por_suite.get(suite_id, {})
        return {
            "id": suite_id,
            "nombre": entry.get("nombre") or (suite.nombre if suite else "Sin Suite"),
            "parent_id": entry.get("parent_id") or (str(suite.parent_id) if suite and suite.parent_id else None),
            "breadcrumb": entry.get("breadcrumb") or suite_breadcrumb(suite_id),
            "total": entry.get("total", 0),
            "pasados": entry.get("pasados", 0),
            "fallados": entry.get("fallados", 0),
            "bloqueados": entry.get("bloqueados", 0),
            "pendientes": entry.get("pendientes", 0),
            "duracion_segundos": entry.get("duracion_segundos", 0),
            "ultima_ejecucion": entry.get("ultima_ejecucion"),
            "casos": entry.get("casos", []),
            "children": [],
        }

    required_suite_ids = set(por_suite.keys())
    for suite_id in list(required_suite_ids):
        current = suites_by_id.get(suite_id)
        while current and current.parent_id:
            parent_id = str(current.parent_id)
            required_suite_ids.add(parent_id)
            current = suites_by_id.get(parent_id)

    suite_nodes = {suite_id: empty_suite_node(suite_id) for suite_id in required_suite_ids}
    root_nodes = []
    for suite_id, node in suite_nodes.items():
        parent_id = node.get("parent_id")
        if parent_id and parent_id in suite_nodes:
            suite_nodes[parent_id]["children"].append(node)
        else:
            root_nodes.append(node)

    def aggregate_suite_node(node):
        for child in node["children"]:
            aggregate_suite_node(child)
            node["total"] += child["total"]
            node["pasados"] += child["pasados"]
            node["fallados"] += child["fallados"]
            node["bloqueados"] += child["bloqueados"]
            node["pendientes"] += child["pendientes"]
            node["duracion_segundos"] = int(node.get("duracion_segundos") or 0) + int(child.get("duracion_segundos") or 0)
            child_last = child.get("ultima_ejecucion")
            node_last = node.get("ultima_ejecucion")
            if child_last and (not node_last or child_last > node_last):
                node["ultima_ejecucion"] = child_last
        node["children"].sort(key=lambda item: (item["breadcrumb"], item["nombre"]))

    for node in root_nodes:
        aggregate_suite_node(node)
    root_nodes.sort(key=lambda item: (item["breadcrumb"], item["nombre"]))

    suite_open_bug_counts: Dict[str, int] = {}
    suite_high_open_bug_counts: Dict[str, int] = {}
    for bug in open_bug_items:
        suite_name = bug.get("suite") or "Sin Suite"
        suite_open_bug_counts[suite_name] = suite_open_bug_counts.get(suite_name, 0) + 1
        if str(bug.get("severidad") or "").upper() in {"CRITICA", "ALTA"}:
            suite_high_open_bug_counts[suite_name] = suite_high_open_bug_counts.get(suite_name, 0) + 1

    def enrich_suite_node(node):
        executed = int(node.get("pasados") or 0) + int(node.get("fallados") or 0) + int(node.get("bloqueados") or 0)
        total = int(node.get("total") or 0)
        breadcrumb = node.get("breadcrumb") or node.get("nombre") or "Sin Suite"
        last_execution = node.get("ultima_ejecucion")
        node["ejecutados"] = executed
        node["cobertura_porcentaje"] = _safe_percent(executed, total)
        node["exito_sobre_ejecutados_porcentaje"] = _safe_percent(int(node.get("pasados") or 0), executed)
        node["exito_sobre_total_porcentaje"] = _safe_percent(int(node.get("pasados") or 0), total)
        node["bugs_abiertos"] = suite_open_bug_counts.get(breadcrumb, 0)
        node["riesgo"] = _risk_level(
            coverage=node["cobertura_porcentaje"],
            failed=int(node.get("fallados") or 0),
            blocked=int(node.get("bloqueados") or 0),
            pending=int(node.get("pendientes") or 0),
            high_open_bugs=suite_high_open_bug_counts.get(breadcrumb, 0),
        )
        node["ultima_ejecucion"] = _safe_iso(last_execution) if hasattr(last_execution, "isoformat") else last_execution
        node["duracion_horas"] = _seconds_to_hours(int(node.get("duracion_segundos") or 0))
        for child in node.get("children") or []:
            enrich_suite_node(child)

    for node in root_nodes:
        enrich_suite_node(node)

    for suite in por_suite.values():
        last_execution = suite.get("ultima_ejecucion")
        executed = int(suite.get("pasados") or 0) + int(suite.get("fallados") or 0) + int(suite.get("bloqueados") or 0)
        total = int(suite.get("total") or 0)
        suite["ejecutados"] = executed
        suite["cobertura_porcentaje"] = _safe_percent(executed, total)
        suite["exito_sobre_ejecutados_porcentaje"] = _safe_percent(int(suite.get("pasados") or 0), executed)
        suite["exito_sobre_total_porcentaje"] = _safe_percent(int(suite.get("pasados") or 0), total)
        suite["bugs_abiertos"] = suite_open_bug_counts.get(suite.get("breadcrumb") or suite.get("nombre") or "Sin Suite", 0)
        suite["riesgo"] = _risk_level(
            coverage=suite["cobertura_porcentaje"],
            failed=int(suite.get("fallados") or 0),
            blocked=int(suite.get("bloqueados") or 0),
            pending=int(suite.get("pendientes") or 0),
            high_open_bugs=suite_high_open_bug_counts.get(suite.get("breadcrumb") or suite.get("nombre") or "Sin Suite", 0),
        )
        suite["ultima_ejecucion"] = _safe_iso(last_execution) if hasattr(last_execution, "isoformat") else last_execution
        suite["duracion_horas"] = _seconds_to_hours(int(suite.get("duracion_segundos") or 0))

    result_historico = await db.execute(
        select(models.Build).filter(
            models.Build.proyecto_id == proyecto_id,
            models.Build.componente_id == build.componente_id
        ).order_by(models.Build.fecha_inicio.desc().nullslast(), models.Build.fecha_creacion.desc(), models.Build.id.desc()).limit(10)
    )
    builds_historico = result_historico.scalars().all()

    historico = []
    for b in builds_historico:
        result_bc = await db.execute(
            select(models.BuildCaso).filter(models.BuildCaso.build_id == b.id)
        )
        b_caso_ids = [bc.caso_id for bc in result_bc.scalars().all()]

        if not b_caso_ids:
            historico.append({
                "build_id": str(b.id),
                "build_name": b.nombre,
                "total_asignados": 0,
                "ejecutados": 0,
                "cobertura_porcentaje": 0.0,
                "exito_sobre_ejecutados_porcentaje": 0.0,
                "pasados": 0,
                "fallados": 0,
                "bloqueados": 0,
                "fecha": b.fecha_creacion.isoformat() if b.fecha_creacion else None
            })
            continue

        result_b_casos_info = await db.execute(
            select(models.CasoPrueba.id, models.CasoPrueba.master_id).filter(
                models.CasoPrueba.id.in_(b_caso_ids),
                *_visible_case_filter(),
            )
        )
        b_assigned_master_ids = {
            master_id
            for _, master_id in result_b_casos_info.all()
        }
        if not b_assigned_master_ids:
            historico.append({
                "build_id": str(b.id),
                "build_name": b.nombre,
                "total_asignados": 0,
                "ejecutados": 0,
                "cobertura_porcentaje": 0.0,
                "exito_sobre_ejecutados_porcentaje": 0.0,
                "pasados": 0,
                "fallados": 0,
                "bloqueados": 0,
                "fecha": b.fecha_creacion.isoformat() if b.fecha_creacion else None
            })
            continue

        result_b_versions = await db.execute(
            select(models.CasoPrueba.id, models.CasoPrueba.master_id).filter(
                models.CasoPrueba.master_id.in_(b_assigned_master_ids),
                *_visible_case_filter(),
            )
        )
        b_master_by_version_id = {
            case_id: master_id
            for case_id, master_id in result_b_versions.all()
        }
        b_version_case_ids = list(b_master_by_version_id.keys())

        result_ejec = await db.execute(
            select(models.EjecucionCaso).join(models.TestRun).filter(
                models.TestRun.build_id == b.id,
                models.EjecucionCaso.caso_id.in_(b_version_case_ids),
                models.EjecucionCaso.estado_resultado != models.EstadoResultado.SIN_CORRER,
            )
        )
        b_ejecuciones = result_ejec.scalars().all()

        b_stats = {"pasados": 0, "fallados": 0, "bloqueados": 0}
        b_caso_estado = {}
        for e in b_ejecuciones:
            master_id = b_master_by_version_id.get(e.caso_id)
            if not master_id:
                continue
            est = e.estado_resultado.value if hasattr(e.estado_resultado, 'value') else e.estado_resultado
            if master_id not in b_caso_estado or e.fecha_ejecucion > b_caso_estado[master_id]['fecha']:
                b_caso_estado[master_id] = {'estado': est, 'fecha': e.fecha_ejecucion}

        for info in b_caso_estado.values():
            if info['estado'] == "PASO":
                b_stats["pasados"] += 1
            elif info['estado'] == "FALLO":
                b_stats["fallados"] += 1
            elif info['estado'] == "BLOQUEADO":
                b_stats["bloqueados"] += 1

        historico.append({
            "build_id": str(b.id),
            "build_name": b.nombre,
            "total_asignados": len(b_assigned_master_ids),
            "ejecutados": len(b_caso_estado),
            "cobertura_porcentaje": _safe_percent(len(b_caso_estado), len(b_assigned_master_ids)),
            "exito_sobre_ejecutados_porcentaje": _safe_percent(b_stats["pasados"], len(b_caso_estado)),
            "pasados": b_stats["pasados"],
            "fallados": b_stats["fallados"],
            "bloqueados": b_stats["bloqueados"],
            "fecha": b.fecha_creacion.isoformat() if b.fecha_creacion else None
        })

    current_history_index = next((idx for idx, item in enumerate(historico) if item.get("build_id") == str(build.id)), 0)
    previous_history = historico[current_history_index + 1] if len(historico) > current_history_index + 1 else None
    comparison = {}
    if previous_history:
        comparison = {
            "previous_build_id": previous_history.get("build_id"),
            "previous_build_name": previous_history.get("build_name"),
            "coverage_delta": round(cobertura - float(previous_history.get("cobertura_porcentaje") or 0), 2),
            "failed_delta": int(stats.get("fallados") or 0) - int(previous_history.get("fallados") or 0),
            "blocked_delta": int(stats.get("bloqueados") or 0) - int(previous_history.get("bloqueados") or 0),
            "passed_delta": int(stats.get("pasados") or 0) - int(previous_history.get("pasados") or 0),
            "success_executed_delta": round(
                _safe_percent(int(stats.get("pasados") or 0), total_ejecutados)
                - float(previous_history.get("exito_sobre_ejecutados_porcentaje") or 0),
                2,
            ),
            "execution_time_delta_hours": None,
            "qa_status_previous": None,
            "qa_status_current": qa_status.get("label"),
            "open_bugs_current": int(bug_metrics.get("open") or 0),
            "recurrent_bugs_current": int(bug_metrics.get("recurrent") or 0),
        }

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

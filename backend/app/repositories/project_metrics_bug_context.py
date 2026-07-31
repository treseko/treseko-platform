from .repository_context import *
from .bug_version_metrics import apply_bug_history_metrics, load_bug_history_context
from sqlalchemy import or_

BUG_OPEN_STATES = {"ABIERTO", "TRIAGE", "ASIGNADO", "EN_PROGRESO", "LISTO_PARA_RETEST", "EN_RETEST", "REABIERTO", "BLOQUEADO"}
BUG_SLA_HOURS = {"CRITICA": 24, "ALTA": 48, "MEDIA": 120, "BAJA": 240, "COSMETICA": 240}
def _safe_iso(value): return value.isoformat() if value else None
def _hours_between(start, end): return round(max((end - start).total_seconds(), 0) / 3600, 2) if start and end else None
def _safe_percent(numerator, denominator): return round((numerator / denominator) * 100, 2) if denominator else 0.0
def _bug_status_is_open(status): return str(status or "").upper() in BUG_OPEN_STATES

async def build_bug_evidence_context(context):
    db = context["db"]
    build = context["build"]
    proyecto_id = context["proyecto_id"]
    project = context["project"]
    component = context["component"]
    case_master_by_version = context["case_master_by_version"]
    related_case_ids = context["related_case_ids"]
    casos_detalle_por_master = context["casos_detalle_por_master"]
    ejecuciones = context["ejecuciones"]
    caso_ultimo_estado = context["caso_ultimo_estado"]
    bug_metrics = context["bug_metrics"]
    now = utc_now()
    bug_result = await db.execute(
        select(models.BugIssue)
        .options(
            selectinload(models.BugIssue.caso),
            selectinload(models.BugIssue.build),
            selectinload(models.BugIssue.resolved_build),
            selectinload(models.BugIssue.assignee),
            selectinload(models.BugIssue.creator),
            selectinload(models.BugIssue.comments).selectinload(models.BugComment.autor),
            selectinload(models.BugIssue.attachments).selectinload(models.BugAttachment.attachment),
        )
        .filter(
            models.BugIssue.proyecto_id == proyecto_id,
            or_(
                models.BugIssue.build_id == build.id,
                models.BugIssue.resolved_build_id == build.id,
                models.BugIssue.caso_id.in_(related_case_ids) if related_case_ids else False,
            ),
        )
        .order_by(models.BugIssue.created_at.desc())
    )
    related_bugs = bug_result.scalars().all()
    project_bug_history, history_metrics = await load_bug_history_context(db, proyecto_id, related_bugs, build)

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
            "build_corregido": bug.resolved_build.nombre if bug.resolved_build else None, "build_corregido_id": str(bug.resolved_build_id) if bug.resolved_build_id else None,
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
    apply_bug_history_metrics(bug_metrics, history_metrics, related_bugs, open_bugs, _safe_percent)

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
    return locals()

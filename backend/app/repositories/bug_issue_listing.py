"""Ordering and summary helpers for bug listing surfaces."""

from .repository_context import *

BUG_CLOSED_STATES = {"RESUELTO", "CERRADO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}


def _summarize_bug_items(bugs):
    def count_by(field):
        data: Dict[str, int] = {}
        for bug in bugs:
            key = str(getattr(bug, field, None) or "N/D")
            data[key] = data.get(key, 0) + 1
        return data

    open_bugs = [bug for bug in bugs if bug.estado not in BUG_CLOSED_STATES]
    return {
        "total": len(bugs),
        "abiertos": len(open_bugs),
        "criticos": len([bug for bug in open_bugs if bug.severidad in {"CRITICA", "ALTA"}]),
        "bloquean_release": len([bug for bug in open_bugs if bug.bloquea_release]),
        "listos_retest": len([bug for bug in open_bugs if bug.estado == "LISTO_PARA_RETEST"]),
        "cerrados": len([bug for bug in bugs if bug.estado in BUG_CLOSED_STATES]),
        "vinculados_externos": len([bug for bug in bugs if bug.external_issue_id or bug.external_links]),
        "sin_evidencia": len([bug for bug in bugs if not bug.attachments and not (bug.metadata_json or {}).get("legacy_evidence_url")]),
        "sin_asignado": len([bug for bug in open_bugs if not bug.asignado_a]),
        "by_estado": count_by("estado"),
        "by_severidad": count_by("severidad"),
        "by_prioridad": count_by("prioridad"),
        "by_origen": count_by("origen"),
    }


def _bug_list_order(sort):
    from sqlalchemy import case

    bug = models.BugIssue
    if sort == "oldest":
        return (bug.created_at.asc(), bug.id.asc())
    if sort == "priority":
        rank = case({"P0": 0, "P1": 1, "P2": 2, "P3": 3, "P4": 4}, value=bug.prioridad, else_=5)
        return (rank.asc(), bug.created_at.asc(), bug.id.asc())
    return (bug.created_at.desc(), bug.id.desc())


def _apply_bug_attention_filter(query, attention):
    if attention in {"open", "critical", "unassigned", "retest"}:
        query = query.filter(models.BugIssue.estado.notin_(BUG_CLOSED_STATES))
    if attention == "critical":
        query = query.filter(models.BugIssue.severidad.in_({"CRITICA", "ALTA"}))
    elif attention == "unassigned":
        query = query.filter(models.BugIssue.asignado_a.is_(None))
    elif attention == "retest":
        query = query.filter(models.BugIssue.estado == "LISTO_PARA_RETEST")
    elif attention == "no_evidence":
        query = query.filter(~models.BugIssue.attachments.any(), func.coalesce(models.BugIssue.metadata_json["legacy_evidence_url"].as_string(), "") == "")
    elif attention == "linked":
        query = query.filter(or_(models.BugIssue.external_issue_id.isnot(None), models.BugIssue.external_links.any()))
    return query

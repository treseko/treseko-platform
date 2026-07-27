from .repository_context import *


OPEN_STATES = {"ABIERTO", "TRIAGE", "ASIGNADO", "EN_PROGRESO", "LISTO_PARA_RETEST", "EN_RETEST", "REABIERTO", "BLOQUEADO"}
CLOSED_STATES = {"RESUELTO", "CERRADO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}
CORRECTED_STATES = {"RESUELTO", "CERRADO"}
ADMIN_CLOSED_STATES = {"DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}


def bug_history_sets(events):
    corrected = {event.bug_id for event in events if str(event.to_status or "").upper() in CORRECTED_STATES}
    administrative = {event.bug_id for event in events if str(event.to_status or "").upper() in ADMIN_CLOSED_STATES}
    reopened = {
        event.bug_id for event in events
        if str(event.from_status or "").upper() in CLOSED_STATES
        and str(event.to_status or "").upper() in OPEN_STATES
    }
    return corrected, administrative, reopened


def _status_at(bug, events, moment):
    if not moment or not bug.created_at or bug.created_at > moment:
        return None
    prior = [event for event in events if event.occurred_at and event.occurred_at <= moment]
    if prior:
        return str(max(prior, key=lambda event: event.occurred_at).to_status or "").upper()
    return "ABIERTO"


def bug_build_history_metrics(bugs, histories, build):
    build_events = [event for event in histories if event.build_id == build.id]
    corrected, administrative, reopened = bug_history_sets(build_events)
    events_by_bug = {}
    for event in histories:
        events_by_bug.setdefault(event.bug_id, []).append(event)
    start = build.fecha_inicio or build.fecha_creacion
    end = build.fecha_fin or utc_now()
    open_at_start = sum(
        str(_status_at(bug, events_by_bug.get(bug.id, []), start) or "").upper() in OPEN_STATES
        for bug in bugs
    )
    open_at_end = sum(
        str(_status_at(bug, events_by_bug.get(bug.id, []), end) or "").upper() in OPEN_STATES
        for bug in bugs
    )
    return {
        "corrected": corrected,
        "administrative": administrative,
        "reopened": reopened,
        "open_at_start": open_at_start,
        "open_at_end": open_at_end,
    }


async def load_bug_history_context(db, project_id, bugs, build):
    result = await db.execute(select(models.BugStatusHistory).filter(models.BugStatusHistory.project_id == project_id))
    histories = result.scalars().all()
    return histories, bug_build_history_metrics(bugs, histories, build)


def apply_bug_history_metrics(metrics, context, bugs, open_bugs, percent):
    corrected = context["corrected"]
    administrative = context["administrative"]
    reopened = context["reopened"]
    metrics.update({
        "resolved_in_build": len(corrected),
        "closed_in_build": len(corrected | administrative),
        "closed_without_fix_in_build": len(administrative),
        "reopened_in_build": len(reopened),
        "open_at_build_start": context["open_at_start"],
        "open_at_build_end": context["open_at_end"],
        "closure_attribution_unknown": sum(
            str(bug.estado or "").upper() in CORRECTED_STATES and not bug.resolved_build_id for bug in bugs
        ),
        "resolution_rate": percent(len(corrected), len(corrected) + len(open_bugs) + len(reopened)),
    })


def bug_history_version_fields(histories, build_id):
    corrected, administrative, reopened = bug_history_sets(
        [event for event in histories if event.build_id == build_id]
    )
    return {
        "bugs_resueltos": len(corrected),
        "bugs_cerrados": len(corrected | administrative),
        "bugs_cierre_administrativo": len(administrative),
        "bugs_reabiertos": len(reopened),
    }

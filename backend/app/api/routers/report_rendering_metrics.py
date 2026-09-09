import os
import re
import csv
import io
import json
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

from ...evidence_url_security import sanitize_evidence_url
from ...main_context import *
from ...services.error_sanitizer import sanitize_external_error


__all__ = [
    "_report_public_url",
    "_flatten_report_cases",
    "_report_badge_class",
    "_render_report_evidence",
    "_render_report_distribution",
    "_render_report_trend",
    "_render_report_cases",
    "_render_report_failed_steps",
    "_render_report_bugs",
    "_report_type_from_payload",
    "_report_common_css",
    "_report_context_html",
    "_render_executive_issues",
    "_render_bug_severity_summary",
    "_render_development_failures",
    "_render_bug_tracking",
    "_render_development_actions",
    "_shared_report_html",
    "_shared_report_csv",
    "_md",
    "_markdown_evidence",
    "_shared_report_markdown",
    "_report_link_url",
]


from .report_rendering_base import *

from .report_rendering_sections import *
from .report_development_rendering import (
    context_json_without_internal_ids,
    development_bug_code,
    development_build_name,
    development_case_code,
    development_category_bugs,
    development_current_build_verification,
    development_responsible_name,
    development_unique_bugs,
)


QA_DECISION_LABELS = {
    "APROBADA": "Aprobada",
    "APROBADA_CON_OBSERVACIONES": "Aprobada con observaciones",
    "NO_APROBADA": "No aprobada",
    "REQUIERE_REEJECUCION": "Requiere reejecución",
    "APTO": "Apto",
    "APTO_CON_OBSERVACIONES": "Apto con observaciones",
    "NO_RECOMENDADO": "No recomendado",
}


def _qa_decision_label(value: Any) -> str:
    text = str(value or "").strip()
    return QA_DECISION_LABELS.get(text.upper(), text or "Sin evaluación registrada")


def _render_calculated_kpis(metrics: dict, bug_metrics: dict, failures: list):
    stats = metrics.get("stats") or {}
    failures_without_bug = len([item for item in failures if (item.get("flags") or {}).get("sin_bug_asociado")])
    no_executions = int(metrics.get("total_ejecutados") or 0) == 0
    cards = [
        ("Pruebas asignadas", metrics.get("total_casos_asignados", 0), "muted", "casos incluidos en la build"),
        ("Pruebas ejecutadas", metrics.get("total_ejecutados", 0), "blocked", "pasadas + fallidas + bloqueadas"),
        ("Pruebas pendientes", stats.get("pendientes", 0), "muted", "asignadas sin ejecucion"),
        ("Cobertura de pruebas", _fmt_report_percent(metrics.get("cobertura_porcentaje")), "blocked", "ejecutadas / asignadas"),
        ("Pruebas pasadas", stats.get("pasados", 0), "ok", "ultimo resultado registrado"),
        ("Exito en ejecutadas", _fmt_report_percent(metrics.get("exito_sobre_ejecutados_porcentaje")), "ok", "pasadas / ejecutadas"),
        ("Pruebas fallidas", stats.get("fallados", 0), "fail", "requieren analisis"),
        ("Pruebas bloqueadas", stats.get("bloqueados", 0), "blocked", "requieren desbloqueo"),
        ("Bugs abiertos", bug_metrics.get("open", 0), "warning", "asociados al build"),
        ("Bugs nuevos", bug_metrics.get("new_in_build", 0), "fail", "detectados en build"),
        ("Pruebas fallidas sin bug", "Sin pruebas ejecutadas" if no_executions else failures_without_bug, "fail", "sin pruebas" if no_executions else "sin bug abierto"),
        ("Bugs sin evidencia", bug_metrics.get("without_evidence", 0), "warning", "requieren respaldo"),
    ]
    return "<div class='grid'>" + "".join(
        f"<div class='metric {klass}'><span class='label'>{html.escape(label)}</span><span class='value'>{html.escape(str(value))}</span><span class='muted-text'>{html.escape(base)}</span></div>"
        for label, value, klass, base in cards
    ) + "</div>"

def _render_qa_decision(qa_summary: dict):
    qa_summary = qa_summary if isinstance(qa_summary, dict) else {}
    has_decision = bool(str(qa_summary.get("decision") or "").strip())
    reasons = qa_summary.get("reasons") or ([qa_summary.get("summary")] if qa_summary.get("summary") else [])
    if not has_decision and not reasons:
        reasons = ["No hay un dictamen QA persistido para este snapshot."]
    reason_items = "".join(f"<li>{html.escape(str(reason))}</li>" for reason in reasons)
    if not has_decision:
        recommendation = "Pendiente de evaluación QA."
    elif qa_summary.get("recommend_release") is True:
        recommendation = "Build apta para avanzar segun la evidencia congelada."
    else:
        recommendation = "No liberar hasta resolver riesgos altos."
    conversation_content = turn_cards or "<p class='muted-text'>No hay turnos conservados en este snapshot.</p>"
    return (
        "<div class='callout'>"
        f"<strong>Diagnóstico de calidad: {html.escape(_qa_decision_label(qa_summary.get('decision')))}</strong><br/>"
        f"<span class='meta'>Riesgo {html.escape(str(qa_summary.get('risk') or 'No registrado'))}</span>"
        f"<ul class='actions'>{reason_items}</ul>"
        f"<strong>Recomendación sugerida:</strong> {html.escape(recommendation)}"
        "</div>"
    )

def _render_manual_definition(payload: dict):
    manual = payload.get("manual_definition") or (payload.get("metadata") or {})
    definition = manual.get("build_definition") or "N/D"
    comment = manual.get("qa_comment") or "Sin comentario QA"
    responsible = (
        manual.get("responsible_display")
        or manual.get("definition_responsible_display")
        or "No registrado"
    )
    defined_at = manual.get("defined_at") or manual.get("definition_at") or "N/D"
    return (
        "<div class='callout'>"
        f"<strong>Decisión tomada por QA: {html.escape(str(definition))}</strong><br/>"
        f"<span class='meta'>Responsable: {html.escape(str(responsible))} · Fecha: {html.escape(_format_report_datetime(defined_at))}</span><br/>"
        f"<div class='report-pre'>{_report_multiline_html(comment, fallback='Sin comentario QA')}</div>"
        "</div>"
    )

def _render_executive_kpis(metrics: dict, bug_metrics: dict):
    stats = metrics.get("stats") or {}
    cards = [
        ("Pruebas asignadas", metrics.get("total_casos_asignados", 0), "muted"),
        ("Pruebas ejecutadas", metrics.get("total_ejecutados", 0), "blocked"),
        ("Cobertura de pruebas", _fmt_report_percent(metrics.get("cobertura_porcentaje")), "blocked"),
        ("Pruebas pasadas", stats.get("pasados", 0), "ok"),
        ("Pruebas fallidas", stats.get("fallados", 0), "fail"),
        ("Pruebas bloqueadas", stats.get("bloqueados", 0), "blocked"),
        ("Bugs abiertos", bug_metrics.get("open", 0), "warning"),
        ("Bugs criticos/altos", bug_metrics.get("high_open", 0), "fail"),
    ]
    return "<div class='grid'>" + "".join(
        f"<div class='metric {klass}'><span class='label'>{html.escape(label)}</span><span class='value'>{html.escape(str(value))}</span></div>"
        for label, value, klass in cards
    ) + "</div>"

def _render_development_summary(metrics: dict, bug_metrics: dict, failures: list, qa_summary: dict | None = None):
    stats = metrics.get("stats") or {}
    pending = stats.get("pendientes") if stats.get("pendientes") is not None else stats.get("sin_correr", 0)
    rows = [
        ("Pruebas asignadas", metrics.get("total_casos_asignados", 0)),
        ("Pruebas ejecutadas", metrics.get("total_ejecutados", 0)),
        ("Pruebas pasadas", stats.get("pasados", 0)),
        ("Fallos", stats.get("fallados", 0)),
        ("Bloqueos", stats.get("bloqueados", 0)),
        ("Pruebas pendientes", pending),
        ("Decisión QA", _qa_decision_label((qa_summary or {}).get("decision"))),
    ]
    return "<table class='compact'><tbody>" + "".join(
        f"<tr><th>{html.escape(label)}</th><td>{html.escape(str(value))}</td></tr>"
        for label, value in rows
    ) + "</tbody></table>"


def _render_development_corrected_bugs(bugs: list):
    if not bugs:
        return "<p class='muted-text'>No hay correcciones verificadas registradas.</p>"
    rows = []
    for bug in bugs:
        rows.append(
            "<tr>"
            f"<td><strong>{html.escape(development_bug_code(bug))}</strong></td>"
            f"<td>{_report_html(bug.get('titulo'), fallback='Sin título', max_len=320)}</td>"
            f"<td>{html.escape(development_build_name(bug))}</td>"
            f"<td>{html.escape(development_current_build_verification(bug))}</td>"
            "</tr>"
        )
    return (
        "<table><thead><tr><th>Bug</th><th>Resultado corregido</th>"
        "<th>Build de origen</th><th>Verificación en build actual</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )

def _render_temporal_metrics(temporal: dict):
    rows = [
        ("Build a primera ejecucion", _fmt_report_hours(temporal.get("build_to_first_execution_hours"))),
        ("Primera a ultima ejecucion", _fmt_report_hours(temporal.get("first_to_last_execution_hours"))),
        ("Ciclo QA total", _fmt_report_hours(temporal.get("qa_cycle_hours"))),
        ("Tiempo total invertido", _fmt_report_seconds(temporal.get("total_execution_seconds"))),
        ("Promedio por caso", _fmt_report_seconds(temporal.get("average_seconds_per_executed_case"))),
        ("Ultima actividad", temporal.get("last_activity_at") or "N/D"),
        ("Dias sin actividad", temporal.get("days_without_activity") if temporal.get("days_without_activity") is not None else "N/D"),
        ("Restante estimado", _fmt_report_seconds(temporal.get("estimated_remaining_seconds"))),
    ]
    return "<table class='compact'><tbody>" + "".join(
        f"<tr><th>{html.escape(label)}</th><td>{html.escape(str(value))}</td></tr>"
        for label, value in rows
    ) + "</tbody></table>"

def _render_bug_traceability(traceability: dict):
    rows = [
        ("MTTR", _fmt_report_hours(traceability.get("mttr_hours"))),
        ("Promedio abierto", _fmt_report_hours(traceability.get("avg_bug_open_hours"))),
        ("Primer comentario", _fmt_report_hours(traceability.get("avg_first_comment_hours"))),
        ("Reabiertos", _fmt_report_percent(traceability.get("reopened_percent"))),
        ("Con evidencia", _fmt_report_percent(traceability.get("with_evidence_percent"))),
        ("Fallos con bug", _fmt_report_percent(traceability.get("failures_with_bug_percent"))),
        ("Vencidos SLA", traceability.get("bugs_overdue_sla") or 0),
    ]
    return "<table class='compact'><tbody>" + "".join(
        f"<tr><th>{html.escape(label)}</th><td>{html.escape(str(value))}</td></tr>"
        for label, value in rows
    ) + "</tbody></table>"

def _render_executive_issues(cases: list):
    failed = [case for case in cases if str(case.get("estado")).upper() in {"FALLO", "BLOQUEADO"}][:5]
    if not failed:
        return "<p class='muted-text'>No hay fallos o bloqueos relevantes para este build.</p>"
    rows = []
    for case in failed:
        rows.append(
            "<tr>"
            f"<td><strong>{html.escape(str(case.get('codigo') or ''))}</strong><br/><span class='muted-text'>{html.escape(str(case.get('suite_breadcrumb') or 'Sin suite'))}</span></td>"
            f"<td>{html.escape(str(case.get('titulo') or ''))}</td>"
            f"<td><span class='pill {_report_badge_class(case.get('estado'))}'>{html.escape(str(case.get('estado') or ''))}</span></td>"
            f"<td>{html.escape(str(case.get('prioridad') or ''))}</td>"
            "</tr>"
        )
    return f"<table><thead><tr><th>Caso</th><th>Hallazgo</th><th>Estado</th><th>Prioridad</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"

def _render_bug_severity_summary(bugs: list):
    open_bugs = [bug for bug in bugs if _report_render_bug_is_active(bug)]
    if not open_bugs:
        return "<p class='muted-text'>No hay bugs abiertos asociados al build.</p>"
    by_severity = {}
    for bug in open_bugs:
        severity = str(bug.get("severidad") or "SIN_SEVERIDAD").upper()
        by_severity[severity] = by_severity.get(severity, 0) + 1
    rows = "".join(f"<tr><td>{html.escape(severity)}</td><td>{count}</td></tr>" for severity, count in sorted(by_severity.items()))
    return f"<table class='compact'><thead><tr><th>Severidad</th><th>Abiertos</th></tr></thead><tbody>{rows}</tbody></table>"

def _render_development_failures(request: Request, payload: dict, *, only_without_bug: bool = False, categories: dict | None = None):
    cases = ((payload.get("development") or {}).get("cases") or [])
    traceable_failures = (payload.get("failures_and_blockers") or (payload.get("development") or {}).get("failures") or [])
    if only_without_bug:
        traceable_failures = (categories or development_category_bugs(payload))["failures_without_bug"]
        cases = []
        if not traceable_failures:
            return "<p class='muted-text'>No hay excepciones sin bug abierto. Si no hubo pruebas ejecutadas, no se puede determinar un fallo sin bug.</p>"
    if traceable_failures:
        rows = []
        for item in traceable_failures:
            flags = item.get("flags") or {}
            badges = []
            if flags.get("sin_evidencia"):
                badges.append("<span class='pill fail'>Sin evidencia</span>")
            if flags.get("sin_bug_asociado"):
                badges.append("<span class='pill warning'>Sin bug abierto</span>")
            if flags.get("bloqueo_sin_motivo"):
                badges.append("<span class='pill blocked'>Sin motivo</span>")
            active_item_bugs = [bug for bug in (item.get("bug") or []) if bug.get("codigo") and _report_render_bug_is_active(bug)]
            bug_codes = ", ".join(str(bug.get("codigo")) for bug in active_item_bugs) or "Sin bug abierto"
            rows.append(
                "<tr>"
                f"<td><strong>{html.escape(str(item.get('case_code') or ''))}</strong><br/><span class='muted-text'>{html.escape(str(item.get('suite') or 'Sin suite'))}</span></td>"
                f"<td>{_report_html(item.get('case_title'), max_len=300)}<br/><span class='muted-text'>Prioridad: {html.escape(str(item.get('prioridad') or ''))} · Responsable: {html.escape(development_responsible_name(item))}</span></td>"
                f"<td><span class='pill {_report_badge_class(item.get('estado'))}'>{html.escape(str(item.get('estado') or ''))}</span><br/>Paso {html.escape(str(item.get('failed_step') or 'N/D'))}</td>"
                f"<td>{_report_html(item.get('expected'), fallback='N/D', max_len=600)}</td>"
                f"<td>{_report_html(item.get('obtained') or item.get('diagnosis'), fallback='Sin detalle', max_len=800)}</td>"
                f"<td><div class='report-cell-text'>{html.escape(bug_codes)}</div><div class='report-flags'>{''.join(badges)}</div></td>"
                "</tr>"
            )
        table = f"<div class='report-table-wrap'><table class='report-failures-table'><thead><tr><th>Caso</th><th>Contexto</th><th>Estado</th><th>Esperado</th><th>Obtenido / diagnostico</th><th>Bug / flags</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>"
        if only_without_bug:
            count = len(traceable_failures)
            return (
                f"<p><strong>Excepciones sin bug abierto: {count}</strong></p>"
                "<p class='muted-text'>Pendientes de investigar por QA; revise el detalle antes de asociar o crear un bug.</p>"
                f"<details><summary>Ver detalle de {count} excepciones</summary>{table}</details>"
            )
        return table
    if not cases:
        return "<p class='muted-text'>No hay fallos o bloqueos para diagnosticar.</p>"
    rows = []
    for case in cases:
        failure = case.get("failure") or {}
        rows.append(
            "<tr>"
            f"<td><strong>{html.escape(str(case.get('codigo') or ''))}</strong><br/><span class='muted-text'>{html.escape(str(case.get('suite_breadcrumb') or 'Sin suite'))}</span></td>"
            f"<td>{_report_html(case.get('titulo'), max_len=300)}<br/><span class='muted-text'>Prioridad: {html.escape(str(case.get('prioridad') or ''))} · Modo: {html.escape(str(case.get('execution_mode') or case.get('tipo_prueba') or ''))}</span></td>"
            f"<td><span class='pill {_report_badge_class(case.get('estado'))}'>{html.escape(str(case.get('estado') or ''))}</span><br/>Paso {html.escape(str(failure.get('step') or 'N/D'))}</td>"
            f"<td>{_report_html(failure.get('expected'), fallback='N/D', max_len=600)}</td>"
            f"<td>{_report_html(failure.get('observed'), fallback='Sin detalle reportado', max_len=800)}<br/><strong>Accion:</strong> {_report_html(case.get('recommendation'), fallback='Revisar evidencia', max_len=300)}</td>"
            f"<td>{_render_report_evidence(request, failure.get('evidencias') or [], failure.get('evidencia_url'), limit=3)}</td>"
            "</tr>"
        )
    return f"<div class='report-table-wrap'><table class='report-failures-table'><thead><tr><th>Caso</th><th>Contexto</th><th>Estado</th><th>Esperado</th><th>Diagnóstico</th><th>Evidencia</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>"

def _render_bug_view_link(request: Request, bug: dict, *, target: str = "bugs") -> str:
    url = _report_bug_tracker_url(request, bug, target=target)
    if not url:
        return ""
    label = "Abrir en Centro de Incidencias" if target == "incidencias" else "Abrir en Bug Tracker"
    return f" <a class='report-action-link' href='{html.escape(url)}' target='_blank' rel='noopener'>{label}</a>"

def _render_traceable_bugs(request: Request, bugs: list, *, target: str = "bugs"):
    if not bugs:
        return "<p class='muted-text'>No hay bugs asociados a este snapshot.</p>"
    rows = []
    for bug in bugs:
        evidence = "Completa" if bug.get("has_evidence") else "Faltante"
        is_open = (
            _report_render_bug_is_active(bug)
            if "is_open" not in bug
            else bool(bug.get("is_open"))
        )
        timing = bug.get("tiempo_abierto_horas") if is_open else bug.get("tiempo_resolucion_horas")
        timing_label = "Tiempo abierto" if is_open else "Tiempo de resolución"
        view_link = _render_bug_view_link(request, bug, target=target)
        rows.append(
            "<tr>"
                f"<td><strong>{html.escape(development_bug_code(bug))}</strong>{view_link}<br/><span class='muted-text'>{_report_html(bug.get('titulo'), fallback='Sin título', max_len=300)}</span></td>"
                f"<td>{html.escape(development_case_code(bug))}<br/><span class='muted-text'>{html.escape(str(bug.get('suite') or 'Sin suite'))}</span></td>"
            f"<td>{html.escape(str(bug.get('severidad') or ''))}<br/><span class='muted-text'>Prioridad {html.escape(str(bug.get('prioridad') or ''))}</span></td>"
                f"<td>{html.escape(str(bug.get('estado') or ''))}<br/><span class='muted-text'>{'Abierto' if is_open else 'Cerrado'}</span></td>"
            f"<td>{html.escape(_fmt_report_hours(timing))}<br/><span class='muted-text'>{timing_label}</span></td>"
                f"<td><span class='muted-text'>Origen: {html.escape(development_build_name(bug))}<br/>Verificación actual: {html.escape(development_current_build_verification(bug))}</span></td>"
                f"<td>{html.escape(evidence)}<br/><span class='muted-text'>Resp.: {html.escape(development_responsible_name(bug))}</span></td>"
            "</tr>"
        )
    return f"<table><thead><tr><th>Bug</th><th>Caso / suite</th><th>Severidad</th><th>Estado</th><th>Tiempo del bug</th><th>Build (origen / corrección)</th><th>Evidencia / responsable</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"


def _conversation_json(value: Any, *, max_len: int = 7000) -> str:
    try:
        rendered = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    except (TypeError, ValueError):
        rendered = str(value or "")
    return _report_text(rendered, fallback="N/D", max_len=max_len)


def _conversation_value(value: Any, *, fallback: str = "N/D", max_len: int = 900) -> str:
    if value in (None, "", [], {}):
        return fallback
    if isinstance(value, (dict, list)):
        return _conversation_json(value, max_len=max_len)
    return _report_text(value, fallback=fallback, max_len=max_len)


def _render_conversational_turn(turn: dict, *, failed_index: Any = None, bug: dict | None = None) -> str:
    bug = bug or {}
    observed = turn.get("observed") if isinstance(turn.get("observed"), dict) else {}
    technical_index = turn.get("technical_index", turn.get("index"))
    visible_index = turn.get("turn_number") or (int(technical_index) + 1 if str(technical_index).isdigit() else "N/D")
    status = str(turn.get("status") or observed.get("status") or "NOT_EXECUTED").upper()
    is_not_executed = status in {"NOT_EXECUTED", "NO_EJECUTADO", "SIN_CORRER"}
    is_failed = (
        str(technical_index) == str(failed_index)
        or status in {"FAILED", "FAIL", "FALLO", "BLOCKED", "BLOQUEADO"}
        or any(isinstance(item, dict) and item.get("passed") is False for item in (turn.get("assertions") or []))
    )
    status_label = "NO EJECUTADO" if is_not_executed else ("FALLO" if is_failed else ("PASO" if status in {"PASSED", "PASS", "PASO"} else status))
    status_class = "blocked" if is_not_executed else ("fail" if is_failed else "ok")
    response_text = turn.get("response_text") or observed.get("responseText") or observed.get("response_text")
    response = observed.get("response") or turn.get("response")
    if not response_text and isinstance(response, dict):
        response_text = response.get("text") or response.get("message") or response.get("content")
    request = observed.get("request") or turn.get("request")
    response_for_evidence = response if response is not None else observed.get("response")
    assertions = turn.get("assertions") or observed.get("assertions") or []
    assertion_items = []
    for assertion in assertions[:20]:
        if not isinstance(assertion, dict):
            assertion_items.append(f"<li>{_report_bug_html(bug, assertion, max_len=300)}</li>")
            continue
        passed = assertion.get("passed")
        klass = "ok" if passed is True else ("fail" if passed is False else "muted")
        label = "PASÓ" if passed is True else ("FALLÓ" if passed is False else "PENDIENTE")
        detail = assertion.get("message") or assertion.get("detail") or assertion.get("observed") or assertion.get("rule") or "Aserción"
        assertion_items.append(f"<li><span class='pill {klass}'>{label}</span> {_report_bug_html(bug, detail, max_len=500)}</li>")
    assertions_html = "<ul class='actions conversation-assertions'>" + "".join(assertion_items) + "</ul>" if assertion_items else "<span class='muted-text'>Sin aserciones determinísticas.</span>"
    raw_blocks = (
        f"<details><summary>Ver request, response y evidencia técnica</summary>"
        f"<div class='conversation-technical-grid'>"
        f"<div><strong>Request</strong><pre class='report-pre'>{_report_bug_json(bug, request, max_len=9000)}</pre></div>"
        f"<div><strong>Response</strong><pre class='report-pre'>{_report_bug_json(bug, response_for_evidence, max_len=9000)}</pre></div>"
        f"</div></details>"
    )
    return (
        f"<article class='conversation-turn {status_class}'>"
        f"<header><strong>Turno visible {html.escape(str(visible_index))}</strong> · índice técnico {html.escape(str(technical_index if technical_index is not None else 'N/D'))}"
        f"<span class='pill {status_class}'>{html.escape(status_label)}</span></header>"
        f"<div class='conversation-meta'>HTTP {html.escape(str(turn.get('status_code') or observed.get('statusCode') or observed.get('status_code') or 'N/D'))} · "
        f"{html.escape(str(turn.get('latency_ms') or observed.get('latencyMs') or observed.get('latency_ms') or 'N/D'))} ms"
        f"{(' · ' + html.escape(str(turn.get('failure_type') or observed.get('failure_type')))) if turn.get('failure_type') or observed.get('failure_type') else ''}</div>"
        f"<p><strong>Mensaje enviado:</strong><br/>{_report_bug_html(bug, turn.get('message'), fallback='No ejecutado', max_len=1200)}</p>"
        f"<p><strong>Respuesta recibida:</strong><br/>{_report_bug_html(bug, response_text, fallback='Sin respuesta', max_len=1800)}</p>"
        f"<p><strong>Resultado esperado:</strong><br/>{_report_bug_html(bug, _conversation_value(turn.get('expected')), max_len=1200)}</p>"
        f"<p><strong>Observación:</strong><br/>{_report_bug_html(bug, turn.get('observation'), fallback='Sin observación adicional', max_len=900)}</p>"
        f"<div><strong>Aserciones:</strong>{assertions_html}</div>"
        f"{raw_blocks}"
        f"</article>"
    )


def _report_bug_case_snapshot(bug: dict) -> dict:
    snapshot = bug.get("case_snapshot")
    return snapshot if isinstance(snapshot, dict) else {}


def _report_bug_execution_snapshot(bug: dict) -> dict:
    snapshot = bug.get("execution_snapshot")
    return snapshot if isinstance(snapshot, dict) else {}


def _report_bug_public_test_data(bug: dict) -> bool:
    policies = [bug.get("evidence_policy"), bug.get("api_evidence_policy")]
    for context_key in ("api_context", "conversational_context"):
        context = bug.get(context_key)
        if isinstance(context, dict):
            policies.append(context.get("evidence_policy"))
    return bool(
        bug.get("public_test_data") is True
        or any(isinstance(policy, dict) and policy.get("public_test_data") is True for policy in policies)
    )


def _report_bug_html(bug: dict, value: Any, *, fallback: str = "", max_len: int = 1200) -> str:
    """Escape report values while preserving explicitly public test data.

    ``sanitize_external_error`` intentionally hides hosts and credentials for
    ordinary shared reports. A snapshot marked ``public_test_data`` is the
    explicit exception defined by the evidence policy: it remains HTML-escaped
    but is not semantically redacted, so a reader can reproduce the test.
    """
    if value in (None, ""):
        return html.escape(fallback)
    text = str(value).replace("\x00", "")
    if _report_bug_public_test_data(bug):
        return html.escape(text[:max_len] + ("..." if len(text) > max_len else ""))
    return _report_html(value, fallback=fallback, max_len=max_len)


def _report_bug_json(bug: dict, value: Any, *, max_len: int = 7000) -> str:
    if _report_bug_public_test_data(bug):
        try:
            rendered = json.dumps(value, ensure_ascii=False, indent=2, default=str)
        except (TypeError, ValueError):
            rendered = str(value or "")
        rendered = rendered[:max_len] + ("..." if len(rendered) > max_len else "")
        return html.escape(rendered)
    return html.escape(_conversation_json(value, max_len=max_len))


def _render_common_bug_context(bug: dict, *, case: dict | None = None, execution: dict | None = None) -> str:
    """Render the shared reproducibility context for every bug format.

    API and Chatbot add format-specific evidence after this block, while
    classic bugs use it as their complete context. The values arrive from a
    frozen report snapshot, so this function deliberately reads only scalar
    fields selected by the snapshot builder instead of dumping metadata.
    """
    case = case or _report_bug_case_snapshot(bug)
    execution = execution or _report_bug_execution_snapshot(bug)
    rows = [
        ("Caso", case.get("code") or bug.get("case_code") or "No registrado"),
        ("Título del caso", case.get("title") or bug.get("case_title") or bug.get("titulo") or "No registrado"),
        ("Versión del caso", case.get("version") or bug.get("case_version") or "No registrado"),
        ("Build", execution.get("build_name") or execution.get("build_code") or bug.get("build_code") or "No registrado"),
        ("Componente", bug.get("component_name") or bug.get("modulo_funcional") or "No registrado"),
        ("Ambiente", execution.get("environment_name") or bug.get("ambiente_nombre") or "No registrado"),
        ("URL del ambiente", execution.get("environment_url") or bug.get("ambiente_url") or "No registrado"),
        ("Dataset", execution.get("dataset_name") or bug.get("dataset_name") or "No registrado"),
        ("Modo", execution.get("mode") or bug.get("execution_mode") or "No registrado"),
        ("Navegador", bug.get("navegador") or "No registrado"),
        ("Dispositivo", bug.get("dispositivo") or "No registrado"),
        ("Resolución", bug.get("resolucion") or "No registrado"),
        ("Sistema operativo", bug.get("sistema_operativo") or "No registrado"),
        ("Versión de la aplicación", bug.get("version_app") or "No registrado"),
        ("URL afectada", bug.get("url_afectada") or "No registrado"),
    ]
    rows_html = "".join(
        f"<tr><th>{html.escape(str(label))}</th><td>{html.escape(str(value)) if label == 'URL del ambiente' and value not in (None, '') else _report_bug_html(bug, value, fallback='N/D', max_len=1000)}</td></tr>"
        for label, value in rows
    )
    return f"<h3>Contexto de reproducción</h3><table class='compact'><tbody>{rows_html}</tbody></table>"


def _render_common_bug_fields(bug: dict, *, case: dict | None = None, include_steps: bool = True) -> str:
    """Render fields shared by classic, API and conversational bug records."""
    case = case or _report_bug_case_snapshot(bug)
    comments = bug.get("comments") or []
    comment_items = "".join(
        f"<li>{html.escape(str(comment.get('created_at') or ''))}: {_report_html(comment.get('comentario'), max_len=900)}</li>"
        for comment in comments[:20] if isinstance(comment, dict)
    ) or "<li>Sin comentarios congelados.</li>"
    attachments = bug.get("attachments") or []
    attachment_items = []
    for item in attachments[:20]:
        if not isinstance(item, dict):
            continue
        attachment = item.get("attachment") if isinstance(item.get("attachment"), dict) else {}
        name = attachment.get("filename_original") or attachment.get("filename") or item.get("tipo") or "Evidencia"
        attachment_items.append(f"<li>{_report_html(name, max_len=300)}</li>")
    attachments_html = "".join(attachment_items) or "<li>Sin evidencias adjuntas congeladas.</li>"
    steps_html = (
        f"<div><strong>Pasos para reproducir:</strong>{_report_steps_html(bug.get('pasos_reproduccion'), fallback='N/D', max_len=5000)}</div>"
        if include_steps else ""
    )
    return (
        f"<h3>Datos del caso y resultado</h3>"
        f"<p><strong>Descripción:</strong><br/>{_report_bug_html(bug, bug.get('descripcion') or case.get('description'), fallback='Sin descripción', max_len=1800)}</p>"
        f"<p><strong>Precondiciones:</strong><br/>{_report_bug_html(bug, bug.get('precondiciones') or case.get('preconditions'), fallback='N/D', max_len=1400)}</p>"
        f"<p><strong>Postcondiciones:</strong><br/>{_report_bug_html(bug, bug.get('postcondiciones') or case.get('postconditions'), fallback='N/D', max_len=1400)}</p>"
        f"{steps_html}"
        f"<p><strong>Datos utilizados en la ejecución:</strong><br/>{_report_bug_html(bug, bug.get('datos_prueba'), fallback='N/D', max_len=1400)}</p>"
        f"<p><strong>Resultado esperado:</strong><br/>{_report_bug_html(bug, bug.get('resultado_esperado'), fallback='N/D', max_len=1400)}</p>"
        f"<p><strong>Resultado obtenido:</strong><br/>{_report_bug_html(bug, bug.get('resultado_obtenido') or bug.get('comportamiento_actual'), fallback='N/D', max_len=1800)}</p>"
        f"<p><strong>Impacto de negocio:</strong><br/>{_report_bug_html(bug, bug.get('impacto_negocio'), fallback='N/D', max_len=1000)}</p>"
        f"<p><strong>Frecuencia:</strong> {_report_bug_html(bug, bug.get('frecuencia'), fallback='N/D', max_len=180)} · "
        f"<strong>Módulo funcional:</strong> {_report_bug_html(bug, bug.get('modulo_funcional'), fallback='N/D', max_len=300)}</p>"
        f"<p><strong>Logs / contexto técnico:</strong><br/>{_report_bug_html(bug, bug.get('logs_relevantes') or bug.get('error_tecnico'), fallback='Sin logs', max_len=1800)}</p>"
        f"<p><strong>Error técnico:</strong><br/>{_report_bug_html(bug, bug.get('error_tecnico'), fallback='N/D', max_len=1800)}</p>"
        f"<details><summary>Stack trace</summary><pre class='report-pre'>{_report_bug_html(bug, bug.get('stack_trace'), fallback='N/D', max_len=9000)}</pre></details>"
        f"<p><strong>Resolución / motivo de cierre:</strong><br/>{_report_bug_html(bug, bug.get('resolucion_bug') or bug.get('motivo_cierre'), fallback='N/D', max_len=1400)}</p>"
        f"<p><strong>Notas QA:</strong><br/>{_report_bug_html(bug, bug.get('notas_qa'), fallback='Sin notas', max_len=1200)}</p>"
        f"<h3>Comentarios</h3><ul class='actions'>{comment_items}</ul>"
        f"<h3>Evidencias adjuntas</h3><ul class='actions'>{attachments_html}</ul>"
    )


def _render_conversational_bug_details(request: Request, bug: dict) -> str:
    context = bug.get("conversational_context") or {}
    case = context.get("case_snapshot") if isinstance(context.get("case_snapshot"), dict) else _report_bug_case_snapshot(bug)
    execution = context.get("execution_snapshot") or {}
    evaluation = context.get("evaluation") or bug.get("chatbot_evaluation") or {}
    technical = context.get("technical_evidence") or bug.get("chatbot_technical_evidence") or {}
    turns = context.get("conversation_turns") or bug.get("conversation_turns") or []
    failed_index = evaluation.get("turn_index")
    if failed_index is None:
        failed_index = bug.get("chatbot_turn_index")
    turn_cards = "".join(_render_conversational_turn(turn, failed_index=failed_index, bug=bug) for turn in turns[:40])
    human = evaluation.get("human_evaluation") or {}
    human_note = human.get("notes") if isinstance(human, dict) else human
    technical_blocks = []
    for label, value in (("Herramientas", technical.get("tools")), ("Comprobaciones de memoria", technical.get("memory_checks")), ("Trazas técnicas", technical.get("request_response") or technical.get("conversation"))):
        if value:
            technical_blocks.append(f"<details><summary>{label}</summary><pre class='report-pre'>{html.escape(context_json_without_internal_ids(value)[:9000])}</pre></details>")
    return (
        "<div class='conversation-report'>"
        f"<p><span class='pill muted'>CONVERSACIONAL</span> <span class='pill {_report_badge_class(evaluation.get('status') or bug.get('estado'))}'>{html.escape(str(evaluation.get('status') or bug.get('estado') or 'N/D'))}</span> "
        f"<strong>{html.escape(str(evaluation.get('finding_type') or bug.get('chatbot_finding_type') or 'OTHER'))}</strong></p>"
        f"{_render_common_bug_context(bug, case=case, execution=execution)}"
        f"{_render_common_bug_fields(bug, case=case, include_steps=False)}"
        f"<table class='compact'><tbody>"
        f"<tr><th>Ambiente / dataset</th><td>{_report_html(execution.get('environment_name') or bug.get('ambiente_nombre'), fallback='No registrado')} / {_report_html(execution.get('dataset_name') or bug.get('dataset_name'), fallback='No registrado')}</td></tr>"
        f"<tr><th>Duración</th><td>{_report_html(execution.get('duration_seconds'), fallback='No registrado')} s · revisión humana: {_report_html(evaluation.get('review_status') or evaluation.get('human_review_required'), fallback='No registrado')}</td></tr>"
        f"</tbody></table>"
        f"<p><strong>Nota de evaluación:</strong><br/>{_report_html(human_note or evaluation.get('review_note'), fallback='Sin nota', max_len=1200)}</p>"
        f"<h3>Conversación obtenida</h3>{conversation_content}"
        f"{''.join(technical_blocks)}"
        "</div>"
    )


def _report_bug_has_conversational_evidence(bug: dict) -> bool:
    """Use the readable conversation view whenever a snapshot has that evidence.

    This also protects reports created from legacy snapshots where the context
    type was not frozen yet but the enrichment step already attached turns.
    """
    return bool(
        str(bug.get("tipo_contexto") or "CLASICO").upper() == "CONVERSACIONAL"
        or bug.get("conversational_context")
        or bug.get("conversation_turns")
    )


def _report_api_context(bug: dict) -> dict:
    context = bug.get("api_context")
    return context if isinstance(context, dict) else {}


def _report_bug_is_api(bug: dict) -> bool:
    """Keep API bugs on the API renderer even when legacy evidence is absent."""
    metadata = bug.get("metadata_json") if isinstance(bug.get("metadata_json"), dict) else {}
    case_code = str(bug.get("case_code") or bug.get("caso_id") or "").upper()
    metadata_format = str(metadata.get("format") or metadata.get("formato_prueba") or "").upper()
    return bool(
        str(bug.get("tipo_contexto") or "").upper() == "API"
        or bug.get("api_context")
        or metadata_format == "API"
        or case_code.startswith("TC-API-")
    )


def _render_api_bug_details(request: Request, bug: dict, *, compact: bool = False) -> str:
    """Render the API contract and the values used by the frozen execution.

    The context is produced by ``api_bug_context`` with the explicit evidence
    policy already applied. We still escape every scalar here because report
    snapshots are shared outside the authenticated application.
    """
    context = _report_api_context(bug)
    case = context.get("case_snapshot") if isinstance(context.get("case_snapshot"), dict) else {}
    execution = context.get("execution_snapshot") if isinstance(context.get("execution_snapshot"), dict) else {}
    technical = context.get("technical_evidence") if isinstance(context.get("technical_evidence"), dict) else {}
    metadata = bug.get("metadata_json") if isinstance(bug.get("metadata_json"), dict) else {}
    config = context.get("api_config_snapshot") if isinstance(context.get("api_config_snapshot"), dict) else {}
    result = context.get("api_resultado") if isinstance(context.get("api_resultado"), dict) else {}
    variables = execution.get("variables_used") if isinstance(execution.get("variables_used"), dict) else {}
    if not variables:
        variables = bug.get("api_variables_used") if isinstance(bug.get("api_variables_used"), dict) else {}
    if not variables:
        variables = metadata.get("api_variables_used") if isinstance(metadata.get("api_variables_used"), dict) else {}
    evidence_policy = context.get("evidence_policy") if isinstance(context.get("evidence_policy"), dict) else {}
    if not evidence_policy:
        evidence_policy = metadata.get("evidence_policy") if isinstance(metadata.get("evidence_policy"), dict) else {}
    if not evidence_policy and isinstance(bug.get("api_evidence_policy"), dict):
        evidence_policy = bug.get("api_evidence_policy") or {}
    public_test_data = (
        evidence_policy.get("public_test_data") is True
        or bug.get("public_test_data") is True
    )
    evidence_max_len = 100_000 if public_test_data else 12_000
    variable_limit = len(variables) if public_test_data else 80
    step_limit = len(context.get("steps") or []) if public_test_data else 30
    resolved_dataset = execution.get("resolved_dataset") or metadata.get("dataset_resolved_values") or []
    request_config = config.get("request") if isinstance(config.get("request"), dict) else config
    response = result.get("response") if isinstance(result.get("response"), dict) else result
    identifiers = [
        ("Caso", case.get("code") or bug.get("case_code") or "No registrado"),
        ("Build", execution.get("build_name") or execution.get("build_code") or bug.get("build_code") or "No registrado"),
        ("Ambiente", execution.get("environment_name") or bug.get("ambiente_nombre") or "No registrado"),
        ("URL del ambiente", execution.get("environment_url") or bug.get("ambiente_url") or "No registrado"),
        ("Dataset", execution.get("dataset_name") or bug.get("dataset_name") or "No registrado"),
        ("Estado técnico", execution.get("status") or result.get("status") or "N/D"),
        ("Duración", f"{execution.get('duration_seconds')} s" if execution.get("duration_seconds") is not None else "N/D"),
    ]
    identifier_rows = "".join(
        f"<tr><th>{html.escape(str(label))}</th><td>{html.escape(str(value)) if label == 'URL del ambiente' and value not in (None, '') else _report_bug_html(bug, value, fallback='N/D', max_len=1000 if public_test_data else 260)}</td></tr>"
        for label, value in identifiers
    )
    variable_rows = "".join(
        f"<tr><th>{_report_bug_html(bug, name, max_len=500 if public_test_data else 220)}</th><td>{_report_bug_html(bug, value, fallback='[SIN VALOR]', max_len=100_000 if public_test_data else 900)}</td></tr>"
        for name, value in list(variables.items())[:variable_limit]
    ) or "<tr><td colspan='2'>No se conservaron variables resueltas.</td></tr>"
    dataset_html = _report_bug_html(
        bug,
        resolved_dataset,
        fallback="Sin dataset específico",
        max_len=100_000 if public_test_data else 1800,
    )
    context_notice = ""
    if not context:
        context_notice = (
            "<p class='warning-text'><strong>Contexto API parcial:</strong> "
            "no se encontró la ejecución persistida en este snapshot. Se muestran los datos conservados en el bug; "
            "generá un informe nuevo para incluir solicitud, respuesta y validaciones completas.</p>"
        )
    base = (
        f"<p><span class='pill muted'>API</span> "
        f"<span class='pill {_report_badge_class(bug.get('estado'))}'>{html.escape(str(bug.get('estado') or 'N/D'))}</span></p>"
        + context_notice
        + f"<table class='compact'><tbody>{identifier_rows}</tbody></table>"
        f"<p><strong>Descripción del caso:</strong><br/>{_report_bug_html(bug, bug.get('descripcion') or case.get('description'), fallback='Sin descripción', max_len=1400)}</p>"
        f"<p><strong>Precondiciones:</strong><br/>{_report_bug_html(bug, bug.get('precondiciones') or case.get('preconditions'), fallback='N/D', max_len=1100)}</p>"
        f"<p><strong>Postcondiciones:</strong><br/>{_report_bug_html(bug, bug.get('postcondiciones') or case.get('postconditions') or metadata.get('case_postconditions'), fallback='N/D', max_len=1100)}</p>"
        f"<p><strong>Datos de prueba del bug:</strong><br/>{_report_bug_html(bug, bug.get('datos_prueba'), fallback='N/D', max_len=1000)}</p>"
        f"<p><strong>Variables utilizadas en la ejecución:</strong></p><table class='compact'><tbody>{variable_rows}</tbody></table>"
        f"<p><strong>Dataset resuelto:</strong><br/>{dataset_html}</p>"
        f"<p><strong>Esperado:</strong><br/>{_report_bug_html(bug, bug.get('resultado_esperado') or result.get('expected'), fallback='N/D', max_len=1100)}</p>"
        f"<p><strong>Obtenido:</strong><br/>{_report_bug_html(bug, bug.get('resultado_obtenido') or bug.get('comportamiento_actual') or result.get('observed'), fallback='N/D', max_len=1300)}</p>"
    )
    if compact:
        return base
    steps = context.get("steps") or []
    step_items = []
    for step in steps[:step_limit]:
        if not isinstance(step, dict):
            continue
        step_name = step.get("name") or f"Solicitud {step.get('visible_index') or step.get('index') or 'N/D'}"
        assertions = step.get("assertions") or []
        assertion_text = ", ".join(
            ("PASÓ" if item.get("passed") is True else "FALLÓ" if item.get("passed") is False else "PENDIENTE")
            if isinstance(item, dict) else str(item)
            for item in assertions[:20]
        ) or "Sin aserciones"
        step_items.append(
            f"<li><strong>{_report_bug_html(bug, step_name, max_len=260)}</strong> · "
            f"HTTP {_report_bug_html(bug, step.get('status_code'), fallback='N/D')} · {_report_bug_html(bug, step.get('latency_ms'), fallback='N/D')} ms · "
            f"{_report_bug_html(bug, step.get('status'), fallback='N/D')} · Aserciones: {_report_bug_html(bug, assertion_text, max_len=600)}</li>"
        )
    steps_html = "<ol class='actions'>" + "".join(step_items) + "</ol>" if step_items else "<p class='muted-text'>No hay solicitudes individuales conservadas.</p>"
    request_block = (
        f"<details><summary>Solicitud API congelada</summary><pre class='report-pre'>{_report_bug_json(bug, request_config, max_len=evidence_max_len)}</pre></details>"
        if request_config
        else "<p class='muted-text'>No se conservó la configuración de solicitud API en este snapshot.</p>"
    )
    response_block = (
        f"<details><summary>Respuesta y validaciones</summary><pre class='report-pre'>{_report_bug_json(bug, response, max_len=evidence_max_len)}</pre>{steps_html}</details>"
        if response or steps
        else "<p class='muted-text'>No se conservaron respuesta ni validaciones de la ejecución.</p>"
    )
    return (
        base
        + request_block
        + response_block
        + f"<p><strong>Evidencia técnica:</strong> {_report_bug_html(bug, technical.get('schema_version'), fallback='N/D')} · "
        f"Errores: {_report_bug_html(bug, technical.get('errors'), fallback='Ninguno', max_len=1000)} · "
        f"Hash: {_report_bug_html(bug, context.get('evidence_sha256'), fallback='N/D', max_len=120)}</p>"
        + f"<p><strong>Notas QA:</strong><br/>{_report_bug_html(bug, bug.get('notas_qa'), fallback='Sin notas', max_len=1000)}</p>"
    )


def _render_bug_reproduction_details(request: Request, bugs: list, *, compact: bool = False, target: str = "bugs") -> str:
    """Render reproducibility cards for API, classic and conversational bugs."""
    if not bugs:
        return "<p class='muted-text'>No hay bugs asociados para detallar.</p>"
    cards = []
    for bug in bugs:
        view_link = _render_bug_view_link(request, bug, target=target)
        if _report_bug_has_conversational_evidence(bug):
            content = _render_conversational_bug_details(request, bug)
        elif _report_bug_is_api(bug):
            content = _render_api_bug_details(request, bug, compact=compact)
        else:
            content = (
                _render_common_bug_context(bug)
                + _render_common_bug_fields(bug)
            )
        cards.append(
            "<div class='subcard'>"
            f"<h3>{html.escape(str(bug.get('codigo') or 'Bug'))} · {_report_html(bug.get('titulo'), fallback='Sin título', max_len=320)}{view_link}</h3>"
            f"<p><span class='pill fail'>{html.escape(str(bug.get('severidad') or ''))}</span> "
            f"<span class='pill warning'>{html.escape(str(bug.get('prioridad') or ''))}</span> "
            f"<span class='pill muted'>{html.escape(str(bug.get('estado') or ''))}</span></p>"
            f"{content}</div>"
        )
    return "".join(cards)

def _render_development_bug_details(request: Request, bugs: list):
    if not bugs:
        return "<p class='muted-text'>No hay bugs asociados para detallar.</p>"
    count = len(bugs)
    return (
        f"<p><strong>Fichas técnicas disponibles: {count}</strong></p>"
        f"<details><summary>Ver fichas técnicas ({count})</summary>"
        f"{_render_bug_reproduction_details(request, bugs, target='incidencias')}"
        "</details>"
    )

def _render_evidence_items(request: Request, items: list):
    if not items:
        return "<p class='muted-text'>Sin evidencias listadas en el snapshot.</p>"
    rows = []
    for item in items[:40]:
        safe_url = _report_public_url(request, item.get("url"))
        link = f"<a href='{html.escape(safe_url)}' target='_blank' rel='noopener'>Abrir</a>" if safe_url else "Sin link"
        rows.append(
            "<tr>"
            f"<td>{html.escape(str(item.get('case_code') or item.get('bug') or 'N/D'))}</td>"
            f"<td>{html.escape(str(item.get('type') or 'archivo'))}</td>"
            f"<td>{html.escape(str(item.get('name') or 'Evidencia'))}</td>"
            f"<td>{html.escape(_format_report_datetime(item.get('created_at')))}</td>"
            f"<td>{html.escape(str(item.get('created_by') or 'N/D'))}</td>"
            f"<td><span class='pill {'ok' if item.get('status') == 'completa' else 'fail'}'>{html.escape(str(item.get('status') or 'N/D'))}</span></td>"
            f"<td>{link}</td>"
            "</tr>"
        )
    return f"<table><thead><tr><th>Caso/Bug</th><th>Tipo</th><th>Nombre</th><th>Fecha</th><th>Usuario</th><th>Estado</th><th>Link</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"

def _render_snapshot_integrity(payload: dict, snapshot: models.SharedReportSnapshot):
    meta = payload.get("metadata") or {}
    metrics = payload.get("metrics") or {}
    comparison = payload.get("comparison") or metrics.get("comparison") or {}
    bundle_paths = meta.get("bundle_paths") or {}
    rows = [
        ("Snapshot group", meta.get("snapshot_group_id")),
        ("Hash", meta.get("snapshot_hash") or snapshot.metrics_hash),
        ("Fecha/hora", _format_report_datetime(meta.get("snapshot_at") or snapshot.created_at)),
        ("Proyecto", meta.get("proyecto")),
        ("Componente", meta.get("componente")),
        ("Build", meta.get("build")),
        ("Cobertura delta", comparison.get("coverage_delta")),
        ("Fallos delta", comparison.get("failed_delta")),
        ("Estado QA actual", comparison.get("qa_status_current") or meta.get("qa_state")),
        ("Link ejecutivo", bundle_paths.get("executive")),
        ("Link desarrollo", bundle_paths.get("development")),
        ("Link snapshot", bundle_paths.get("internal")),
    ]
    return "<table class='compact'><tbody>" + "".join(
        f"<tr><th>{html.escape(str(label))}</th><td>{html.escape(str(value if value is not None else 'N/D'))}</td></tr>"
        for label, value in rows
    ) + "</tbody></table>"

def _render_bug_tracking(tracking: list):
    if not tracking:
        return "<p class='muted-text'>No hay bugs vinculados para seguimiento.</p>"
    rows = []
    for item in tracking:
        external = " ".join(filter(None, [str(item.get("external_provider") or ""), str(item.get("external_issue_id") or "")])) or "N/D"
        builds = ", ".join(str(value) for value in (item.get("affected_builds") or [])) or "N/D"
        rows.append(
            "<tr>"
            f"<td><strong>{html.escape(str(item.get('codigo') or ''))}</strong><br/><span class='muted-text'>{html.escape(external)}</span></td>"
            f"<td>{html.escape(str(item.get('titulo') or ''))}<br/><span class='muted-text'>{html.escape(str(item.get('last_comment') or 'Sin ultimo comentario'))}</span></td>"
            f"<td>{html.escape(str(item.get('severidad') or ''))}<br/><span class='muted-text'>Prioridad {html.escape(str(item.get('prioridad') or ''))}</span></td>"
            f"<td>{html.escape(str(item.get('estado') or ''))}<br/><span class='muted-text'>{html.escape(str(item.get('current_status') or ''))}</span></td>"
            f"<td>Primera: {html.escape(str(item.get('first_seen_build') or 'N/D'))}<br/>Ultima: {html.escape(str(item.get('last_seen_build') or 'N/D'))}<br/><span class='muted-text'>{html.escape(builds)}</span></td>"
            "</tr>"
        )
    return f"<table><thead><tr><th>Bug / Ticket</th><th>Detalle</th><th>Severidad</th><th>Estado</th><th>Builds</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"

def _render_development_actions(payload: dict):
    dev = payload.get("development") or {}
    cases = dev.get("cases") or []
    tracking = dev.get("bug_tracking") or []
    actions = []
    if cases:
        actions.append("Re-ejecutar los casos bloqueados despues de corregir datos, ambiente o selectores.")
        actions.append("Asociar cada fallo sin ticket a un bug interno o ticket externo antes de cerrar el build.")
    if any(item.get("current_status") == "Sigue abierto" for item in tracking):
        actions.append("Priorizar bugs abiertos que afectan el build actual y validar correccion en el proximo build.")
    if not actions:
        actions.append("No hay acciones tecnicas pendientes detectadas para este snapshot.")
    return "<ul class='actions'>" + "".join(f"<li>{html.escape(action)}</li>" for action in actions) + "</ul>"
__all__ = ["_qa_decision_label","_render_calculated_kpis","_render_qa_decision","_render_manual_definition","_render_executive_kpis","_render_development_summary","_render_development_corrected_bugs","_render_temporal_metrics","_render_bug_traceability","_render_executive_issues","_render_bug_severity_summary","_render_development_failures","_render_bug_view_link","_render_traceable_bugs","_render_development_bug_details","_render_bug_reproduction_details","_render_api_bug_details","_report_api_context","_report_bug_is_api","_render_evidence_items","_render_snapshot_integrity","_render_bug_tracking","_render_development_actions","_report_bug_has_conversational_evidence"]

import os
import re
import csv
import io
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


def _render_calculated_kpis(metrics: dict, bug_metrics: dict, failures: list):
    stats = metrics.get("stats") or {}
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
        ("Pruebas fallidas sin bug", len([item for item in failures if (item.get("flags") or {}).get("sin_bug_asociado")]), "fail", "sin bug abierto"),
        ("Bugs sin evidencia", bug_metrics.get("without_evidence", 0), "warning", "requieren respaldo"),
    ]
    return "<div class='grid'>" + "".join(
        f"<div class='metric {klass}'><span class='label'>{html.escape(label)}</span><span class='value'>{html.escape(str(value))}</span><span class='muted-text'>{html.escape(base)}</span></div>"
        for label, value, klass, base in cards
    ) + "</div>"

def _render_qa_decision(qa_summary: dict):
    reasons = qa_summary.get("reasons") or ([qa_summary.get("summary")] if qa_summary.get("summary") else [])
    reason_items = "".join(f"<li>{html.escape(str(reason))}</li>" for reason in reasons)
    recommendation = "No liberar hasta resolver riesgos altos." if not qa_summary.get("recommend_release") else "Build apta para avanzar segun la evidencia congelada."
    return (
        "<div class='callout'>"
        f"<strong>Diagnóstico de calidad: {html.escape(str(qa_summary.get('decision') or 'N/D'))}</strong><br/>"
        f"<span class='meta'>Riesgo {html.escape(str(qa_summary.get('risk') or 'N/D'))}</span>"
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
        or manual.get("responsible_id")
        or manual.get("definition_responsible_id")
        or "N/D"
    )
    defined_at = manual.get("defined_at") or manual.get("definition_at") or "N/D"
    return (
        "<div class='callout'>"
        f"<strong>Decisión tomada por QA: {html.escape(str(definition))}</strong><br/>"
        f"<span class='meta'>Responsable: {html.escape(str(responsible))} · Fecha: {html.escape(_format_report_datetime(defined_at))}</span><br/>"
        f"<span>{html.escape(str(comment))}</span>"
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

def _render_development_summary(metrics: dict, bug_metrics: dict, failures: list):
    stats = metrics.get("stats") or {}
    rows = [
        ("Fallos", stats.get("fallados", 0)),
        ("Bloqueos", stats.get("bloqueados", 0)),
        ("Bugs abiertos", bug_metrics.get("open", 0)),
        ("Fallos sin bug", len([item for item in failures if (item.get("flags") or {}).get("sin_bug_asociado")])),
        ("Fallos sin evidencia", len([item for item in failures if (item.get("flags") or {}).get("sin_evidencia")])),
    ]
    return "<table class='compact'><tbody>" + "".join(
        f"<tr><th>{html.escape(label)}</th><td>{html.escape(str(value))}</td></tr>"
        for label, value in rows
    ) + "</tbody></table>"

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

def _render_development_failures(request: Request, payload: dict):
    cases = ((payload.get("development") or {}).get("cases") or [])
    traceable_failures = (payload.get("failures_and_blockers") or (payload.get("development") or {}).get("failures") or [])
    if traceable_failures:
        rows = []
        for item in traceable_failures:
            flags = item.get("flags") or {}
            badges = []
            if flags.get("sin_evidencia"):
                badges.append("<span class='pill fail'>Sin evidencia</span>")
            if flags.get("sin_bug_asociado"):
                badges.append("<span class='pill warning'>Sin bug</span>")
            if flags.get("bloqueo_sin_motivo"):
                badges.append("<span class='pill blocked'>Sin motivo</span>")
            active_item_bugs = [bug for bug in (item.get("bug") or []) if bug.get("codigo") and _report_render_bug_is_active(bug)]
            bug_codes = ", ".join(str(bug.get("codigo")) for bug in active_item_bugs) or "Sin bug abierto"
            rows.append(
                "<tr>"
                f"<td><strong>{html.escape(str(item.get('case_code') or ''))}</strong><br/><span class='muted-text'>{html.escape(str(item.get('suite') or 'Sin suite'))}</span></td>"
                f"<td>{_report_html(item.get('case_title'), max_len=300)}<br/><span class='muted-text'>Prioridad: {html.escape(str(item.get('prioridad') or ''))} · Responsable: {_report_html(item.get('responsable'), fallback='N/D', max_len=120)}</span></td>"
                f"<td><span class='pill {_report_badge_class(item.get('estado'))}'>{html.escape(str(item.get('estado') or ''))}</span><br/>Paso {html.escape(str(item.get('failed_step') or 'N/D'))}</td>"
                f"<td>{_report_html(item.get('expected'), fallback='N/D', max_len=600)}</td>"
                f"<td>{_report_html(item.get('obtained') or item.get('diagnosis'), fallback='Sin detalle', max_len=800)}</td>"
                f"<td>{html.escape(bug_codes)}<br/>{''.join(badges)}</td>"
                "</tr>"
            )
        return f"<table><thead><tr><th>Caso</th><th>Contexto</th><th>Estado</th><th>Esperado</th><th>Obtenido / diagnostico</th><th>Bug / flags</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"
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
    return f"<table><thead><tr><th>Caso</th><th>Contexto</th><th>Estado</th><th>Esperado</th><th>Diagnóstico</th><th>Evidencia</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"

def _render_bug_view_link(request: Request, bug: dict) -> str:
    url = _report_bug_tracker_url(request, bug)
    if not url:
        return ""
    return f" <a class='report-action-link' href='{html.escape(url)}' target='_blank' rel='noopener'>Ver</a>"

def _render_traceable_bugs(request: Request, bugs: list):
    if not bugs:
        return "<p class='muted-text'>No hay bugs asociados a este snapshot.</p>"
    rows = []
    for bug in bugs[:40]:
        evidence = "Completa" if bug.get("has_evidence") else "Faltante"
        timing = bug.get("tiempo_abierto_horas") if bug.get("is_open") else bug.get("tiempo_resolucion_horas")
        view_link = _render_bug_view_link(request, bug)
        rows.append(
            "<tr>"
            f"<td><strong>{html.escape(str(bug.get('codigo') or ''))}</strong>{view_link}<br/><span class='muted-text'>{_report_html(bug.get('titulo'), max_len=300)}</span></td>"
            f"<td>{html.escape(str(bug.get('case_code') or 'Sin caso'))}<br/><span class='muted-text'>{html.escape(str(bug.get('suite') or 'Sin suite'))}</span></td>"
            f"<td>{html.escape(str(bug.get('severidad') or ''))}<br/><span class='muted-text'>Prioridad {html.escape(str(bug.get('prioridad') or ''))}</span></td>"
            f"<td>{html.escape(str(bug.get('estado') or ''))}<br/><span class='muted-text'>{'Abierto' if bug.get('is_open') else 'Cerrado'}</span></td>"
            f"<td>{html.escape(_fmt_report_hours(timing))}<br/><span class='muted-text'>Origen: {html.escape(str(bug.get('build_detectado') or 'N/D'))}<br/>Corrección: {html.escape(str(bug.get('build_corregido') or 'N/D'))}</span></td>"
            f"<td>{html.escape(evidence)}<br/><span class='muted-text'>Resp.: {_report_html(bug.get('responsable'), fallback='Sin asignar', max_len=120)}</span></td>"
            "</tr>"
        )
    return f"<table><thead><tr><th>Bug</th><th>Caso / suite</th><th>Severidad</th><th>Estado</th><th>Tiempo / build</th><th>Evidencia / responsable</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"

def _render_development_bug_details(request: Request, bugs: list):
    if not bugs:
        return "<p class='muted-text'>No hay bugs asociados para detallar.</p>"
    cards = []
    for bug in bugs[:30]:
        view_link = _render_bug_view_link(request, bug)
        comments = bug.get("comments") or []
        comment_items = "".join(
            f"<li>{html.escape(str(comment.get('created_at') or ''))}: {_report_html(comment.get('comentario'), max_len=360)}</li>"
            for comment in comments[:5]
        ) or "<li>Sin comentarios congelados.</li>"
        context = [
            ("Caso", bug.get("case_code") or bug.get("caso_id") or "Sin caso"),
            ("Build", bug.get("build_code") or bug.get("build_id") or "Sin build"),
            ("Ambiente", bug.get("ambiente_nombre") or "N/D"),
            ("Navegador", bug.get("navegador") or "N/D"),
            ("Dispositivo", bug.get("dispositivo") or "N/D"),
            ("SO", bug.get("sistema_operativo") or "N/D"),
        ]
        context_rows = "".join(f"<tr><th>{html.escape(label)}</th><td>{html.escape(str(value))}</td></tr>" for label, value in context)
        cards.append(
            "<div class='subcard'>"
            f"<h3>{html.escape(str(bug.get('codigo') or 'Bug'))} · {_report_html(bug.get('titulo'), fallback='Sin titulo', max_len=300)}{view_link}</h3>"
            f"<p><span class='pill fail'>{html.escape(str(bug.get('severidad') or ''))}</span> "
            f"<span class='pill warning'>{html.escape(str(bug.get('prioridad') or ''))}</span> "
            f"<span class='pill muted'>{html.escape(str(bug.get('estado') or ''))}</span></p>"
            f"<table class='compact'><tbody>{context_rows}</tbody></table>"
            f"<p><strong>Descripcion:</strong><br/>{_report_html(bug.get('descripcion'), fallback='Sin descripcion', max_len=1200)}</p>"
            f"<p><strong>Precondiciones:</strong><br/>{_report_html(bug.get('precondiciones'), fallback='N/D', max_len=900)}</p>"
            f"<div><strong>Pasos para reproducir:</strong>{_report_steps_html(bug.get('pasos_reproduccion'), fallback='N/D', max_len=2000)}</div>"
            f"<p><strong>Esperado:</strong><br/>{_report_html(bug.get('resultado_esperado'), fallback='N/D', max_len=900)}</p>"
            f"<p><strong>Obtenido:</strong><br/>{_report_html(bug.get('resultado_obtenido') or bug.get('comportamiento_actual'), fallback='N/D', max_len=1200)}</p>"
            f"<p><strong>Logs / contexto tecnico:</strong><br/>{_report_html(bug.get('logs_relevantes'), fallback='Sin logs', max_len=1200)}</p>"
            f"<p><strong>Notas QA:</strong><br/>{_report_html(bug.get('notas_qa'), fallback='Sin notas', max_len=900)}</p>"
            f"<h3>Comentarios</h3><ul class='actions'>{comment_items}</ul>"
            "</div>"
        )
    return "".join(cards)

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


__all__ = ["_render_calculated_kpis","_render_qa_decision","_render_manual_definition","_render_executive_kpis","_render_development_summary","_render_temporal_metrics","_render_bug_traceability","_render_executive_issues","_render_bug_severity_summary","_render_development_failures","_render_bug_view_link","_render_traceable_bugs","_render_development_bug_details","_render_evidence_items","_render_snapshot_integrity","_render_bug_tracking","_render_development_actions"]

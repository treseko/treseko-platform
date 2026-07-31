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
from .report_rendering_metrics import *
from .report_rendering_html import _MARKDOWN_ESCAPE_RE

from .report_rendering_base import *


def _md(value: Any) -> str:
    text = _report_text(value, max_len=2000).replace("\x00", "").replace("\r", " ").replace("\n", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return _MARKDOWN_ESCAPE_RE.sub(r"\\\1", text)


def _markdown_link_url(value: Any) -> Optional[str]:
    safe_url = sanitize_evidence_url(value)
    if not safe_url:
        return None
    safe_url = re.sub(r"[\x00-\x20<>]", "", safe_url)
    safe_url = (
        safe_url
        .replace("[", "%5B")
        .replace("]", "%5D")
        .replace("(", "%28")
        .replace(")", "%29")
    )
    return f"<{safe_url}>" if safe_url else None

def _markdown_evidence(items: list, legacy_url: Optional[str] = None) -> str:
    evidence = list(items or [])
    if legacy_url:
        evidence.append({"filename_original": "Evidencia legacy", "public_url": legacy_url})
    links = []
    for item in evidence:
        safe_url = _markdown_link_url(item.get("public_url"))
        if safe_url:
            links.append(f"[{_md(item.get('filename_original') or 'Evidencia')}]({safe_url})")
    return ", ".join(links) if links else "Sin evidencia"

def _shared_report_markdown(snapshot: models.SharedReportSnapshot, has_new_values: bool = False) -> str:
    payload = snapshot.payload or {}
    meta = payload.get("metadata") or {}
    metrics = payload.get("metrics") or {}
    stats = metrics.get("stats") or {}
    cases = _flatten_report_cases(metrics.get("por_suite_tree") or [])
    failed_cases = [case for case in cases if str(case.get("estado")).upper() in {"FALLO", "BLOQUEADO"}]
    bugs = payload.get("bugs") or []
    qa_summary = payload.get("qa_summary") or {}
    bug_metrics = metrics.get("bug_metrics") or {}
    temporal = payload.get("temporal_metrics") or metrics.get("temporal_metrics") or {}
    traceability = payload.get("bug_traceability") or metrics.get("bug_traceability") or {}
    failures = payload.get("failures_and_blockers") or metrics.get("failures_and_blockers") or []
    evidence_summary = payload.get("evidence_summary") or metrics.get("evidence_summary") or {}
    evidence_items = payload.get("evidence_items") or metrics.get("evidence_items") or []
    comparison = payload.get("comparison") or metrics.get("comparison") or {}
    dev = payload.get("development") or {}
    report_type = _report_type_from_payload(payload)
    report_type_label = {"development": "Desarrollo", "internal": "Interno", "executive": "Ejecutivo"}.get(report_type, "Ejecutivo")
    lines = [
        f"# Informe QA - {_md(snapshot.title)}",
        "",
        "> Snapshot inmutable. Los datos listados corresponden al momento en que se compartio el informe.",
    ]
    if has_new_values:
        lines.extend(["", "> Hay nuevos resultados disponibles desde que se compartio este informe."])
    lines.extend([
        "",
        "## Contexto",
        f"- Organizacion: {_md(meta.get('organizacion') or 'N/D')}",
        f"- Proyecto: {_md(meta.get('proyecto') or 'N/D')}",
        f"- Componente: {_md(meta.get('componente') or 'N/D')}",
        f"- Build: {_md(meta.get('build') or metrics.get('build_name') or 'N/D')}",
        f"- Ultima ejecucion: {_md(_format_report_datetime(meta.get('last_execution_at')))}",
        f"- Generado: {_md(_format_report_datetime(meta.get('snapshot_at') or snapshot.created_at))}",
        f"- Tipo de informe: {report_type_label}",
        "",
        "## Decisión tomada por QA",
        f"- Decision humana: {_md((payload.get('manual_definition') or meta).get('build_definition') or 'N/D')}",
        f"- Comentario QA: {_md((payload.get('manual_definition') or meta).get('qa_comment') or 'Sin comentario QA')}",
        f"- Responsable: {_md((payload.get('manual_definition') or meta).get('responsible_display') or meta.get('definition_responsible_display') or (payload.get('manual_definition') or meta).get('responsible_id') or meta.get('definition_responsible_id') or 'N/D')}",
        f"- Fecha de decision: {_md(_format_report_datetime((payload.get('manual_definition') or meta).get('defined_at') or meta.get('definition_at')))}",
    ])
    show_common_summary = _report_section_enabled(payload, report_type, "summary")
    if show_common_summary:
        lines.extend([
            "",
            "## Resumen",
        f"- Diagnóstico de calidad: {_md(qa_summary.get('decision') or 'N/D')}",
        f"- Riesgo de calidad: {_md(qa_summary.get('risk') or 'N/D')}",
        f"- Lectura por métricas: {_md(qa_summary.get('summary') or 'Snapshot de calidad generado por Treseko.')}",
        f"- Recomendación sugerida: {'Apto' if qa_summary.get('recommend_release') else 'No liberar sin resolver observaciones/riesgos'}",
        f"- Pasadas: {stats.get('pasados', 0)}",
        f"- Fallidas: {stats.get('fallados', 0)}",
        f"- Bloqueadas: {stats.get('bloqueados', 0)}",
        f"- Pendientes: {stats.get('pendientes', 0)}",
        f"- Cobertura real: {metrics.get('cobertura_porcentaje', 0)}% (ejecutados / asignados)",
        f"- Exito sobre ejecutados: {metrics.get('exito_sobre_ejecutados_porcentaje', 0)}% (pasados / ejecutados)",
        f"- Exito sobre total asignado: {metrics.get('exito_sobre_total_porcentaje', 0)}% (pasados / asignados)",
        f"- Ejecutadas: {metrics.get('total_ejecutados', 0)} / {metrics.get('total_casos_asignados', 0)}",
        f"- Bugs abiertos: {bug_metrics.get('open', 0)}",
        f"- Bugs criticos/altos abiertos: {bug_metrics.get('high_open', 0)}",
        ])
    show_trend = _report_section_enabled(payload, report_type, "trend")
    if show_trend:
        lines.extend([
            "",
            "## Comparacion contra build anterior",
            f"- Build anterior: {_md(comparison.get('previous_build_name') or 'N/D')}",
            f"- Delta cobertura de pruebas: {_md(comparison.get('coverage_delta') if comparison.get('coverage_delta') is not None else 'N/D')}",
            f"- Delta pruebas fallidas: {_md(comparison.get('failed_delta') if comparison.get('failed_delta') is not None else 'N/D')}",
            f"- Delta bugs abiertos: {_md(comparison.get('open_bugs_current') if comparison.get('open_bugs_current') is not None else 'N/D')}",
            f"- Estado QA actual: {_md(comparison.get('qa_status_current') or meta.get('qa_state') or 'N/D')}",
            "",
            "## Tendencia por build",
            "| Build | Pruebas pasadas | Pruebas fallidas | Pruebas bloqueadas |",
            "|---|---:|---:|---:|",
        ])
        for item in metrics.get("historico_versions") or []:
            lines.append(f"| {_md(item.get('build_name'))} | {item.get('pasados', 0)} | {item.get('fallados', 0)} | {item.get('bloqueados', 0)} |")
    if report_type == "development":
        development_bugs = [bug for bug in (dev.get("bugs") or bugs) if _report_render_bug_is_active(bug)]
        if _report_section_enabled(payload, "development", "summary"):
            lines.extend([
                "",
                "## Resumen tecnico",
                f"- Fallos: {stats.get('fallados', 0)}",
                f"- Bloqueos: {stats.get('bloqueados', 0)}",
                f"- Bugs abiertos: {bug_metrics.get('open', 0)}",
                f"- Fallos sin bug asociado: {len([item for item in failures if (item.get('flags') or {}).get('sin_bug_asociado')])}",
                f"- Fallos sin evidencia: {len([item for item in failures if (item.get('flags') or {}).get('sin_evidencia')])}",
            ])
        dev_failures = payload.get("failures_and_blockers") or dev.get("failures") or []
        dev_cases = dev.get("cases") or []
        if _report_section_enabled(payload, "development", "failures"):
            lines.extend(["", "## Fallos y bloqueos diagnosticables"])
            if dev_failures:
                lines.extend(["| Caso | Estado | Suite | Paso | Esperado | Obtenido | Bug | Flags |", "|---|---|---|---|---|---|---|---|"])
                for item in dev_failures:
                    flags = item.get("flags") or {}
                    active_item_bugs = [bug for bug in (item.get("bug") or []) if bug.get("codigo") and _report_render_bug_is_active(bug)]
                    bug_codes = ", ".join(str(bug.get("codigo")) for bug in active_item_bugs) or "Sin bug abierto"
                    flag_text = ", ".join(label for label, enabled in [
                        ("sin evidencia", flags.get("sin_evidencia")),
                        ("sin bug", flags.get("sin_bug_asociado")),
                        ("bloqueo sin motivo", flags.get("bloqueo_sin_motivo")),
                    ] if enabled) or "Sin flags"
                    lines.append(f"| {_md(item.get('case_code'))} - {_md(item.get('case_title'))} | {_md(item.get('estado'))} | {_md(item.get('suite'))} | {_md(item.get('failed_step') or 'N/D')} | {_md(item.get('expected'))} | {_md(item.get('obtained') or item.get('diagnosis'))} | {_md(bug_codes)} | {_md(flag_text)} |")
            elif dev_cases:
                lines.extend(["| Caso | Estado | Suite | Esperado | Diagnóstico | Acción | Evidencia |", "|---|---|---|---|---|---|---|"])
                for case in dev_cases:
                    failure = case.get("failure") or {}
                    lines.append(f"| {_md(case.get('codigo'))} - {_md(case.get('titulo'))} | {_md(case.get('estado'))} | {_md(case.get('suite_breadcrumb'))} | {_md(failure.get('expected'))} | {_md(failure.get('observed'))} | {_md(case.get('recommendation'))} | {_markdown_evidence((failure.get('evidencias') or [])[:3], failure.get('evidencia_url'))} |")
            else:
                lines.append("No hay fallos o bloqueos para diagnosticar.")
        if _report_section_enabled(payload, "development", "bugs"):
            lines.extend(["", "## Bugs asociados a la build", "| Bug | Caso | Severidad | Estado | Tiempo | Evidencia | Responsable |", "|---|---|---|---|---|---|---|"])
            if development_bugs:
                for bug in development_bugs:
                    timing = bug.get("tiempo_abierto_horas") if bug.get("is_open") else bug.get("tiempo_resolucion_horas")
                    lines.append(f"| {_md(bug.get('codigo'))} - {_md(bug.get('titulo'))} | {_md(bug.get('case_code') or 'Sin caso')} | {_md(bug.get('severidad'))} | {_md(bug.get('estado'))} | {_fmt_report_hours(timing)} | {'Completa' if bug.get('has_evidence') else 'Faltante'} | {_md(bug.get('responsable') or 'Sin asignar')} |")
            else:
                lines.append("| Sin bugs |  |  |  |  |  |  |")
        if _report_section_enabled(payload, "development", "bug_details") and development_bugs:
            lines.extend(["", "## Fichas de bugs para replicacion"])
            for bug in development_bugs:
                lines.extend([
                    "",
                    f"### {_md(bug.get('codigo'))} - {_md(bug.get('titulo'))}",
                    f"- Estado: {_md(bug.get('estado'))}",
                    f"- Severidad/prioridad: {_md(bug.get('severidad'))} / {_md(bug.get('prioridad'))}",
                    f"- Caso/build: {_md(bug.get('case_code') or 'Sin caso')} / {_md(bug.get('build_code') or bug.get('build_id') or 'Sin build')}",
                    f"- Ambiente: {_md(bug.get('ambiente_nombre') or 'N/D')}",
                    f"- Pasos: {_md(bug.get('pasos_reproduccion') or 'N/D')}",
                    f"- Esperado: {_md(bug.get('resultado_esperado') or 'N/D')}",
                    f"- Obtenido: {_md(bug.get('resultado_obtenido') or bug.get('comportamiento_actual') or 'N/D')}",
                    f"- Logs/contexto: {_md(bug.get('logs_relevantes') or 'Sin logs')}",
                ])
        tracking = dev.get("bug_tracking") or []
        if _report_section_enabled(payload, "development", "bug_tracking") and tracking:
            lines.extend(["", "## Bugs y seguimiento por build"])
            lines.extend(["| Bug | Ticket externo | Severidad | Estado | Primera build | Ultima build | Builds afectadas | Ultimo comentario |", "|---|---|---|---|---|---|---|---|"])
            for item in tracking:
                external = " ".join(filter(None, [str(item.get("external_provider") or ""), str(item.get("external_issue_id") or "")])) or "N/D"
                builds = ", ".join(str(value) for value in (item.get("affected_builds") or [])) or "N/D"
                lines.append(f"| {_md(item.get('codigo'))} - {_md(item.get('titulo'))} | {_md(external)} | {_md(item.get('severidad'))} | {_md(item.get('estado'))} / {_md(item.get('current_status'))} | {_md(item.get('first_seen_build'))} | {_md(item.get('last_seen_build'))} | {_md(builds)} | {_md(item.get('last_comment') or 'Sin ultimo comentario')} |")
        persistent = (dev.get("regressions") or {}).get("persistent_bugs") or []
        if _report_section_enabled(payload, "development", "regressions"):
            lines.extend(["", "## Regresiones y reincidencias"])
            if persistent:
                for item in persistent:
                    lines.append(f"- {_md(item.get('codigo'))}: {_md(item.get('titulo'))} sigue abierto en {len(item.get('affected_builds') or [])} builds.")
            else:
                lines.append("No se detectaron bugs persistentes en multiples builds.")
        if _report_section_enabled(payload, "development", "actions"):
            lines.extend(["", "## Acciones recomendadas"])
            if dev_cases or dev_failures:
                lines.append("- Re-ejecutar casos bloqueados tras corregir datos, ambiente o selectores.")
                lines.append("- Asociar fallos sin ticket a bug interno o ticket externo.")
            if any(item.get("current_status") == "Sigue abierto" for item in tracking):
                lines.append("- Priorizar bugs abiertos que afectan el build actual y validar correccion en el proximo build.")
            if not dev_cases and not dev_failures and not tracking:
                lines.append("- No hay acciones tecnicas pendientes detectadas.")
    elif report_type == "internal":
        bundle_paths = meta.get("bundle_paths") or {}
        if _report_section_enabled(payload, "internal", "integrity"):
            lines.extend(["", "## Snapshot / Foto de build"])
            lines.extend([
                f"- Snapshot group: {_md(meta.get('snapshot_group_id'))}",
                f"- Hash: {_md(meta.get('snapshot_hash') or snapshot.metrics_hash)}",
                f"- Estado QA congelado: {_md(meta.get('qa_state') or qa_summary.get('decision'))}",
                f"- Total evidencias listadas: {evidence_summary.get('total', 0)}",
                f"- Bugs asociados congelados: {len(bugs)}",
                f"- Casos congelados: {len(cases)}",
                f"- Link ejecutivo: {_md(bundle_paths.get('executive') or 'N/D')}",
                f"- Link desarrollo: {_md(bundle_paths.get('development') or 'N/D')}",
                f"- Link snapshot: {_md(bundle_paths.get('internal') or 'N/D')}",
            ])
        if _report_section_enabled(payload, "internal", "temporal"):
            lines.extend([
                "",
                "## Progreso temporal",
                f"- Build a primera ejecucion: {_fmt_report_hours(temporal.get('build_to_first_execution_hours'))}",
                f"- Primera a ultima ejecucion: {_fmt_report_hours(temporal.get('first_to_last_execution_hours'))}",
                f"- Ciclo QA total: {_fmt_report_hours(temporal.get('qa_cycle_hours'))}",
                f"- Tiempo total invertido: {_fmt_report_seconds(temporal.get('total_execution_seconds'))}",
                f"- Promedio por caso ejecutado: {_fmt_report_seconds(temporal.get('average_seconds_per_executed_case'))}",
            ])
        if _report_section_enabled(payload, "internal", "traceability"):
            lines.extend([
                "",
                "## Trazabilidad",
                f"- MTTR: {_fmt_report_hours(traceability.get('mttr_hours'))}",
                f"- Promedio abierto: {_fmt_report_hours(traceability.get('avg_bug_open_hours'))}",
                f"- Bugs con evidencia: {_fmt_report_percent(traceability.get('with_evidence_percent'))}",
                f"- Fallos con bug asociado: {_fmt_report_percent(traceability.get('failures_with_bug_percent'))}",
                f"- Evidencias completas/faltantes: {evidence_summary.get('complete', 0)} / {evidence_summary.get('missing', 0)}",
            ])
        if _report_section_enabled(payload, "internal", "failures"):
            lines.extend(["", "## Fallos y bloqueos"])
            if failures:
                lines.extend(["| Caso | Estado | Suite | Paso | Bug | Flags |", "|---|---|---|---|---|---|"])
                for item in failures:
                    flags = item.get("flags") or {}
                    bug_codes = ", ".join(str(bug.get("codigo")) for bug in (item.get("bug") or []) if bug.get("codigo")) or "Sin bug abierto"
                    flag_text = ", ".join(label for label, enabled in [
                        ("sin evidencia", flags.get("sin_evidencia")),
                        ("sin bug", flags.get("sin_bug_asociado")),
                        ("bloqueo sin motivo", flags.get("bloqueo_sin_motivo")),
                    ] if enabled) or "Sin flags"
                    lines.append(f"| {_md(item.get('case_code'))} - {_md(item.get('case_title'))} | {_md(item.get('estado'))} | {_md(item.get('suite'))} | {_md(item.get('failed_step') or 'N/D')} | {_md(bug_codes)} | {_md(flag_text)} |")
            else:
                lines.append("No hay fallos ni bloqueos.")
        if _report_section_enabled(payload, "internal", "bugs"):
            lines.extend(["", "## Bugs asociados"])
            if bugs:
                lines.extend(["| Bug | Caso | Severidad | Estado | Evidencia | Responsable |", "|---|---|---|---|---|---|"])
                for bug in bugs:
                    lines.append(f"| {_md(bug.get('codigo'))} - {_md(bug.get('titulo'))} | {_md(bug.get('case_code') or 'Sin caso')} | {_md(bug.get('severidad'))} | {_md(bug.get('estado'))} | {'Completa' if bug.get('has_evidence') else 'Faltante'} | {_md(bug.get('responsable') or 'Sin asignar')} |")
            else:
                lines.append("No hay bugs asociados.")
        tracking = dev.get("bug_tracking") or []
        if _report_section_enabled(payload, "internal", "bug_tracking") and tracking:
            lines.extend(["", "## Bugs y seguimiento por build"])
            lines.extend(["| Bug | Estado | Primera build | Ultima build | Builds afectadas | Ultimo comentario |", "|---|---|---|---|---|---|"])
            for item in tracking:
                builds = ", ".join(str(value) for value in (item.get("affected_builds") or [])) or "N/D"
                lines.append(f"| {_md(item.get('codigo'))} - {_md(item.get('titulo'))} | {_md(item.get('estado'))} / {_md(item.get('current_status'))} | {_md(item.get('first_seen_build'))} | {_md(item.get('last_seen_build'))} | {_md(builds)} | {_md(item.get('last_comment') or 'Sin ultimo comentario')} |")
        if _report_section_enabled(payload, "internal", "evidence"):
            lines.extend(["", "## Evidencias vinculadas"])
            if evidence_items:
                lines.extend(["| Caso/Bug | Tipo | Nombre | Fecha | Usuario | Estado | Link |", "|---|---|---|---|---|---|---|"])
                for item in evidence_items[:40]:
                    safe_url = _markdown_link_url(item.get("url"))
                    link = f"[Abrir]({safe_url})" if safe_url else "Sin link"
                    lines.append(f"| {_md(item.get('case_code') or item.get('bug') or 'N/D')} | {_md(item.get('type') or 'archivo')} | {_md(item.get('name') or 'Evidencia')} | {_md(_format_report_datetime(item.get('created_at')))} | {_md(item.get('created_by') or 'N/D')} | {_md(item.get('status') or 'N/D')} | {link} |")
            else:
                lines.append("Sin evidencias listadas en el snapshot.")
        if _report_section_enabled(payload, "internal", "cases"):
            lines.extend(["", "## Casos del snapshot"])
            if cases:
                lines.extend(["| Caso | Titulo | Estado | Suite | Tipo | Evidencia |", "|---|---|---|---|---|---|"])
                for case in cases:
                    lines.append(f"| {_md(case.get('codigo'))} | {_md(case.get('titulo'))} | {_md(case.get('estado'))} | {_md(case.get('suite_breadcrumb') or 'Sin suite')} | {_md(case.get('tipo_prueba') or 'N/D')} | {_markdown_evidence(case.get('evidencias') or [], case.get('evidencia_url'))} |")
            else:
                lines.append("No hay casos para mostrar.")
    else:
        if _report_section_enabled(payload, "executive", "findings"):
            lines.extend(["", "## Top hallazgos relevantes"])
            if failed_cases:
                lines.extend(["| Caso | Titulo | Estado | Suite | Prioridad |", "|---|---|---|---|---|"])
                for case in failed_cases[:5]:
                    lines.append(f"| {_md(case.get('codigo'))} | {_md(case.get('titulo'))} | {_md(case.get('estado'))} | {_md(case.get('suite_breadcrumb'))} | {_md(case.get('prioridad'))} |")
            else:
                lines.append("No hay fallos o bloqueos relevantes.")
        if _report_section_enabled(payload, "executive", "risks"):
            lines.extend(["", "## Bugs abiertos por severidad"])
            open_bugs = [bug for bug in bugs if str(bug.get("estado") or "").upper() not in {"CERRADO", "RESUELTO", "CLOSED", "DONE", "RESOLVED"}]
            if open_bugs:
                severity_counts = {}
                for bug in open_bugs:
                    severity = str(bug.get("severidad") or "SIN_SEVERIDAD").upper()
                    severity_counts[severity] = severity_counts.get(severity, 0) + 1
                for severity, count in sorted(severity_counts.items()):
                    lines.append(f"- {severity}: {count}")
            else:
                lines.append("No hay bugs abiertos asociados.")
    return "\n".join(lines) + "\n"


__all__ = ["_md","_markdown_link_url","_markdown_evidence","_shared_report_markdown"]

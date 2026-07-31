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


def _shared_report_html(snapshot: models.SharedReportSnapshot, request: Request, has_new_values: bool = False, latest_url: Optional[str] = None) -> str:
    payload = snapshot.payload or {}
    meta = payload.get("metadata") or {}
    metrics = payload.get("metrics") or {}
    stats = metrics.get("stats") or {}
    bugs = payload.get("bugs") or []
    cases = _flatten_report_cases(metrics.get("por_suite_tree") or [])
    qa_summary = payload.get("qa_summary") or {}
    bug_metrics = metrics.get("bug_metrics") or {}
    failures = payload.get("failures_and_blockers") or metrics.get("failures_and_blockers") or []
    temporal = payload.get("temporal_metrics") or metrics.get("temporal_metrics") or {}
    traceability = payload.get("bug_traceability") or metrics.get("bug_traceability") or {}
    evidence_items = payload.get("evidence_items") or metrics.get("evidence_items") or []
    report_type = _report_type_from_payload(payload)
    title = html.escape(snapshot.title)
    preview_description = _report_preview_description(meta, metrics, qa_summary, snapshot.description)
    description = html.escape(preview_description)
    current_url = str(request.url)
    request_path = getattr(request.url, "path", "")
    image_url = f"{current_url.rstrip('/')}/preview.svg" if request_path.startswith("/informes/") else str(request.url_for("public_shared_report_thumbnail", token=snapshot.token))
    canonical_url = str(request.url)
    safe_latest_url = _report_link_url(latest_url)
    update_link = f"<a href='{html.escape(safe_latest_url)}'>Abrir version actualizada</a>" if safe_latest_url else ""
    banner = f"<div class='banner'>Hay datos mas recientes para este informe. Este link conserva el snapshot original.{update_link}</div>" if has_new_values else ""
    type_label = {"development": "Desarrollo", "internal": "Interno", "executive": "Ejecutivo"}.get(report_type, "Ejecutivo")
    toolbar = _report_download_toolbar(request, report_type)
    head = f"""<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title><meta name="description" content="{description}" /><link rel="canonical" href="{html.escape(canonical_url)}" /><meta property="og:site_name" content="Treseko" /><meta property="og:title" content="{title}" /><meta property="og:description" content="{description}" /><meta property="og:image" content="{html.escape(image_url)}" /><meta property="og:url" content="{html.escape(canonical_url)}" /><meta property="og:type" content="article" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="{title}" /><meta name="twitter:description" content="{description}" /><meta name="twitter:image" content="{html.escape(image_url)}" /><style>{_report_common_css()}</style></head><body><main>{banner}{toolbar}"""
    base_header = f"""<section class="card"><span class="pill muted">Informe {type_label}</span><h1>{title}</h1><p class="meta">{_report_context_html(meta, metrics, snapshot)}</p>{_render_manual_definition(payload)}{_render_qa_decision(qa_summary)}"""
    if report_type == "internal":
        header = f"{base_header}{_render_calculated_kpis(metrics, bug_metrics, failures) if _report_section_enabled(payload, 'internal', 'summary') else ''}</section>"
        dev = payload.get("development") or {}
        distribution_block = f"<div class='card'><h2>Distribucion de resultados</h2>{_render_report_distribution(stats)}</div>" if _report_section_enabled(payload, "internal", "distribution") else ""
        integrity_block = f"<div class='card'><h2>Integridad del snapshot</h2>{_render_snapshot_integrity(payload, snapshot)}</div>" if _report_section_enabled(payload, "internal", "integrity") else ""
        temporal_block = f"<div class='card'><h2>Progreso temporal</h2>{_render_temporal_metrics(temporal)}</div>" if _report_section_enabled(payload, "internal", "temporal") else ""
        traceability_block = f"<div class='card'><h2>Trazabilidad de bugs</h2>{_render_bug_traceability(traceability)}</div>" if _report_section_enabled(payload, "internal", "traceability") else ""
        body = (
            f"{header}"
            f"<section class='two-col'>{distribution_block}{integrity_block}</section>"
            f"<section class='two-col'>{temporal_block}{traceability_block}</section>"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'trend'), 'Tendencia entre builds', _render_report_trend(metrics))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'failures'), 'Fallos y bloqueos diagnosticables', _render_development_failures(request, payload))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'failed_steps'), 'Pasos con incidencia', _render_report_failed_steps(request, cases))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'bugs'), 'Bugs asociados a la build', _render_traceable_bugs(request, bugs))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'evidence'), 'Evidencias vinculadas', _render_evidence_items(request, evidence_items))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'bug_tracking'), 'Bugs y seguimiento por build', _render_bug_tracking(dev.get('bug_tracking') or []))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'cases'), 'Casos del snapshot', _render_report_cases(request, cases))}"
        )
    elif report_type == "development":
        dev = payload.get("development") or {}
        development_bugs = [bug for bug in (dev.get("bugs") or bugs) if _report_render_bug_is_active(bug)]
        header_parts = []
        if _report_section_enabled(payload, "development", "summary"):
            header_parts.append(f"<div>{_render_development_summary(metrics, bug_metrics, failures)}</div>")
        if _report_section_enabled(payload, "development", "distribution"):
            header_parts.append(f"<div>{_render_report_distribution(stats)}</div>")
        header_grid = f"<div class='two-col'>{''.join(header_parts)}</div>" if header_parts else ""
        header = f"{base_header}{header_grid}</section>"
        body = (
            f"{header}"
            f"{_render_section_if(_report_section_enabled(payload, 'development', 'failures'), 'Fallos y bloqueos diagnosticables', _render_development_failures(request, payload))}"
            f"{_render_section_if(_report_section_enabled(payload, 'development', 'bugs'), 'Bugs asociados a la build', _render_traceable_bugs(request, development_bugs))}"
            f"{_render_section_if(_report_section_enabled(payload, 'development', 'bug_details'), 'Ficha publica de bugs para replicacion', _render_development_bug_details(request, development_bugs))}"
            f"{_render_section_if(_report_section_enabled(payload, 'development', 'bug_tracking'), 'Bugs y seguimiento por build', _render_bug_tracking(dev.get('bug_tracking') or []))}"
            f"{_render_section_if(_report_section_enabled(payload, 'development', 'regressions'), 'Regresiones y reincidencias', _render_bug_tracking((dev.get('regressions') or {}).get('persistent_bugs') or []))}"
            f"{_render_section_if(_report_section_enabled(payload, 'development', 'actions'), 'Acciones recomendadas', _render_development_actions(payload))}"
        )
    else:
        header = f"{base_header}{_render_executive_kpis(metrics, bug_metrics) if _report_section_enabled(payload, 'executive', 'kpis') else ''}</section>"
        risk_block = f"<div class='card'><h2>Riesgos principales</h2>{_render_bug_severity_summary(bugs)}</div>" if _report_section_enabled(payload, "executive", "risks") else ""
        trend_block = f"<div class='card'><h2>Tendencia vs build anterior</h2>{_render_report_trend(metrics)}</div>" if _report_section_enabled(payload, "executive", "trend") else ""
        body = (
            f"{header}"
            f"<section class='two-col'>"
            f"{risk_block}"
            f"{trend_block}"
            f"</section>"
            f"{_render_section_if(_report_section_enabled(payload, 'executive', 'findings'), 'Top hallazgos relevantes', _render_executive_issues(cases))}"
        )
    return f"{head}{body}</main></body></html>"

def _shared_report_csv(snapshot: models.SharedReportSnapshot) -> str:
    payload = snapshot.payload or {}
    meta = payload.get("metadata") or {}
    metrics = payload.get("metrics") or {}
    stats = metrics.get("stats") or {}
    bugs = payload.get("bugs") or []
    cases = _flatten_report_cases(metrics.get("por_suite_tree") or [])
    qa_summary = payload.get("qa_summary") or {}
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Seccion", "Campo", "Valor"])
    for label, value in [
        ("Organizacion", meta.get("organizacion") or "N/D"),
        ("Proyecto", meta.get("proyecto") or "N/D"),
        ("Componente", meta.get("componente") or "N/D"),
        ("Build", meta.get("build") or metrics.get("build_name") or "N/D"),
        ("Tipo informe", _report_type_from_payload(payload)),
        ("Diagnóstico de calidad", qa_summary.get("decision") or "N/D"),
        ("Riesgo de calidad", qa_summary.get("risk") or "N/D"),
        ("Generado", _format_report_datetime(meta.get("snapshot_at") or snapshot.created_at)),
    ]:
        writer.writerow(["Contexto", label, value])
    for label, value in [
        ("Pruebas asignadas", metrics.get("total_casos_asignados", 0)),
        ("Pruebas ejecutadas", metrics.get("total_ejecutados", 0)),
        ("Pruebas pasadas", stats.get("pasados", 0)),
        ("Pruebas fallidas", stats.get("fallados", 0)),
        ("Pruebas bloqueadas", stats.get("bloqueados", 0)),
        ("Pruebas pendientes", stats.get("pendientes", 0)),
        ("Cobertura de pruebas", _fmt_report_percent(metrics.get("cobertura_porcentaje"))),
        ("Exito en ejecutadas", _fmt_report_percent(metrics.get("exito_sobre_ejecutados_porcentaje"))),
    ]:
        writer.writerow(["Metricas", label, value])
    writer.writerow([])
    writer.writerow(["Casos", "Codigo", "Titulo", "Suite", "Estado", "Tipo", "Prioridad"])
    for case in cases:
        writer.writerow([
            "Caso",
            case.get("codigo") or "",
            case.get("titulo") or "",
            case.get("suite_breadcrumb") or "",
            case.get("estado") or "",
            case.get("tipo_prueba") or "",
            case.get("prioridad") or "",
        ])
    writer.writerow([])
    writer.writerow(["Bugs", "Codigo", "Titulo", "Caso", "Severidad", "Estado", "Responsable"])
    for bug in bugs:
        writer.writerow([
            "Bug",
            bug.get("codigo") or "",
            bug.get("titulo") or "",
            bug.get("case_code") or "",
            bug.get("severidad") or "",
            bug.get("estado") or "",
            bug.get("responsable") or "",
        ])
    return "\ufeff" + output.getvalue()

_MARKDOWN_ESCAPE_RE = re.compile(r"([\\`*_{}\[\]()#+\-.!|>])")



__all__ = ["_shared_report_html","_shared_report_csv"]

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
from .report_development_rendering import (
    development_bug_code,
    development_build_name,
    development_case_code,
    development_category_bugs,
    development_current_build_verification,
    development_responsible_name,
    development_section_enabled,
    development_unique_bugs,
)


def _shared_report_html(
    snapshot: models.SharedReportSnapshot,
    request: Request,
    has_new_values: bool = False,
    latest_url: Optional[str] = None,
    branding: Optional[dict] = None,
) -> str:
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
    snapshot_branding = meta.get("branding") if isinstance(meta.get("branding"), dict) else {}
    live_branding = branding if isinstance(branding, dict) else {}
    brand_name = html.escape(str(
        live_branding.get("effective_brand_name")
        or live_branding.get("brand_name")
        or snapshot_branding.get("brand_name")
        or "Treseko"
    ).strip() or "Treseko")
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
    update_link = f"<a href='{html.escape(safe_latest_url)}'>Abrir informe actualizado</a>" if safe_latest_url else ""
    banner = f"<div class='banner'>Hay cambios más recientes en este informe. Este enlace conserva la versión original.{update_link}</div>" if has_new_values else ""
    type_label = {"development": "Desarrollo", "internal": "Interno", "executive": "Ejecutivo"}.get(report_type, "Ejecutivo")
    toolbar = _report_download_toolbar(request, report_type)
    head = f"""<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{title}</title><meta name="description" content="{description}" /><link rel="canonical" href="{html.escape(canonical_url)}" /><meta property="og:site_name" content="{brand_name}" /><meta property="og:title" content="{title}" /><meta property="og:description" content="{description}" /><meta property="og:image" content="{html.escape(image_url)}" /><meta property="og:url" content="{html.escape(canonical_url)}" /><meta property="og:type" content="article" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="{title}" /><meta name="twitter:description" content="{description}" /><meta name="twitter:image" content="{html.escape(image_url)}" /><style>{_report_common_css()}.report-page{{position:relative;min-height:100vh}}.report-watermark{{position:absolute;inset:0;z-index:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));grid-auto-rows:160px;align-content:start;gap:70px 100px;padding:48px 24px;overflow:hidden;pointer-events:none}}.report-watermark span{{color:#1f4fbf;font-size:clamp(34px,5vw,64px);font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.12;transform:rotate(-24deg);white-space:nowrap;mix-blend-mode:multiply}}</style></head><body><div class='report-page'><main>{banner}{toolbar}"""
    base_header = f"""<section class="card"><span class="pill muted">Informe {type_label}</span><h1>{title}</h1><p class="meta">{_report_context_html(meta, metrics, snapshot)}</p>{_render_manual_definition(payload)}{_render_qa_decision(qa_summary)}"""
    if report_type == "internal":
        header = f"{base_header}{_render_calculated_kpis(metrics, bug_metrics, failures) if _report_section_enabled(payload, 'internal', 'summary') else ''}</section>"
        dev = payload.get("development") or {}
        distribution_block = f"<div class='card'><h2>Distribucion de resultados</h2>{_render_report_distribution(stats)}</div>" if _report_section_enabled(payload, "internal", "distribution") else ""
        format_metrics_block = f"<div class='card'><h2>Métricas por formato de prueba</h2>{_render_report_format_metrics(metrics)}</div>" if _report_section_enabled(payload, "internal", "format_metrics") else ""
        integrity_block = f"<div class='card'><h2>Integridad del snapshot</h2>{_render_snapshot_integrity(payload, snapshot)}</div>" if _report_section_enabled(payload, "internal", "integrity") else ""
        temporal_block = f"<div class='card'><h2>Progreso temporal</h2>{_render_temporal_metrics(temporal)}</div>" if _report_section_enabled(payload, "internal", "temporal") else ""
        traceability_block = f"<div class='card'><h2>Trazabilidad de bugs</h2>{_render_bug_traceability(traceability)}</div>" if _report_section_enabled(payload, "internal", "traceability") else ""
        body = (
            f"{header}"
            f"<section class='two-col'>{distribution_block}{integrity_block}</section>"
            f"{format_metrics_block}"
            f"<section class='two-col'>{temporal_block}{traceability_block}</section>"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'trend'), 'Tendencia entre builds', _render_report_trend(metrics))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'failures'), 'Fallos y bloqueos diagnosticables', _render_development_failures(request, payload))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'failed_steps'), 'Pasos con incidencia', _render_report_failed_steps(request, cases))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'bugs'), 'Bugs asociados a la build', _render_traceable_bugs(request, bugs))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'bugs'), 'Fichas de bugs para replicación', _render_bug_reproduction_details(request, bugs))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'evidence'), 'Evidencias vinculadas', _render_evidence_items(request, evidence_items))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'bug_tracking'), 'Bugs y seguimiento por build', _render_bug_tracking(dev.get('bug_tracking') or []))}"
            f"{_render_section_if(_report_section_enabled(payload, 'internal', 'cases'), 'Casos del snapshot', _render_report_cases(request, cases))}"
        )
    elif report_type == "development":
        development_categories = development_category_bugs(payload)
        bugs_enabled = development_section_enabled(payload, "bugs")
        tracking_enabled = development_section_enabled(payload, "bug_tracking")
        corrected_enabled = development_section_enabled(payload, "corrected_bugs")
        details_enabled = development_section_enabled(payload, "bug_details")
        new_bugs = development_categories["new_bugs"] if bugs_enabled else []
        unclassified_bugs = development_categories["unclassified_bugs"] if bugs_enabled else []
        historical_bugs = development_categories["historical_bugs"] if tracking_enabled else []
        corrected_bugs = development_categories["corrected_bugs"] if corrected_enabled else []
        detail_bugs = development_unique_bugs(
            new_bugs,
            unclassified_bugs,
            historical_bugs,
            corrected_bugs,
        ) if details_enabled else []
        header_parts = []
        if development_section_enabled(payload, "summary"):
            header_parts.append(f"<div>{_render_development_summary(metrics, bug_metrics, failures, qa_summary)}</div>")
        if development_section_enabled(payload, "distribution"):
            header_parts.append(f"<div>{_render_report_distribution(stats)}</div>")
        if development_section_enabled(payload, "format_metrics"):
            header_parts.append(f"<div><h2>Métricas por formato de prueba</h2>{_render_report_format_metrics(metrics)}</div>")
        header_grid = f"<div class='two-col'>{''.join(header_parts)}</div>" if header_parts else ""
        header = f"{base_header}{header_grid}</section>"
        body = (
            f"{header}"
            f"{_render_section_if(development_section_enabled(payload, 'failures'), 'Excepciones sin bug abierto', _render_development_failures(request, payload, only_without_bug=True, categories=development_categories))}"
            f"{_render_section_if(bugs_enabled, 'Bugs nuevos detectados', _render_traceable_bugs(request, new_bugs, target='incidencias'))}"
            f"{_render_section_if(bugs_enabled, 'Bugs sin clasificar', _render_traceable_bugs(request, unclassified_bugs, target='incidencias'))}"
            f"{_render_section_if(tracking_enabled, 'Históricos pendientes y reincidencias', _render_traceable_bugs(request, historical_bugs, target='incidencias'))}"
            f"{_render_section_if(corrected_enabled, 'Correcciones verificadas', _render_development_corrected_bugs(corrected_bugs))}"
            f"{_render_section_if(details_enabled, 'Fichas técnicas de las categorías habilitadas', _render_development_bug_details(request, detail_bugs))}"
            f"{_render_section_if(development_section_enabled(payload, 'actions'), 'Acciones recomendadas', _render_development_actions(payload))}"
        )
    else:
        header = f"{base_header}{_render_executive_kpis(metrics, bug_metrics) if _report_section_enabled(payload, 'executive', 'kpis') else ''}</section>"
        risk_block = f"<div class='card'><h2>Riesgos principales</h2>{_render_bug_severity_summary(bugs)}</div>" if _report_section_enabled(payload, "executive", "risks") else ""
        trend_block = f"<div class='card'><h2>Tendencia vs build anterior</h2>{_render_report_trend(metrics)}</div>" if _report_section_enabled(payload, "executive", "trend") else ""
        body = (
            f"{header}"
            f"{_render_section_if(_report_section_enabled(payload, 'executive', 'format_metrics'), 'Métricas por formato de prueba', _render_report_format_metrics(metrics))}"
            f"<section class='two-col'>"
            f"{risk_block}"
            f"{trend_block}"
            f"</section>"
            f"{_render_section_if(_report_section_enabled(payload, 'executive', 'findings'), 'Top hallazgos relevantes', _render_executive_issues(cases))}"
            f"{_render_section_if(_report_section_enabled(payload, 'executive', 'risks'), 'Incidentes relevantes para reproducir', _render_bug_reproduction_details(request, [bug for bug in bugs if _report_render_bug_is_active(bug)], compact=True))}"
        )
    footer_version = meta.get("app_version")
    footer = (
        f"<footer class='report-footer'>Gracias por utilizar {brand_name} · {brand_name} Platform · v{html.escape(str(footer_version))}</footer>"
        if footer_version
        else f"<footer class='report-footer'>Gracias por utilizar {brand_name} · {brand_name} Platform</footer>"
    )
    watermark_items = "".join(f"<span>{brand_name}</span>" for _ in range(256))
    watermark = f"<div class='report-watermark' aria-hidden='true'>{watermark_items}</div>"
    return f"{head}{body}{footer}</main>{watermark}</div></body></html>"

def _shared_report_csv(snapshot: models.SharedReportSnapshot) -> str:
    payload = snapshot.payload or {}
    meta = payload.get("metadata") or {}
    metrics = payload.get("metrics") or {}
    stats = metrics.get("stats") or {}
    bugs = payload.get("bugs") or []
    cases = _flatten_report_cases(metrics.get("por_suite_tree") or [])
    qa_summary = payload.get("qa_summary") or {}
    pending = stats.get("pendientes") if stats.get("pendientes") is not None else stats.get("sin_correr", 0)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Seccion", "Campo", "Valor"])
    for label, value in [
        ("Organizacion", meta.get("organizacion") or "N/D"),
        ("Proyecto", meta.get("proyecto") or "N/D"),
        ("Componente", meta.get("componente") or "N/D"),
        ("Version de Treseko", meta.get("app_version") or "N/D"),
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
        ("Pruebas pendientes", pending),
        ("Cobertura de pruebas", _fmt_report_percent(metrics.get("cobertura_porcentaje"))),
        ("Exito en ejecutadas", _fmt_report_percent(metrics.get("exito_sobre_ejecutados_porcentaje"))),
    ]:
        writer.writerow(["Metricas", label, value])
    if _report_type_from_payload(payload) == "development":
        sections = development_category_bugs(payload)
        section_flags = {
            "Bugs nuevos": development_section_enabled(payload, "bugs"),
            "Bugs sin clasificar": development_section_enabled(payload, "bugs"),
            "Históricos pendientes": development_section_enabled(payload, "bug_tracking"),
            "Correcciones verificadas": development_section_enabled(payload, "corrected_bugs"),
        }
        writer.writerow([])
        writer.writerow(["Bugs desarrollo", "Categoria", "Codigo", "Titulo", "Caso", "Estado", "Severidad", "Build de origen", "Verificacion build actual", "Responsable", "Descripcion", "Resultado esperado", "Resultado obtenido"])
        for category, key in (
            ("Bugs nuevos", "new_bugs"),
            ("Bugs sin clasificar", "unclassified_bugs"),
            ("Históricos pendientes", "historical_bugs"),
            ("Correcciones verificadas", "corrected_bugs"),
        ):
            if not section_flags[category]:
                continue
            for bug in sections[key]:
                writer.writerow([
                    "Bug", category, development_bug_code(bug), bug.get("titulo") or "Sin título",
                    development_case_code(bug), bug.get("estado") or "No registrado",
                    bug.get("severidad") or "No registrado", development_build_name(bug),
                    development_current_build_verification(bug), development_responsible_name(bug),
                    bug.get("descripcion") or "", bug.get("resultado_esperado") or "",
                    bug.get("resultado_obtenido") or bug.get("comportamiento_actual") or "",
                ])
        if development_section_enabled(payload, "failures"):
            writer.writerow([])
            writer.writerow(["Excepciones sin bug abierto", "Caso", "Titulo", "Estado", "Esperado", "Obtenido / diagnostico", "Accion"])
            for item in sections["failures_without_bug"]:
                writer.writerow([
                    "Excepcion sin bug abierto", item.get("case_code") or "TC no registrado",
                    item.get("case_title") or "Sin título", item.get("estado") or "No registrado",
                    item.get("expected") or "No registrado", item.get("obtained") or item.get("diagnosis") or "Sin detalle",
                    item.get("recommendation") or "Revisar evidencia y asociar un bug.",
                ])
        return "\ufeff" + output.getvalue()
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
    writer.writerow(["Bugs", "Codigo", "Titulo", "Caso", "Severidad", "Estado", "Responsable", "Descripcion", "Precondiciones", "Datos de prueba", "Resultado esperado", "Resultado obtenido", "Ejecucion", "Run", "Variables utilizadas"])
    for bug in bugs:
        api_context = bug.get("api_context") if isinstance(bug.get("api_context"), dict) else {}
        execution = api_context.get("execution_snapshot") if isinstance(api_context.get("execution_snapshot"), dict) else {}
        variables = execution.get("variables_used") or bug.get("api_variables_used") or {}
        if not variables:
            metadata = bug.get("metadata_json") if isinstance(bug.get("metadata_json"), dict) else {}
            variables = metadata.get("api_variables_used") if isinstance(metadata.get("api_variables_used"), dict) else {}
        variables_value = json.dumps(variables, ensure_ascii=False, default=str) if variables else ""
        writer.writerow([
            "Bug",
            bug.get("codigo") or "",
            bug.get("titulo") or "",
            bug.get("case_code") or "",
            bug.get("severidad") or "",
            bug.get("estado") or "",
            bug.get("responsable") or "",
            bug.get("descripcion") or "",
            bug.get("precondiciones") or "",
            bug.get("datos_prueba") or "",
            bug.get("resultado_esperado") or "",
            bug.get("resultado_obtenido") or bug.get("comportamiento_actual") or "",
            execution.get("execution_id") or bug.get("ejecucion_id") or "",
            execution.get("run_id") or bug.get("test_run_id") or "",
            variables_value,
        ])
    return "\ufeff" + output.getvalue()

_MARKDOWN_ESCAPE_RE = re.compile(r"([\\`*_{}\[\]()#+\-.!|>])")



__all__ = ["_shared_report_html","_shared_report_csv"]

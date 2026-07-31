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


def _render_report_evidence(request: Request, items: list, legacy_url: Optional[str] = None, limit: int = 6):
    evidence = list(items or [])
    if legacy_url:
        evidence.append({"filename_original": "Evidencia legacy", "public_url": legacy_url, "content_type": "image/*"})
    rendered = []
    for item in evidence[:limit]:
        url = _report_public_url(request, item.get("public_url"))
        if not url:
            continue
        name = html.escape(str(item.get("filename_original") or "Evidencia"))
        ctype = str(item.get("content_type") or "")
        if ctype.startswith("image/") or ctype == "image/*":
            rendered.append(f"<a class='evidence-thumb' href='{html.escape(url)}' target='_blank' rel='noopener'><img src='{html.escape(url)}' alt='{name}' /><span>{name}</span></a>")
        else:
            rendered.append(f"<a class='evidence-link' href='{html.escape(url)}' target='_blank' rel='noopener'>{name}</a>")
    return "".join(rendered) if rendered else "<span class='muted-text'>Sin evidencia</span>"

def _render_report_distribution(stats: dict):
    total = max(1, sum(int(stats.get(key) or 0) for key in ["pasados", "fallados", "bloqueados", "pendientes"]))
    rows = []
    for label, key, klass in [("Pasadas", "pasados", "ok"), ("Fallidas", "fallados", "fail"), ("Bloqueadas", "bloqueados", "blocked"), ("Pendientes", "pendientes", "muted")]:
        value = int(stats.get(key) or 0)
        rows.append(f"<div><div class='bar-label'><span>{label}</span><strong>{value}</strong></div><div class='bar'><span class='{klass}' style='width:{round((value / total) * 100, 2)}%'></span></div></div>")
    return "".join(rows)

def _render_report_trend(metrics: dict):
    history = metrics.get("historico_versions") or []
    if len(history) < 2:
        return "<p class='muted-text'>No hay build anterior suficiente para comparar.</p>"
    current_index = next((idx for idx, item in enumerate(history) if item.get("build_id") == metrics.get("build_id")), 0)
    current = history[current_index] if current_index < len(history) else history[0]
    previous = history[current_index + 1] if current_index + 1 < len(history) else None
    if not previous:
        return "<p class='muted-text'>No hay build anterior suficiente para comparar.</p>"
    diff_failed = int(current.get("fallados") or 0) - int(previous.get("fallados") or 0)
    diff_passed = int(current.get("pasados") or 0) - int(previous.get("pasados") or 0)
    diff_blocked = int(current.get("bloqueados") or 0) - int(previous.get("bloqueados") or 0)
    current_build = html.escape(str(current.get("build_name") or "build actual"))
    previous_build = html.escape(str(previous.get("build_name") or "build anterior"))
    if diff_failed < 0:
        verdict, verdict_class = f"Mejoro: {abs(diff_failed)} prueba(s) fallida(s) menos", "ok-text"
    elif diff_failed > 0:
        verdict, verdict_class = f"Empeoro: {diff_failed} prueba(s) fallida(s) mas", "fail-text"
    elif diff_blocked > 0:
        verdict, verdict_class = f"Sin cambio en fallos, pero hay {diff_blocked} prueba(s) bloqueada(s) mas", "fail-text"
    elif diff_blocked < 0:
        verdict, verdict_class = f"Sin cambio en fallos y {abs(diff_blocked)} bloqueo(s) menos", "ok-text"
    else:
        verdict, verdict_class = "Sin cambio en fallos ni bloqueos", "muted-text"
    rows = "".join(
        "<tr>"
        f"<td>{html.escape(str(item.get('build_name') or 'Build'))}</td>"
        f"<td>{item.get('pasados', 0)} pruebas</td>"
        f"<td>{item.get('fallados', 0)} pruebas</td>"
        f"<td>{item.get('bloqueados', 0)} pruebas</td>"
        "</tr>"
        for item in history[:6]
    )
    return (
        "<div class='trend-callout'>"
        f"<div><strong class='{verdict_class}'>{html.escape(verdict)}</strong>"
        f"<br/><span class='muted-text'>{current_build} comparada con {previous_build}</span></div>"
        "<div class='trend-deltas'>"
        f"<span>Pasadas: {diff_passed:+d} pruebas</span>"
        f"<span>Fallidas: {diff_failed:+d} pruebas</span>"
        f"<span>Bloqueadas: {diff_blocked:+d} pruebas</span>"
        "</div>"
        "</div>"
        "<table class='compact'><thead><tr><th>Build</th><th>Pruebas pasadas</th><th>Pruebas fallidas</th><th>Pruebas bloqueadas</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
    )

def _render_report_cases(request: Request, cases: list, only_failed: bool = False):
    visible = [case for case in cases if not only_failed or str(case.get("estado")).upper() in {"FALLO", "BLOQUEADO"}]
    if not visible:
        return "<p class='muted-text'>No hay casos para mostrar.</p>"
    rows = []
    for case in visible:
        status = str(case.get("estado") or "SIN_CORRER")
        rows.append("<tr>"
            f"<td><strong>{html.escape(str(case.get('codigo') or ''))}</strong><br/><span class='muted-text'>{html.escape(str(case.get('suite_breadcrumb') or 'Sin suite'))}</span></td>"
            f"<td>{_report_html(case.get('titulo'), max_len=300)}<br/><span class='muted-text'>{_report_html(case.get('observaciones'), max_len=240)}</span></td>"
            f"<td><span class='pill {_report_badge_class(status)}'>{html.escape(status)}</span></td>"
            f"<td>{html.escape(str(case.get('tipo_prueba') or ''))}</td>"
            f"<td>{_render_report_evidence(request, case.get('evidencias') or [], case.get('evidencia_url'))}</td></tr>")
    return f"<table><thead><tr><th>Caso</th><th>Resultado / detalle</th><th>Estado</th><th>Tipo</th><th>Evidencia</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"

def _render_report_failed_steps(request: Request, cases: list):
    failed = [case for case in cases if str(case.get("estado")).upper() in {"FALLO", "BLOQUEADO"}]
    if not failed:
        return "<p class='muted-text'>No hay pasos fallidos o bloqueados.</p>"
    cards = []
    for case in failed:
        snapshots = case.get("snapshots") or []
        relevant = [snap for snap in snapshots if str(snap.get("estado_paso")).upper() in {"FALLO", "BLOQUEADO"}] or snapshots[:4]
        rows = []
        for snap in relevant:
            status = str(snap.get("estado_paso") or "")
            rows.append("<tr>"
                f"<td>{snap.get('numero_paso', '')}</td><td>{_report_html(snap.get('accion_congelada'), max_len=500)}</td>"
                f"<td>{_report_html(snap.get('resultado_esperado_congelado'), max_len=500)}</td>"
                f"<td><span class='pill {_report_badge_class(status)}'>{html.escape(status)}</span><br/><span class='muted-text'>{_report_html(snap.get('error_log') or snap.get('comentarios'), max_len=260)}</span></td>"
                f"<td>{_render_report_evidence(request, snap.get('evidencias') or [], snap.get('evidencia_url'))}</td></tr>")
        cards.append(f"<section class='subcard'><h3>{html.escape(str(case.get('codigo') or ''))} - {html.escape(str(case.get('titulo') or ''))}</h3><table><thead><tr><th>#</th><th>Acción</th><th>Esperado</th><th>Fallo</th><th>Evidencia</th></tr></thead><tbody>{''.join(rows)}</tbody></table></section>")
    return "".join(cards)

def _render_report_bugs(request: Request, bugs: list):
    if not bugs:
        return "<p class='muted-text'>No hay bugs internos asociados.</p>"
    rows = []
    for bug in bugs:
        attachments = [item.get("attachment") for item in (bug.get("attachments") or []) if item.get("attachment")]
        external = f"<br/><span class='muted-text'>Externo: {html.escape(str(bug.get('external_provider') or ''))} {html.escape(str(bug.get('external_issue_id') or ''))}</span>" if bug.get("external_provider") or bug.get("external_issue_id") else ""
        rows.append("<tr>"
            f"<td><strong>{html.escape(str(bug.get('codigo') or ''))}</strong>{external}</td>"
            f"<td>{_report_html(bug.get('titulo'), max_len=300)}<br/><span class='muted-text'>{_report_html(bug.get('descripcion'), max_len=260)}</span></td>"
            f"<td><span class='pill fail'>{html.escape(str(bug.get('severidad') or ''))}</span></td><td>{html.escape(str(bug.get('estado') or ''))}</td>"
            f"<td>{_render_report_evidence(request, attachments)}</td></tr>")
    return f"<table><thead><tr><th>Bug / ticket</th><th>Detalle</th><th>Severidad</th><th>Estado</th><th>Evidencia</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"

def _report_type_from_payload(payload: dict) -> str:
    return str((payload.get("metadata") or {}).get("report_type") or "executive").lower()

def _report_sections(payload: dict, report_type: str) -> dict:
    settings = payload.get("report_settings") if isinstance(payload.get("report_settings"), dict) else {}
    type_settings = settings.get(report_type) if isinstance(settings.get(report_type), dict) else {}
    sections = type_settings.get("sections") if isinstance(type_settings.get("sections"), dict) else {}
    return sections

def _report_section_enabled(payload: dict, report_type: str, section: str) -> bool:
    return _report_sections(payload, report_type).get(section) is not False

def _render_section_if(enabled: bool, title: str, content: str, class_name: str = "card") -> str:
    return f"<section class='{class_name}'><h2>{html.escape(title)}</h2>{content}</section>" if enabled else ""

REPORT_DISPLAY_TIMEZONE = os.getenv("REPORT_DISPLAY_TIMEZONE", "America/Argentina/Buenos_Aires")

def _report_display_timezone():
    try:
        return ZoneInfo(REPORT_DISPLAY_TIMEZONE)
    except Exception:
        return timezone.utc

def _parse_report_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(_report_display_timezone())

def _format_report_datetime(value: Any) -> str:
    parsed = _parse_report_datetime(value)
    if not parsed:
        return "N/D"
    return parsed.strftime("%d/%m/%Y %H:%M")

def _report_common_css() -> str:
    return """body{margin:0;font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a}main{max-width:1220px;margin:32px auto;padding:0 20px 60px}h1{margin:0 0 10px;font-size:34px}h2{margin:0 0 18px;font-size:22px}h3{margin:0 0 12px;font-size:17px}.card,.subcard{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;box-shadow:0 10px 35px rgba(15,23,42,.07);margin-bottom:18px}.subcard{box-shadow:none;padding:18px}.banner{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:12px 16px;border-radius:10px;margin-bottom:18px;font-weight:700}.banner a{display:inline-block;margin-left:12px;color:#0f172a;background:white;border:1px solid #f59e0b;border-radius:8px;padding:7px 10px;text-decoration:none}.download-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:14px 16px;margin-bottom:18px;box-shadow:0 8px 24px rgba(15,23,42,.05)}.download-toolbar strong{display:block}.download-toolbar span{color:#64748b;font-size:13px}.download-actions{display:flex;flex-wrap:wrap;gap:8px}.download-actions a{display:inline-flex;align-items:center;gap:6px;border:1px solid #2563eb;border-radius:9px;padding:8px 11px;color:#1d4ed8;background:#eff6ff;text-decoration:none;font-weight:800;font-size:12px}.download-actions a.primary{background:#0d6efd;color:white;border-color:#0d6efd}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:22px}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px}.metric{border-radius:12px;padding:20px;border:1px solid rgba(15,23,42,.06)}.ok{background:#dcfce7;color:#166534}.fail{background:#fee2e2;color:#991b1b}.blocked{background:#dbeafe;color:#1e3a8a}.muted{background:#f1f5f9;color:#475569}.warning{background:#fef3c7;color:#92400e}.value{font-size:38px;font-weight:800;display:block}.label{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.meta,.muted-text{color:#64748b;line-height:1.6}.ok-text{color:#15803d}.fail-text{color:#dc2626}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #e2e8f0;padding:10px;text-align:left;vertical-align:top}th{color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:#f8fafc}.compact td,.compact th{padding:8px}.pill{display:inline-block;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:800}.report-action-link{display:inline-block;margin-left:8px;padding:4px 9px;border:1px solid #2563eb;border-radius:7px;color:#1d4ed8;background:#eff6ff;text-decoration:none;font-size:11px;font-weight:800;vertical-align:middle}.report-action-link:hover{background:#dbeafe}.bar-label{display:flex;justify-content:space-between;font-size:13px;margin:10px 0 5px}.bar{height:12px;background:#e2e8f0;border-radius:999px;overflow:hidden}.bar span{display:block;height:100%}.trend-callout{display:flex;justify-content:space-between;gap:12px;background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:10px;margin-bottom:10px}.trend-deltas{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.trend-deltas span{background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:700;color:#334155}.evidence-thumb{display:inline-flex;align-items:center;gap:6px;margin:2px 6px 2px 0;color:#0d6efd;text-decoration:none}.evidence-thumb img{width:44px;height:34px;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1}.evidence-link{display:inline-block;margin:2px 6px 2px 0;color:#0d6efd;font-weight:700}.callout{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-top:16px}.actions li{margin:7px 0}.bug-steps{margin:8px 0 16px 22px;padding:0}.bug-steps li{margin:8px 0;line-height:1.45}.bug-steps strong{color:#334155}.report-pre{white-space:pre-wrap;line-height:1.45;margin:8px 0 16px}@media(max-width:900px){.grid,.two-col{grid-template-columns:1fr}.download-toolbar{align-items:flex-start;flex-direction:column}table{display:block;overflow-x:auto}}@media print{@page{size:A4;margin:12mm}.download-toolbar{display:none}body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}main{max-width:none;margin:0 auto;padding:0}.card,.subcard{box-shadow:none;break-inside:avoid;page-break-inside:avoid}.grid{grid-template-columns:repeat(4,1fr)!important;gap:8px}.two-col{grid-template-columns:1fr 1fr!important;gap:10px}.metric{padding:12px;min-height:74px}.value{font-size:28px}.label{font-size:9px;line-height:1.25}h1{font-size:26px}h2{font-size:18px}.card{padding:16px;margin-bottom:10px}.trend-callout{display:block;padding:10px}.trend-callout strong{font-size:14px}.trend-callout .muted-text{font-size:12px}.trend-deltas{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;justify-content:stretch;margin-top:8px}.trend-deltas span{border-radius:8px;padding:6px 5px;text-align:center;font-size:10px;line-height:1.25;white-space:normal}table{display:table;overflow:visible;font-size:11px}th,td{padding:7px}.bug-steps li{margin:5px 0}}"""

def _report_download_toolbar(request: Request, report_type: str) -> str:
    path = request.url.path
    if path.endswith((".md", ".pdf", ".csv")):
        return ""
    md_href = f"{path}.md"
    pdf_href = f"{path}.pdf"
    csv_href = f"{path}.csv"
    ai_label = "Markdown para IA"
    excel_label = "Excel CSV"
    type_label = {"development": "Desarrollo", "internal": "Interno", "executive": "Ejecutivo"}.get(report_type, "Ejecutivo")
    return (
        "<section class='download-toolbar'>"
        f"<div><strong>Descargar informe {html.escape(type_label)}</strong><span>Exporta este snapshot congelado sin cambiar sus datos.</span></div>"
        "<div class='download-actions'>"
        f"<a class='primary' href='{html.escape(pdf_href)}'>PDF</a>"
        f"<a href='{html.escape(csv_href)}'>{html.escape(excel_label)}</a>"
        f"<a href='{html.escape(md_href)}'>{html.escape(ai_label)}</a>"
        "</div>"
        "</section>"
    )

def _report_context_html(meta: dict, metrics: dict, snapshot: models.SharedReportSnapshot) -> str:
    snapshot_at = meta.get("snapshot_at") or snapshot.created_at
    return (
        f"Organizacion: {html.escape(str(meta.get('organizacion') or 'N/D'))}<br/>"
        f"Proyecto: {html.escape(str(meta.get('proyecto') or 'N/D'))}<br/>"
        f"Componente: {html.escape(str(meta.get('componente') or 'N/D'))}<br/>"
        f"Build: {html.escape(str(meta.get('build') or metrics.get('build_name') or 'N/D'))}<br/>"
        f"Ultima ejecucion: {html.escape(_format_report_datetime(meta.get('last_execution_at')))}<br/>"
        f"Generado: {html.escape(_format_report_datetime(snapshot_at))}"
    )

def _report_preview_description(meta: dict, metrics: dict, qa_summary: dict, fallback: Any = "") -> str:
    stats = metrics.get("stats") or {}
    parts = [
        f"{meta.get('organizacion') or 'Treseko'}",
        f"Proyecto {meta.get('proyecto') or 'N/D'}",
        f"Build {meta.get('build') or metrics.get('build_name') or 'N/D'}",
        f"Diagnóstico {qa_summary.get('decision') or meta.get('qa_state') or 'N/D'}",
        f"Cobertura {_fmt_report_percent(metrics.get('cobertura_porcentaje'))}",
        f"Fallos {stats.get('fallados', 0)}",
        f"Bloqueos {stats.get('bloqueados', 0)}",
    ]
    text = " · ".join(str(part) for part in parts if part)
    return _report_text(text or fallback or "Informe QA compartido desde Treseko.", max_len=260)

def _fmt_report_percent(value: Any) -> str:
    try:
        return f"{float(value or 0):.1f}%"
    except (TypeError, ValueError):
        return "0.0%"

def _fmt_report_hours(value: Any) -> str:
    if value in (None, ""):
        return "N/D"
    try:
        hours = float(value or 0)
    except (TypeError, ValueError):
        return "N/D"
    if hours < 1:
        return f"{round(hours * 60)} min"
    if hours < 48:
        return f"{hours:.1f} h"
    return f"{hours / 24:.1f} dias"

def _fmt_report_seconds(value: Any) -> str:
    try:
        seconds = int(value or 0)
    except (TypeError, ValueError):
        return "0 min"
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{round(seconds / 60)} min"
    return f"{seconds / 3600:.1f} h"


__all__ = ["_render_report_evidence","_render_report_distribution","_render_report_trend","_render_report_cases","_render_report_failed_steps","_render_report_bugs","_report_type_from_payload","_report_sections","_report_section_enabled","_render_section_if","_report_display_timezone","_parse_report_datetime","_format_report_datetime","_report_common_css","_report_download_toolbar","_report_context_html","_report_preview_description","_fmt_report_percent","_fmt_report_hours","_fmt_report_seconds"]

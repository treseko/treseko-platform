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


def _report_public_url(request: Request, value: Optional[str]):
    safe_value = sanitize_evidence_url(value)
    if not safe_value:
        return None
    if safe_value.startswith(("http://", "https://")):
        return safe_value
    return f"{str(request.base_url).rstrip('/')}/{safe_value.lstrip('/')}"


def _report_link_url(value: Any) -> Optional[str]:
    text = str(value or "").strip().replace("\x00", "")
    if not text or any(char.isspace() for char in text) or any(char in text for char in "<>\"'"):
        return None
    parsed = urlparse(text)
    if parsed.scheme:
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
            return None
        if parsed.username or parsed.password:
            return None
        return text
    if text.startswith("/") and not text.startswith("//"):
        return text
    return None

def _flatten_report_cases(nodes: list):
    cases = []
    for node in nodes or []:
        cases.extend(node.get("casos") or [])
        cases.extend(_flatten_report_cases(node.get("children") or []))
    return cases

def _report_badge_class(value: str):
    return {"PASO": "ok", "FALLO": "fail", "BLOQUEADO": "blocked"}.get(str(value or "").upper(), "muted")

def _report_text(value: Any, *, fallback: str = "", max_len: int = 1200) -> str:
    if value is None or str(value).strip() == "":
        return fallback
    return sanitize_external_error(value, max_len=max_len)

def _report_html(value: Any, *, fallback: str = "", max_len: int = 1200) -> str:
    return html.escape(_report_text(value, fallback=fallback, max_len=max_len))

def _report_multiline_html(value: Any, *, fallback: str = "", max_len: int = 1200) -> str:
    text = _report_text(value, fallback=fallback, max_len=max_len)
    if not text:
        return ""
    return "<br/>".join(html.escape(line) for line in text.splitlines())

def _report_steps_html(value: Any, *, fallback: str = "N/D", max_len: int = 2000) -> str:
    text = _report_text(value, fallback="", max_len=max_len)
    if not text:
        return html.escape(fallback)
    text = re.sub(r"\s+", " ", text).strip()
    matches = list(re.finditer(r"(?:(?<=^)|(?<=\s))\d+\.\s+(?!\d)", text))
    steps = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        steps.append(text[start:end].strip())
    if len(steps) <= 1:
        lines = [line.strip() for line in _report_text(value, fallback="", max_len=max_len).splitlines() if line.strip()]
        steps = lines if len(lines) > 1 else steps
    if len(steps) <= 1:
        return f"<div class='report-pre'>{_report_multiline_html(value, fallback=fallback, max_len=max_len)}</div>"
    items = []
    for step in steps:
        cleaned = re.sub(r"^\d+\.\s*", "", step).strip()
        cleaned = re.sub(r"\s+(Datos:|Esperado:|Observacion:|Observación:)", r"<br/><strong>\1</strong>", html.escape(cleaned))
        items.append(f"<li>{cleaned}</li>")
    return f"<ol class='bug-steps'>{''.join(items)}</ol>"

REPORT_RENDER_CLOSED_BUG_STATUSES = {"CERRADO", "RESUELTO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE", "CLOSED", "DONE", "RESOLVED"}

def _report_render_bug_is_active(bug: dict) -> bool:
    return str((bug or {}).get("estado") or "").upper() not in REPORT_RENDER_CLOSED_BUG_STATUSES

def _report_frontend_base_url(request: Request) -> str:
    configured = os.getenv("FRONTEND_PUBLIC_URL") or os.getenv("NOTIFICATIONS_PUBLIC_BASE_URL")
    if configured:
        parsed = urlparse(configured.strip())
        if parsed.scheme.lower() in {"http", "https"} and parsed.netloc:
            return configured.strip().rstrip("/")
    host = request.url.hostname or "localhost"
    scheme = request.url.scheme or "http"
    if host in {"localhost", "127.0.0.1", "0.0.0.0"}:
        return f"{scheme}://{host}:5173"
    return str(request.base_url).rstrip("/")

def _report_bug_tracker_url(request: Request, bug: dict) -> Optional[str]:
    bug_id = (bug or {}).get("id")
    if not bug_id:
        return None
    return f"{_report_frontend_base_url(request)}/?{urlencode({'tab': 'bugs', 'bug_id': str(bug_id)})}"

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
            f"<td>{html.escape(_fmt_report_hours(timing))}<br/><span class='muted-text'>Origen: {html.escape(str(bug.get('build_detectado') or 'N/D'))}</span></td>"
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

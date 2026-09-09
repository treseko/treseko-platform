import os
import re
import csv
import io
import json
import uuid
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
from .report_rendering_sections import REPORT_VISIBLE_FORMATS
from .report_development_markdown import (
    development_report_categories,
    render_development_bug_details,
    render_development_bug_table,
    render_development_failures,
)
from .report_rendering_metrics import *
from .report_rendering_html import _MARKDOWN_ESCAPE_RE

from .report_rendering_base import *


def _md(value: Any) -> str:
    text = _report_text(value, max_len=2000).replace("\x00", "").replace("\r", " ").replace("\n", " ").strip()
    text = re.sub(r"\s+", " ", text)
    return _MARKDOWN_ESCAPE_RE.sub(r"\\\1", text)


def _md_multiline(value: Any) -> str:
    """Escape user text while retaining intentional line breaks in Markdown."""
    text = _report_text(value, max_len=2000).replace("\x00", "").replace("\r", "")
    return "  \n".join(_md(line) for line in text.splitlines())


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


def _markdown_conversation_value(value: Any, fallback: str = "N/D") -> str:
    if value in (None, "", [], {}):
        return fallback
    if isinstance(value, (dict, list)):
        return _md(json.dumps(value, ensure_ascii=False, indent=2, default=str))
    return _md(value)


def _markdown_bug_identifier(value: Any) -> str:
    return _md(value).replace("\\-", "-")


def _markdown_bug_public_test_data(bug: dict) -> bool:
    policies = [bug.get("evidence_policy"), bug.get("api_evidence_policy")]
    for context_key in ("api_context", "conversational_context"):
        context = bug.get(context_key)
        if isinstance(context, dict):
            policies.append(context.get("evidence_policy"))
    return bool(
        bug.get("public_test_data") is True
        or any(isinstance(policy, dict) and policy.get("public_test_data") is True for policy in policies)
    )


def _markdown_bug_value(bug: dict, value: Any, fallback: str = "N/D", *, max_len: Optional[int] = 2000) -> str:
    if value in (None, ""):
        return fallback
    if _markdown_bug_public_test_data(bug):
        text = str(value).replace("\x00", "")
        if text.startswith(("http://", "https://")):
            return _markdown_link_url(text) or _MARKDOWN_ESCAPE_RE.sub(r"\\\1", text[:2000])
        if max_len is not None and len(text) > max_len:
            text = text[:max_len] + "..."
        return _MARKDOWN_ESCAPE_RE.sub(r"\\\1", text)
    return _md(value)


def _markdown_conversation_bug_value(
    bug: dict,
    value: Any,
    fallback: str = "N/D",
    *,
    max_len: Optional[int] = 2000,
) -> str:
    if value in (None, "", [], {}):
        return fallback
    if isinstance(value, (dict, list)):
        return _markdown_bug_value(
            bug,
            json.dumps(value, ensure_ascii=False, indent=2, default=str),
            fallback,
            max_len=max_len,
        )
    return _markdown_bug_value(bug, value, fallback, max_len=max_len)


def _markdown_display_label(item: dict, keys: tuple[str, ...], fallback: str = "No registrado") -> str:
    """Return a human label without turning an internal identifier into a name."""
    for key in keys:
        value = item.get(key)
        if value in (None, ""):
            continue
        if isinstance(value, dict):
            value = value.get("name") or value.get("build_name") or value.get("label") or value.get("status")
        if value in (None, ""):
            continue
        text = str(value).strip()
        try:
            uuid.UUID(text)
        except (AttributeError, TypeError, ValueError):
            return _md(text)
    return fallback


def _markdown_development_bug_context(
    bug: dict,
    *,
    case: dict | None = None,
    execution: dict | None = None,
    include_classic_details: bool = False,
) -> list[str]:
    case = case or (bug.get("case_snapshot") if isinstance(bug.get("case_snapshot"), dict) else {})
    execution = execution or (bug.get("execution_snapshot") if isinstance(bug.get("execution_snapshot"), dict) else {})
    rows = [
        ("Caso", _markdown_display_label(case, ("code", "codigo"), _markdown_display_label(bug, ("case_code", "codigo_caso"), "TC no registrado"))),
        ("Título del caso", _markdown_display_label(case, ("title", "titulo"), _markdown_display_label(bug, ("case_title", "titulo"), "No registrado"))),
        ("Versión del caso", _markdown_display_label(case, ("version",), _markdown_display_label(bug, ("case_version",), "No registrado"))),
        ("Build", _markdown_display_label(bug, ("origin_build_name", "build_name", "build_code"))),
        ("Ambiente", _markdown_display_label(execution, ("environment_name", "ambiente_nombre"), _markdown_display_label(bug, ("ambiente_nombre",), "No registrado"))),
        ("Dataset", _markdown_display_label(execution, ("dataset_name",), _markdown_display_label(bug, ("dataset_name",), "No registrado"))),
        ("Run", _markdown_display_label(execution, ("run_name", "test_run_name"), _markdown_display_label(bug, ("run_name",), "No registrado"))),
        ("Ejecución", _markdown_display_label(execution, ("execution_name", "execution_label"), _markdown_display_label(bug, ("execution_name",), "No registrado"))),
        ("Responsable", _markdown_display_label(bug, ("responsable", "responsible_display"))),
    ]
    lines = [f"- {label}: {value}" for label, value in rows]
    environment_url = execution.get("environment_url") or bug.get("ambiente_url")
    lines.append(f"- URL del ambiente: {_markdown_bug_value(bug, environment_url, 'No registrado')}")
    if include_classic_details:
        lines.extend([
            f"- Navegador: {_markdown_bug_value(bug, bug.get('navegador'), 'No registrado')}",
            f"- Dispositivo: {_markdown_bug_value(bug, bug.get('dispositivo'), 'No registrado')}",
            f"- Sistema operativo: {_markdown_bug_value(bug, bug.get('sistema_operativo'), 'No registrado')}",
            f"- URL afectada: {_markdown_bug_value(bug, bug.get('url_afectada'), 'No registrado')}",
        ])
    return lines


def _markdown_common_bug_context(
    bug: dict,
    *,
    case: dict | None = None,
    execution: dict | None = None,
    development: bool = False,
    include_classic_details: bool = False,
) -> list[str]:
    if development:
        return _markdown_development_bug_context(
            bug,
            case=case,
            execution=execution,
            include_classic_details=include_classic_details,
        )
    case = case or (bug.get("case_snapshot") if isinstance(bug.get("case_snapshot"), dict) else {})
    execution = execution or (bug.get("execution_snapshot") if isinstance(bug.get("execution_snapshot"), dict) else {})
    rows = [
        ("Caso", case.get("code") or bug.get("case_code") or bug.get("caso_id") or "N/D"),
        ("Título del caso", case.get("title") or bug.get("case_title") or bug.get("titulo") or "N/D"),
        ("Versión del caso", case.get("version") or bug.get("case_version") or "N/D"),
        ("Build", execution.get("build_name") or execution.get("build_code") or bug.get("build_code") or bug.get("build_id") or "N/D"),
        ("Componente", bug.get("component_name") or bug.get("modulo_funcional") or bug.get("componente_id") or "N/D"),
        ("Ambiente", execution.get("environment_name") or bug.get("ambiente_nombre") or "N/D"),
        ("ID del ambiente", execution.get("environment_id") or bug.get("entorno_id") or "N/D"),
        ("URL del ambiente", execution.get("environment_url") or bug.get("ambiente_url") or "N/D"),
        ("Dataset", execution.get("dataset_name") or bug.get("dataset_name") or "N/D"),
        ("ID del dataset", execution.get("dataset_id") or bug.get("dataset_id") or "N/D"),
        ("Ejecución", execution.get("execution_id") or bug.get("ejecucion_id") or "N/D"),
        ("Run", execution.get("run_id") or bug.get("test_run_id") or "N/D"),
        ("Modo", execution.get("mode") or bug.get("execution_mode") or "N/D"),
        ("Navegador", bug.get("navegador") or "N/D"),
        ("Dispositivo", bug.get("dispositivo") or "N/D"),
        ("Resolución", bug.get("resolucion") or "N/D"),
        ("Sistema operativo", bug.get("sistema_operativo") or "N/D"),
        ("Versión de la aplicación", bug.get("version_app") or "N/D"),
        ("URL afectada", bug.get("url_afectada") or "N/D"),
    ]
    return [f"- {label}: {_markdown_bug_identifier(value) if label in {'ID del ambiente', 'ID del dataset', 'Ejecución', 'Run'} else _markdown_bug_value(bug, value)}" for label, value in rows]


def _markdown_common_bug_fields(
    bug: dict,
    *,
    case: dict | None = None,
    include_steps: bool = True,
    full_evidence: bool = False,
    development: bool = False,
) -> list[str]:
    case = case or (bug.get("case_snapshot") if isinstance(bug.get("case_snapshot"), dict) else {})
    lines = [
        f"- Descripción: {_markdown_bug_value(bug, bug.get('descripcion') or case.get('description'), 'Sin descripción', max_len=None if full_evidence else 2000)}",
        f"- Precondiciones: {_markdown_bug_value(bug, bug.get('precondiciones') or case.get('preconditions'), max_len=None if full_evidence else 2000)}",
        f"- Postcondiciones: {_markdown_bug_value(bug, bug.get('postcondiciones') or case.get('postconditions'), max_len=None if full_evidence else 2000)}",
    ]
    if include_steps:
        lines.append(f"- Pasos para reproducir: {_markdown_bug_value(bug, bug.get('pasos_reproduccion'), max_len=None if full_evidence else 2000)}")
    lines.extend([
        f"- Datos utilizados en la ejecución: {_markdown_bug_value(bug, bug.get('datos_prueba'), max_len=None if full_evidence else 2000)}",
        f"- Resultado esperado: {_markdown_bug_value(bug, bug.get('resultado_esperado'), max_len=None if full_evidence else 2000)}",
        f"- Resultado obtenido: {_markdown_bug_value(bug, bug.get('resultado_obtenido') or bug.get('comportamiento_actual'), max_len=None if full_evidence else 2000)}",
        f"- Impacto de negocio: {_markdown_bug_value(bug, bug.get('impacto_negocio'), max_len=None if full_evidence else 2000)}",
        f"- Frecuencia: {_markdown_bug_value(bug, bug.get('frecuencia'), max_len=None if full_evidence else 2000)}",
        f"- Módulo funcional: {_markdown_bug_value(bug, bug.get('modulo_funcional'), max_len=None if full_evidence else 2000)}",
        f"- Logs / contexto técnico: {_markdown_bug_value(bug, bug.get('logs_relevantes'), 'Sin logs', max_len=None if full_evidence else 2000)}",
        f"- Error técnico: {_markdown_bug_value(bug, bug.get('error_tecnico'), max_len=None if full_evidence else 2000)}",
        f"- Stack trace: {_markdown_bug_value(bug, bug.get('stack_trace'), max_len=None if full_evidence else 2000)}",
        f"- Resolución / motivo de cierre: {_markdown_bug_value(bug, bug.get('resolucion_bug') or bug.get('motivo_cierre'), max_len=None if full_evidence else 2000)}",
        f"- Notas QA: {_markdown_bug_value(bug, bug.get('notas_qa'), 'Sin notas', max_len=None if full_evidence else 2000)}",
    ])
    comments = bug.get("comments") or []
    lines.append("- Comentarios:")
    comments_to_render = comments if full_evidence else comments[:20]
    lines.extend(
        f"  - {_markdown_bug_value(bug, comment.get('created_at') or '')}: {_markdown_bug_value(bug, comment.get('comentario') or 'Sin comentario', max_len=None if full_evidence else 2000)}"
        for comment in comments_to_render if isinstance(comment, dict)
    )
    if not comments:
        lines.append("  - Sin comentarios congelados.")
    attachments = bug.get("attachments") or []
    lines.append("- Evidencias adjuntas:")
    attachments_to_render = attachments if full_evidence else attachments[:20]
    for item in attachments_to_render:
        attachment = item.get("attachment") if isinstance(item, dict) and isinstance(item.get("attachment"), dict) else {}
        lines.append(f"  - {_markdown_bug_value(bug, attachment.get('filename_original') or attachment.get('filename') or (item or {}).get('tipo') or 'Evidencia', max_len=None if full_evidence else 2000)}")
    if not attachments:
        lines.append("  - Sin evidencias adjuntas congeladas.")
    return lines


def _markdown_conversational_bug(
    bug: dict,
    *,
    full_evidence: bool = False,
    development: bool = False,
) -> list[str]:
    context = bug.get("conversational_context") or {}
    case = context.get("case_snapshot") if isinstance(context.get("case_snapshot"), dict) else (bug.get("case_snapshot") or {})
    execution = context.get("execution_snapshot") or {}
    evaluation = context.get("evaluation") or bug.get("chatbot_evaluation") or {}
    technical = context.get("technical_evidence") or bug.get("chatbot_technical_evidence") or {}
    turns = context.get("conversation_turns") or bug.get("conversation_turns") or []
    failed_index = evaluation.get("turn_index")
    if failed_index is None:
        failed_index = bug.get("chatbot_turn_index")
    lines = [
        f"- Tipo: CONVERSACIONAL",
        f"- Categoría: {_md(evaluation.get('finding_type') or bug.get('chatbot_finding_type') or 'OTHER')}",
        f"- Estado: {_md(evaluation.get('status') or bug.get('estado') or 'N/D')}",
        *_markdown_common_bug_context(bug, case=case, execution=execution, development=development),
        *_markdown_common_bug_fields(bug, case=case, include_steps=False, full_evidence=full_evidence, development=development),
        f"- Sesión: {_markdown_display_label(execution, ('session_name',), 'No registrado') if development else _md(execution.get('session_id') or 'N/D')}",
        f"- Run / ejecución: {_markdown_display_label(execution, ('run_name',), 'No registrado')} / {_markdown_display_label(execution, ('execution_name', 'execution_label'), 'No registrado') if development else _md(execution.get('execution_id') or 'N/D')}",
        "",
        "#### Conversación obtenida",
    ]
    if not turns:
        lines.append("No hay turnos conservados en este snapshot.")
    turns_to_render = turns if full_evidence else turns[:40]
    for turn in turns_to_render:
        observed = turn.get("observed") if isinstance(turn.get("observed"), dict) else {}
        technical_index = turn.get("technical_index", turn.get("index"))
        visible_index = turn.get("turn_number") or (int(technical_index) + 1 if str(technical_index).isdigit() else "N/D")
        status = str(turn.get("status") or observed.get("status") or "NOT_EXECUTED").upper()
        failed = str(technical_index) == str(failed_index) or status in {"FAILED", "FAIL", "FALLO", "BLOCKED", "BLOQUEADO"} or any(isinstance(item, dict) and item.get("passed") is False for item in (turn.get("assertions") or []))
        response = turn.get("response_text") or observed.get("responseText") or observed.get("response_text") or observed.get("response") or turn.get("response")
        lines.extend([
            "",
            f"##### Turno visible {visible_index} · índice técnico {technical_index} {'· FALLO' if failed else ('· NO EJECUTADO' if status in {'NOT_EXECUTED', 'NO_EJECUTADO', 'SIN_CORRER'} else '· PASO')}",
            f"- HTTP: {_md(turn.get('status_code') or observed.get('statusCode') or observed.get('status_code') or 'N/D')} · Latencia: {_md(turn.get('latency_ms') or observed.get('latencyMs') or observed.get('latency_ms') or 'N/D')} ms",
            f"- Mensaje enviado: {_markdown_conversation_bug_value(bug, turn.get('message'), 'No ejecutado', max_len=None if full_evidence else 2000)}",
            f"- Respuesta recibida: {_markdown_conversation_bug_value(bug, response, 'Sin respuesta', max_len=None if full_evidence else 2000)}",
            f"- Resultado esperado: {_markdown_conversation_bug_value(bug, turn.get('expected'), max_len=None if full_evidence else 2000)}",
            f"- Observación: {_markdown_conversation_bug_value(bug, turn.get('observation'), 'Sin observación adicional', max_len=None if full_evidence else 2000)}",
        ])
        assertions = turn.get("assertions") or observed.get("assertions") or []
        if assertions:
            lines.append("- Aserciones:")
            for assertion in (assertions if full_evidence else assertions[:20]):
                if isinstance(assertion, dict):
                    label = "PASÓ" if assertion.get("passed") is True else ("FALLÓ" if assertion.get("passed") is False else "PENDIENTE")
                    detail = assertion.get("message") or assertion.get("detail") or assertion.get("rule") or "Aserción"
                    lines.append(f"  - {label}: {_markdown_conversation_bug_value(bug, detail, max_len=None if full_evidence else 2000)}")
                else:
                    lines.append(f"  - {_markdown_conversation_bug_value(bug, assertion, max_len=None if full_evidence else 2000)}")
        request = observed.get("request") or turn.get("request")
        raw_response = observed.get("response") or turn.get("response")
        if request is not None or raw_response is not None:
            lines.extend([
                "",
                "<details><summary>Evidencia técnica: request y response</summary>",
                "",
                "```json",
                _markdown_bug_value(
                    bug,
                    json.dumps({"request": request, "response": raw_response}, ensure_ascii=False, indent=2, default=str),
                    max_len=None if full_evidence else 2000,
                ),
                "```",
                "</details>",
            ])
    human = evaluation.get("human_evaluation") or {}
    human_note = human.get("notes") if isinstance(human, dict) else human
    lines.extend([
        "",
        f"- Nota de evaluación: {_markdown_conversation_bug_value(bug, human_note or evaluation.get('review_note'), 'Sin nota', max_len=None if full_evidence else 2000)}",
    ])
    for label, value in (("Herramientas", technical.get("tools")), ("Comprobaciones de memoria", technical.get("memory_checks"))):
        if value:
            lines.extend([
                "",
                f"<details><summary>{label}</summary>",
                "",
                "```json",
                _markdown_bug_value(
                    bug,
                    json.dumps(value, ensure_ascii=False, indent=2, default=str),
                    max_len=None if full_evidence else 2000,
                ),
                "```",
                "</details>",
            ])
    return lines


def _markdown_json(value: Any, *, max_len: Optional[int] = 12000) -> str:
    try:
        rendered = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    except (TypeError, ValueError):
        rendered = str(value or "")
    if max_len is not None and len(rendered) > max_len:
        rendered = rendered[:max_len] + "..."
    return _md(rendered)


def _markdown_api_bug(
    bug: dict,
    *,
    compact: bool = False,
    full_evidence: bool = False,
    development: bool = False,
) -> list[str]:
    context = bug.get("api_context") if isinstance(bug.get("api_context"), dict) else {}
    case = context.get("case_snapshot") if isinstance(context.get("case_snapshot"), dict) else {}
    execution = context.get("execution_snapshot") if isinstance(context.get("execution_snapshot"), dict) else {}
    config = context.get("api_config_snapshot") if isinstance(context.get("api_config_snapshot"), dict) else {}
    result = context.get("api_resultado") if isinstance(context.get("api_resultado"), dict) else {}
    technical = context.get("technical_evidence") if isinstance(context.get("technical_evidence"), dict) else {}
    metadata = bug.get("metadata_json") if isinstance(bug.get("metadata_json"), dict) else {}
    variables = execution.get("variables_used") or bug.get("api_variables_used") or {}
    if not variables:
        variables = metadata.get("api_variables_used") if isinstance(metadata.get("api_variables_used"), dict) else {}
    evidence_policy = context.get("evidence_policy") if isinstance(context.get("evidence_policy"), dict) else {}
    if not evidence_policy:
        evidence_policy = metadata.get("evidence_policy") if isinstance(metadata.get("evidence_policy"), dict) else {}
    if not evidence_policy and isinstance(bug.get("api_evidence_policy"), dict):
        evidence_policy = bug.get("api_evidence_policy") or {}
    public_test_data = evidence_policy.get("public_test_data") is True or _markdown_bug_public_test_data(bug)
    evidence_max_len = None if full_evidence else (100_000 if public_test_data else 12_000)
    variable_limit = None if full_evidence else (len(variables) if public_test_data else 80)
    step_limit = None if full_evidence else (len(context.get("steps") or []) if public_test_data else 30)
    # Identifiers are meant to be copied into tickets and logs.  Markdown's
    # punctuation escaping would otherwise turn ``execution-1`` into
    # ``execution\\-1`` and make the persisted execution hard to search.
    lines = [
        "- Tipo: API",
        f"- Estado: {_md(bug.get('estado') or 'N/D')}",
        f"- Caso: {_markdown_display_label(case, ('code', 'codigo'), 'TC no registrado') if development else _md(case.get('code') or bug.get('case_code') or bug.get('caso_id') or 'N/D')} · {_markdown_display_label(case, ('title', 'titulo'), 'No registrado') if development else _md(case.get('title') or bug.get('titulo') or 'N/D')}",
        f"- Build: {_markdown_display_label(bug, ('origin_build_name', 'build_name')) if development else _md(execution.get('build_name') or execution.get('build_code') or bug.get('build_code') or bug.get('build_id') or 'N/D')}",
        f"- Ambiente: {_markdown_display_label(execution, ('environment_name', 'ambiente_nombre'))}",
        *( [f"- Responsable: {_markdown_display_label(bug, ('responsable', 'responsible_display'))}"] if development else [] ),
        *( [f"- Dataset: {_markdown_display_label(execution, ('dataset_name',), 'No registrado')}"] if development else [f"- Dataset: {_md(execution.get('dataset_name') or bug.get('dataset_name') or execution.get('dataset_id') or 'N/D')}"] ),
        *( [f"- Run: {_markdown_display_label(execution, ('run_name', 'test_run_name'))}"] if development else [] ),
        *( [f"- Ejecución: {_markdown_display_label(execution, ('execution_name', 'execution_label'))}"] if development else [] ),
        *([] if development else [f"- ID del ambiente: {_markdown_bug_identifier(execution.get('environment_id') or bug.get('entorno_id') or 'N/D')}"]),
        f"- URL del ambiente: {_markdown_bug_value(bug, execution.get('environment_url') or bug.get('ambiente_url') or 'N/D')}",
        *([] if development else [f"- ID del dataset: {_markdown_bug_identifier(execution.get('dataset_id') or bug.get('dataset_id') or 'N/D')}"]),
        f"- Estado técnico: {_md(execution.get('status') or result.get('status') or 'N/D')}",
        f"- Duración: {_md(execution.get('duration_seconds') if execution.get('duration_seconds') is not None else 'N/D')} s",
        *( [f"- Ejecución / Run: {_markdown_display_label(execution, ('execution_name', 'execution_label'))} / {_markdown_display_label(execution, ('run_name', 'test_run_name'))}"] if development else [f"- Ejecución / Run: {_markdown_bug_identifier(execution.get('execution_id') or bug.get('ejecucion_id') or 'N/D')} / {_markdown_bug_identifier(execution.get('run_id') or bug.get('test_run_id') or 'N/D')}"] ),
        f"- Descripción del caso: {_md(bug.get('descripcion') or case.get('description') or 'Sin descripción')}",
        f"- Precondiciones: {_md(bug.get('precondiciones') or case.get('preconditions') or 'N/D')}",
        f"- Postcondiciones: {_md(bug.get('postcondiciones') or case.get('postconditions') or metadata.get('case_postconditions') or 'N/D')}",
        f"- Datos de prueba: {_md(bug.get('datos_prueba') or 'N/D')}",
        f"- Resultado esperado: {_md(bug.get('resultado_esperado') or result.get('expected') or 'N/D')}",
        f"- Resultado obtenido: {_md(bug.get('resultado_obtenido') or bug.get('comportamiento_actual') or result.get('observed') or 'N/D')}",
        "- Variables utilizadas:",
    ]
    if not context:
        lines.extend([
            "",
            "> Contexto API parcial: este snapshot no conserva la ejecución completa. Se muestran los datos congelados disponibles; generá un informe nuevo para incluir solicitud, respuesta y validaciones.",
        ])
    if variables:
        # Variable names are identifiers (not free-form user content); keep
        # underscores readable so exported reports can be copied into a
        # request without visually changing the placeholder.
        variable_items = list(variables.items()) if variable_limit is None else list(variables.items())[:variable_limit]
        for name, value in variable_items:
            display_name = _md(name).replace("\\_", "_")
            display_value = _markdown_bug_value(
                bug, value, max_len=None if full_evidence else 2000
            )
            lines.append(f"  - {display_name}: {display_value}")
    else:
        lines.append("  - No se conservaron variables resueltas.")
    if compact:
        return lines
    resolved_dataset = execution.get("resolved_dataset") or metadata.get("dataset_resolved_values") or []
    if resolved_dataset:
        lines.extend([
            "",
            f"- Dataset resuelto: {_markdown_json(resolved_dataset, max_len=evidence_max_len)}",
        ])
    lines.extend([
        "",
        "#### Solicitud API congelada",
        "```json",
        _markdown_json(config, max_len=evidence_max_len),
        "```",
        "",
        "#### Respuesta y validaciones",
        "```json",
        _markdown_json(result, max_len=evidence_max_len),
        "```",
        f"- Evidencia técnica: {_md(technical.get('schema_version') or 'N/D')} · errores: {_md(technical.get('errors') or 'Ninguno')} · hash: {_md(context.get('evidence_sha256') or 'N/D')}",
    ])
    steps = context.get("steps") or []
    if steps:
        lines.extend(["", "#### Solicitudes individuales"])
        step_items = steps if step_limit is None else steps[:step_limit]
        for step in step_items:
            if isinstance(step, dict):
                assertions = step.get("assertions") or []
                assertion_text = ", ".join(
                    "PASÓ" if item.get("passed") is True else "FALLÓ" if item.get("passed") is False else "PENDIENTE"
                    for item in assertions if isinstance(item, dict)
                ) or "Sin aserciones"
                lines.append(f"- {_md(step.get('name') or 'Solicitud')} · HTTP {_md(step.get('status_code') or 'N/D')} · {_md(step.get('latency_ms') or 'N/D')} ms · {_md(step.get('status') or 'N/D')} · {_md(assertion_text)}")
    lines.extend([f"- Notas QA: {_md(bug.get('notas_qa') or 'Sin notas')}"])
    return lines


def _markdown_classic_bug(
    bug: dict,
    *,
    development: bool = False,
    full_evidence: bool = False,
) -> list[str]:
    return [
        f"- Tipo: CLÁSICA",
        f"- Estado: {_md(bug.get('estado') or 'N/D')}",
        *_markdown_common_bug_context(bug, development=development, include_classic_details=development),
        *_markdown_common_bug_fields(bug, full_evidence=full_evidence, development=development),
    ]


def _markdown_bug_reproduction(
    bug: dict,
    *,
    compact: bool = False,
    full_evidence: bool = False,
    development: bool = False,
) -> list[str]:
    if _report_bug_has_conversational_evidence(bug):
        return _markdown_conversational_bug(bug, full_evidence=full_evidence, development=development)
    if _report_bug_is_api(bug):
        return _markdown_api_bug(bug, compact=compact, full_evidence=full_evidence, development=development)
    return _markdown_classic_bug(bug, development=development, full_evidence=full_evidence)


def _development_bug_code(bug: dict) -> str:
    return _md(bug.get("codigo") or "BUG no registrado").replace("\\-", "-")


def _development_case_code(bug: dict) -> str:
    return _markdown_display_label(bug, ("case_code", "codigo_caso"), "TC no registrado").replace("\\-", "-")


def _development_bug_verification(bug: dict) -> str:
    return _md(bug.get("current_build_verification") or "Pendiente de verificar")


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
        f"- Version de Treseko: {_md(meta.get('app_version') or 'N/D')}",
        f"- Build: {_md(meta.get('build') or metrics.get('build_name') or 'N/D')}",
        f"- Ultima ejecucion: {_md(_format_report_datetime(meta.get('last_execution_at')))}",
        f"- Generado: {_md(_format_report_datetime(meta.get('snapshot_at') or snapshot.created_at))}",
        f"- Tipo de informe: {report_type_label}",
        "",
        "## Decisión tomada por QA",
        f"- Decision humana: {_md((payload.get('manual_definition') or meta).get('build_definition') or 'N/D')}",
        f"- Comentario QA: {_md_multiline((payload.get('manual_definition') or meta).get('qa_comment') or 'Sin comentario QA')}",
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
    if _report_section_enabled(payload, report_type, "format_metrics"):
        format_labels = {"CLASICA": "Clásica", "CONVERSACIONAL": "Conversacional", "API": "API"}
        lines.extend(["", "## Métricas por formato de prueba", "| Formato | Estado | Casos | Ejecutados | Pasados | Fallados | Bloqueados | Cobertura |", "|---|---|---:|---:|---:|---:|---:|---:|"])
        for formato in REPORT_VISIBLE_FORMATS:
            data = (metrics.get("metricas_por_formato") or {}).get(formato)
            if not data:
                continue
            lines.append(f"| {_md(format_labels.get(formato, formato))} | {_md(data.get('status') or 'N/D')} | {data.get('total', 0)} | {data.get('executed', 0)} | {data.get('passed', 0)} | {data.get('failed', 0)} | {data.get('blocked', 0)} | {float(data.get('coverage_percent') or 0):.1f}% |")
        chatbot = (metrics.get("metricas_por_formato") or {}).get("CONVERSACIONAL") or {}
        specific = chatbot.get("specific") or {}
        if int(chatbot.get("total") or 0) > 0:
            lines.append(f"\nDetalle Conversacional: {specific.get('turns', 0)} turnos · P95 {specific.get('p95_latency_ms', 0)} ms · {specific.get('http_errors', 0)} errores HTTP · {specific.get('validation_failures', 0)} validaciones fallidas.")
        matrix = metrics.get("metricas_por_formato_y_modo") or {}
        modes = ["MANUAL", "AUTOMATIZADA", "IA", "EXTERNA", "SIN_EJECUTAR"]
        mode_labels = {"MANUAL": "Manual", "AUTOMATIZADA": "Automatizada", "IA": "IA", "EXTERNA": "Externa", "SIN_EJECUTAR": "Sin ejecutar"}
        format_labels = {"CLASICA": "Clásica", "CONVERSACIONAL": "Conversacional", "API": "API"}
        lines.extend(["", "### Matriz de formato y modo de ejecución", "| Formato | " + " | ".join(mode_labels[mode] for mode in modes) + " | Total |", "|---|" + "---:|" * (len(modes) + 1)])
        for formato, label in format_labels.items():
            buckets = matrix.get(formato) or {}
            values = [int((buckets.get(mode) or {}).get("total") or 0) for mode in modes]
            if sum(values):
                lines.append("| " + label + " | " + " | ".join(str(value) for value in values) + " | " + str(sum(values)) + " |")
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
        development_sections = development_report_categories(payload)
        new_bugs = development_sections.get("new_bugs") or []
        historical_bugs = development_sections.get("historical_bugs") or []
        corrected_bugs = development_sections.get("corrected_bugs") or []
        unclassified_bugs = development_sections.get("unclassified_bugs") or []
        failures_without_bug = development_sections.get("failures_without_bug") or []
        visible_bug_categories = {
            "new_bugs": new_bugs,
            "unclassified_bugs": unclassified_bugs,
            "historical_bugs": historical_bugs,
            "corrected_bugs": corrected_bugs,
        }
        if _report_section_enabled(payload, "development", "summary"):
            lines.extend([
                "",
                "## Resumen de desarrollo",
                f"- Resultados: {stats.get('pasados', 0)} pasadas, {stats.get('fallados', 0)} fallidas, {stats.get('bloqueados', 0)} bloqueadas y {stats.get('pendientes', 0)} pendientes.",
                f"- Casos ejecutados: {metrics.get('total_ejecutados', 0)} de {metrics.get('total_casos_asignados', 0)}.",
                f"- Fallos: {stats.get('fallados', 0)}",
                f"- Bloqueos: {stats.get('bloqueados', 0)}",
                f"- Bugs nuevos en la versión actual: {len(new_bugs)}",
                f"- Bugs sin clasificar: {len(unclassified_bugs)}",
                f"- Bugs históricos pendientes: {len(historical_bugs)}",
                f"- Correcciones verificadas: {len(corrected_bugs)}",
        f"- Fallos sin bug abierto: {len(failures_without_bug)}",
        ])
        if _report_section_enabled(payload, "development", "failures"):
            lines.extend(render_development_failures(
                failures_without_bug,
                md=_md,
                display_label=_markdown_display_label,
            ))
        if _report_section_enabled(payload, "development", "bugs"):
            lines.extend(render_development_bug_table(
                new_bugs + unclassified_bugs,
                title="Bugs nuevos y sin clasificar",
                md=_md,
                bug_code=_development_bug_code,
                case_code=_development_case_code,
                display_label=_markdown_display_label,
                verification=_development_bug_verification,
                include_verification=True,
            ))
        if _report_section_enabled(payload, "development", "bug_tracking"):
            lines.extend(render_development_bug_table(
                historical_bugs,
                title="Bugs históricos pendientes",
                md=_md,
                bug_code=_development_bug_code,
                case_code=_development_case_code,
                display_label=_markdown_display_label,
                verification=_development_bug_verification,
                include_verification=True,
            ))
        if _report_section_enabled(payload, "development", "corrected_bugs"):
            lines.extend(render_development_bug_table(
                corrected_bugs,
                title="Correcciones verificadas",
                md=_md,
                bug_code=_development_bug_code,
                case_code=_development_case_code,
                display_label=_markdown_display_label,
                verification=_development_bug_verification,
                include_verification=True,
            ))
        if _report_section_enabled(payload, "development", "bug_details"):
            enabled_categories = tuple(
                category for category, setting in (
                    ("new_bugs", "bugs"),
                    ("unclassified_bugs", "bugs"),
                    ("historical_bugs", "bug_tracking"),
                    ("corrected_bugs", "corrected_bugs"),
                )
                if _report_section_enabled(payload, "development", setting)
            )
            lines.extend(render_development_bug_details(
                visible_bug_categories,
                enabled_categories,
                md=_md,
                bug_code=_development_bug_code,
                render_reproduction=lambda bug: _markdown_bug_reproduction(
                    bug,
                    full_evidence=True,
                    development=True,
                ),
            ))
        if _report_section_enabled(payload, "development", "actions"):
            lines.extend(["", "## Acciones recomendadas"])
            if failures_without_bug:
                lines.append("- Re-ejecutar casos bloqueados tras corregir datos, ambiente o selectores.")
                lines.append("- Asociar fallos sin ticket a bug interno o ticket externo.")
            if historical_bugs:
                lines.append("- Priorizar bugs abiertos que afectan el build actual y validar correccion en el proximo build.")
            if not failures_without_bug and not historical_bugs:
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
            if bugs:
                lines.extend(["", "## Fichas de bugs para replicacion"])
                for bug in bugs:
                    lines.extend(["", f"### {_md(bug.get('codigo'))} - {_md(bug.get('titulo'))}", *_markdown_bug_reproduction(bug)])
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
            open_bug_details = [bug for bug in bugs if str(bug.get("estado") or "").upper() not in {"CERRADO", "RESUELTO", "CLOSED", "DONE", "RESOLVED"}]
            if open_bug_details:
                lines.extend(["", "## Incidentes relevantes para reproducir"])
                for bug in open_bug_details[:10]:
                    lines.extend(["", f"### {_md(bug.get('codigo'))} - {_md(bug.get('titulo'))}", *_markdown_bug_reproduction(bug, compact=True)])
    return "\n".join(lines) + "\n"


__all__ = ["_md","_markdown_link_url","_markdown_evidence","_markdown_api_bug","_markdown_bug_reproduction","_shared_report_markdown"]

"""Data preparation for the development Markdown report.

The classification itself belongs to ``services.development_report``.  This
module only normalizes its pure result for the renderer and prevents a bug
from receiving more than one technical reproduction card.
"""

from typing import Any
from collections.abc import Callable

from ...services.development_report import development_report_sections

_CATEGORY_NAMES = (
    "new_bugs",
    "historical_bugs",
    "corrected_bugs",
    "unclassified_bugs",
    "failures_without_bug",
)


def _as_items(value: Any) -> list[dict]:
    if not isinstance(value, (list, tuple)):
        return []
    return [item for item in value if isinstance(item, dict)]


def development_report_categories(payload: dict) -> dict[str, list[dict]]:
    """Return the data-owned development categories without mutating payload."""
    sections = development_report_sections(payload)
    if not isinstance(sections, dict):
        raise TypeError("development_report_sections debe retornar un dict")
    return {
        name: _as_items(sections.get(name))
        for name in _CATEGORY_NAMES
    }


def development_report_detail_items(
    categories: dict[str, list[dict]],
    enabled_categories: tuple[str, ...],
) -> list[tuple[str, dict]]:
    """Flatten enabled categories while keeping one technical card per bug."""
    result = []
    seen = set()
    for category in enabled_categories:
        for bug in categories.get(category) or []:
            key = str(bug.get("id") or bug.get("codigo") or "")
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            result.append((category, bug))
    return result


def render_development_bug_table(
    bugs: list[dict],
    *,
    title: str,
    md: Callable[[Any], str],
    bug_code: Callable[[dict], str],
    case_code: Callable[[dict], str],
    display_label: Callable[[dict, tuple[str, ...], str], str],
    verification: Callable[[dict], str],
    include_verification: bool = False,
) -> list[str]:
    """Render a category table without deciding which category a bug belongs to."""
    lines = ["", f"## {title}"]
    if include_verification:
        lines.extend([
            "| Bug | Caso | Severidad | Estado | Build de origen | Verificación en build actual | Responsable |",
            "|---|---|---|---|---|---|---|",
        ])
    else:
        lines.extend([
            "| Bug | Caso | Severidad | Estado | Build de origen | Responsable |",
            "|---|---|---|---|---|---|",
        ])
    if not bugs:
        empty_columns = 7 if include_verification else 6
        lines.append("| No hay registros | " + " | " * (empty_columns - 1) + "|")
        return lines
    for bug in bugs:
        row = [
            f"{bug_code(bug)} - {md(bug.get('titulo') or 'Sin título')}",
            case_code(bug),
            md(bug.get("severidad") or "No registrada"),
            md(bug.get("estado") or "No registrado"),
            display_label(bug, ("origin_build_name",), "No registrado"),
        ]
        if include_verification:
            row.append(verification(bug))
        row.append(display_label(bug, ("responsable", "responsible_display"), "No registrado"))
        lines.append("| " + " | ".join(row) + " |")
    return lines


def render_development_failures(
    failures: list[dict],
    *,
    md: Callable[[Any], str],
    display_label: Callable[[dict, tuple[str, ...], str], str],
) -> list[str]:
    lines = [
        "",
        "<details>",
        "<summary>Fallos sin bug abierto</summary>",
        "",
        f"Cantidad: {len(failures)}",
    ]
    if not failures:
        return lines + ["No hay fallos sin bug abierto.", "", "</details>"]
    lines.extend([
        "| Caso | Estado | Suite | Paso | Esperado | Obtenido / diagnóstico |",
        "|---|---|---|---|---|---|",
    ])
    for item in failures:
        case = item.get("case") if isinstance(item.get("case"), dict) else {}
        failed_step = item.get("failed_step")
        step = failed_step if isinstance(failed_step, dict) else {}
        step_number = step.get("numero_paso") or step.get("step_number") or (failed_step if failed_step not in (None, "") and not isinstance(failed_step, dict) else None)
        action = item.get("action") or step.get("accion_congelada") or step.get("action")
        expected = item.get("expected") or step.get("resultado_esperado_congelado") or step.get("expected")
        observed = item.get("obtained") or item.get("diagnosis") or item.get("observed") or step.get("error_log") or step.get("comentarios") or step.get("observed")
        lines.append(
            "| " + " | ".join([
                display_label(item or case, ("case_code", "codigo", "codigo_caso"), "TC no registrado").replace("\\-", "-"),
                md(item.get("estado") or case.get("estado") or "No registrado"),
                md(item.get("suite") or item.get("suite_breadcrumb") or case.get("suite_breadcrumb") or "No registrada"),
                md(step_number or item.get("step") or "No registrado"),
                md(expected or item.get("resultado_esperado") or "No registrado"),
                md(observed or "No registrado") + (f" ({md(action)})" if action else ""),
            ]) + " |"
        )
    lines.extend(["", "</details>"])
    return lines


def render_development_bug_details(
    categories: dict[str, list[dict]],
    enabled_categories: tuple[str, ...],
    *,
    md: Callable[[Any], str],
    bug_code: Callable[[dict], str],
    render_reproduction: Callable[[dict], list[str]],
) -> list[str]:
    labels = {
        "new_bugs": "Bugs nuevos",
        "unclassified_bugs": "Bugs sin clasificar",
        "historical_bugs": "Bugs históricos pendientes",
        "corrected_bugs": "Correcciones verificadas",
    }
    lines = ["", "## Detalles para reproducir"]
    items = development_report_detail_items(categories, enabled_categories)
    if not items:
        return lines + ["No hay bugs habilitados para detallar."]
    for category, bug in items:
        lines.extend([
            "",
            f"### {labels[category]}: {bug_code(bug)} - {md(bug.get('titulo') or 'Sin título')}",
            *render_reproduction(bug),
        ])
    return lines


__all__ = [
    "development_report_categories",
    "development_report_detail_items",
    "render_development_bug_table",
    "render_development_failures",
    "render_development_bug_details",
]

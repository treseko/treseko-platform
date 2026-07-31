"""Vendor-aware parsers for test-case portability imports.

Adapters return Treseko's neutral field names plus diagnostics.  They do not
write data and they never execute content from the imported file.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass, field
from typing import Any


class AdapterError(ValueError):
    pass


@dataclass
class AdapterResult:
    cases: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)
    source_fields: list[str] = field(default_factory=list)
    ignored_fields: list[str] = field(default_factory=list)

    def diagnostics(self) -> dict[str, Any]:
        return {
            "warnings": list(dict.fromkeys(self.warnings)),
            "source_fields": self.source_fields,
            "ignored_fields": sorted(set(self.ignored_fields)),
        }


def _key(value: Any) -> str:
    text = str(value or "").replace("\ufeff", "").strip().lower()
    text = re.sub(r"[^a-z0-9áéíóúüñ]+", "_", text, flags=re.IGNORECASE)
    return text.strip("_")


def _decode_text(data: bytes) -> tuple[str, list[str]]:
    try:
        return data.decode("utf-8-sig"), []
    except UnicodeDecodeError:
        try:
            return data.decode("cp1252"), ["El archivo no estaba en UTF-8; se interpretó como Windows-1252."]
        except UnicodeDecodeError as exc:
            raise AdapterError("El archivo no usa una codificación de texto compatible") from exc


def read_csv(data: bytes) -> tuple[list[dict[str, str]], list[str], list[str]]:
    text, warnings = _decode_text(data)
    sample = text[:64_000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        header_line = next((line for line in text.splitlines() if line.strip()), "")
        delimiter = max((",", ";", "\t", "|"), key=header_line.count)
        warnings.append(f"El detector automático no fue concluyente; se utilizó {repr(delimiter)} según el encabezado.")

    try:
        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        raw_headers = next(reader)
    except StopIteration as exc:
        raise AdapterError("El CSV no contiene encabezados") from exc
    except csv.Error as exc:
        raise AdapterError(f"El encabezado CSV no es válido: {exc}") from exc
    if not any(str(value).strip() for value in raw_headers):
        raise AdapterError("El CSV no contiene encabezados válidos")

    headers: list[str] = []
    counts: dict[str, int] = {}
    for position, raw in enumerate(raw_headers, 1):
        base = _key(raw) or f"column_{position}"
        counts[base] = counts.get(base, 0) + 1
        headers.append(base if counts[base] == 1 else f"{base}_{counts[base]}")

    rows: list[dict[str, str]] = []
    try:
        for raw_row in reader:
            if not any(str(value).strip() for value in raw_row):
                continue
            padded = raw_row + [""] * max(0, len(headers) - len(raw_row))
            rows.append({headers[index]: str(padded[index]).strip() for index in range(len(headers))})
    except csv.Error as exc:
        raise AdapterError(f"El contenido CSV no es válido: {exc}") from exc
    if delimiter != ",":
        warnings.append(f"Delimitador detectado: {repr(delimiter)}.")
    return rows, headers, warnings


def _get(row: dict[str, Any], *aliases: str) -> str:
    for alias in aliases:
        value = row.get(_key(alias))
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _stable_id(tool: str, *parts: Any) -> str:
    material = "\x1f".join(str(part or "").strip() for part in parts)
    return f"{tool}-{hashlib.sha256(material.encode('utf-8')).hexdigest()[:20]}"


def _numbered_lines(value: Any) -> list[str]:
    lines = []
    for raw in str(value or "").replace("\r", "").split("\n"):
        if not raw.strip():
            continue
        cleaned = re.sub(r"^\s*(?:\d+(?:\.\d+)*[.)]?|[-*])\s*", "", raw).strip()
        if cleaned:
            lines.append(cleaned)
    return lines


def _paired_steps(actions: Any, expected: Any = "", data: Any = "") -> list[dict[str, Any]]:
    action_lines = _numbered_lines(actions)
    expected_lines = _numbered_lines(expected)
    data_lines = _numbered_lines(data)
    return [
        {
            "accion": action,
            "resultado_esperado": expected_lines[index] if index < len(expected_lines) and expected_lines[index] else "Resultado esperado",
            "datos": data_lines[index] if index < len(data_lines) and data_lines[index] else None,
        }
        for index, action in enumerate(action_lines)
    ]


def parse_structured_csv(data: bytes) -> AdapterResult:
    rows, headers, warnings = read_csv(data)
    detailed_step_fields = {
        "step_number", "step_action", "step_data", "step_expected",
    }
    if not detailed_step_fields.intersection(headers):
        return AdapterResult(rows, warnings=warnings, source_fields=headers)

    cases: list[dict[str, Any]] = []
    grouped: dict[str, dict[str, Any]] = {}
    current: dict[str, Any] | None = None
    for position, row in enumerate(rows, 1):
        external_id = _get(row, "id", "external id", "external_id")
        title = _get(row, "title", "titulo")
        suite = _get(row, "suite", "suite path", "suite_path")
        identity = external_id or (f"title:{title}|suite:{suite}" if title else "")
        if identity and identity in grouped:
            current = grouped[identity]
            if title and title != current["title"]:
                warnings.append(
                    f"La fila {position} repite {external_id} con otro título; se conservó el primero."
                )
        elif title:
            current = {
                "id": external_id or _stable_id("csv", suite, title, position),
                "external_version": _get(row, "external version", "external_version", "version"),
                "title": title,
                "suite_path": suite or "Importados/CSV",
                "description": _get(row, "description", "descripcion"),
                "preconditions": _get(row, "preconditions", "precondiciones"),
                "postconditions": _get(row, "postconditions", "postcondiciones"),
                "priority": _get(row, "priority", "prioridad"),
                "severity": _get(row, "severity", "criticidad"),
                "type": _get(row, "type", "tipo prueba", "tipo_prueba"),
                "status": _get(row, "status", "estado caso", "estado_caso"),
                "tags": _get(row, "tags", "etiquetas"),
                "steps": [],
                "_step_entries": [],
            }
            cases.append(current)
            grouped[identity or current["id"]] = current
        elif current is None:
            warnings.append(
                f"Se omitió la fila {position}: no identifica un caso ni continúa uno anterior."
            )
            continue

        action = _get(row, "step action", "step_action", "action")
        expected = _get(
            row, "step expected", "step_expected", "expected result", "expected"
        )
        step_data = _get(row, "step data", "step_data", "data")
        if action:
            step_number_raw = _get(row, "step number", "step_number", "number")
            step_number: int | None = None
            if step_number_raw:
                try:
                    step_number = int(step_number_raw)
                except ValueError as exc:
                    raise AdapterError(
                        f"La fila {position} tiene un step_number inválido: {step_number_raw}."
                    ) from exc
                if step_number < 1:
                    raise AdapterError(
                        f"La fila {position} tiene un step_number inválido: debe ser mayor que cero."
                    )
            current["_step_entries"].append({
                "number": step_number,
                "position": position,
                "step": {
                "accion": action,
                "datos": step_data or None,
                "resultado_esperado": expected or "Resultado esperado",
                },
            })
        elif expected or step_data:
            warnings.append(
                f"Se omitió el paso de la fila {position}: contiene datos o resultado, pero no acción."
            )
    for case in cases:
        entries = case.pop("_step_entries")
        numbered = [entry for entry in entries if entry["number"] is not None]
        if numbered and len(numbered) != len(entries):
            warnings.append(
                f"El caso {case['title']} mezcla pasos con y sin step_number; se conservó el orden del archivo."
            )
            case["steps"] = [entry["step"] for entry in entries]
            continue
        numbers = [entry["number"] for entry in numbered]
        if len(numbers) != len(set(numbers)):
            duplicates = sorted({number for number in numbers if numbers.count(number) > 1})
            raise AdapterError(
                f"El caso {case['title']} contiene step_number repetidos: {', '.join(map(str, duplicates))}."
            )
        ordered = sorted(entries, key=lambda entry: entry["number"]) if numbered else entries
        case["steps"] = [entry["step"] for entry in ordered]
    return AdapterResult(cases, warnings=warnings, source_fields=headers)


def parse_testrail_csv(data: bytes) -> AdapterResult:
    rows, headers, warnings = read_csv(data)
    cases: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    section_stack: list[str] = []
    current: dict[str, Any] | None = None
    for position, row in enumerate(rows, 1):
        title = _get(row, "title")
        external_id = _get(row, "id")
        section = _get(row, "section", "sections", "section hierarchy")
        depth_text = _get(row, "section depth")
        if section:
            try:
                depth = max(0, int(depth_text or 0))
            except ValueError:
                depth = 0
            section_stack = section_stack[:depth]
            if len(section_stack) == depth:
                section_stack.append(section)
            else:
                section_stack[depth] = section
                section_stack = section_stack[: depth + 1]
        suite_path = "/".join(section_stack) or _get(row, "suite") or "Importados/TestRail"
        identity = external_id or (f"title:{title}|suite:{suite_path}" if title else "")
        if identity and identity in by_key:
            current = by_key[identity]
        elif title:
            current = {
                "id": external_id or _stable_id("testrail", suite_path, title, position),
                "title": title,
                "description": _get(row, "description", "section description"),
                "preconditions": _get(row, "preconditions", "preconds"),
                "priority": _get(row, "priority"),
                "type": _get(row, "type"),
                "suite_path": suite_path,
                "tags": _get(row, "references"),
                "steps": [],
            }
            cases.append(current)
            by_key[identity or current["id"]] = current
        elif current is None:
            warnings.append(f"Se omitió la fila {position}: no tiene ID, título ni caso anterior.")
            continue
        actions = _get(row, "steps step", "steps", "step", "action")
        expected = _get(row, "steps expected result", "expected result", "expected")
        step_data = _get(row, "steps additional info", "additional info", "data")
        if actions:
            current["steps"].extend(_paired_steps(actions, expected, step_data))
    return AdapterResult(cases, warnings=warnings, source_fields=headers)


def parse_xray_csv(data: bytes) -> AdapterResult:
    rows, headers, warnings = read_csv(data)
    cases: list[dict[str, Any]] = []
    grouped: dict[str, dict[str, Any]] = {}
    current: dict[str, Any] | None = None
    attachment_columns = [field for field in headers if field.startswith("attach") or "attachment" in field]
    preconditions: dict[str, str] = {}
    test_sets: dict[str, str] = {}
    for row in rows:
        issue_type = _get(row, "issue type").lower()
        issue_id = _get(row, "issue id", "issue key", "id")
        summary = _get(row, "test summary", "summary", "title")
        if issue_type == "precondition" and issue_id and summary:
            preconditions[issue_id] = summary
        elif issue_type in {"testset", "test set"} and issue_id and summary:
            test_sets[issue_id] = summary
    for position, row in enumerate(rows, 1):
        issue_type = _get(row, "issue type").lower()
        if issue_type in {"precondition", "testset", "test set"}:
            current = None
            continue
        external_id = _get(row, "tcid", "issue id", "issue key", "id")
        title = _get(row, "test summary", "summary", "title")
        identity = external_id or (f"title:{title}" if title else "")
        if identity and identity in grouped:
            current = grouped[identity]
        elif title:
            precondition_value = _get(row, "preconditions", "precondition specification")
            if not precondition_value:
                references = [value.strip() for value in re.split(r"[;,]", _get(row, "precondition")) if value.strip()]
                precondition_value = "\n".join(preconditions[value] for value in references if value in preconditions)
            test_set_references = [value.strip() for value in re.split(r"[;,]", _get(row, "test set")) if value.strip()]
            repository_path = _get(row, "test repository path", "test repo path", "folder")
            if not repository_path:
                repository_path = next((test_sets[value] for value in test_set_references if value in test_sets), "")
            gherkin_definition = _get(row, "gherkin definition")
            current = {
                "id": external_id or _stable_id("xray", title, position),
                "title": title,
                "description": _get(row, "description", "unstructured definition", "gherkin definition"),
                "preconditions": precondition_value,
                "priority": _get(row, "test priority", "priority"),
                "type": _get(row, "test type", "type"),
                "suite_path": repository_path or "Importados/Xray",
                "tags": _get(row, "labels"),
                "steps": _paired_steps(gherkin_definition) if gherkin_definition else [],
            }
            cases.append(current)
            grouped[identity or current["id"]] = current
        elif current is None:
            warnings.append(f"Se omitió la fila {position}: no se pudo asociar a un caso Xray.")
            continue
        action = _get(row, "action", "step action")
        if action:
            current["steps"].append({
                "accion": action,
                "datos": _get(row, "data", "step data") or None,
                "resultado_esperado": _get(row, "result", "expected result", "step result") or "Resultado esperado",
            })
    if attachment_columns and any(any(row.get(field) for field in attachment_columns) for row in rows):
        warnings.append("El archivo Xray contiene referencias a adjuntos; esta versión no descarga archivos remotos.")
    return AdapterResult(cases, warnings=warnings, source_fields=headers, ignored_fields=attachment_columns)


def parse_azure_csv(data: bytes) -> AdapterResult:
    rows, headers, warnings = read_csv(data)
    cases: list[dict[str, Any]] = []
    grouped: dict[str, dict[str, Any]] = {}
    for position, row in enumerate(rows, 1):
        work_item_type = _get(row, "work item type")
        if work_item_type and work_item_type.lower() != "test case":
            warnings.append(f"Se omitió la fila {position}: Work Item Type no es Test Case.")
            continue
        title = _get(row, "title")
        external_id = _get(row, "id")
        area = _get(row, "area path") or "Importados/Azure Test Plans"
        identity = external_id or (f"{area}|{title}" if title else "")
        case = grouped.get(identity) if identity else None
        if case is None and title:
            case = {
                "id": external_id or _stable_id("azure", area, title),
                "title": title,
                "description": _get(row, "description"),
                "priority": _get(row, "priority"),
                "status": _get(row, "state"),
                "suite_path": area.replace("\\", "/"),
                "steps": [],
            }
            cases.append(case)
            grouped[identity or case["id"]] = case
        if case is None:
            warnings.append(f"Se omitió la fila {position}: no tiene título ni ID asociable.")
            continue
        action = _get(row, "step action")
        if action:
            case["steps"].append({
                "accion": action,
                "datos": None,
                "resultado_esperado": _get(row, "step expected") or "Resultado esperado",
            })
    return AdapterResult(cases, warnings=warnings, source_fields=headers)


def _qase_suite_path(suite_id: str, suites: dict[str, dict[str, str]]) -> str:
    names: list[str] = []
    seen: set[str] = set()
    current = suites.get(suite_id)
    while current and current["id"] not in seen:
        seen.add(current["id"])
        if current.get("name"):
            names.insert(0, current["name"])
        current = suites.get(current.get("parent", ""))
    return "/".join(names) or "Importados/Qase"


def parse_qase_csv(data: bytes) -> AdapterResult:
    rows, headers, warnings = read_csv(data)
    suites: dict[str, dict[str, str]] = {}
    for row in rows:
        if _get(row, "suite without cases") in {"1", "true", "yes"}:
            suite_id = _get(row, "suite id")
            if suite_id:
                suites[suite_id] = {"id": suite_id, "name": _get(row, "suite"), "parent": _get(row, "suite parent id")}
    cases: list[dict[str, Any]] = []
    for position, row in enumerate(rows, 1):
        if _get(row, "suite without cases") in {"1", "true", "yes"}:
            continue
        title = _get(row, "title")
        if not title:
            warnings.append(f"Se omitió la fila Qase {position}: no representa una suite ni un caso con título.")
            continue
        suite_id = _get(row, "suite id")
        suite_path = _qase_suite_path(suite_id, suites) if suite_id else (_get(row, "suite") or "Importados/Qase")
        steps = _paired_steps(_get(row, "steps actions"), _get(row, "steps result"), _get(row, "steps data"))
        cases.append({
            "id": _get(row, "id") or _stable_id("qase", suite_path, title),
            "title": title,
            "description": _get(row, "description"),
            "preconditions": _get(row, "preconditions"),
            "postconditions": _get(row, "postconditions"),
            "priority": _get(row, "priority"),
            "severity": _get(row, "severity"),
            "type": "AUTOMATIZADA" if _get(row, "automation") in {"automated", "is-automated"} else "MANUAL",
            "status": _get(row, "status"),
            "tags": _get(row, "tags"),
            "suite_path": suite_path,
            "steps": steps,
        })
    ignored = [field for field in headers if field in {"parameters", "milestone", "milestone_id", "is_flaky", "is_muted", "behavior", "layer"}]
    if ignored:
        warnings.append("Qase contiene propiedades sin equivalente nativo; se muestran como campos no importados.")
    return AdapterResult(cases, warnings=warnings, source_fields=headers, ignored_fields=ignored)


def parse_practitest_csv(data: bytes) -> AdapterResult:
    rows, headers, warnings = read_csv(data)
    cases: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for position, row in enumerate(rows, 1):
        title = _get(row, "name", "test name", "title")
        if title:
            current = {
                "id": _get(row, "id", "test id") or _stable_id("practitest", title, position),
                "title": title,
                "description": _get(row, "description"),
                "preconditions": _get(row, "preconditions"),
                "priority": _get(row, "priority"),
                "status": _get(row, "status"),
                "suite_path": _get(row, "folder", "suite", "test folder") or "Importados/PractiTest",
                "tags": _get(row, "tags"),
                "steps": [],
            }
            cases.append(current)
        if current is None:
            warnings.append(f"Se omitió la fila {position}: no inicia ni continúa un caso PractiTest.")
            continue
        action = _get(row, "step description", "step name", "step", "action")
        if action:
            current["steps"].append({
                "accion": action,
                "datos": _get(row, "step data", "data") or None,
                "resultado_esperado": _get(row, "expected result", "expected") or "Resultado esperado",
            })
    return AdapterResult(cases, warnings=warnings, source_fields=headers)



from .case_import_adapters_extended import parse_gherkin, parse_qtest_excel, parse_zephyr_json

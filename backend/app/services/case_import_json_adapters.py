"""Strict JSON adapters whose contracts are independent from CSV/XLS parsers."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .case_import_adapters import AdapterError, AdapterResult


def _stable_id(tool: str, *parts: Any) -> str:
    material = "\x1f".join(str(part or "").strip() for part in parts)
    return f"{tool}-{hashlib.sha256(material.encode('utf-8')).hexdigest()[:20]}"


def _name(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("title") or value.get("value") or value.get("slug") or "").strip()
    return str(value or "").strip()


def _decode_json(data: bytes, tool: str) -> Any:
    try:
        return json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AdapterError(f"El JSON de {tool} no es válido") from exc


def _qase_envelopes(parsed: Any) -> tuple[list[Any], list[Any], str, str]:
    if isinstance(parsed, list):
        return parsed, [], "", "raw-list"
    if not isinstance(parsed, dict):
        raise AdapterError("El JSON de Qase debe contener un objeto o una lista")
    if parsed.get("status") is False:
        raise AdapterError("El JSON de Qase representa una respuesta API fallida")

    result = parsed.get("result") if isinstance(parsed.get("result"), dict) else {}
    data = parsed.get("data") if isinstance(parsed.get("data"), dict) else {}
    cases = (
        parsed.get("cases")
        or parsed.get("testCases")
        or parsed.get("test_cases")
        or parsed.get("items")
        or result.get("entities")
        or result.get("cases")
        or data.get("entities")
        or data.get("cases")
    )
    if cases is None and (parsed.get("title") or result.get("title")):
        cases = [parsed if parsed.get("title") else result]
    if not isinstance(cases, list):
        raise AdapterError("El JSON no contiene casos Qase en cases, items o result.entities")

    suites = parsed.get("suites") or result.get("suites") or data.get("suites") or []
    if not isinstance(suites, list):
        raise AdapterError("La colección suites del JSON de Qase no es una lista")
    project = parsed.get("project") or result.get("project") or data.get("project") or {}
    project_code = _name(project.get("code") if isinstance(project, dict) else project)
    project_code = project_code or str(parsed.get("project_code") or result.get("project_code") or "").strip()
    if isinstance(result.get("entities"), list) or isinstance(data.get("entities"), list):
        variant = "api-v1-entities"
    elif any(key in parsed for key in ("cases", "testCases", "test_cases")):
        variant = "repository-export"
    elif len(cases) == 1 and cases[0] is result:
        variant = "api-v1-single"
    else:
        variant = "items-envelope"
    return cases, suites, project_code, variant


def _flatten_suites(source: list[Any]) -> dict[str, dict[str, str]]:
    suites: dict[str, dict[str, str]] = {}

    def visit(item: Any, inherited_parent: str = "") -> None:
        if not isinstance(item, dict):
            return
        suite_id = str(item.get("id") or item.get("suite_id") or _stable_id("qase-suite", inherited_parent, _name(item)))
        parent_id = str(item.get("parent_id") or item.get("parentId") or inherited_parent or "")
        suites[suite_id] = {"id": suite_id, "parent_id": parent_id, "name": _name(item)}
        children = item.get("children") or item.get("suites") or item.get("items") or []
        if isinstance(children, list):
            for child in children:
                visit(child, suite_id)

    for raw in source:
        visit(raw)
    return suites


def _suite_path(suite_id: Any, suites: dict[str, dict[str, str]]) -> str:
    current = suites.get(str(suite_id or ""))
    names: list[str] = []
    seen: set[str] = set()
    while current and current["id"] not in seen:
        seen.add(current["id"])
        if current["name"]:
            names.insert(0, current["name"])
        current = suites.get(current["parent_id"])
    return "/".join(names)


def _qase_tags(value: Any) -> list[str]:
    if isinstance(value, str):
        return [part.strip() for part in value.replace(";", ",").split(",") if part.strip()]
    if isinstance(value, list):
        return [name for item in value if (name := _name(item))]
    return []


def _qase_steps(value: Any, steps_type: str, warnings: list[str]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []

    def append_step(item: Any) -> None:
        if not isinstance(item, dict):
            return
        nested = item.get("steps") or item.get("children")
        if steps_type == "gherkin":
            gherkin = item.get("value") or item.get("action") or item.get("description")
            for line in str(gherkin or "").replace("\r", "").split("\n"):
                if line.strip():
                    result.append({"accion": line.strip(), "resultado_esperado": "Resultado esperado"})
        else:
            action = item.get("action") or item.get("description") or item.get("step") or item.get("value")
            if action:
                result.append({
                    "accion": str(action),
                    "datos": item.get("data") or item.get("test_data"),
                    "resultado_esperado": item.get("expected_result") or item.get("expected") or item.get("result") or "Resultado esperado",
                })
        if item.get("attachments"):
            warnings.append("El JSON de Qase contiene referencias a adjuntos de pasos; no incluye binarios portables.")
        if isinstance(nested, list):
            for child in nested:
                append_step(child)
        elif item.get("shared_step_id") or item.get("shared_step"):
            warnings.append("El JSON referencia pasos compartidos sin expandir; revisá el caso antes de confirmar.")

    for raw in value:
        append_step(raw)
    return result


def _qase_automation(item: dict[str, Any]) -> str:
    if item.get("isManual") is False:
        return "AUTOMATIZADA"
    value = _name(item.get("automation")).lower()
    if value in {"2", "automated", "automatizada"}:
        return "AUTOMATIZADA"
    return "MANUAL"


def parse_qase_json(data: bytes) -> AdapterResult:
    """Parse Qase repository exports and documented v1 API response envelopes."""
    parsed = _decode_json(data, "Qase")
    raw_cases, raw_suites, project_code, variant = _qase_envelopes(parsed)
    suites = _flatten_suites(raw_suites)
    warnings: list[str] = []
    ignored: set[str] = set()
    cases: list[dict[str, Any]] = []
    numeric_ids_without_project = False
    if variant.startswith("api-v1"):
        warnings.append("Se detectó un envoltorio de la API Qase v1; verificá que la exportación incluya todas las páginas y suites.")
    elif variant in {"raw-list", "items-envelope"}:
        warnings.append("El JSON Qase no incluye el envoltorio completo del repositorio; revisá el árbol de suites en la vista previa.")

    for position, item in enumerate(raw_cases, 1):
        if not isinstance(item, dict) or not str(item.get("title") or item.get("name") or "").strip():
            warnings.append(f"Se omitió el elemento Qase {position}: no es un caso con título.")
            continue
        suite = item.get("suite")
        if isinstance(suite, dict):
            inline_id = str(suite.get("id") or item.get("suite_id") or _stable_id("qase-suite", _name(suite)))
            if inline_id not in suites:
                suites[inline_id] = {
                    "id": inline_id,
                    "parent_id": str(suite.get("parent_id") or suite.get("parentId") or ""),
                    "name": _name(suite),
                }
        suite_id = item.get("suite_id") or item.get("suiteId") or (suite.get("id") if isinstance(suite, dict) else "")
        path = str(item.get("suite_path") or "").strip() or _suite_path(suite_id, suites)
        if not path and isinstance(suite, str):
            path = suite.strip()
        if not path and suite_id:
            path = f"Suite {suite_id}"
            warnings.append(f"No se encontró el nombre de la suite Qase {suite_id}; se conservó su ID.")

        raw_id = item.get("id") or item.get("case_id") or item.get("caseId")
        if raw_id is not None and project_code:
            external_id = f"{project_code}-{raw_id}"
        elif raw_id is not None:
            external_id = str(raw_id)
            numeric_ids_without_project = numeric_ids_without_project or str(raw_id).isdigit()
        else:
            external_id = _stable_id("qase", path, item.get("title"), position)

        steps_type = str(item.get("steps_type") or item.get("stepsType") or "classic").lower()
        steps = _qase_steps(item.get("steps") or [], steps_type, warnings)
        priority = _name(item.get("priority"))
        severity = _name(item.get("severity"))
        if isinstance(item.get("priority"), (int, float)):
            priority = ""
            ignored.add("priority_numeric_id")
        if isinstance(item.get("severity"), (int, float)):
            severity = ""
            ignored.add("severity_numeric_id")
        for field in ("custom_field", "custom_fields", "parameters", "params", "milestone_id"):
            if item.get(field):
                ignored.add(field)
        if item.get("attachments"):
            warnings.append("El JSON de Qase contiene referencias a adjuntos; exportá los binarios por separado.")

        cases.append({
            "id": external_id,
            "version": item.get("version"),
            "title": item.get("title") or item.get("name"),
            "description": item.get("description"),
            "preconditions": item.get("preconditions"),
            "postconditions": item.get("postconditions"),
            "priority": priority,
            "severity": severity,
            "type": _qase_automation(item),
            "status": "ARCHIVADO" if _name(item.get("status")).lower() in {"deprecated", "archived"} else "ACTIVO",
            "tags": _qase_tags(item.get("tags")),
            "suite_path": path or "Importados/Qase",
            "steps": steps,
        })

    if numeric_ids_without_project:
        warnings.append("El JSON no incluye código de proyecto Qase; los IDs numéricos se conservaron sin prefijo.")
    if not cases:
        raise AdapterError("El JSON de Qase no contiene casos reconocibles")
    fields = sorted({str(key) for item in raw_cases if isinstance(item, dict) for key in item})
    return AdapterResult(cases, warnings=list(dict.fromkeys(warnings)), source_fields=fields, ignored_fields=sorted(ignored))


def _xray_spec_steps(test_info: dict[str, Any]) -> list[dict[str, Any]]:
    test_type = str(test_info.get("testType") or test_info.get("type") or "").strip().lower()
    if test_type == "manual":
        raw_steps = test_info.get("steps") or []
        if not isinstance(raw_steps, list):
            raise AdapterError("Xray testInfo.steps debe ser una lista para pruebas Manual")
        steps = []
        for position, step in enumerate(raw_steps, 1):
            if not isinstance(step, dict) or not str(step.get("action") or "").strip():
                raise AdapterError(f"El paso Xray {position} no contiene action")
            steps.append({
                "accion": str(step["action"]),
                "datos": step.get("data"),
                "resultado_esperado": step.get("result") or "Resultado esperado",
            })
        return steps
    if test_type in {"cucumber", "bdd"}:
        scenario = str(test_info.get("scenario") or "").replace("\r", "")
        return [
            {"accion": line.strip(), "resultado_esperado": "Resultado esperado"}
            for line in scenario.split("\n")
            if line.strip()
        ]
    definition = str(test_info.get("definition") or "").strip()
    return [{"accion": definition, "resultado_esperado": "Ejecución automatizada completada"}] if definition else []


def parse_xray_json_testinfo(data: bytes) -> AdapterResult:
    """Import specifications embedded in Xray execution JSON `testInfo` objects.

    Xray JSON is an execution-result contract, not a repository export.  Only
    test entries carrying the official `testInfo` specification are importable.
    Execution status, iterations and actual results are deliberately ignored.
    """
    parsed = _decode_json(data, "Xray")
    if not isinstance(parsed, dict) or not isinstance(parsed.get("tests"), list):
        raise AdapterError("El JSON Xray debe contener la lista tests del contrato de resultados")
    if not parsed["tests"]:
        raise AdapterError("El JSON Xray no contiene resultados de pruebas")

    info = parsed.get("info") if isinstance(parsed.get("info"), dict) else {}
    cases: list[dict[str, Any]] = []
    warnings: list[str] = [
        "Xray JSON representa resultados de ejecución; Treseko importa sólo las especificaciones testInfo.",
    ]
    ignored: set[str] = set()
    skipped_without_spec = 0
    for position, test in enumerate(parsed["tests"], 1):
        if not isinstance(test, dict):
            raise AdapterError(f"El elemento Xray {position} no es un objeto")
        test_info = test.get("testInfo")
        if not isinstance(test_info, dict):
            skipped_without_spec += 1
            continue
        missing = [field for field in ("summary", "projectKey") if not str(test_info.get(field) or "").strip()]
        if not str(test_info.get("testType") or test_info.get("type") or "").strip():
            missing.append("testType/type")
        if missing:
            raise AdapterError(f"Xray testInfo {position} no contiene {', '.join(missing)}")
        if not str(test.get("status") or "").strip():
            raise AdapterError(f"El resultado Xray {position} no contiene status")

        project_key = str(test_info["projectKey"]).strip()
        test_key = str(test.get("testKey") or "").strip()
        external_id = test_key or _stable_id("xray-json", project_key, test_info["summary"])
        labels = [str(value).strip() for value in (test_info.get("labels") or []) if str(value).strip()]
        labels.extend(
            f"requirement:{value}"
            for value in (test_info.get("requirementKeys") or [])
            if str(value).strip()
        )
        test_type = str(test_info.get("testType") or test_info.get("type")).strip()
        if not test_info.get("testType") and test_info.get("type"):
            warnings.append("Se detectó el campo histórico Xray testInfo.type; se interpretó como testType.")
        cases.append({
            "id": external_id,
            "version": info.get("version"),
            "title": test_info["summary"],
            "description": test_info.get("description"),
            "type": "MANUAL" if test_type.lower() == "manual" else "AUTOMATIZADA",
            "tags": labels,
            "suite_path": f"Importados/Xray/{project_key}",
            "steps": _xray_spec_steps(test_info),
        })
        for field in ("start", "finish", "comment", "executedBy", "assignee", "status", "steps", "examples", "iterations", "defects", "customFields"):
            if test.get(field) not in (None, [], {}, ""):
                ignored.add(field)
        if test.get("evidence") or test.get("evidences"):
            ignored.add("evidence")
            warnings.append("El resultado Xray contiene evidencias; este perfil no transporta los binarios a casos Treseko.")
    if skipped_without_spec:
        warnings.append(f"Se omitieron {skipped_without_spec} resultados Xray sin testInfo porque no contienen la definición del caso.")
    if not cases:
        raise AdapterError("El JSON Xray no contiene ninguna especificación testInfo importable")
    return AdapterResult(
        cases,
        warnings=list(dict.fromkeys(warnings)),
        source_fields=sorted(str(key) for key in parsed),
        ignored_fields=sorted(ignored),
    )

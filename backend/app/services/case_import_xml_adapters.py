"""Strict XML adapters for vendor contracts verified with public fixtures."""
from __future__ import annotations

import hashlib
import re
from typing import Any

from defusedxml import ElementTree as ET
from defusedxml.common import DefusedXmlException

from app.services.case_import_adapters import AdapterError, AdapterResult


def _text(node: Any, path: str, default: str = "") -> str:
    return str((node.findtext(path) if node is not None else None) or default).strip()


def _stable_id(*parts: Any) -> str:
    material = "\x1f".join(str(part or "").strip() for part in parts)
    return f"zephyr-scale-{hashlib.sha256(material.encode('utf-8')).hexdigest()[:20]}"


def _labels(case: Any) -> list[str]:
    values: list[str] = []
    labels = case.find("labels")
    if labels is not None:
        for node in labels.iter():
            if node is labels:
                continue
            value = str(node.text or "").strip()
            if value:
                values.append(value)
    for issue in case.findall("./issues/issue"):
        key = _text(issue, "key")
        if key:
            values.append(f"requirement:{key}")
    return list(dict.fromkeys(values))


def _bdd_steps(details: str) -> list[dict[str, str]]:
    steps: list[dict[str, str]] = []
    for raw_line in details.replace("\r", "").split("\n"):
        line = raw_line.strip()
        if not line or line.lower().startswith("examples:") or line.startswith("|"):
            continue
        if re.match(r"^(given|when|then|and|but|dado|cuando|entonces|y|pero)\b", line, re.I):
            steps.append({"action": line, "expected": "Continuar el escenario BDD"})
    if not steps and details.strip():
        steps.append({"action": details.strip(), "expected": "Completar el escenario BDD"})
    return steps


def _script(case: Any, warnings: list[str]) -> tuple[str, list[dict[str, str]], str]:
    script = case.find("testScript")
    if script is None:
        return "", [], "manual"
    kind = str(script.attrib.get("type") or "").strip().lower()
    details = _text(script, "details")
    if kind == "steps":
        steps = []
        for node in script.findall("./steps/step"):
            action = _text(node, "description")
            if action:
                steps.append({
                    "action": action,
                    "data": _text(node, "testData"),
                    "expected": _text(node, "expectedResult", "Resultado esperado"),
                })
        return "", steps, "manual"
    if kind == "bdd":
        if re.search(r"(?im)^\s*examples\s*:", details):
            warnings.append("Los Examples de Zephyr Scale se conservan como definición BDD, pero no se expanden en casos separados.")
        return details, _bdd_steps(details), "automated"
    if kind == "plain":
        return details, [], "manual"
    if kind:
        warnings.append(f"Se encontró un tipo de testScript de Zephyr Scale no reconocido: {kind}.")
    return details, [], "manual"


def _has_content(node: Any) -> bool:
    return node is not None and (bool(list(node)) or bool(str(node.text or "").strip()))


def parse_zephyr_scale_xml(data: bytes) -> AdapterResult:
    """Parse the Zephyr Scale project XML export contract (Cloud/Server)."""
    try:
        root = ET.fromstring(data)
    except (ET.ParseError, DefusedXmlException) as exc:
        raise AdapterError("El XML de Zephyr Scale no es válido o contiene construcciones no permitidas") from exc
    if str(root.tag).rsplit("}", 1)[-1] != "project":
        raise AdapterError("El XML no corresponde a una exportación de proyecto de Zephyr Scale")

    project_key = _text(root, "projectKey")
    export_version = _text(root, "modelVersion")
    case_nodes = root.findall("./testCases/testCase")
    if not case_nodes:
        raise AdapterError("El XML de Zephyr Scale no contiene testCases reconocibles")

    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    ignored: set[str] = set()
    for position, case in enumerate(case_nodes, 1):
        key = str(case.attrib.get("key") or "").strip()
        case_id = key or str(case.attrib.get("id") or "").strip()
        title = _text(case, "name")
        if not title:
            raise AdapterError(f"El caso Zephyr Scale {case_id or position} no tiene nombre")

        script_details, steps, case_type = _script(case, warnings)
        objective = _text(case, "objective")
        script = case.find("testScript")
        script_kind = str(script.attrib.get("type") if script is not None else "").lower()
        description_parts = [objective]
        if script_kind == "plain" and script_details:
            description_parts.append(script_details)
        description = "\n\n".join(part for part in description_parts if part)

        rich_values = [description, _text(case, "precondition")]
        rich_values.extend(value for step in steps for value in step.values())
        if any(re.search(r"<img\b", value, re.I) for value in rich_values):
            warnings.append("El XML referencia imágenes embebidas por URL; Zephyr Scale no incluye sus binarios en esta exportación.")
        if _has_content(case.find("attachments")):
            warnings.append("Zephyr Scale declaró adjuntos, pero este contrato XML no garantiza sus binarios; revisalos antes de confirmar.")
            ignored.add("attachments")
        if _has_content(case.find("parameters")):
            warnings.append("Los parámetros de Zephyr Scale se conservan dentro del texto de pasos, pero sus valores por defecto no tienen equivalente nativo.")
            ignored.add("parameters")
        if _has_content(case.find("testDataWrapper")):
            warnings.append("Las filas de test data de Zephyr Scale no se expanden automáticamente en casos independientes.")
            ignored.add("testDataWrapper")
        if _has_content(case.find("customFields")):
            ignored.add("customFields")
        if _has_content(case.find("confluencePageLinks")):
            ignored.add("confluencePageLinks")

        folder = _text(case, "folder") or "Importados/Zephyr Scale"
        rows.append({
            "id": case_id or _stable_id(project_key, title, folder, position),
            "external_version": export_version or None,
            "title": title,
            "description": description,
            "preconditions": _text(case, "precondition"),
            "priority": _text(case, "priority", "Normal"),
            "status": _text(case, "status"),
            "type": case_type,
            "tags": _labels(case),
            "steps": steps,
            "suite_path": folder,
        })

    return AdapterResult(
        rows,
        warnings=warnings,
        source_fields=[
            "projectKey", "modelVersion", "testCase.key", "folder", "name", "objective",
            "precondition", "priority", "status", "labels", "issues", "testScript",
        ],
        ignored_fields=sorted(ignored),
    )

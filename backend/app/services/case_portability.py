"""Safe, versioned import/export of test-case definitions.

This is a core broker, not code supplied by a plugin.  Store artifacts merely
declare that this official capability is available; no downloaded code, macros
or XML extensions are executed while parsing customer files.
"""
from __future__ import annotations

import hashlib
import html
import io
import json
import os
from html.parser import HTMLParser
from pathlib import Path
import re
import zipfile
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from defusedxml import ElementTree as ET
from defusedxml.common import DefusedXmlException

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from .. import models
from ..time_utils import utc_now
from . import case_import_adapters as adapters
from . import case_import_json_adapters as json_adapters
from . import case_import_xml_adapters as xml_adapters

FORMAT_ID = "treseko.test-cases-package/v1"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 2_000
MAX_CASES = 10_000
ROLLBACK_WINDOW = timedelta(hours=1)
SUPPORTED_PROFILES = {
    "treseko/tcases-v1": {"tool": "treseko", "version": "tcases-v1", "extensions": [".tcases"], "status": "stable", "import_enabled": True},
    "csv/structured-v1": {"tool": "csv", "version": "structured-v1", "extensions": [".csv"], "status": "stable", "import_enabled": True},
    "testlink/xml-v1": {"tool": "testlink", "version": "xml-v1", "extensions": [".xml"], "status": "beta", "import_enabled": True, "verification_label": "Verificado", "verification_detail": "Probado con exportaciones XML reales de TestLink."},
    "xray/json-v1": {"tool": "xray", "version": "execution-testinfo-v1", "extensions": [".json"], "status": "beta", "import_enabled": True},
    "zephyr/json-v1": {"tool": "zephyr", "display_name": "Zephyr Scale", "version": "scale-cloud-api-v2", "extensions": [".json"], "status": "beta", "import_enabled": True},
    "azure-test-plans/csv-v1": {"tool": "azure-test-plans", "version": "csv-v1", "extensions": [".csv"], "status": "beta", "import_enabled": True},
    "qtest/excel-v1": {"tool": "qtest", "version": "excel-v1", "extensions": [".xls", ".xlsx"], "status": "beta", "import_enabled": True},
    "practitest/csv-v1": {"tool": "practitest", "version": "csv-v1", "extensions": [".csv"], "status": "beta", "import_enabled": True},
    "testrail/xml-v1": {"tool": "testrail", "version": "xml-v1", "extensions": [".xml"], "status": "beta", "import_enabled": True},
    "testrail/csv-v1": {"tool": "testrail", "version": "csv-v1", "extensions": [".csv"], "status": "beta", "import_enabled": True},
    "xray/csv-v1": {"tool": "xray", "version": "csv-importer-v1", "extensions": [".csv"], "status": "beta", "import_enabled": True},
    "zephyr/xml-v1": {"tool": "zephyr", "display_name": "Zephyr Scale", "version": "project-xml-v1", "extensions": [".xml"], "status": "beta", "import_enabled": True},
    "zephyr/csv-v1": {"tool": "zephyr", "version": "csv-unverified", "extensions": [".csv"], "status": "blocked", "import_enabled": False, "reason": "Zephyr CSV cambia entre productos y todavía no tiene fixture oficial validado."},
    "qase/json-v1": {"tool": "qase", "version": "export-api-v1", "extensions": [".json"], "status": "beta", "import_enabled": True},
    "qase/csv-v1": {"tool": "qase", "version": "csv-v1", "extensions": [".csv"], "status": "beta", "import_enabled": True},
    "gherkin/feature-v1": {"tool": "gherkin", "version": "official-parser-v1", "extensions": [".feature"], "status": "beta", "import_enabled": True},
}


class PortabilityError(ValueError):
    pass


class _PortableHtmlTextParser(HTMLParser):
    """Convert rich text exported by test managers into readable plain text."""

    _BLOCK_TAGS = {
        "blockquote", "div", "h1", "h2", "h3", "h4", "h5", "h6",
        "ol", "p", "pre", "table", "tr", "ul",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.suppressed_depth = 0

    def _newline(self) -> None:
        if self.parts and not self.parts[-1].endswith("\n"):
            self.parts.append("\n")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag in {"script", "style"}:
            self.suppressed_depth += 1
            return
        if self.suppressed_depth:
            return
        if tag == "br":
            self._newline()
        elif tag == "li":
            self._newline()
            self.parts.append("- ")
        elif tag in {"td", "th"}:
            current_line = "".join(self.parts).rsplit("\n", 1)[-1].strip()
            if current_line:
                self.parts.append(" | ")
        elif tag in self._BLOCK_TAGS:
            self._newline()

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            if self.suppressed_depth:
                self.suppressed_depth -= 1
            return
        if not self.suppressed_depth and (tag in self._BLOCK_TAGS or tag in {"li", "td", "th"}):
            self._newline()

    def handle_data(self, data: str) -> None:
        if not self.suppressed_depth:
            self.parts.append(data.replace("\xa0", " "))

    def text(self) -> str:
        lines: list[str] = []
        for raw_line in "".join(self.parts).replace("\r", "").split("\n"):
            line = re.sub(r"[ \t\f\v]+", " ", raw_line).strip()
            if line:
                lines.append(line)
            elif lines and lines[-1] != "":
                lines.append("")
        while lines and not lines[-1]:
            lines.pop()
        text = "\n".join(lines)
        return re.sub(r"(?m)^(- .*)\n\n(?=- )", r"\1\n", text)


def _html_to_text(value: Any) -> str:
    parser = _PortableHtmlTextParser()
    parser.feed(str(value or ""))
    parser.close()
    return parser.text()


_RICH_HTML_TAG = re.compile(r"</?(?:p|div|br|li|ul|ol|table|tr|td|th|blockquote|pre|h[1-6]|strong|em|span)\b", re.IGNORECASE)


def _portable_text(value: Any) -> str:
    text = str(value or "")
    if _RICH_HTML_TAG.search(text):
        return _html_to_text(text)
    return html.unescape(text).strip()


def profiles() -> list[dict[str, Any]]:
    return [{"id": key, **value} for key, value in SUPPORTED_PROFILES.items()]


def validate_file_extension(profile_id: str, file_name: str | None) -> None:
    profile = SUPPORTED_PROFILES.get(profile_id)
    if not profile:
        raise PortabilityError("Perfil de origen o versión no reconocido; elegí un perfil compatible")
    if not file_name:
        return
    extension = Path(file_name).suffix.lower()
    allowed = {str(value).lower() for value in profile.get("extensions", [])}
    if extension not in allowed:
        expected = ", ".join(sorted(allowed))
        raise PortabilityError(f"El archivo {extension or 'sin extensión'} no corresponde a este perfil; se espera {expected}")


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def _enum(value: Any, enum_cls: Any, default: str) -> str:
    text = str(value or default).strip().upper().replace(" ", "_")
    aliases = {"HIGH": "ALTA", "MEDIUM": "MEDIA", "LOW": "BAJA", "CRITICAL": "CRITICA", "ACTIVE": "ACTIVO", "ARCHIVED": "ARCHIVADO", "MANUAL": "MANUAL", "AUTOMATED": "AUTOMATIZADA"}
    text = aliases.get(text, text)
    return text if text in {item.value for item in enum_cls} else default


def _steps(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        # Portable CSV convention: action => expected, one line per step.
        source = [line for line in value.replace("\r", "").split("\n") if line.strip()]
        items = [{"accion": line.split("=>", 1)[0].strip(), "resultado_esperado": (line.split("=>", 1)[1].strip() if "=>" in line else "Resultado esperado")} for line in source]
    else:
        items = value if isinstance(value, list) else []
    if len(items) > 200:
        raise PortabilityError("Un caso supera el máximo de 200 pasos; dividilo o revisá el adaptador antes de importar")
    result = []
    for index, item in enumerate(items, 1):
        if not isinstance(item, dict):
            continue
        action = _portable_text(item.get("accion") or item.get("action") or item.get("step"))
        expected = _portable_text(item.get("resultado_esperado") or item.get("expected") or item.get("expected_result") or "Resultado esperado")
        if action:
            result.append({"numero_paso": index, "accion": action, "datos": _portable_text(item.get("datos") or item.get("data")) or None, "resultado_esperado": expected})
    return result


def _normal_case(raw: dict[str, Any], tool: str, position: int) -> dict[str, Any]:
    title = raw.get("titulo") or raw.get("title") or raw.get("name") or raw.get("summary")
    if not str(title or "").strip():
        raise PortabilityError(f"El caso {position} no tiene título")
    title = str(title).strip()
    if len(title) > 255:
        raise PortabilityError(f"El título del caso {position} supera 255 caracteres")
    tags = raw.get("etiquetas") or raw.get("tags") or raw.get("labels") or []
    if isinstance(tags, str): tags = [x.strip() for x in re.split(r"[,;]", tags) if x.strip()]
    if len(tags) > 50:
        raise PortabilityError(f"El caso {position} supera el máximo de 50 etiquetas")
    external_id = str(raw.get("external_id") or raw.get("id") or raw.get("key") or raw.get("codigo") or f"row-{position}")
    if len(external_id) > 255:
        raise PortabilityError(f"El identificador externo del caso {position} supera 255 caracteres")
    suite_path = str(raw.get("suite_path") or raw.get("suite") or raw.get("folder") or raw.get("section") or "Importados").strip()
    suite_parts = [part.strip() for part in suite_path.replace("\\", "/").split("/") if part.strip()]
    if len(suite_parts) > 8:
        raise PortabilityError(f"El caso {position} supera ocho niveles de suites")
    if any(len(part) > 150 for part in suite_parts):
        raise PortabilityError(f"El caso {position} contiene un nombre de suite mayor a 150 caracteres")
    return {
        "external_id": external_id, "external_version": str(raw.get("external_version") or raw.get("version") or "").strip() or None,
        "suite_path": "/".join(suite_parts) or "Importados",
        "titulo": _portable_text(title), "descripcion": _portable_text(raw.get("descripcion") or raw.get("description") or raw.get("objective")) or None,
        "precondiciones": _portable_text(raw.get("precondiciones") or raw.get("preconditions")) or None,
        "postcondiciones": _portable_text(raw.get("postcondiciones") or raw.get("postconditions")) or None,
        "prioridad": _enum(raw.get("prioridad") or raw.get("priority"), models.Prioridad, "MEDIA"),
        "criticidad": _enum(raw.get("criticidad") or raw.get("severity"), models.Criticidad, "MEDIA"),
        "tipo_prueba": _enum(raw.get("tipo_prueba") or raw.get("type"), models.TipoPrueba, "MANUAL"),
        "estado_caso": _enum(raw.get("estado_caso") or raw.get("status"), models.EstadoCaso, "ACTIVO"),
        "etiquetas": [str(x) for x in tags], "pasos": _steps(raw.get("pasos") or raw.get("steps") or raw.get("test_steps")),
        "source_tool": tool,
    }


def _xml_text(node: Any, name: str, default: str = "") -> str:
    return str((node.findtext(name) if node is not None else None) or default).strip()


def _parse_testrail_xml(root: Any) -> adapters.AdapterResult:
    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    ignored_custom_fields: set[str] = set()

    def custom_text(case: Any, *names: str) -> str:
        for name in names:
            value = _xml_text(case, f"custom/{name}")
            if value:
                return value
        return ""

    def visit(section: Any, parents: list[str]) -> None:
        name = _xml_text(section, "name")
        path = parents + ([name] if name else [])
        for case in section.findall("./cases/case"):
            steps = []
            for step in case.findall(".//step"):
                action = _xml_text(step, "content") or _xml_text(step, "action")
                if action:
                    steps.append({"accion": action, "datos": _xml_text(step, "data") or None, "resultado_esperado": _xml_text(step, "expected") or "Resultado esperado"})
            description = custom_text(case, "description") or _xml_text(case, "custom_description")
            mission = custom_text(case, "mission")
            goals = custom_text(case, "goals")
            if not description and (mission or goals):
                description = "\n\n".join(part for part in (f"Misión\n{mission}" if mission else "", f"Objetivos\n{goals}" if goals else "") if part)
            custom = case.find("custom")
            if custom is not None:
                recognized = {"description", "mission", "goals", "preconds", "preconditions", "steps", "steps_separated"}
                ignored_custom_fields.update(child.tag for child in list(custom) if child.tag not in recognized)
            rows.append({
                "id": _xml_text(case, "id") or f"row-{len(rows)+1}",
                "title": _xml_text(case, "title"),
                "description": description,
                "preconditions": custom_text(case, "preconds", "preconditions"),
                "priority": _xml_text(case, "priority", "MEDIA"),
                "type": _xml_text(case, "type"),
                "tags": _xml_text(case, "references"),
                "steps": steps,
                "suite_path": "/".join(path) or "Importados/TestRail",
            })
        for child in section.findall("./sections/section"):
            visit(child, path)
    roots = root.findall("./sections/section") or root.findall("./section")
    for section in roots: visit(section, [])
    if ignored_custom_fields:
        warnings.append("TestRail contiene campos personalizados sin equivalente nativo; revisalos antes de confirmar.")
    return adapters.AdapterResult(rows, warnings=warnings, ignored_fields=sorted(ignored_custom_fields))


def _read_zip(data: bytes) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            total_uncompressed = sum(info.file_size for info in infos)
            if (
                len(infos) > MAX_ARCHIVE_MEMBERS
                or total_uncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES
                or any(
                    info.filename.startswith(("/", "\\"))
                    or ".." in info.filename.replace("\\", "/").split("/")
                    or info.file_size > MAX_UPLOAD_BYTES
                    for info in infos
                )
            ):
                raise PortabilityError("El paquete contiene rutas o archivos no permitidos")
            names = {info.filename for info in infos}
            required = {"manifest.json", "cases.json", "suites.json", "versions.json"}
            if not required.issubset(names): raise PortabilityError("El paquete .tcases está incompleto")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("format") != FORMAT_ID: raise PortabilityError("La versión del formato Treseko no es compatible")
            checksums = manifest.get("checksums") or {}
            values = {name: json.loads(archive.read(name)) for name in required - {"manifest.json"}}
            for name in values:
                if checksums.get(name) != hashlib.sha256(_canonical(values[name])).hexdigest(): raise PortabilityError(f"Checksum inválido en {name}")
            attachments = json.loads(archive.read("attachments.json")) if "attachments.json" in names else []
            if checksums.get("attachments.json") and checksums["attachments.json"] != hashlib.sha256(_canonical(attachments)).hexdigest():
                raise PortabilityError("Checksum inválido en attachments.json")
            missing = [item.get("archive_path") for item in attachments if item.get("archive_path") not in names]
            if missing:
                raise PortabilityError("El paquete no contiene todos los archivos adjuntos declarados")
            files = {item["archive_path"]: archive.read(item["archive_path"]) for item in attachments}
            return {"tool": "treseko", "version": "tcases-v1", "suites": values["suites.json"], "cases": values["cases.json"], "versions": values["versions.json"], "attachments": attachments, "attachment_files": files}
    except zipfile.BadZipFile as exc:
        raise PortabilityError("El archivo .tcases no es un ZIP válido") from exc


def _adapter_package(profile: dict[str, Any], result: adapters.AdapterResult) -> dict[str, Any]:
    if len(result.cases) > MAX_CASES:
        raise PortabilityError("El archivo supera el máximo de casos permitidos")
    try:
        cases = [_normal_case(row, profile["tool"], index) for index, row in enumerate(result.cases, 1)]
    except adapters.AdapterError as exc:
        raise PortabilityError(str(exc)) from exc
    if not cases:
        raise PortabilityError("El archivo no contiene casos de prueba reconocibles")
    external_ids = [case["external_id"] for case in cases]
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in external_ids:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    if duplicates:
        sample = ", ".join(sorted(duplicates)[:3])
        raise PortabilityError(f"El archivo contiene identificadores externos duplicados sin agrupar: {sample}")
    diagnostics = result.diagnostics()
    diagnostics.update({
        "case_count": len(cases),
        "suite_count": len({case["suite_path"] for case in cases}),
        "step_count": sum(len(case["pasos"]) for case in cases),
        "cases_with_description": sum(bool(case["descripcion"]) for case in cases),
        "cases_with_preconditions": sum(bool(case["precondiciones"]) for case in cases),
        "cases_without_steps": sum(not case["pasos"] for case in cases),
    })
    diagnostics["quality"] = "warnings" if diagnostics["warnings"] or diagnostics["ignored_fields"] else "complete"
    return {"tool": profile["tool"], "version": profile["version"], "suites": [], "versions": [], "cases": cases, "diagnostics": diagnostics}


def parse_import(profile_id: str, data: bytes) -> dict[str, Any]:
    if profile_id not in SUPPORTED_PROFILES: raise PortabilityError("Perfil de origen o versión no reconocido; elegí un perfil compatible")
    if not data or len(data) > MAX_UPLOAD_BYTES: raise PortabilityError("El archivo está vacío o supera el límite de 20 MB")
    profile = SUPPORTED_PROFILES[profile_id]
    if not profile.get("import_enabled", False):
        raise PortabilityError(profile.get("reason") or "Este perfil está bloqueado hasta validar su contrato de importación")
    if profile_id == "gherkin/feature-v1":
        try:
            return _adapter_package(profile, adapters.parse_gherkin(data))
        except adapters.AdapterError as exc:
            raise PortabilityError(str(exc)) from exc
    if profile_id == "testlink/xml-v1":
        try: root = ET.fromstring(data)
        except (ET.ParseError, DefusedXmlException) as exc: raise PortabilityError("El XML de TestLink no es válido o contiene construcciones no permitidas") from exc
        rows = []
        def append_cases(node: Any, current: list[str]) -> None:
            for case in node.findall("./testcase"):
                importance = {"1": "BAJA", "2": "MEDIA", "3": "ALTA"}.get(
                    str(case.findtext("importance") or "").strip(), "MEDIA"
                )
                execution_type = {"1": "MANUAL", "2": "AUTOMATIZADA"}.get(
                    str(case.findtext("execution_type") or "").strip(), "MANUAL"
                )
                steps = []
                for step in case.findall(".//step"):
                    action = step.findtext("actions") or step.findtext("action") or ""
                    expected = step.findtext("expectedresults") or step.findtext("expected") or "Resultado esperado"
                    action_text = _html_to_text(action)
                    if action_text:
                        steps.append({"accion": action_text, "resultado_esperado": _html_to_text(expected) or "Resultado esperado"})
                rows.append({"id": case.attrib.get("internalid") or case.findtext("externalid") or f"row-{len(rows)+1}", "external_version": case.findtext("version"), "title": case.attrib.get("name") or _html_to_text(case.findtext("summary")) or "Caso TestLink", "description": _html_to_text(case.findtext("summary") or case.findtext("details")) or None, "preconditions": _html_to_text(case.findtext("preconditions")) or None, "priority": importance, "type": execution_type, "steps": steps, "suite_path": "/".join(current) or "Importados/TestLink"})
        def walk(node: Any, path: list[str]) -> None:
            name = str(node.attrib.get("name") or "").strip(); current = path + ([name] if name else [])
            append_cases(node, current)
            for child in node.findall("./testsuite"): walk(child, current)
        root_tag = str(root.tag).rsplit("}", 1)[-1].lower()
        if root_tag == "testsuite":
            walk(root, [])
        elif root_tag == "testcases":
            append_cases(root, ["Importados", "TestLink"])
        else:
            for suite in root.findall("./testsuite"): walk(suite, [])
        if not rows:
            append_cases(root, ["Importados", "TestLink"])
        if not rows:
            raise PortabilityError("El XML de TestLink no contiene casos de prueba reconocibles")
        return _adapter_package(profile, adapters.AdapterResult(rows))
    if profile_id == "testrail/xml-v1":
        try: root = ET.fromstring(data)
        except (ET.ParseError, DefusedXmlException) as exc: raise PortabilityError("El XML de casos no es válido o contiene construcciones no permitidas") from exc
        return _adapter_package(profile, _parse_testrail_xml(root))
    if profile_id == "treseko/tcases-v1":
        package = _read_zip(data)
        if len(package["cases"]) > MAX_CASES:
            raise PortabilityError("El paquete supera el máximo de casos permitidos")
        suites_by_id = {str(item.get("id")): item for item in package["suites"] if isinstance(item, dict) and item.get("id")}

        def suite_path(suite_id: Any) -> str:
            names: list[str] = []
            current = suites_by_id.get(str(suite_id))
            seen: set[str] = set()
            while current and str(current.get("id")) not in seen:
                seen.add(str(current.get("id")))
                if current.get("nombre"): names.insert(0, str(current["nombre"]))
                current = suites_by_id.get(str(current.get("parent_id")))
            return "/".join(names) or "Importados"

        suite_descriptions: dict[str, str | None] = {}
        for suite in suites_by_id.values():
            path = suite_path(suite.get("id"))
            suite_descriptions[path] = suite.get("descripcion")

        cases = []
        for index, item in enumerate(package["cases"], 1):
            normalized = _normal_case(item, "treseko", index)
            normalized["suite_path"] = suite_path(item.get("suite_id"))
            normalized["suite_description"] = suite_descriptions.get(normalized["suite_path"])
            cases.append(normalized)
        package["cases"] = cases
        package["diagnostics"] = {
            "warnings": [], "source_fields": ["manifest", "suites", "cases", "versions", "attachments"], "ignored_fields": [],
            "case_count": len(cases), "suite_count": len(suites_by_id), "step_count": sum(len(case["pasos"]) for case in cases),
            "cases_with_description": sum(bool(case["descripcion"]) for case in cases),
            "cases_with_preconditions": sum(bool(case["precondiciones"]) for case in cases),
            "cases_without_steps": sum(not case["pasos"] for case in cases), "quality": "complete",
        }
        return package
    adapter_by_profile = {
        "csv/structured-v1": adapters.parse_structured_csv,
        "testrail/csv-v1": adapters.parse_testrail_csv,
        "xray/csv-v1": adapters.parse_xray_csv,
        "azure-test-plans/csv-v1": adapters.parse_azure_csv,
        "qase/csv-v1": adapters.parse_qase_csv,
        "practitest/csv-v1": adapters.parse_practitest_csv,
        "qtest/excel-v1": adapters.parse_qtest_excel,
        "zephyr/json-v1": adapters.parse_zephyr_json,
        "qase/json-v1": json_adapters.parse_qase_json,
        "xray/json-v1": json_adapters.parse_xray_json_testinfo,
        "zephyr/xml-v1": xml_adapters.parse_zephyr_scale_xml,
    }
    adapter = adapter_by_profile.get(profile_id)
    if not adapter:
        raise PortabilityError("El perfil está declarado pero todavía no tiene un adaptador ejecutable")
    try:
        result = adapter(data)
    except adapters.AdapterError as exc:
        raise PortabilityError(str(exc)) from exc
    if len(result.cases) > MAX_CASES:
        raise PortabilityError("El archivo supera el máximo de casos permitidos")
    return _adapter_package(profile, result)


async def export_tcases(db: AsyncSession, project_id: UUID, component_id: UUID, suite_ids: list[UUID] | None = None, case_ids: list[UUID] | None = None) -> bytes:
    suites = (await db.execute(select(models.Suite).where(
        models.Suite.proyecto_id == project_id,
        models.Suite.componente_id == component_id,
    ))).scalars().all()
    selected_ids = {str(value) for value in (suite_ids or [])}
    if selected_ids:
        children: dict[str | None, list[str]] = {}
        for suite in suites: children.setdefault(str(suite.parent_id) if suite.parent_id else None, []).append(str(suite.id))
        expanded = set(selected_ids); pending = list(selected_ids)
        while pending:
            for child in children.get(pending.pop(), []):
                if child not in expanded: expanded.add(child); pending.append(child)
        suites = [suite for suite in suites if str(suite.id) in expanded]
    allowed_suite_ids = {str(suite.id) for suite in suites} if selected_ids else None
    cases = (await db.execute(select(models.CasoPrueba).where(
        models.CasoPrueba.proyecto_id == project_id,
        models.CasoPrueba.componente_id == component_id,
    ).order_by(models.CasoPrueba.master_id, models.CasoPrueba.version))).scalars().all()
    if allowed_suite_ids is not None: cases = [case for case in cases if case.suite_id and str(case.suite_id) in allowed_suite_ids]
    if case_ids: cases = [case for case in cases if case.id in set(case_ids)]
    suite_data = [{"id": str(s.id), "parent_id": str(s.parent_id) if s.parent_id else None, "nombre": s.nombre, "descripcion": s.descripcion, "orden": s.orden} for s in suites]
    case_data, versions, attachments = [], [], []
    attachment_files: dict[str, bytes] = {}
    for case in cases:
        steps = (await db.execute(select(models.PasoPrueba).where(models.PasoPrueba.caso_id == case.id).order_by(models.PasoPrueba.numero_paso))).scalars().all()
        step_data = [{"numero_paso": p.numero_paso, "accion": p.accion, "datos": p.datos, "resultado_esperado": p.resultado_esperado} for p in steps]
        entry = {"external_id": str(case.master_id), "external_version": str(case.version), "suite_id": str(case.suite_id) if case.suite_id else None, "titulo": case.titulo, "descripcion": case.descripcion, "precondiciones": case.precondiciones, "postcondiciones": case.postcondiciones, "prioridad": case.prioridad.value, "criticidad": case.criticidad.value, "tipo_prueba": case.tipo_prueba.value, "estado_caso": case.estado_caso.value, "etiquetas": case.etiquetas or [], "pasos": step_data}
        for step in steps:
            links = (await db.execute(select(models.PasoAttachment).where(models.PasoAttachment.paso_id == step.id))).scalars().all()
            for link in links:
                attachment = await db.get(models.Attachment, link.attachment_id)
                if not attachment or not attachment.storage_path or not os.path.isfile(attachment.storage_path):
                    raise PortabilityError(f"No se pudo leer el adjunto {link.attachment_id} del paso {step.id}")
                safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(attachment.filename_original).name)[:120] or "attachment"
                archive_path = f"attachments/{case.master_id}/{step.numero_paso}-{attachment.id}-{safe_name}"
                content = Path(attachment.storage_path).read_bytes()
                attachments.append({"case_external_id": str(case.master_id), "step_number": step.numero_paso, "filename": safe_name, "content_type": attachment.content_type, "size": len(content), "sha256": hashlib.sha256(content).hexdigest(), "tipo": link.tipo, "archive_path": archive_path})
                attachment_files[archive_path] = content
        case_data.append(entry); versions.append({"master_id": str(case.master_id), "version": case.version, "case": entry})
    payloads = {"cases.json": case_data, "suites.json": suite_data, "versions.json": versions, "attachments.json": attachments}
    manifest = {"format": FORMAT_ID, "created_at": utc_now().isoformat(), "project_id": str(project_id), "checksums": {name: hashlib.sha256(_canonical(value)).hexdigest() for name, value in payloads.items()}, "case_count": len(case_data)}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", _canonical(manifest)); [archive.writestr(name, _canonical(value)) for name, value in payloads.items()]
        for name, content in attachment_files.items(): archive.writestr(name, content)
    return stream.getvalue()


async def preview_import(db: AsyncSession, project_id: UUID, profile_id: str, data: bytes, *, include_binary: bool = False) -> dict[str, Any]:
    package = parse_import(profile_id, data)
    results, new, changed, duplicate = [], 0, 0, 0
    for item in package["cases"]:
        digest = hashlib.sha256(_canonical(item)).hexdigest()
        ref = (await db.execute(select(models.CaseExternalRef).where(models.CaseExternalRef.proyecto_id == project_id, models.CaseExternalRef.source_tool == item["source_tool"], models.CaseExternalRef.external_id == item["external_id"]).order_by(models.CaseExternalRef.created_at.desc()).limit(1))).scalar_one_or_none()
        outcome = "new" if not ref else ("duplicate" if ref.content_sha256 == digest else "new_version")
        new += outcome == "new"; changed += outcome == "new_version"; duplicate += outcome == "duplicate"
        results.append({"external_id": item["external_id"], "titulo": item["titulo"], "outcome": outcome})
    response_package = package if include_binary else {key: value for key, value in package.items() if key != "attachment_files"}
    return {"source_tool": package["tool"], "source_version": package["version"], "file_sha256": hashlib.sha256(data).hexdigest(), "summary": {"total": len(results), "new": new, "new_versions": changed, "duplicates": duplicate}, "diagnostics": package.get("diagnostics", {}), "items": results, "package": response_package}


async def _suite_for_path(db: AsyncSession, project_id: UUID, path: str, created: list[str], descriptions: dict[str, str | None] | None = None, component_id: UUID | None = None) -> UUID | None:
    parent_id = None
    names = [part.strip() for part in path.replace("\\", "/").split("/") if part.strip()][:8]
    for index, name in enumerate(names):
        existing = (await db.execute(select(models.Suite).where(models.Suite.proyecto_id == project_id, models.Suite.parent_id == parent_id, models.Suite.nombre == name, models.Suite.componente_id == component_id))).scalar_one_or_none()
        if existing: parent_id = existing.id; continue
        current_path = "/".join(names[: index + 1])
        suite = models.Suite(proyecto_id=project_id, componente_id=component_id, parent_id=parent_id, nombre=name, descripcion=(descriptions or {}).get(current_path))
        db.add(suite); await db.flush(); parent_id = suite.id; created.append(str(suite.id))
    return parent_id


async def commit_import(db: AsyncSession, project_id: UUID, profile_id: str, data: bytes, file_name: str | None, actor_id: UUID, selected_external_ids: list[str] | None = None, component_id: UUID | None = None, build_id: UUID | None = None) -> models.CaseImportBatch:
    preview = await preview_import(db, project_id, profile_id, data, include_binary=True); package = preview.pop("package")
    if selected_external_ids is not None:
        allowed = set(selected_external_ids); package["cases"] = [item for item in package["cases"] if str(item.get("external_id")) in allowed]
    batch = models.CaseImportBatch(proyecto_id=project_id, source_tool=package["tool"], source_version=package["version"], file_name=(file_name or "import" )[:255], file_sha256=preview["file_sha256"], status="RUNNING", summary_json={}, item_results=[], created_case_ids=[], created_suite_ids=[], created_by=actor_id)
    db.add(batch); await db.flush(); created_cases: list[str] = []; created_suites: list[str] = []; results = []
    try:
        for item in package["cases"]:
            digest = hashlib.sha256(_canonical(item)).hexdigest()
            ref = (await db.execute(select(models.CaseExternalRef).where(models.CaseExternalRef.proyecto_id == project_id, models.CaseExternalRef.source_tool == item["source_tool"], models.CaseExternalRef.external_id == item["external_id"]).order_by(models.CaseExternalRef.created_at.desc()).limit(1))).scalar_one_or_none()
            if ref and ref.content_sha256 == digest:
                results.append({"external_id": item["external_id"], "outcome": "duplicate"}); continue
            suite_id = await _suite_for_path(
                db, project_id, item["suite_path"], created_suites,
                {item["suite_path"]: item.get("suite_description")},
                component_id,
            )
            latest = await db.get(models.CasoPrueba, ref.caso_id) if ref else None
            case = models.CasoPrueba(master_id=(latest.master_id if latest else uuid4()), codigo=(latest.codigo if latest else None), proyecto_id=project_id, suite_id=suite_id, componente_id=component_id, titulo=item["titulo"], descripcion=item["descripcion"], precondiciones=item["precondiciones"], postcondiciones=item["postcondiciones"], version=((latest.version + 1) if latest else 1), prioridad=item["prioridad"], criticidad=item["criticidad"], tipo_prueba=item["tipo_prueba"], estado_caso=item["estado_caso"], etiquetas=item["etiquetas"], creado_por=actor_id)
            db.add(case); await db.flush()
            imported_steps = []
            for step in item["pasos"]:
                row = models.PasoPrueba(caso_id=case.id, **step); db.add(row); imported_steps.append(row)
            await db.flush()
            for attachment in package.get("attachments", []):
                if attachment.get("case_external_id") != item["external_id"]: continue
                step = next((row for row in imported_steps if row.numero_paso == attachment.get("step_number")), None)
                content = package.get("attachment_files", {}).get(attachment.get("archive_path"))
                if not step or not content or hashlib.sha256(content).hexdigest() != attachment.get("sha256"):
                    raise PortabilityError(f"Adjunto inválido para el caso {item['external_id']}")
                safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(attachment.get("filename") or "attachment").name)[:120] or "attachment"
                target_dir = Path(__file__).resolve().parents[1] / "static" / "evidencias"
                target_dir.mkdir(parents=True, exist_ok=True)
                target_name = f"{uuid4()}-{safe_name}"; target_path = target_dir / target_name; target_path.write_bytes(content)
                saved = models.Attachment(filename_original=safe_name, content_type=attachment.get("content_type") or "application/octet-stream", size=len(content), sha256=attachment["sha256"], storage_path=str(target_path), public_url=f"/static/evidencias/{target_name}", scope="CASE_PORTABILITY", proyecto_id=project_id, created_by=actor_id)
                db.add(saved); await db.flush(); db.add(models.PasoAttachment(paso_id=step.id, attachment_id=saved.id, tipo=attachment.get("tipo") or "evidence"))
            db.add(models.CaseExternalRef(proyecto_id=project_id, caso_id=case.id, master_id=case.master_id, source_tool=item["source_tool"], external_id=item["external_id"], external_version=item["external_version"], content_sha256=digest, import_batch_id=batch.id, metadata_json={"profile": profile_id}))
            created_cases.append(str(case.id)); results.append({"external_id": item["external_id"], "case_id": str(case.id), "outcome": "new_version" if latest else "new"})
        # Mark the completion boundary after all records exist. Rollback uses
        # this timestamp to distinguish imported rows from later edits; using
        # the initial batch timestamp would incorrectly reject every rollback.
        batch.created_at = utc_now()
        batch.status = "COMPLETED"; batch.summary_json = {**preview["summary"], "diagnostics": preview.get("diagnostics", {})}; batch.item_results = results; batch.created_case_ids = created_cases; batch.created_suite_ids = created_suites
        if build_id:
            for case_id in created_cases: db.add(models.BuildCaso(build_id=build_id, caso_id=UUID(case_id)))
        await db.commit(); await db.refresh(batch); return batch
    except Exception:
        await db.rollback(); raise


def rollback_expires_at(batch: models.CaseImportBatch) -> datetime | None:
    return batch.created_at + ROLLBACK_WINDOW if batch.created_at else None


async def rollback_eligibility(
    db: AsyncSession,
    batch: models.CaseImportBatch,
) -> tuple[bool, str | None, datetime | None]:
    expires_at = rollback_expires_at(batch)
    if batch.status != "COMPLETED" or batch.rolled_back_at:
        return False, "El lote no se puede revertir", expires_at
    if not expires_at or utc_now() >= expires_at:
        return False, "La ventana de una hora para revertir este lote ya venció", expires_at

    ids = [UUID(value) for value in (batch.created_case_ids or [])]
    if ids:
        execution_id = await db.scalar(
            select(models.EjecucionCaso.id)
            .where(models.EjecucionCaso.caso_id.in_(ids))
            .limit(1)
        )
        if execution_id:
            return False, "No se puede revertir: uno o más casos ya tienen ejecuciones", expires_at

    for case_id in ids:
        case = await db.get(models.CasoPrueba, case_id)
        if not case: continue
        if case.ultima_modificacion and batch.created_at and case.ultima_modificacion > batch.created_at:
            return False, "No se puede revertir: uno o más casos tuvieron cambios posteriores", expires_at
    return True, None, expires_at


async def rollback_batch(db: AsyncSession, batch: models.CaseImportBatch, actor_id: UUID) -> models.CaseImportBatch:
    eligible, reason, _ = await rollback_eligibility(db, batch)
    if not eligible:
        raise PortabilityError(reason or "El lote no se puede revertir")

    try:
        for case_id in [UUID(value) for value in (batch.created_case_ids or [])]:
            case = await db.get(models.CasoPrueba, case_id)
            if case:
                await db.delete(case)
        for suite_id in reversed([UUID(value) for value in (batch.created_suite_ids or [])]):
            suite = await db.get(models.Suite, suite_id)
            if suite:
                remaining = (await db.execute(select(models.CasoPrueba.id).where(models.CasoPrueba.suite_id == suite_id).limit(1))).scalar_one_or_none()
                children = (await db.execute(select(models.Suite.id).where(models.Suite.parent_id == suite_id).limit(1))).scalar_one_or_none()
                if not remaining and not children: await db.delete(suite)
        batch.status = "ROLLED_BACK"; batch.rolled_back_at = utc_now(); batch.rolled_back_by = actor_id
        await db.commit(); await db.refresh(batch); return batch
    except IntegrityError as exc:
        await db.rollback()
        raise PortabilityError("No se puede revertir: uno o más casos ya tienen ejecuciones") from exc

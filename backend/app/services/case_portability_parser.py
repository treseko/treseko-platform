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
from .chatbot_config import normalize_chatbot_config
from .api_dynamic_variables import (
    DYNAMIC_VARIABLE_CATALOG_VERSION,
    DYNAMIC_VARIABLE_NAMES,
    POSTMAN_EXTENSION_VARIABLE_NAMES,
    POSTMAN_OFFICIAL_DYNAMIC_VARIABLE_NAMES,
)

FORMAT_ID = "treseko.test-cases-package/v1"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 2_000
MAX_CASES = 10_000
ROLLBACK_WINDOW = timedelta(hours=1)
SUPPORTED_PROFILES = {
    "treseko/tcases-v1": {"tool": "treseko", "version": "tcases-v1", "extensions": [".tcases"], "status": "stable", "import_enabled": True},
    # Legacy project exports were JSON responses from /proyectos/{id}/export/.
    # They were commonly saved by users with a .treseko extension.
    "treseko/legacy-project-v1": {"tool": "treseko", "version": "legacy-project-v1", "extensions": [".treseko", ".json"], "status": "stable", "import_enabled": True, "verification_label": "Compatibilidad histórica"},
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
    "postman/collection-v2.1": {"tool": "postman", "version": "collection-v2.1", "extensions": [".json"], "status": "beta", "import_enabled": True},
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
    chatbot_config = normalize_chatbot_config(raw.get("configuracion_chatbot") or raw.get("chatbot_config") or {})
    if not isinstance(chatbot_config, dict):
        raise PortabilityError(f"La configuración Chatbot del caso {position} debe ser un objeto JSON")
    if len(json.dumps(chatbot_config, ensure_ascii=False).encode("utf-8")) > 256 * 1024:
        raise PortabilityError(f"La configuración Chatbot del caso {position} supera 256 KB")
    dataset = raw.get("dataset") or raw.get("datos_prueba") or []
    if not isinstance(dataset, list) or len(dataset) > 500:
        raise PortabilityError(f"El dataset del caso {position} no es válido o supera 500 filas")
    normalized_dataset = []
    for row in dataset:
        if not isinstance(row, dict):
            raise PortabilityError(f"El dataset del caso {position} contiene una fila inválida")
        normalized_dataset.append({str(key): str(value or "") for key, value in row.items()})
    if len(json.dumps(normalized_dataset, ensure_ascii=False).encode("utf-8")) > 128 * 1024:
        raise PortabilityError(f"El dataset del caso {position} supera 128 KB")
    traceability = raw.get("trazabilidad") or raw.get("traceability") or {}
    if not isinstance(traceability, dict):
        raise PortabilityError(f"La trazabilidad del caso {position} debe ser un objeto JSON")
    code = _portable_text(raw.get("codigo") or raw.get("code")) or None
    if code and len(code) > 20:
        raise PortabilityError(f"El código del caso {position} supera 20 caracteres")
    return {
        "external_id": external_id, "external_version": str(raw.get("external_version") or raw.get("version") or "").strip() or None,
        "suite_path": "/".join(suite_parts) or "Importados",
        "codigo": code,
        "titulo": _portable_text(title), "descripcion": _portable_text(raw.get("descripcion") or raw.get("description") or raw.get("objective")) or None,
        "precondiciones": _portable_text(raw.get("precondiciones") or raw.get("preconditions")) or None,
        "postcondiciones": _portable_text(raw.get("postcondiciones") or raw.get("postconditions")) or None,
        "prioridad": _enum(raw.get("prioridad") or raw.get("priority"), models.Prioridad, "MEDIA"),
        "criticidad": _enum(raw.get("criticidad") or raw.get("severity"), models.Criticidad, "MEDIA"),
        "tipo_prueba": _enum(raw.get("tipo_prueba") or raw.get("type"), models.TipoPrueba, "MANUAL"),
        "formato_prueba": _enum(("CLASICA" if (raw.get("formato_prueba") or raw.get("format")) == "FUNCIONAL" else (raw.get("formato_prueba") or raw.get("format"))), models.FormatoPrueba, "CLASICA"),
        "estado_caso": _enum(raw.get("estado_caso") or raw.get("status"), models.EstadoCaso, "ACTIVO"),
        "etiquetas": [str(x) for x in tags], "dataset": normalized_dataset,
        "configuracion_chatbot": chatbot_config, "configuracion_api": raw.get("configuracion_api") if isinstance(raw.get("configuracion_api"), dict) else {},
        "script_automatizado": _portable_text(raw.get("script_automatizado") or raw.get("script")) or None,
        "framework": _portable_text(raw.get("framework")) or None,
        "trazabilidad": traceability, "pasos": _steps(raw.get("pasos") or raw.get("steps") or raw.get("test_steps")),
        "source_tool": tool,
    }


def _read_legacy_project_package(data: bytes) -> dict[str, Any]:
    """Normalize the pre-.tcases project JSON export used by older Treseko."""
    try:
        package = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PortabilityError("El paquete .treseko histórico no contiene JSON válido") from exc
    if not isinstance(package, dict) or not isinstance(package.get("casos"), list):
        raise PortabilityError("El paquete .treseko histórico no contiene la colección casos")
    suites = package.get("suites") if isinstance(package.get("suites"), list) else []
    suites_by_id = {str(item.get("id")): item for item in suites if isinstance(item, dict) and item.get("id")}

    def suite_path(suite_id: Any) -> str:
        names: list[str] = []
        current = suites_by_id.get(str(suite_id))
        seen: set[str] = set()
        while current and str(current.get("id")) not in seen:
            seen.add(str(current.get("id")))
            if current.get("nombre"):
                names.insert(0, str(current["nombre"]))
            current = suites_by_id.get(str(current.get("parent_id")))
        return "/".join(names) or "Importados/Treseko"

    rows = []
    for item in package["casos"]:
        if not isinstance(item, dict):
            continue
        rows.append({**item, "external_id": item.get("external_id") or item.get("master_id") or item.get("id"), "external_version": item.get("external_version") or item.get("version"), "suite_path": item.get("suite_path") or suite_path(item.get("suite_id"))})
    profile = SUPPORTED_PROFILES["treseko/legacy-project-v1"]
    result = _adapter_package(profile, adapters.AdapterResult(rows, warnings=["Paquete histórico JSON de Treseko: los campos ausentes se completaron con valores compatibles."] if package.get("version_formato") else [], source_fields=sorted({str(key) for item in package["casos"] if isinstance(item, dict) for key in item})))
    result["diagnostics"]["legacy_format_version"] = str(package.get("version_formato") or "unknown")
    result["diagnostics"]["suite_count"] = len(suites_by_id)
    return result


def _postman_script(events: Any, listen: str) -> str | None:
    for event in events or []:
        if not isinstance(event, dict) or str(event.get("listen") or "").lower() != listen:
            continue
        script = event.get("script") or {}
        exec_lines = script.get("exec") if isinstance(script, dict) else None
        if isinstance(exec_lines, list):
            value = "\n".join(str(line) for line in exec_lines).strip()
            # Postman commonly exports an empty event before the real event.
            # Do not let that placeholder hide a later non-empty script.
            if value:
                return value
        if isinstance(exec_lines, str):
            value = exec_lines.strip()
            if value:
                return value
    return None


def _postman_unsupported_dynamic_variables(value: Any) -> set[str]:
    """Find Postman dynamic placeholders not implemented by the safe runner."""
    found: set[str] = set()
    if isinstance(value, str):
        for match in re.finditer(r"\{\{\s*(\$[A-Za-z][A-Za-z0-9_]*)\s*\}\}", value):
            name = match.group(1)
            if name not in DYNAMIC_VARIABLE_NAMES:
                found.add(name)
    elif isinstance(value, list):
        for item in value:
            found.update(_postman_unsupported_dynamic_variables(item))
    elif isinstance(value, dict):
        for item in value.values():
            found.update(_postman_unsupported_dynamic_variables(item))
    return found


def _postman_script_diagnostics(*scripts: str | None) -> tuple[set[str], set[str]]:
    """Classify script APIs without executing imported JavaScript."""
    source = "\n".join(str(script or "") for script in scripts)
    supported = {
        name for pattern, name in (
            (r"\bpm\.test\s*\(", "pm.test"),
            (r"\bpm\.expect\s*\(", "pm.expect"),
            (r"\bpm\.variables\b", "pm.variables"),
            (r"\bpm\.globals\b", "pm.globals"),
            (r"\bpm\.collectionVariables\b", "pm.collectionVariables"),
            (r"\bpm\.environment\b", "pm.environment"),
            (r"\bpm\.iterationData\b", "pm.iterationData"),
            (r"\bpm\.request\b", "pm.request"),
            (r"\bpm\.response\b", "pm.response"),
            (r"replaceIn\s*\(", "replaceIn"),
        ) if re.search(pattern, source)
    }
    unsupported = {
        name for pattern, name in (
            (r"\bpm\.sendRequest\b", "pm.sendRequest"),
            (r"\bpm\.execution\.runRequest\b", "pm.execution.runRequest"),
            (r"\bpm\.visual\b", "pm.visual"),
            (r"\bpm\.cookies\b", "pm.cookies"),
            (r"\brequire\s*\(", "require"),
            (r"\b(fetch|XMLHttpRequest|WebSocket)\b", "network API"),
        ) if re.search(pattern, source)
    }
    return supported, unsupported


def _postman_value(value: Any) -> Any:
    if isinstance(value, dict):
        return value.get("value") if "value" in value else value.get("raw")
    return value


def _postman_request(request: Any) -> dict[str, Any]:
    if isinstance(request, str):
        return {"method": "GET", "url": request}
    if not isinstance(request, dict):
        raise PortabilityError("Una request Postman no tiene una definición válida")
    url_value = request.get("url")
    if isinstance(url_value, dict):
        raw_url = url_value.get("raw") or ""
        query = url_value.get("query") or []
    else:
        raw_url = url_value or ""
        query = request.get("query") or []
    query_items = []
    for item in query if isinstance(query, list) else []:
        if isinstance(item, dict) and item.get("key") and item.get("disabled") is not True:
            query_items.append({"key": str(item["key"]), "value": _postman_value(item.get("value")) or "", "enabled": True})
    headers = []
    for item in request.get("header") or []:
        if isinstance(item, dict) and item.get("key") and item.get("disabled") is not True:
            headers.append({"key": str(item["key"]), "value": _postman_value(item.get("value")) or "", "enabled": True})
    body = request.get("body") or {}
    body_config: dict[str, Any] = {"mode": "none"}
    if isinstance(body, dict):
        mode = str(body.get("mode") or "none").lower()
        if mode == "raw":
            options = body.get("options") or {}
            raw_options = options.get("raw") if isinstance(options, dict) else {}
            language = raw_options.get("language") if isinstance(raw_options, dict) else None
            body_config = {"mode": "raw", "media_type": "application/json" if language == "json" else "text/plain", "content": body.get("raw") or ""}
        elif mode in {"urlencoded", "formdata"}:
            fields = []
            for item in body.get(mode) or []:
                if isinstance(item, dict) and item.get("key") and item.get("disabled") is not True:
                    fields.append({"key": str(item["key"]), "value": _postman_value(item.get("value")) or "", "type": item.get("type") or "text", "enabled": True})
            body_config = {"mode": mode, "fields": fields}
    auth = request.get("auth") or {"type": "noauth"}
    auth_type = str(auth.get("type") or "noauth").lower() if isinstance(auth, dict) else "noauth"
    auth_config: dict[str, Any] = {"type": "none"}
    if auth_type in {"bearer", "basic", "apikey", "oauth2"}:
        values = {str(item.get("key")): _postman_value(item.get("value")) for item in (auth.get(auth_type) or []) if isinstance(item, dict)}
        if auth_type == "apikey":
            auth_config = {"type": "api_key", "header": values.get("key") or "X-API-Key", "value": values.get("value") or ""} if str(values.get("in") or "header") == "header" else {"type": "api_key", "query": values.get("key") or "api_key", "value": values.get("value") or ""}
        elif auth_type == "oauth2":
            auth_config = {"type": "oauth2", "flow": values.get("grant_type") or values.get("accessTokenUrl") or "imported", "token": values.get("accessToken") or values.get("accessToken") or ""}
        else:
            auth_config = {"type": auth_type, **values}
    return {"method": str(request.get("method") or "GET").upper(), "url": str(raw_url), "query": query_items, "headers": headers, "body": body_config, "auth": auth_config}


def _postman_external_id(collection_key: str, path: list[str], position: int, item: dict[str, Any], request: dict[str, Any]) -> str:
    """Build a deterministic identity when Postman omits ``item.id``.

    A positional fallback such as ``request-1`` collides when two different
    collections are imported into the same project. The collection identity,
    folder path, sibling position and request definition make re-imports
    stable without treating unrelated requests as new versions.
    """
    identity = {
        "collection": collection_key,
        "path": path,
        "position": position,
        "name": item.get("name") or "",
        "method": request.get("method") or "GET",
        "url": request.get("url") or "",
    }
    digest = hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return f"postman-{digest[:32]}"


def _parse_postman_collection(data: bytes) -> dict[str, Any]:
    try:
        collection = json.loads(data)
    except (TypeError, ValueError) as exc:
        raise PortabilityError("La colección Postman no contiene JSON válido") from exc
    if not isinstance(collection, dict) or not isinstance(collection.get("item"), list):
        raise PortabilityError("La colección Postman debe ser v2.1 y contener item")
    info = collection.get("info") or {}
    collection_name = str(info.get("name") or "Colección Postman").strip()[:150]
    collection_variables = {str(item.get("key")): _postman_value(item.get("value")) for item in collection.get("variable") or [] if isinstance(item, dict) and item.get("key")}
    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    ignored_fields: list[str] = []
    script_request_count = 0
    script_without_tests = 0
    script_capabilities: set[str] = set()
    unsupported_script_apis: set[str] = set()
    unknown_dynamic_variables: set[str] = set()

    collection_events = collection.get("event") if isinstance(collection.get("event"), list) else []
    collection_auth = collection.get("auth") if isinstance(collection.get("auth"), dict) else None

    def walk(items: list[Any], path: list[str], inherited_events: list[Any] | None = None, inherited_auth: dict[str, Any] | None = None) -> None:
        nonlocal script_request_count, script_without_tests
        inherited_events = inherited_events or []
        inherited_auth = inherited_auth or collection_auth
        for position, item in enumerate(items, 1):
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or f"Request {len(rows) + 1}").strip()
            if isinstance(item.get("item"), list):
                folder_events = item.get("event") if isinstance(item.get("event"), list) else []
                folder_auth = item.get("auth") if isinstance(item.get("auth"), dict) else inherited_auth
                walk(item["item"], path + [name], inherited_events + folder_events, folder_auth)
                continue
            if not item.get("request"):
                warnings.append(f"Se ignoró el elemento sin request: {name}")
                continue
            request_source = dict(item["request"])
            if "auth" not in request_source and inherited_auth:
                request_source["auth"] = inherited_auth
            request = _postman_request(request_source)
            events = inherited_events + (item.get("event") if isinstance(item.get("event"), list) else [])
            pre_script = _postman_script(events, "prerequest")
            post_script = _postman_script(events, "test")
            if pre_script or post_script:
                script_request_count += 1
                warnings.append(f"La request {name} contiene scripts; serán ejecutados por el sandbox controlado de Treseko.")
            if not post_script:
                script_without_tests += 1
                warnings.append(f"La request {name} no contiene pruebas Postman; revisá o agregá validaciones antes de automatizarla.")
            supported_apis, unsupported_apis = _postman_script_diagnostics(pre_script, post_script)
            script_capabilities.update(supported_apis)
            unsupported_script_apis.update(unsupported_apis)
            if unsupported_apis:
                warnings.append(f"La request {name} usa APIs de Postman fuera del sandbox declarativo: {', '.join(sorted(unsupported_apis))}; se importará la configuración y se informará durante la ejecución.")
            unsupported_dynamic = _postman_unsupported_dynamic_variables({"request": request, "pre_request_script": pre_script, "post_response_script": post_script})
            if unsupported_dynamic:
                unknown_dynamic_variables.update(unsupported_dynamic)
                warnings.append(f"La request {name} usa variables dinámicas no soportadas por Treseko: {', '.join(sorted(unsupported_dynamic))}; se conservarán sin resolver.")
            request_obj = item.get("request") if isinstance(item.get("request"), dict) else {}
            external_id = str(item.get("id") or request_obj.get("id") or _postman_external_id(
                str(info.get("_postman_id") or collection_name), path, position, item, request,
            ))
            rows.append({
                "external_id": external_id,
                "external_version": str(info.get("_postman_id") or "2.1"),
                "titulo": name,
                "descripcion": _portable_text(item.get("description") or (item.get("request") or {}).get("description")) or None,
                "suite_path": "/".join([collection_name, *path]) or collection_name,
                "prioridad": "MEDIA", "criticidad": "MEDIA", "tipo_prueba": "AUTOMATIZADA", "formato_prueba": "API", "estado_caso": "ACTIVO", "etiquetas": ["postman", "api"],
                "configuracion_api": {"schema_version": "treseko.api-test/v2", "request": request, "collection_variables": collection_variables, "variables": {}, "pre_request_script": pre_script, "post_response_script": post_script, "assertions": [], "extractors": [], "execution": {"iterations": 1, "parallelism": 1, "fail_fast": True}},
                "pasos": [], "source_tool": "postman",
            })
    walk(collection["item"], [], collection_events, collection_auth)
    if not rows:
        raise PortabilityError("La colección Postman no contiene requests HTTP importables")
    if collection_variables:
        warnings.append("Las variables de colección se conservaron como variables de colección; el ambiente o dataset puede sobrescribirlas al ejecutar.")
    return _adapter_package(
        {"tool": "postman", "version": "collection-v2.1"},
        adapters.AdapterResult(rows, warnings=warnings, ignored_fields=ignored_fields, metadata={
            "runtime": "treseko-declarative-sandbox",
            "dynamic_variable_catalog_version": DYNAMIC_VARIABLE_CATALOG_VERSION,
            "official_dynamic_variable_count": len(POSTMAN_OFFICIAL_DYNAMIC_VARIABLE_NAMES),
            "extension_dynamic_variables": sorted(POSTMAN_EXTENSION_VARIABLE_NAMES),
            "scripts_detected": script_request_count,
            "requests_without_postman_tests": script_without_tests,
            "script_capabilities": sorted(script_capabilities),
            "unsupported_script_apis": sorted(unsupported_script_apis),
            "unknown_dynamic_variables": sorted(unknown_dynamic_variables),
            "diagnostics_note": "La vista previa identifica límites de compatibilidad; la importación no ejecuta scripts.",
        }),
    )


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
    if profile_id == "postman/collection-v2.1":
        return _parse_postman_collection(data)
    if profile_id == "treseko/legacy-project-v1":
        return _read_legacy_project_package(data)
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

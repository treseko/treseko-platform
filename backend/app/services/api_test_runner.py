"""Small, declarative HTTP runner for Treseko API-format cases.

The runner deliberately accepts data-only definitions.  It does not evaluate
scripts or arbitrary code, and every destination is checked against the
selected environment allowlist before the request is sent.
"""
from __future__ import annotations

import base64
import copy
import ipaddress
import json
import re
import socket
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from .api_test_sandbox import ApiScriptError, run_api_script
from .api_dynamic_variables import (
    DYNAMIC_VARIABLE_CATALOG_VERSION,
    POSTMAN_EXTENSION_VARIABLE_NAMES,
    POSTMAN_OFFICIAL_DYNAMIC_VARIABLE_NAMES,
    DynamicVariableContext,
    extract_dynamic_variable_names,
)
from .api_evidence_policy import evidence_policy_marker, public_api_evidence_enabled


MAX_RESPONSE_BYTES = 2 * 1024 * 1024
SECRET_HEADER_NAMES = {"authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key"}
SECRET_CONFIG_KEYS = {"authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key", "token", "password", "secret", "client_secret", "access_token", "refresh_token"}
VARIABLE_PATTERN = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
SENSITIVE_VARIABLE_PATTERN = re.compile(r"token|secret|password|passwd|authorization|api[-_]?key|cookie", re.IGNORECASE)


class ApiTestRunnerError(ValueError):
    pass


@dataclass
class ApiEnvironment:
    base_url: str
    variables: dict[str, Any]
    allowed_hosts: set[str]


def _json_path(value: Any, selector: str) -> Any:
    selector = str(selector or "$").strip()
    if selector in {"", "$"}:
        return value
    if not selector.startswith("$"):
        raise ApiTestRunnerError(f"JSONPath inválido: {selector}")
    tokens = re.findall(r"\.([A-Za-z_][\w-]*)|\[([0-9]+|['\"][^'\"]+['\"])\]", selector[1:])
    current = value
    for dot_key, bracket_key in tokens:
        key: Any = bracket_key or dot_key
        if isinstance(key, str) and len(key) > 1 and key[0] in "'\"":
            key = key[1:-1]
        if isinstance(key, str) and key.isdigit():
            key = int(key)
        try:
            current = current[key]
        except (KeyError, IndexError, TypeError):
            return None
    return current


def _replace_string(value: str, variables: dict[str, Any], dynamic_variables: DynamicVariableContext | None = None) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        if dynamic_variables is not None and key.startswith("$"):
            generated = dynamic_variables.ensure(key)
            if generated is not None:
                dynamic_variables.occurrences.append({"name": key, "value": generated, "source": "variable_resolution"})
                return str(generated)
        if key == "$uuid":
            return str(uuid.uuid4())
        if key == "$timestamp":
            return str(int(time.time()))
        return str(variables.get(key, match.group(0)))

    return VARIABLE_PATTERN.sub(replace, value)


def resolve_variables(value: Any, variables: dict[str, Any], dynamic_variables: DynamicVariableContext | None = None, *, source: str = "request") -> Any:
    if isinstance(value, str):
        if dynamic_variables is not None:
            value = dynamic_variables.resolve_string(value, source=source)
        return _replace_string(value, variables, dynamic_variables)
    if isinstance(value, list):
        return [resolve_variables(item, variables, dynamic_variables, source=source) for item in value]
    if isinstance(value, dict):
        return {key: resolve_variables(item, variables, dynamic_variables, source=source) for key, item in value.items()}
    return value


def _variable_names(value: Any, names: set[str] | None = None) -> set[str]:
    if names is None:
        names = set()
    if isinstance(value, str):
        names.update(match.group(1).strip() for match in VARIABLE_PATTERN.finditer(value))
    elif isinstance(value, list):
        for item in value:
            _variable_names(item, names)
    elif isinstance(value, dict):
        for item in value.values():
            _variable_names(item, names)
    return names


def _used_variable_values(config: dict[str, Any], variables: dict[str, Any], dynamic_variables: DynamicVariableContext | None = None, *, redact: bool = True) -> dict[str, Any]:
    return {
        name: "[REDACTED]" if redact and SENSITIVE_VARIABLE_PATTERN.search(name) else (dynamic_variables.values.get(name) if dynamic_variables and name in dynamic_variables.values else variables.get(name, "[MISSING]"))
        for name in sorted(_variable_names(config))
    }


def _redact(value: Any, secrets: set[str] | None = None) -> Any:
    secrets = {item for item in (secrets or set()) if item}
    if isinstance(value, str):
        result = value
        for secret in sorted(secrets, key=len, reverse=True):
            result = result.replace(secret, "[REDACTED]")
        return result
    if isinstance(value, list):
        return [_redact(item, secrets) for item in value]
    if isinstance(value, dict):
        return {key: _redact(item, secrets) for key, item in value.items()}
    return value


def _script_evidence(index: int, phase: str, result: dict[str, Any], variables: dict[str, Any], secrets: set[str], *, redact: bool = True) -> dict[str, Any]:
    """Keep script diagnostics without turning execution evidence into a secret store."""
    evidence = {
        "step": index,
        "phase": phase,
        "runtime": result.get("runtime", "treseko-declarative-sandbox"),
        "capabilities": result.get("capabilities") or [],
        "tests": result.get("tests") or [],
        "logs": result.get("logs") or [],
        "scope_reads": result.get("scope_reads") or [],
        "scope_writes": result.get("scope_writes") or [],
        "variables": result.get("variables") or variables,
        "environment": result.get("environment") or {},
        "collection_variables": result.get("collection_variables") or {},
        "globals": result.get("globals") or {},
        "iteration_data": result.get("iteration_data") or {},
    }
    # A script can create a token or password that did not exist in the
    # initial environment. Discover string values in every returned scope
    # before redacting so evidence never becomes a secret store by accident.
    evidence_secrets = set(secrets)

    def collect_strings(value: Any) -> None:
        if isinstance(value, str) and len(value) >= 4:
            evidence_secrets.add(value)
        elif isinstance(value, dict):
            for item in value.values():
                collect_strings(item)
        elif isinstance(value, list):
            for item in value:
                collect_strings(item)

    for key in ("variables", "environment", "collection_variables", "globals", "iteration_data"):
        collect_strings(evidence.get(key))
    return _redact(evidence, evidence_secrets) if redact else evidence


def sanitize_api_config(config: dict[str, Any], *, redact: bool = True) -> dict[str, Any]:
    """Return a persistence-safe copy of an API definition.

    Definitions may reference environment variables, but users can still paste
    a credential into an auth/header field. By default snapshots redact those
    values. The explicit public-test-data policy is the only path that asks
    the caller to preserve exact synthetic values for replication.
    """
    if not redact:
        return copy.deepcopy(config)

    def sanitize(value: Any, key: str = "") -> Any:
        if isinstance(value, dict):
            header_name = str(value.get("key") or value.get("name") or "").lower()
            return {name: "[REDACTED]" if str(name).lower() in SECRET_CONFIG_KEYS or (str(name).lower() == "value" and header_name in SECRET_HEADER_NAMES) else sanitize(item, str(name)) for name, item in value.items()}
        if isinstance(value, list):
            return [sanitize(item, key) for item in value]
        return value

    return sanitize(copy.deepcopy(config))


def _safe_headers(headers: Any, secrets: set[str], *, redact: bool = True) -> dict[str, str]:
    items = headers.items() if isinstance(headers, dict) else ((item.get("key"), item.get("value")) for item in (headers or []) if isinstance(item, dict) and item.get("enabled", True))
    safe: dict[str, str] = {}
    for key, value in items:
        if not key:
            continue
        safe[str(key)] = "[REDACTED]" if redact and str(key).lower() in SECRET_HEADER_NAMES else str(_redact(str(value), secrets) if redact else value)
    return safe


def _assert_json_schema(value: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    if not isinstance(schema, dict):
        return [f"{path}: el esquema JSON debe ser un objeto"]
    failures: list[str] = []
    if "const" in schema and value != schema["const"]:
        failures.append(f"{path}: se esperaba const={schema['const']!r}")
    if "enum" in schema and value not in (schema.get("enum") or []):
        failures.append(f"{path}: valor fuera de enum")
    expected_type = schema.get("type")
    type_matches = {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
        "null": value is None,
    }
    if expected_type:
        if expected_type not in type_matches:
            return [f"{path}: type JSON no soportado={expected_type}"]
        if not type_matches[expected_type]:
            return [f"{path}: se esperaba type={expected_type}"]
    if isinstance(value, dict):
        for required in schema.get("required", []):
            if required not in value:
                failures.append(f"{path}.{required}: campo requerido ausente")
        for key, child in (schema.get("properties") or {}).items():
            if key in value and isinstance(child, dict):
                failures.extend(_assert_json_schema(value[key], child, f"{path}.{key}"))
        if schema.get("additionalProperties") is False:
            allowed = set((schema.get("properties") or {}).keys())
            for key in value:
                if key not in allowed:
                    failures.append(f"{path}.{key}: propiedad no permitida")
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            failures.extend(_assert_json_schema(item, schema["items"], f"{path}[{index}]"))
    if isinstance(value, str):
        if isinstance(schema.get("minLength"), int) and len(value) < schema["minLength"]:
            failures.append(f"{path}: longitud menor que minLength")
        if isinstance(schema.get("maxLength"), int) and len(value) > schema["maxLength"]:
            failures.append(f"{path}: longitud mayor que maxLength")
        if schema.get("pattern"):
            try:
                if re.search(str(schema["pattern"]), value) is None:
                    failures.append(f"{path}: no coincide con pattern")
            except re.error as exc:
                failures.append(f"{path}: pattern inválido: {exc}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if schema.get("minimum") is not None and value < schema["minimum"]:
            failures.append(f"{path}: menor que minimum")
        if schema.get("maximum") is not None and value > schema["maximum"]:
            failures.append(f"{path}: mayor que maximum")
    if isinstance(value, list):
        if isinstance(schema.get("minItems"), int) and len(value) < schema["minItems"]:
            failures.append(f"{path}: menos elementos que minItems")
        if isinstance(schema.get("maxItems"), int) and len(value) > schema["maxItems"]:
            failures.append(f"{path}: más elementos que maxItems")
    return failures


def _ordered_compare(actual: Any, expected: Any, operator: str) -> bool:
    if actual is None:
        return False
    try:
        if operator == "lt":
            return actual < expected
        if operator == "lte":
            return actual <= expected
        if operator == "gt":
            return actual > expected
        return actual >= expected
    except (TypeError, ValueError):
        return False


def _assertion_result(assertion: dict[str, Any], response: dict[str, Any], *, redact: bool = True) -> dict[str, Any]:
    source = str(assertion.get("source") or "response.body")
    if source == "response.status":
        actual = response["status"]
    elif source == "response.time.total_ms":
        actual = response["timings"]["total_ms"]
    elif source == "response.size_bytes":
        actual = response.get("size_bytes")
    elif source == "response.text":
        actual = response.get("body")
    elif source == "response.headers":
        actual = response["headers"]
        selector = assertion.get("selector")
        if selector:
            actual = _json_path(actual, selector) if str(selector).startswith("$") else actual.get(str(selector))
    elif source == "response.body":
        actual = response.get("body_json") if response.get("body_json") is not None else response.get("body")
        selector = assertion.get("selector")
        if selector:
            actual = _json_path(actual, selector)
    elif source.startswith("response.headers."):
        actual = response["headers"].get(source.split(".", 2)[2])
    elif source == "response.cookies":
        actual = response.get("cookies") or {}
        if assertion.get("selector"):
            actual = actual.get(str(assertion["selector"]))
    elif source.startswith("response.cookies."):
        actual = (response.get("cookies") or {}).get(source.split(".", 2)[2])
    else:
        actual = None
    operator = str(assertion.get("operator") or "equals").lower()
    expected = assertion.get("expected")
    failures: list[str] = []
    if operator in {"equals", "equal"}:
        passed = actual == expected
    elif operator == "not_equals":
        passed = actual != expected
    elif operator == "exists":
        passed = actual is not None
    elif operator == "not_exists":
        passed = actual is None
    elif operator == "contains":
        if isinstance(actual, (str, list, tuple, dict)):
            try:
                passed = expected in actual
            except (TypeError, ValueError):
                passed = False
        else:
            passed = False
    elif operator == "starts_with":
        passed = isinstance(actual, str) and str(actual).startswith(str(expected))
    elif operator == "ends_with":
        passed = isinstance(actual, str) and str(actual).endswith(str(expected))
    elif operator in {"less_than", "lt"}:
        passed = _ordered_compare(actual, expected, "lt")
    elif operator in {"less_or_equal", "lte"}:
        passed = _ordered_compare(actual, expected, "lte")
    elif operator in {"greater_than", "gt"}:
        passed = _ordered_compare(actual, expected, "gt")
    elif operator in {"greater_or_equal", "gte"}:
        passed = _ordered_compare(actual, expected, "gte")
    elif operator == "in":
        try:
            passed = actual in expected if isinstance(expected, (list, tuple, set, dict, str)) else False
        except (TypeError, ValueError):
            passed = False
    elif operator == "matches":
        try:
            passed = actual is not None and re.search(str(expected), str(actual)) is not None
        except re.error as exc:
            passed = False
            failures = [f"regex inválido: {exc}"]
    elif operator == "type_is":
        actual_type = (
            "null" if actual is None else
            "boolean" if isinstance(actual, bool) else
            "number" if isinstance(actual, (int, float)) else
            "string" if isinstance(actual, str) else
            "array" if isinstance(actual, list) else
            "object" if isinstance(actual, dict) else "unknown"
        )
        passed = actual_type == str(expected or "").lower()
        if not passed:
            failures = [f"tipo recibido={actual_type!r}, esperado={expected!r}"]
    elif operator in {"array_length_equals", "array_length_greater_or_equal", "array_length_less_or_equal"}:
        length = len(actual) if isinstance(actual, list) else None
        if operator == "array_length_equals":
            passed = length is not None and length == expected
        elif operator == "array_length_greater_or_equal":
            passed = _ordered_compare(length, expected, "gte")
        else:
            passed = _ordered_compare(length, expected, "lte")
        if not passed and length is None:
            failures = [f"se esperaba un array, se recibió {type(actual).__name__}"]
    elif operator == "is_empty":
        passed = actual is None or actual == "" or actual == [] or actual == {}
    elif operator == "not_empty":
        passed = not (actual is None or actual == "" or actual == [] or actual == {})
    elif operator == "json_schema":
        failures = _assert_json_schema(actual, {} if expected is None else expected)
        passed = not failures
    else:
        raise ApiTestRunnerError(f"Operador de aserción no soportado: {operator}")
    if not passed and not failures:
        failures = [f"{source} {operator}: actual={actual!r}, expected={expected!r}"]
    return {
        "id": assertion.get("id") or str(uuid.uuid4()),
        "name": assertion.get("name") or assertion.get("id") or "Assertion",
        "severity": assertion.get("severity", "must"),
        "status": "PASSED" if passed else "FAILED",
        "source": source,
        "selector": assertion.get("selector"),
        "operator": operator,
        "expected": _redact(expected) if redact else expected,
        "expected_type": assertion.get("expected_type"),
        "actual": _redact(actual) if redact else actual,
        "error": "; ".join(failures) if failures else None,
    }


def _environment(environment: Any, config: dict[str, Any]) -> ApiEnvironment:
    base_url = str(getattr(environment, "url", "") or "").strip().rstrip("/")
    if not base_url:
        raise ApiTestRunnerError("El ambiente API no tiene URL")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ApiTestRunnerError("La URL del ambiente debe usar HTTP o HTTPS")
    environment_config = getattr(environment, "configuracion_api", None) or {}
    allowed_hosts = {parsed.hostname.lower()}
    for item in [*(config.get("allowed_hosts") or []), *(environment_config.get("allowed_hosts") or [])]:
        if item:
            allowed_hosts.add(str(item).lower().strip().rstrip("."))
    variables = {"base_url": base_url, **(getattr(environment, "variables", None) or {})}
    return ApiEnvironment(base_url, variables, allowed_hosts)


def _validate_destination(
    url: str,
    environment: ApiEnvironment,
    *,
    resolve_dns: bool = True,
    allow_private_network: bool = False,
) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ApiTestRunnerError("El destino debe ser una URL HTTP/HTTPS válida")
    if parsed.username or parsed.password:
        raise ApiTestRunnerError("No se permiten credenciales embebidas en la URL")
    host = parsed.hostname.lower().rstrip(".")
    if host not in environment.allowed_hosts:
        raise ApiTestRunnerError("Destino bloqueado: el host no pertenece a la allowlist del ambiente")
    if host in {"169.254.169.254", "metadata.google.internal", "metadata.azure.internal"}:
        raise ApiTestRunnerError("Destino bloqueado por política SSRF")
    try:
        address = ipaddress.ip_address(host)
        if (
            not allow_private_network
            and (address.is_private or address.is_loopback or address.is_link_local or address.is_unspecified or address.is_reserved or address.is_multicast)
        ):
            raise ApiTestRunnerError("Destino bloqueado por política SSRF")
    except ValueError:
        # A public-looking hostname can still resolve to an internal address.
        # Resolve it before the request when using the real network transport.
        if not resolve_dns:
            return
        try:
            resolved = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            raise ApiTestRunnerError("No se pudo resolver el destino") from exc
        for item in resolved:
            address = ipaddress.ip_address(item[4][0])
            if (
                not allow_private_network
                and (address.is_private or address.is_loopback or address.is_link_local or address.is_unspecified or address.is_reserved or address.is_multicast)
            ):
                raise ApiTestRunnerError("Destino bloqueado por política SSRF")


def _request_config(step: dict[str, Any], variables: dict[str, Any], dynamic_variables: DynamicVariableContext | None = None) -> dict[str, Any]:
    request = copy.deepcopy(step.get("request") or step)
    request.pop("assertions", None)
    request.pop("extractors", None)
    request.pop("name", None)
    resolved = resolve_variables(request, variables, dynamic_variables, source="request")
    unresolved: set[str] = set()
    def collect(value: Any) -> None:
        if isinstance(value, str):
            unresolved.update(match.group(1).strip() for match in VARIABLE_PATTERN.finditer(value) if match.group(1).strip().startswith("api."))
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)
    collect(resolved)
    if unresolved:
        raise ApiTestRunnerError(f"Variables API no resueltas: {', '.join(sorted(unresolved))}")
    return resolved


def _enabled_pairs(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return {str(key): item for key, item in value.items() if key}
    result: dict[str, Any] = {}
    for item in value or []:
        if not isinstance(item, dict) or not item.get("enabled", item.get("disabled") is not True):
            continue
        # Postman cookies use ``name`` while headers, params and Treseko v2 use
        # ``key``. Accept both so imported and historical definitions execute
        # exactly like rows authored in the guided editor.
        pair_key = item.get("key") or item.get("name")
        if pair_key:
            result[str(pair_key)] = item.get("value", "")
    return result


def _body_kwargs(body: Any) -> dict[str, Any]:
    if isinstance(body, dict):
        mode = str(body.get("mode") or "none").lower()
        if mode in {"raw", "json"}:
            content = body.get("content", body.get("value"))
            if body.get("media_type") == "application/json" and isinstance(content, str):
                try:
                    content = json.loads(content)
                except (TypeError, ValueError):
                    pass
            return {"json": content} if isinstance(content, (dict, list, int, float, bool)) else ({"content": str(content)} if content is not None else {})
        if mode == "urlencoded":
            return {"data": _enabled_pairs(body.get("fields") or body.get("values"))}
        if mode in {"formdata", "multipart"}:
            fields = _enabled_pairs(body.get("fields") or body.get("values"))
            return {"files": [(key, (None, str(value))) for key, value in fields.items()]}
    if isinstance(body, (dict, list)):
        return {"json": body}
    return {"content": str(body)} if body is not None else {}


async def _run_cleanup(config: dict[str, Any], environment: ApiEnvironment, variables: dict[str, Any], secrets: set[str], transport: httpx.AsyncBaseTransport | None, timeout_seconds: float, dynamic_variables: DynamicVariableContext | None = None, *, redact: bool = True) -> dict[str, Any]:
    cleanup = config.get("cleanup") or {}
    steps = cleanup.get("steps") or []
    if not steps:
        return {"status": "NOT_CONFIGURED", "steps": []}
    cleanup_steps: list[dict[str, Any]] = []
    async with httpx.AsyncClient(verify=True, follow_redirects=False, timeout=timeout_seconds, transport=transport) as client:
        for index, step in enumerate(steps, start=1):
            request = _request_config(step, variables, dynamic_variables)
            method = str(request.get("method") or "DELETE").upper()
            if method == "TRACE" or method not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
                raise ApiTestRunnerError(f"Método HTTP no permitido en cleanup: {method}")
            url = str(request.get("url") or "")
            if url.startswith("/"):
                url = f"{environment.base_url}{url}"
            _validate_destination(url, environment, resolve_dns=transport is None)
            raw_headers = _enabled_pairs(request.get("headers"))
            raw_query = _enabled_pairs(request.get("query") or request.get("query_params"))
            cookies = _enabled_pairs(request.get("cookies"))
            body = request.get("body")
            request_kwargs = _body_kwargs(body)
            redirects = request.get("redirects") or {}
            try:
                response = await client.request(method, url, headers=dict(raw_headers), params=raw_query or None, cookies=cookies or None, follow_redirects=bool(redirects.get("follow", False)), **request_kwargs)
                cleanup_steps.append({"index": index, "name": step.get("name") or f"Cleanup {index}", "status": "PASSED" if response.is_success else "FAILED", "status_code": response.status_code, "request": {"method": method, "url": url, "headers": _safe_headers(raw_headers, secrets, redact=redact), "query": _redact(raw_query, secrets) if redact else raw_query, "cookies": _redact(cookies, secrets) if redact else cookies, "body": _redact(body, secrets) if redact else body}})
            except (httpx.HTTPError, TimeoutError) as exc:
                cleanup_steps.append({"index": index, "name": step.get("name") or f"Cleanup {index}", "status": "FAILED", "request": {"method": method, "url": url, "headers": _safe_headers(raw_headers, secrets, redact=redact), "query": _redact(raw_query, secrets) if redact else raw_query, "cookies": _redact(cookies, secrets) if redact else cookies, "body": _redact(body, secrets) if redact else body}, "error": _redact(str(exc), secrets) if redact else str(exc)})
    status = "FAILED" if any(item["status"] == "FAILED" for item in cleanup_steps) else "PASSED"
    return {"status": status, "steps": cleanup_steps}


async def run_api_test(
    config: dict[str, Any],
    environment_obj: Any,
    dataset_variables: dict[str, Any] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    shared_variables: dict[str, Any] | None = None,
    dynamic_seed: int | str | None = None,
) -> dict[str, Any]:
    config = copy.deepcopy(config or {})
    public_evidence = public_api_evidence_enabled(environment=environment_obj, config=config)
    redact_evidence = not public_evidence
    environment = _environment(environment_obj, config)
    collection_variables = dict(config.get("collection_variables") or {})
    config_variables = config.get("variables") or {}
    if isinstance(config_variables, dict) and any(key in config_variables for key in ("case", "collection", "local")):
        case_variables = dict(config_variables.get("case") or {})
        collection_variables.update(config_variables.get("collection") or {})
    else:
        case_variables = dict(config_variables) if isinstance(config_variables, dict) else {}
    global_variables = dict(config.get("global_variables") or {})
    iteration_data = dict(config.get("iteration_data") or {})
    if isinstance(config_variables, dict) and isinstance(config_variables.get("global"), dict):
        global_variables.update(config_variables["global"])
    if isinstance(config_variables, dict) and isinstance(config_variables.get("data"), dict):
        iteration_data.update(config_variables["data"])
    variables = {**environment.variables, **collection_variables, **case_variables, **(dataset_variables or {}), **(shared_variables or {})}
    dynamic_variables = DynamicVariableContext(dynamic_seed)
    # Resolve all dynamic names declared anywhere in this case before scripts
    # run. This gives pre/post scripts and the request the same value, like a
    # single Postman request evaluation.
    for dynamic_name in extract_dynamic_variable_names(config):
        dynamic_variables.ensure(dynamic_name)
    steps = config.get("steps") or [{"name": config.get("metadata", {}).get("name", "API request"), "request": config.get("request") or {}, "assertions": config.get("assertions") or [], "extractors": config.get("extractors") or []}]
    if not steps:
        raise ApiTestRunnerError("La prueba API debe tener al menos una solicitud")
    iterations = max(1, min(int((config.get("execution") or {}).get("iterations") or 1), 100))
    if iterations > 1:
        steps = [
            {**step, "name": f"{step.get('name') or f'Request {position + 1}'} · iteración {iteration}" , "iteration": iteration}
            for iteration in range(1, iterations + 1)
            for position, step in enumerate(steps)
        ]
    execution_steps: list[dict[str, Any]] = []
    script_evidence: list[dict[str, Any]] = []
    persistent_variables: dict[str, Any] = {}
    run_status = "PASSED"
    started = time.perf_counter()
    secrets = {str(value) for value in variables.values() if isinstance(value, str) and len(value) >= 4}
    client_timeout = float((config.get("request") or {}).get("timeout", {}).get("total_ms", 45000)) / 1000
    async with httpx.AsyncClient(verify=True, follow_redirects=False, timeout=max(0.1, min(client_timeout, 120.0)), transport=transport) as client:
        for index, step in enumerate(steps, start=1):
            step_started = time.perf_counter()
            method = "GET"
            url = ""
            headers: dict[str, Any] = {}
            body: Any = None
            try:
                pre_script = step.get("pre_request_script") or config.get("pre_request_script")
                if pre_script:
                    # Postman scripts inspect the request after variable
                    # resolution. Keep the persisted request untouched and
                    # expose only the effective request to the sandbox.
                    for dynamic_name in extract_dynamic_variable_names(pre_script):
                        dynamic_variables.ensure(dynamic_name)
                    script_request = resolve_variables(step.get("request") or {}, variables, dynamic_variables, source="pre_request_script")
                    pre_result = run_api_script(pre_script, variables=variables, environment=environment.variables, collection_variables=collection_variables, globals=global_variables, iteration_data=step.get("iteration_data") or iteration_data, dynamic_variables=dynamic_variables.values, request=script_request, timeout_ms=int((config.get("scripts") or {}).get("timeout_ms", 1000)))
                    script_evidence.append(_script_evidence(index, "pre_request", pre_result, variables, secrets, redact=redact_evidence))
                    variables.update(pre_result.get("variables") or {})
                    persistent_variables.update(pre_result.get("persistent_variables") or {})
                    environment.variables.update(pre_result.get("environment") or {})
                    collection_variables.update(pre_result.get("collection_variables") or {})
                    global_variables.update(pre_result.get("globals") or {})
                request = _request_config(step, variables, dynamic_variables)
                method = str(request.get("method") or "GET").upper()
                if method == "TRACE" or method not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
                    raise ApiTestRunnerError(f"Método HTTP no permitido: {method}")
                url = str(request.get("url") or "")
                if url.startswith("/"):
                    url = f"{environment.base_url}{url}"
                _validate_destination(url, environment, resolve_dns=transport is None)
                raw_headers = _enabled_pairs(request.get("headers"))
                headers = _safe_headers(raw_headers, secrets, redact=redact_evidence)
                raw_query = _enabled_pairs(request.get("query") or request.get("query_params"))
                auth = request.get("auth") or {}
                auth_type = str(auth.get("type") or "none").lower()
                if auth_type in {"bearer", "api_key"}:
                    token = str(auth.get("token") or auth.get("value") or variables.get(auth.get("variable"), ""))
                    if not token:
                        raise ApiTestRunnerError("La autenticación API no tiene un valor resoluble")
                    if auth_type == "bearer":
                        raw_headers["Authorization"] = f"Bearer {token}"
                        headers["Authorization"] = "[REDACTED]" if redact_evidence else raw_headers["Authorization"]
                    elif auth.get("query"):
                        raw_query[str(auth.get("query"))] = token
                    else:
                        header_name = str(auth.get("header") or "X-API-Key")
                        raw_headers[header_name] = token
                        headers[header_name] = "[REDACTED]" if redact_evidence else raw_headers[header_name]
                elif auth_type == "basic":
                    username = str(auth.get("username") or variables.get(auth.get("username_variable"), ""))
                    password = str(auth.get("password") or variables.get(auth.get("password_variable"), ""))
                    if not username:
                        raise ApiTestRunnerError("Basic Auth requiere usuario")
                    encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
                    raw_headers["Authorization"] = f"Basic {encoded}"
                    headers["Authorization"] = "[REDACTED]" if redact_evidence else raw_headers["Authorization"]
                elif auth_type == "oauth2":
                    token = str(auth.get("token") or variables.get(auth.get("variable") or "access_token", ""))
                    if not token:
                        raise ApiTestRunnerError("OAuth 2.0 requiere configurar un token de ambiente antes de ejecutar")
                    raw_headers["Authorization"] = f"Bearer {token}"
                    headers["Authorization"] = "[REDACTED]" if redact_evidence else raw_headers["Authorization"]
                for candidate in raw_headers.values():
                    if isinstance(candidate, str) and len(candidate) >= 4:
                        secrets.add(candidate)
                body = request.get("body")
                request_kwargs = _body_kwargs(body)
                request_cookies = _enabled_pairs(request.get("cookies"))
                redirects = request.get("redirects") or {}
                response = await client.request(method, url, headers=dict(raw_headers), params=raw_query or None, cookies=request_cookies or None, follow_redirects=bool(redirects.get("follow", False)), **request_kwargs)
                content = response.content[:MAX_RESPONSE_BYTES]
                text = content.decode(response.encoding or "utf-8", errors="replace")
                try:
                    body_json = json.loads(text)
                except (ValueError, TypeError):
                    body_json = None
                response_data = {
                    "status": response.status_code,
                    "headers": dict(response.headers),
                    "body": text,
                    "body_json": body_json,
                    "cookies": dict(response.cookies),
                    "size_bytes": len(response.content),
                    "timings": {"total_ms": round((time.perf_counter() - step_started) * 1000, 2)},
                }
                assertions = [_assertion_result(resolve_variables(item, variables, dynamic_variables, source="assertion"), response_data, redact=redact_evidence) for item in (step.get("assertions") or config.get("assertions") or [])]
                post_script = step.get("post_response_script") or config.get("post_response_script")
                if post_script:
                    for dynamic_name in extract_dynamic_variable_names(post_script):
                        dynamic_variables.ensure(dynamic_name)
                    post_result = run_api_script(post_script, variables=variables, environment=environment.variables, collection_variables=collection_variables, globals=global_variables, iteration_data=step.get("iteration_data") or iteration_data, dynamic_variables=dynamic_variables.values, response=response_data, request={"method": method, "url": url, "headers": headers}, timeout_ms=int((config.get("scripts") or {}).get("timeout_ms", 1000)))
                    script_evidence.append(_script_evidence(index, "post_response", post_result, variables, secrets, redact=redact_evidence))
                    variables.update(post_result.get("variables") or {})
                    persistent_variables.update(post_result.get("persistent_variables") or {})
                    environment.variables.update(post_result.get("environment") or {})
                    collection_variables.update(post_result.get("collection_variables") or {})
                    global_variables.update(post_result.get("globals") or {})
                    for test in post_result.get("tests") or []:
                        assertions.append({"id": f"script-{index}-{len(assertions)+1}", "name": test.get("name") or "Postman test", "severity": "must", "status": test.get("status", "FAILED"), "source": "post_response_script", "selector": None, "operator": "script", "expected": None, "expected_type": None, "actual": None, "error": test.get("error")})
                failed = [item for item in assertions if item["status"] == "FAILED" and item.get("severity", "must") != "warning"]
                warnings = [item for item in assertions if item["status"] == "FAILED" and item.get("severity") == "warning"]
                for extractor in step.get("extractors") or config.get("extractors") or []:
                    extractor_source = extractor.get("source", "response.body")
                    source = response_data.get("body_json") if extractor_source == "response.body" else response_data.get("body") if extractor_source == "response.text" else response_data.get("headers") if extractor_source == "response.headers" else response_data.get("cookies") if extractor_source == "response.cookies" else response_data.get("status") if extractor_source == "response.status" else response_data
                    extracted = _json_path(source, extractor.get("selector", "$.")) if isinstance(source, (dict, list)) else source
                    if extractor.get("regex") and extracted is not None:
                        match = re.search(str(extractor["regex"]), str(extracted))
                        extracted = match.group(1) if match and match.groups() else (match.group(0) if match else None)
                    if extracted is None and extractor.get("required", False):
                        failed.append({"id": extractor.get("name"), "error": "No se pudo extraer el valor requerido", "status": "FAILED"})
                    elif extracted is not None:
                        extractor_name = str(extractor.get("name") or "")
                        if extractor_name:
                            variables[extractor_name] = extracted
                            if extractor.get("persist") is True or str(extractor.get("scope") or "").lower() in {"state", "persistent"}:
                                if not extractor_name.startswith("api."):
                                    raise ApiTestRunnerError("Los extractores persistentes deben usar nombres api.*")
                                persistent_variables[extractor_name] = extracted
                        if isinstance(extracted, str) and len(extracted) >= 4:
                            secrets.add(extracted)
                status = "FAILED" if failed else "PASSED"
                if warnings and status == "PASSED":
                    status = "PASSED_WITH_WARNINGS"
                if status == "FAILED":
                    run_status = "FAILED"
                step_evidence = {"index": index, "iteration": step.get("iteration", 1), "name": step.get("name") or f"Request {index}", "status": status, "request": {"method": method, "url": url, "headers": headers, "query": raw_query, "cookies": request_cookies, "body": body}, "response": response_data, "assertions": assertions, "errors": failed}
                execution_steps.append(_redact(step_evidence, secrets) if redact_evidence else step_evidence)
            except (httpx.HTTPError, TimeoutError) as exc:
                run_status = "FAILED"
                execution_steps.append({"index": index, "name": step.get("name") or f"Request {index}", "status": "FAILED", "request": {"method": method, "url": url, "headers": headers, "body": _redact(body, secrets) if redact_evidence else body}, "response": None, "assertions": [], "errors": [{"error": _redact(str(exc), secrets) if redact_evidence else str(exc)}]})
            except ApiScriptError as exc:
                # A script that cannot run means the request was not evaluated.
                # Keep functional assertion failures as FAILED, but classify
                # unsupported/runtime script failures as BLOCKED so the result
                # matches the preflight/runner error semantics.
                raise ApiTestRunnerError(f"El script API no pudo ejecutarse: {_redact(str(exc), secrets)}") from exc
            except ApiTestRunnerError:
                raise
            if run_status == "FAILED" and (config.get("execution") or {}).get("fail_fast", False):
                break
    cleanup_report = await _run_cleanup(config, environment, variables, secrets, transport, max(0.1, min(client_timeout, 120.0)), dynamic_variables, redact=redact_evidence) if (config.get("cleanup") or {}).get("always_run", False) else {"status": "SKIPPED", "steps": []}
    if cleanup_report["status"] == "FAILED" and run_status == "PASSED":
        run_status = "FAILED"
    api_variables = {key: value for key, value in variables.items() if str(key).startswith("api.")}
    if shared_variables is not None:
        shared_variables.update(api_variables)
    safe_dynamic_values = {name: "[REDACTED]" if redact_evidence and SENSITIVE_VARIABLE_PATTERN.search(name) else value for name, value in dynamic_variables.values.items()}
    return {"schema_version": "treseko.api-result/v1", "status": run_status, "duration_ms": round((time.perf_counter() - started) * 1000, 2), "steps": execution_steps, "variables_extracted": sorted(key for key in variables if key not in environment.variables), "variables_used": _used_variable_values(config, variables, dynamic_variables, redact=redact_evidence), "dynamic_variables": {"catalog_version": DYNAMIC_VARIABLE_CATALOG_VERSION, "official_count": len(POSTMAN_OFFICIAL_DYNAMIC_VARIABLE_NAMES), "extensions": sorted(POSTMAN_EXTENSION_VARIABLE_NAMES), "seed": dynamic_variables.seed, "values": safe_dynamic_values, "occurrences": [{**item, "value": "[REDACTED]" if redact_evidence and SENSITIVE_VARIABLE_PATTERN.search(str(item.get("name")) ) else item.get("value")} for item in dynamic_variables.occurrences]}, "script_evidence": script_evidence, "api_variables": api_variables, "persistent_variables": persistent_variables, "cleanup": cleanup_report, **evidence_policy_marker(public_evidence)}

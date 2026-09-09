"""HTTP transport helpers shared by Chatbot execution modes.

The environment/case resolver remains responsible for producing the canonical
configuration.  This module only handles interpolation, session history and
the HTTP exchange so manual and automated runs observe the same contract.
"""

from __future__ import annotations

import json
import ipaddress
import re
import time
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import httpx

from .api_dynamic_variables import DynamicVariableContext
from .api_test_runner import ApiEnvironment, ApiTestRunnerError, _validate_destination


_VARIABLE_PATTERN = re.compile(r"{{\s*([^{}]+?)\s*}}")
MAX_CHATBOT_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_CHATBOT_TIMEOUT_MS = 120_000
SENSITIVE_HEADER_NAMES = {"authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key"}
SENSITIVE_KEY_PATTERN = re.compile(r"token|secret|password|passwd|authorization|api[-_]?key|cookie", re.IGNORECASE)


def _path_value(source: Any, path: str) -> Any:
    normalized = str(path or "").strip().replace("$.", "", 1).replace("$", "", 1)
    normalized = re.sub(r"\[(\d+)\]", r".\1", normalized)
    if not normalized:
        return None
    value = source
    for key in (part for part in normalized.split(".") if part):
        if isinstance(value, dict):
            value = value.get(key)
        elif isinstance(value, list) and key.isdigit():
            index = int(key)
            value = value[index] if 0 <= index < len(value) else None
        else:
            return None
    return value


def resolve_chatbot_variable(name: str, variables: dict[str, Any], local: dict[str, Any] | None = None) -> Any:
    key = str(name or "").strip()
    local = local or {}
    if key in local:
        return local[key]
    local_value = _path_value(local, key)
    if local_value is not None:
        return local_value

    candidates = [key]
    if "." not in key:
        candidates.extend((f"ENV.{key}", f"DATASET.{key}", f"COMPONENT.{key}", f"CASE.{key}"))
    normalized = key.upper()
    for candidate in candidates:
        if candidate in variables:
            return variables[candidate]
        upper_match = next((value for variable, value in variables.items() if str(variable).upper() == candidate.upper()), None)
        if upper_match is not None:
            return upper_match
    if key.startswith(("ENV.", "DATASET.", "COMPONENT.", "CASE.")):
        return variables.get(key)
    return _path_value({**variables, "local": local}, key)


def interpolate_chatbot(
    value: Any,
    variables: dict[str, Any],
    local: dict[str, Any] | None = None,
    dynamic_variables: DynamicVariableContext | None = None,
    *,
    source: str = "chatbot",
) -> Any:
    local = local or {}

    def resolve(name: str) -> Any:
        key = str(name or "").strip()
        if dynamic_variables is not None and key.startswith("$"):
            generated = dynamic_variables.ensure(key)
            if generated is not None:
                dynamic_variables.occurrences.append({"name": key, "value": generated, "source": source})
                return generated
        return resolve_chatbot_variable(key, variables, local)

    if isinstance(value, str):
        matches = list(_VARIABLE_PATTERN.finditer(value))
        if len(matches) == 1 and matches[0].group(0) == value:
            return resolve(matches[0].group(1))

        def replace(match: re.Match[str]) -> str:
            resolved = resolve(match.group(1))
            return str(resolved) if resolved is not None else ""

        return _VARIABLE_PATTERN.sub(
            replace,
            value,
        )
    if isinstance(value, list):
        return [interpolate_chatbot(item, variables, local, dynamic_variables, source=source) for item in value]
    if isinstance(value, dict):
        return {key: interpolate_chatbot(item, variables, local, dynamic_variables, source=source) for key, item in value.items()}
    return value


def response_path(response: Any, path: str) -> Any:
    return _path_value(response, path)


def chatbot_environment(environment: Any, config: dict[str, Any]) -> ApiEnvironment:
    """Build the same destination policy used by the declarative API runner."""
    environment_config = getattr(environment, "configuracion_chatbot", None) or {}
    environment_connection = environment_config.get("connection") if isinstance(environment_config, dict) else {}
    environment_connection = environment_connection if isinstance(environment_connection, dict) else {}
    candidates = [
        getattr(environment, "url", ""),
        environment_connection.get("base_url"),
        environment_connection.get("endpoint"),
    ]
    absolute_urls = [str(item).strip().rstrip("/") for item in candidates if str(item or "").strip().lower().startswith(("http://", "https://"))]
    base_url = absolute_urls[0] if absolute_urls else ""
    parsed_base = urlparse(base_url)
    if not base_url or not parsed_base.hostname:
        raise ApiTestRunnerError("El ambiente Chatbot no tiene una URL válida")
    # Only the persisted environment may broaden this policy. A case or
    # preview payload cannot turn the endpoint into an arbitrary HTTP proxy.
    allowed_hosts = {urlparse(item).hostname.lower().rstrip(".") for item in absolute_urls if urlparse(item).hostname}
    for source in (environment_config, environment_connection):
        if isinstance(source, dict):
            for item in source.get("allowed_hosts") or []:
                if item:
                    allowed_hosts.add(str(item).strip().lower().rstrip("."))
    variables = {"base_url": base_url, **(getattr(environment, "variables", None) or {})}
    return ApiEnvironment(base_url=base_url, variables=variables, allowed_hosts=allowed_hosts)


def validate_chatbot_destination(endpoint: str, environment: Any, config: dict[str, Any]) -> None:
    """Reject destinations outside the selected environment or private ranges."""
    policy = chatbot_environment(environment, config)
    host = (urlparse(endpoint).hostname or "").lower().rstrip(".")
    allow_private_network = False
    try:
        address = ipaddress.ip_address(host)
        # An exact private IP persisted in the selected environment is an
        # explicit, auditable self-hosted destination.
        allow_private_network = host in policy.allowed_hosts and (address.is_private or address.is_loopback)
    except ValueError:
        environment_config = getattr(environment, "configuracion_chatbot", None) or {}
        security = environment_config.get("security") if isinstance(environment_config, dict) else {}
        allow_private_network = bool(isinstance(security, dict) and security.get("allow_private_network") is True)
    _validate_destination(endpoint, policy, resolve_dns=True, allow_private_network=allow_private_network)


def extract_chatbot_tool_evidence(response: Any, config: dict[str, Any]) -> dict[str, Any]:
    """Extract configured tool evidence for manual and HTTP-side consumers."""
    connection = config.get("connection") if isinstance(config.get("connection"), dict) else {}
    mapping = connection.get("response_mapping") if isinstance(connection.get("response_mapping"), dict) else {}
    calls = response_path(response, mapping.get("tool_calls_path") or "")
    result = response_path(response, mapping.get("tool_result_path") or "")
    if calls is None:
        calls = response_path(response, "treseko.tool_calls")
    if calls is None:
        calls = response_path(response, "choices.0.message.tool_calls")
    if result is None:
        result = response_path(response, "treseko.tool_result")
    evidence = []
    for tool in config.get("tools") if isinstance(config.get("tools"), list) else []:
        observation = tool.get("observation") if isinstance(tool, dict) and isinstance(tool.get("observation"), dict) else {}
        custom_calls = response_path(response, observation.get("tool_calls_path") or "")
        custom_result = response_path(response, observation.get("tool_result_path") or "")
        if custom_calls is not None or custom_result is not None:
            evidence.append({"tool": tool.get("name"), "tool_calls": custom_calls, "tool_result": custom_result})
    payload = {"tool_calls": calls, "tool_result": result}
    if evidence:
        payload["tool_evidence"] = evidence
    return payload


def _response_mapping(config: dict[str, Any]) -> dict[str, Any]:
    connection = config.get("connection") if isinstance(config.get("connection"), dict) else {}
    mapping = connection.get("response_mapping") or connection.get("responseMapping") or config.get("response_mapping") or config.get("responseMapping")
    return mapping if isinstance(mapping, dict) else {}


def _adapter(config: dict[str, Any]) -> str:
    connection = config.get("connection") if isinstance(config.get("connection"), dict) else {}
    adapter = str(connection.get("adapter") or config.get("adapter") or "http").strip().lower().replace("-", "_")
    return "generic_http" if adapter == "generic" else adapter


def extract_chatbot_response(response: Any, config: dict[str, Any]) -> tuple[str, str | None]:
    """Extract the user-visible message and a useful configuration error."""
    mapping = _response_mapping(config)
    response_format = str(mapping.get("response_format") or "auto").strip().lower()
    configured_path = str(mapping.get("message_path") or "").strip()
    adapter = _adapter(config)
    if response_format == "text":
        if isinstance(response, str) and response.strip():
            return response, None
        return "", "La respuesta no contiene texto para el formato configurado text."
    if response_format == "json" and isinstance(response, str):
        return "", "La respuesta no es JSON válido para el formato configurado json."
    candidates: list[str] = []
    if configured_path:
        candidates.append(configured_path)
        configured_value = response_path(response, configured_path)
        if configured_value is None or (isinstance(configured_value, str) and not configured_value.strip()):
            return "", f"No se pudo extraer el mensaje configurado desde response_mapping.message_path='{configured_path}'."
    if adapter == "openai_compatible":
        candidates.append("choices.0.message.content")
    candidates.extend(("message", "answer", "reply", "output", "data.message"))
    for path in candidates:
        value = response_path(response, path)
        if value is not None and (not isinstance(value, str) or value.strip()):
            return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False), None
    if response_format == "auto" and isinstance(response, str) and response.strip():
        return response, None
    if configured_path:
        return "", f"No se pudo extraer el mensaje configurado desde response_mapping.message_path='{configured_path}'."
    return "", "No se pudo extraer un mensaje de la respuesta JSON. Configurá response_mapping.message_path."


def response_message(response: Any, config: dict[str, Any]) -> str:
    message, _error = extract_chatbot_response(response, config)
    return message or (json.dumps(response or "", ensure_ascii=False) if not isinstance(response, str) else response)


def resolve_chatbot_endpoint(
    config: dict[str, Any],
    variables: dict[str, Any],
    base_url: str = "",
    dynamic_variables: DynamicVariableContext | None = None,
) -> str:
    connection = config.get("connection") if isinstance(config.get("connection"), dict) else {}
    explicit = interpolate_chatbot(
        connection.get("endpoint") or config.get("endpoint") or connection.get("url") or config.get("url") or "",
        variables,
        dynamic_variables=dynamic_variables,
        source="chatbot.endpoint",
    )
    explicit = str(explicit or "").strip()
    base = interpolate_chatbot(
        connection.get("base_url") or config.get("base_url") or base_url or variables.get("ENV.BASE_URL") or variables.get("ENV.URL") or "",
        variables,
        dynamic_variables=dynamic_variables,
        source="chatbot.base_url",
    )
    base = str(base or "").strip().rstrip("/")
    adapter = _adapter(config)
    if explicit.lower().startswith(("http://", "https://")):
        return explicit
    if not explicit and adapter == "openai_compatible" and base:
        if base.endswith("/chat/completions"):
            return base
        return f"{base}/chat/completions" if base.endswith("/v1") else f"{base}/v1/chat/completions"
    return f"{base}/{explicit.lstrip('/')}" if base else explicit


def _parse_response(raw: str) -> Any:
    try:
        return json.loads(raw) if raw else None
    except (TypeError, ValueError):
        return raw


def _request_body(
    *,
    config: dict[str, Any],
    variables: dict[str, Any],
    message: str,
    session_id: str,
    history: list[dict[str, Any]],
    turn_index: int,
    dynamic_variables: DynamicVariableContext | None,
) -> Any:
    connection = config.get("connection") if isinstance(config.get("connection"), dict) else {}
    request_template = connection.get("request_template") or config.get("request_template") or config.get("request_body") or {}
    local = {
        "message": message,
        "session_id": session_id,
        "turn_index": turn_index,
        "turn": {"message": message, "index": turn_index},
        "session": {"id": session_id},
        "conversation": {"history": history},
        "conversation.history": history,
        "resolved": {"variables": variables},
    }
    if _adapter(config) == "openai_compatible":
        messages = history + [{"role": "user", "content": message}]
        template = request_template if isinstance(request_template, dict) else {}
        body = interpolate_chatbot(template, variables, local, dynamic_variables, source="chatbot.request")
        body = dict(body) if isinstance(body, dict) else {}
        model = connection.get("model") or config.get("model") or (config.get("profile") or {}).get("model") or variables.get("ENV.MODEL")
        body["model"] = model
        body["messages"] = messages
        return body
    default_body = {
        "message": message,
        "session_id": session_id,
        "conversation": history,
        "variables": variables,
    }
    template = request_template if isinstance(request_template, dict) and request_template else default_body
    body = interpolate_chatbot(template, variables, local, dynamic_variables, source="chatbot.request")
    if isinstance(body, dict) and body.get("message") is None:
        body["message"] = message
    return body


def _safe_chatbot_value(value: Any, secrets: set[str] | None = None, key: str = "") -> Any:
    secrets = {str(item) for item in (secrets or set()) if item and len(str(item)) >= 4}
    if isinstance(value, dict):
        return {
            name: "[REDACTED]" if SENSITIVE_KEY_PATTERN.search(str(name)) else _safe_chatbot_value(item, secrets, str(name))
            for name, item in value.items()
        }
    if isinstance(value, list):
        return [_safe_chatbot_value(item, secrets, key) for item in value]
    if isinstance(value, str):
        safe = value
        for secret in sorted(secrets, key=len, reverse=True):
            safe = safe.replace(secret, "[REDACTED]")
        return safe
    return value


def redact_chatbot_exchange(result: dict[str, Any]) -> dict[str, Any]:
    """Redact preview data before it leaves the authenticated API response."""
    request = result.get("request") if isinstance(result.get("request"), dict) else {}
    raw_headers = request.get("headers") if isinstance(request.get("headers"), dict) else {}
    secrets = {str(value) for name, value in raw_headers.items() if str(value) and str(name).lower() in SENSITIVE_HEADER_NAMES}

    def collect_sensitive_values(value: Any, key: str = "") -> None:
        if isinstance(value, dict):
            for name, item in value.items():
                collect_sensitive_values(item, str(name))
        elif isinstance(value, list):
            for item in value:
                collect_sensitive_values(item, key)
        elif SENSITIVE_KEY_PATTERN.search(key) and isinstance(value, str) and len(value) >= 4:
            secrets.add(value)

    collect_sensitive_values(request)
    safe = dict(result)
    safe["request"] = _safe_chatbot_value(request, secrets)
    safe["response"] = _safe_chatbot_value(result.get("response"), secrets)
    if isinstance(result.get("response_headers"), dict):
        safe["response_headers"] = _safe_chatbot_value(result["response_headers"], secrets)
    return safe


async def send_chatbot_turn(
    *,
    config: dict[str, Any],
    variables: dict[str, Any],
    message: str,
    session_id: str | None,
    history: list[dict[str, Any]],
    turn_index: int,
    base_url: str = "",
    dynamic_variables: DynamicVariableContext | None = None,
    environment: Any | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    connection = config.get("connection") if isinstance(config.get("connection"), dict) else {}
    endpoint = resolve_chatbot_endpoint(config, variables, base_url, dynamic_variables)
    session_mode = str((config.get("conversation") or {}).get("session_mode") or config.get("session_mode") or "reuse").strip().lower()
    session_id = str(uuid4()) if session_mode == "new_each_turn" else (session_id or str(uuid4()))
    if environment is not None:
        validate_chatbot_destination(endpoint, environment, config)
    headers = {"content-type": "application/json"}
    configured_headers = connection.get("headers") or config.get("headers") or {}
    if isinstance(configured_headers, dict):
        headers.update(interpolate_chatbot(configured_headers, variables, {"session_id": session_id}, dynamic_variables, source="chatbot.headers"))
    body = _request_body(
        config=config, variables=variables, message=message, session_id=session_id,
        history=history, turn_index=turn_index, dynamic_variables=dynamic_variables,
    )
    method = str(connection.get("method") or config.get("method") or "POST").upper()
    timeout_ms = max(500, min(MAX_CHATBOT_TIMEOUT_MS, int(connection.get("timeout_ms") or config.get("timeout_ms") or 30_000)))
    retries = max(0, min(3, int(connection.get("retries") or config.get("retries") or 0)))
    request_payload = {"method": method, "url": endpoint, "headers": headers, "body": body}
    started = time.perf_counter()
    status_code = 0
    response_body: Any = None
    response_json_valid = False
    response_text = ""
    response_headers: dict[str, str] = {}
    response_format = str(_response_mapping(config).get("response_format") or "auto").strip().lower()
    extraction_error = ""
    response_truncated = False
    raw = ""
    encoding = "utf-8"
    is_success = False
    error = ""
    for attempt in range(retries + 1):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_ms / 1000, connect=min(5, timeout_ms / 1000)), transport=transport) as client:
                async with client.stream(
                    method,
                    endpoint,
                    headers=headers,
                    json=None if method == "GET" else body,
                    params=body if method == "GET" and isinstance(body, dict) else None,
                ) as response:
                    status_code = response.status_code
                    response_headers = dict(response.headers)
                    chunks: list[bytes] = []
                    content_size = 0
                    async for chunk in response.aiter_bytes():
                        remaining = MAX_CHATBOT_RESPONSE_BYTES - content_size
                        if remaining <= 0:
                            response_truncated = True
                            break
                        chunks.append(chunk[:remaining])
                        content_size += min(len(chunk), remaining)
                        if len(chunk) > remaining:
                            response_truncated = True
                            break
                    content = b"".join(chunks)
                    if response_truncated:
                        error = f"La respuesta supera el límite de {MAX_CHATBOT_RESPONSE_BYTES} bytes"
                    encoding = response.encoding or "utf-8"
                    is_success = response.is_success
            raw = content.decode(encoding, errors="replace")
            response_body = _parse_response(raw)
            response_json_valid = not isinstance(response_body, str)
            response_text, extraction = extract_chatbot_response(response_body, config)
            extraction_error = extraction or ""
            if is_success or attempt == retries:
                break
            error = f"HTTP {status_code}"
        except httpx.TimeoutException:
            error = "Timeout del chatbot"
            if attempt == retries:
                break
        except httpx.HTTPError as exc:
            error = str(exc)[:500]
            if attempt == retries:
                break
    latency_ms = int((time.perf_counter() - started) * 1000)
    response_has_content = response_body is not None and (not isinstance(response_body, str) or bool(response_body.strip()))
    passed = 200 <= status_code < 300 and not error and response_has_content and not extraction_error
    mapping = _response_mapping(config)
    extracted_session_id = response_path(response_body, mapping.get("session_id_path") or "")
    effective_session_id = str(extracted_session_id or session_id)
    result: dict[str, Any] = {
        "index": turn_index,
        "technical_index": max(0, turn_index - 1),
        "role": "user",
        "message": message,
        "request": request_payload,
        "response": response_body,
        "responseText": response_text,
        "statusCode": status_code,
        "latencyMs": latency_ms,
        "status": "PASSED" if passed else "FAILED",
        "response_json_valid": response_json_valid,
        "session_id": effective_session_id,
        "session_id_extracted": bool(extracted_session_id),
        "response_format": response_format,
        "response_type": "json" if response_json_valid else "text",
        "response_headers": _safe_chatbot_value(response_headers),
        "extraction_error": extraction_error or None,
        "response_truncated": response_truncated,
    }
    if dynamic_variables is not None:
        result["dynamic_variables"] = {
            "seed": dynamic_variables.seed,
            "values": dict(dynamic_variables.values),
            "occurrences": list(dynamic_variables.occurrences),
        }
    result.update(extract_chatbot_tool_evidence(response_body, config))
    if error:
        result["error"] = error
    return result

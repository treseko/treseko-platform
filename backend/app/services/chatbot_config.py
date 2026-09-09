"""Canonical configuration helpers for conversational test cases.

The first Chatbot implementation stored most fields at the root of the JSON
payload.  This module keeps those cases executable while giving the Engine a
stable v2 shape for connection, profile, conversation, tools and evaluation.
"""

from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Any, Dict, Iterable

from .chatbot_profiles import SYSTEM_CHATBOT_PROFILES


CHATBOT_SCHEMA_VERSION = 2
CHATBOT_ENV_SCHEMA_VERSION = 1
SUPPORTED_HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
SUPPORTED_TOOL_OBSERVATION_MODES = {"response_payload", "black_box", "external_trace"}
SUPPORTED_CHATBOT_ADAPTERS = {"http", "generic_http", "openai_compatible"}
SUPPORTED_RESPONSE_FORMATS = {"auto", "json", "text"}
SUPPORTED_SESSION_MODES = {"reuse", "new_each_turn"}
_VARIABLE_PATTERN = re.compile(r"{{\s*([^{}]+?)\s*}}")

# Safe, reusable personas available to every QA environment.  They are
# intentionally generic: credentials, business data and goals belong to the
# selected dataset or to the case override.
def _as_dict(value: Any) -> dict[str, Any]:
    return deepcopy(value) if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return deepcopy(value) if isinstance(value, list) else []


def _profile_id(value: Any, index: int) -> str:
    raw = str(value or '').strip().lower()
    normalized = re.sub(r'[^a-z0-9]+', '_', raw).strip('_')
    return normalized or f'profile_{index + 1}'


def _normalize_reusable_profiles(value: Any) -> list[dict[str, Any]]:
    """Normalize environment profile presets without constraining profile fields."""
    if isinstance(value, dict):
        entries = [
            {"id": key, "name": key, "profile": item}
            for key, item in value.items()
        ]
    elif isinstance(value, list):
        entries = value
    else:
        return []

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(entries):
        if not isinstance(item, dict):
            continue
        profile = item.get('profile') or item.get('values') or item.get('perfil')
        if not isinstance(profile, dict):
            profile = {
                key: deepcopy(value)
                for key, value in item.items()
                if key not in {'id', 'name', 'description', 'profile', 'values', 'perfil'}
            }
        name = str(item.get('name') or item.get('label') or item.get('id') or f'Perfil {index + 1}').strip()
        identifier = _profile_id(item.get('id') or name, index)
        normalized.append({
            'id': identifier,
            'name': name,
            'description': str(item.get('description') or '').strip(),
            'profile': deepcopy(profile),
        })
    return normalized


def _first_non_empty(*values: Any, default: Any = None) -> Any:
    for value in values:
        if value is not None and value != "":
            return value
    return default


def _legacy_turn(turn: Any, index: int) -> dict[str, Any]:
    raw = _as_dict(turn)
    message = _first_non_empty(raw.get("message"), raw.get("content"), raw.get("mensaje"), default="")
    mode = _first_non_empty(raw.get("input_mode"), raw.get("mode"), default="fixed")
    input_payload = _as_dict(raw.get("input"))
    input_payload.setdefault("mode", mode if mode in {"fixed", "profile_generated"} else "fixed")
    input_payload.setdefault("text", message)
    expected = _as_dict(raw.get("expected"))
    for key in ("semantic", "must_include", "must_not_include", "regex", "json_path", "schema"):
        if key in raw and key not in expected:
            expected[key] = raw[key]
    if raw.get("expected_response") is not None and "semantic" not in expected:
        expected["semantic"] = raw["expected_response"]
    result = {
        "order": int(raw.get("order") or raw.get("index") or index + 1),
        "role": str(raw.get("role") or "user"),
        "input": input_payload,
        "assertions": _as_list(raw.get("assertions")),
    }
    if expected:
        result["expected"] = expected
    return result


def _normalize_tool_contract(value: Any) -> dict[str, Any]:
    """Normalize tool observability without changing the legacy contract."""
    raw = _as_dict(value)
    observation = _as_dict(raw.get("observation"))
    legacy_required = raw.get("require_observable") is True
    mode = str(observation.get("mode") or ("response_payload" if legacy_required else "black_box")).strip().lower()
    if mode not in SUPPORTED_TOOL_OBSERVATION_MODES:
        mode = "black_box"
    observation["mode"] = mode
    observation["required"] = bool(observation.get("required", legacy_required))
    for key in ("tool_calls_path", "tool_result_path"):
        if observation.get(key) is not None:
            observation[key] = str(observation[key]).strip()
    result = deepcopy(raw)
    result["observation"] = observation
    # Keep this field for old consumers, but make the canonical observation
    # object the source of truth for new execution code.
    result["require_observable"] = mode == "response_payload" and observation["required"]
    return result


def normalize_chatbot_config(value: Dict[str, Any] | None) -> dict[str, Any]:
    """Return a defensive, canonical v2 config while preserving extra fields."""
    raw = _as_dict(value)
    if not raw:
        return {}
    if isinstance(raw.get("connection"), dict):
        result = deepcopy(raw)
    else:
        result = deepcopy(raw)
        result["connection"] = {
            "adapter": str(raw.get("adapter") or "http"),
            "endpoint": _first_non_empty(raw.get("endpoint"), raw.get("url"), default=""),
            "base_url": raw.get("base_url"),
            "method": str(raw.get("method") or "POST").upper(),
            "headers": _as_dict(raw.get("headers")),
            "request_template": deepcopy(raw.get("request_template") or raw.get("request_body") or {}),
            "response_mapping": _as_dict(raw.get("response_mapping") or raw.get("responseMapping")),
            "timeout_ms": raw.get("timeout_ms", 30000),
            "retries": raw.get("retries", 0),
        }
    connection = _as_dict(result.get("connection"))
    connection["adapter"] = str(connection.get("adapter") or "http").strip().lower().replace("-", "_")
    if connection["adapter"] == "generic":
        connection["adapter"] = "generic_http"
    connection.setdefault("method", "POST")
    connection.setdefault("headers", {})
    mapping = _as_dict(connection.get("response_mapping") or connection.get("responseMapping") or raw.get("response_mapping") or raw.get("responseMapping"))
    mapping["response_format"] = str(mapping.get("response_format") or "auto").strip().lower()
    for key in ("message_path", "session_id_path", "tool_calls_path", "tool_result_path"):
        if mapping.get(key) is not None:
            mapping[key] = str(mapping[key]).strip()
    connection["response_mapping"] = mapping
    connection.setdefault("timeout_ms", 30000)
    connection.setdefault("retries", 0)
    result["connection"] = connection

    if not isinstance(result.get("profile"), dict):
        result["profile"] = _as_dict(raw.get("perfil"))

    conversation = _as_dict(result.get("conversation"))
    legacy_turns = raw.get("turns") or raw.get("turnos") or []
    turns = conversation.get("turns") if isinstance(conversation.get("turns"), list) else legacy_turns
    conversation["session_mode"] = str(conversation.get("session_mode") or raw.get("session_mode") or "reuse").strip().lower()
    opening = conversation.get("opening_message")
    if not isinstance(opening, dict):
        opening_text = _first_non_empty(
            raw.get("opening_message"),
            raw.get("initial_message"),
            raw.get("mensaje_inicial"),
        )
        opening = {"mode": "fixed", "text": opening_text} if opening_text else {}
    else:
        opening = deepcopy(opening)
        opening.setdefault("mode", "fixed")
    conversation["opening_message"] = opening
    normalized_turns = [_legacy_turn(turn, index) for index, turn in enumerate(turns)]
    # The opening message is also materialized as the first turn when a v2
    # payload has no explicit turns. Keep the original opening value as
    # backwards-compatible metadata: readers and report consumers still use
    # it, while executors use the canonical ordered stream.
    if not normalized_turns and str(opening.get("text") or "").strip():
        normalized_turns = [{
            "order": 1,
            "role": str(opening.get("role") or "user"),
            "input": {"mode": str(opening.get("mode") or "fixed"), "text": str(opening.get("text") or "")},
            "expected": _as_dict(opening.get("expected")),
            "assertions": _as_list(opening.get("assertions")),
        }]
    conversation["turns"] = normalized_turns
    conversation["memory_checks"] = _as_list(conversation.get("memory_checks") or raw.get("memory_checks"))
    result["conversation"] = conversation

    if not isinstance(result.get("tools"), list):
        result["tools"] = _as_list(raw.get("tool_contracts"))
    result["tools"] = [_normalize_tool_contract(item) for item in result.get("tools", []) if isinstance(item, dict)]

    evaluation = _as_dict(result.get("evaluation"))
    deterministic = _as_dict(evaluation.get("deterministic"))
    legacy_security = _as_dict(raw.get("security") or raw.get("seguridad"))
    forbidden = _first_non_empty(
        deterministic.get("forbidden_patterns"),
        legacy_security.get("forbidden_response_patterns"),
        default=[],
    )
    deterministic["forbidden_patterns"] = _as_list(forbidden)
    deterministic.setdefault("required_validations", [])
    evaluation["deterministic"] = deterministic
    semantic = _as_dict(evaluation.get("semantic"))
    legacy_judge = _as_dict(evaluation.get("llm_judge") or raw.get("llm_judge"))
    if legacy_judge and "enabled" not in semantic:
        semantic["enabled"] = legacy_judge.get("enabled", False)
    if legacy_judge and "criteria" not in semantic:
        semantic["criteria"] = legacy_judge.get("criteria") or legacy_judge.get("rubric") or []
    if legacy_judge and "minimum_score" not in semantic:
        minimum = legacy_judge.get("min_score")
        semantic["minimum_score"] = (float(minimum) / 100) if isinstance(minimum, (int, float)) and minimum > 1 else (minimum or 0.8)
    semantic.setdefault("enabled", False)
    semantic.setdefault("criteria", [])
    semantic.setdefault("minimum_score", 0.8)
    evaluation["semantic"] = semantic
    result["evaluation"] = evaluation
    if "profiles" in raw or "perfiles" in raw:
        result["profiles"] = _normalize_reusable_profiles(raw.get("profiles") or raw.get("perfiles"))
    if raw.get("default_profile") or raw.get("defaultProfile"):
        result["default_profile"] = str(raw.get("default_profile") or raw.get("defaultProfile"))
    if raw.get("profile_id") or raw.get("profile_ref"):
        result["profile_id"] = str(raw.get("profile_id") or raw.get("profile_ref"))
    result["schema_version"] = CHATBOT_SCHEMA_VERSION
    return result


def normalize_environment_chatbot_config(value: Dict[str, Any] | None) -> dict[str, Any]:
    """Normalize the reusable technical contract stored on an environment."""
    raw = _as_dict(value)
    if not raw:
        return {}
    connection = _as_dict(raw.get("connection"))
    # Accept the same root keys for a small compatibility window when an
    # environment configuration was created by an early 1.0.3 client.
    for key in ("adapter", "endpoint", "base_url", "model", "method", "headers", "request_template", "request_body", "response_mapping", "responseMapping", "timeout_ms", "retries"):
        if key not in connection and key in raw:
            connection[key] = deepcopy(raw[key])
    connection["adapter"] = str(connection.get("adapter") or "http").strip().lower().replace("-", "_")
    if connection["adapter"] == "generic":
        connection["adapter"] = "generic_http"
    connection["method"] = str(connection.get("method") or "POST").upper()
    connection.setdefault("headers", {})
    connection.setdefault("request_template", {})
    mapping = _as_dict(connection.get("response_mapping") or connection.get("responseMapping"))
    mapping["response_format"] = str(mapping.get("response_format") or "auto").strip().lower()
    for key in ("message_path", "session_id_path", "tool_calls_path", "tool_result_path"):
        if mapping.get(key) is not None:
            mapping[key] = str(mapping[key]).strip()
    connection["response_mapping"] = mapping
    connection.setdefault("timeout_ms", 30000)
    connection.setdefault("retries", 0)
    profiles = _normalize_reusable_profiles(raw.get("profiles") or raw.get("perfiles"))
    if not profiles:
        profiles = deepcopy(SYSTEM_CHATBOT_PROFILES)
    default_profile = raw.get("default_profile") or raw.get("defaultProfile") or profiles[0]["id"]
    return {
        "schema_version": CHATBOT_ENV_SCHEMA_VERSION,
        "connection": connection,
        "profile_bindings": _as_dict(raw.get("profile_bindings") or raw.get("profileBindings")),
        "profiles": profiles,
        "default_profile": str(default_profile),
        **({"defaults": _as_dict(raw.get("defaults"))} if isinstance(raw.get("defaults"), dict) else {}),
    }


def _merge_section(base: dict[str, Any], override: dict[str, Any], key: str) -> None:
    if not isinstance(override.get(key), dict):
        return
    current = _as_dict(base.get(key))
    current.update(deepcopy(override[key]))
    base[key] = current


def merge_chatbot_config(environment_value: Dict[str, Any] | None, case_value: Dict[str, Any] | None) -> dict[str, Any]:
    """Merge environment contract with explicit, scenario-level case overrides."""
    environment = normalize_environment_chatbot_config(environment_value)
    raw_case = _as_dict(case_value)
    if not raw_case:
        return environment
    result: dict[str, Any] = deepcopy(environment)

    # Only explicit case connection keys override the environment.  Defaults
    # introduced by normalize_chatbot_config must never erase inherited values.
    explicit_connection = _as_dict(raw_case.get("connection"))
    legacy_connection_keys = ("adapter", "endpoint", "url", "base_url", "model", "method", "headers", "request_template", "request_body", "response_mapping", "responseMapping", "timeout_ms", "retries")
    if any(key in raw_case for key in legacy_connection_keys):
        explicit_connection = {
            **explicit_connection,
            **{key: deepcopy(raw_case[key]) for key in legacy_connection_keys if key in raw_case},
        }
    if explicit_connection:
        connection = _as_dict(result.get("connection"))
        if isinstance(explicit_connection.get("headers"), dict):
            connection["headers"] = {**_as_dict(connection.get("headers")), **deepcopy(explicit_connection["headers"])}
        if isinstance(explicit_connection.get("response_mapping"), dict):
            connection["response_mapping"] = {**_as_dict(connection.get("response_mapping")), **deepcopy(explicit_connection["response_mapping"])}
        if isinstance(explicit_connection.get("responseMapping"), dict):
            connection["response_mapping"] = {**_as_dict(connection.get("response_mapping")), **deepcopy(explicit_connection["responseMapping"])}
        connection.update({key: deepcopy(value) for key, value in explicit_connection.items() if key not in {"headers", "response_mapping", "responseMapping", "request_body"}})
        if "request_body" in explicit_connection and "request_template" not in explicit_connection:
            connection["request_template"] = deepcopy(explicit_connection["request_body"])
        result["connection"] = connection

    if isinstance(raw_case.get("profile"), dict) or isinstance(raw_case.get("perfil"), dict):
        # An empty profile is a valid explicit no-override value.  Do not let
        # the fallback expression turn it into None before dictionary merge;
        # cases inheriting their profile from the environment must remain
        # executable after normalization.
        case_profile = raw_case.get("profile") if isinstance(raw_case.get("profile"), dict) else raw_case.get("perfil")
        result["profile"] = {**_as_dict(result.get("profile")), **_as_dict(case_profile)}
    if raw_case.get("profile_id") or raw_case.get("profile_ref"):
        result["profile_id"] = str(raw_case.get("profile_id") or raw_case.get("profile_ref"))
    if any(key in raw_case for key in ("conversation", "turns", "turnos", "opening_message", "initial_message", "mensaje_inicial", "session_mode", "memory_checks")):
        case_normalized = normalize_chatbot_config(raw_case)
        result["conversation"] = deepcopy(case_normalized.get("conversation") or {})
    if "tools" in raw_case or "tool_contracts" in raw_case:
        result["tools"] = deepcopy(raw_case.get("tools") if isinstance(raw_case.get("tools"), list) else raw_case.get("tool_contracts") or [])
    if isinstance(raw_case.get("evaluation"), dict):
        case_evaluation = normalize_chatbot_config(raw_case).get("evaluation") or {}
        result["evaluation"] = case_evaluation
    for key in ("workflow", "workflow_override", "workflow_id", "workflow_version", "stop_on_error"):
        if key in raw_case:
            result[key] = deepcopy(raw_case[key])
    # Preserve explicit advanced fields without forcing them into the
    # environment contract.
    for key in ("security", "seguridad", "assertions", "validations", "llm_judge"):
        if key in raw_case:
            result[key] = deepcopy(raw_case[key])
    return normalize_chatbot_config(result)


def _variable_value(name: str, variables: dict[str, Any]) -> tuple[bool, Any]:
    key = str(name or "").strip()
    candidates = [key]
    if "." not in key:
        candidates.extend([f"DATASET.{key}", f"ENV.{key}", f"COMPONENT.{key}", f"CASE.{key}"])
    for candidate in candidates:
        if candidate in variables:
            return True, variables[candidate]
    upper = key.upper()
    for candidate, value in variables.items():
        if str(candidate).upper() in {upper, f"DATASET.{upper}", f"ENV.{upper}", f"COMPONENT.{upper}", f"CASE.{upper}"}:
            return True, value
    return False, None


def _coerce_variable(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    raw = value.strip()
    if raw.lower() in {"true", "false"}:
        return raw.lower() == "true"
    if raw and raw[0] in "[{\"" or raw in {"null"}:
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            pass
    try:
        if "." in raw:
            return float(raw)
        return int(raw)
    except (TypeError, ValueError):
        return value


def resolve_chatbot_profile(config: Dict[str, Any], variables: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Resolve free-form dataset keys into the canonical profile fields."""
    selected_id = config.get("profile_id") or config.get("default_profile")
    selected_profile = next(
        (item.get("profile") for item in _normalize_reusable_profiles(config.get("profiles"))
         if item.get("id") == selected_id),
        {},
    )
    resolved = _as_dict(selected_profile)
    missing: list[str] = []
    bindings = _as_dict(config.get("profile_bindings"))
    for field, variable_name in bindings.items():
        if not isinstance(variable_name, str) or not variable_name.strip():
            continue
        found, value = _variable_value(variable_name, variables)
        if found:
            resolved[str(field)] = _coerce_variable(value)
        else:
            missing.append(variable_name)
    for field, value in _as_dict(config.get("profile")).items():
        if isinstance(value, str):
            match = _VARIABLE_PATTERN.fullmatch(value.strip())
            if match:
                found, resolved_value = _variable_value(match.group(1), variables)
                if found:
                    resolved[field] = _coerce_variable(resolved_value)
                else:
                    missing.append(match.group(1))
                continue
        resolved[field] = value
    return resolved, sorted(set(missing))


def chatbot_required_variables(config: Dict[str, Any], variables: dict[str, Any]) -> list[str]:
    """Return external variables referenced by the executable contract."""
    references: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, str):
            for match in _VARIABLE_PATTERN.findall(value):
                name = match.strip()
                if name.startswith(("turn.", "session.", "conversation.", "resolved.", "profile.")):
                    continue
                references.add(name)
        elif isinstance(value, dict):
            for key, item in value.items():
                # Bindings are metadata: an absent profile value should be
                # visible to the author, but it must not make an otherwise
                # executable conversation fail.  A case can still make a
                # profile field mandatory by referencing it from its request,
                # turn or assertion.
                if key == "profile_bindings":
                    continue
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(config)
    missing = []
    for reference in sorted(references):
        if reference.strip().startswith("$"):
            continue
        found, value = _variable_value(reference, variables)
        if not found:
            missing.append(reference)
    return missing


def chatbot_config_errors(value: Dict[str, Any] | None) -> list[str]:
    from .chatbot_config_validation import chatbot_config_errors as validate

    return validate(value)


def is_chatbot_config_executable(value: Dict[str, Any] | None) -> bool:
    return not chatbot_config_errors(value)

"""Deterministic evaluation for manual Chatbot executions.

Manual execution does not invoke the IA judge, but it must still preserve the
same deterministic evidence contract used by automated Chatbot runs.
"""

from __future__ import annotations

import re
from typing import Any


NO_RESPONSE = "NO_RESPONSE"
HTTP_FAILURE = "HTTP_FAILURE"
SAFETY_VIOLATION = "SAFETY_VIOLATION"
TURN_EXPECTATION_MISMATCH = "TURN_EXPECTATION_MISMATCH"
INVALID_RESPONSE = "INVALID_RESPONSE"


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


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


def _compare(actual: Any, assertion: dict[str, Any]) -> bool:
    expected = assertion.get("expected", assertion.get("value", assertion.get("equals")))
    operator = str(assertion.get("operator") or assertion.get("op") or assertion.get("type") or "contains").lower()
    actual_text = str(actual if actual is not None else "")
    expected_text = str(expected if expected is not None else "")
    if operator == "exists":
        return actual is not None
    if operator in {"equals", "eq"}:
        return actual == expected
    if operator in {"not_equals", "neq"}:
        return actual != expected
    if operator == "regex":
        try:
            return bool(re.search(expected_text, actual_text))
        except re.error:
            return False
    if operator in {"not_contains", "does_not_contain"}:
        return expected_text.lower() not in actual_text.lower()
    if operator in {"json_path", "jsonpath"}:
        nested = _path_value(actual, str(assertion.get("path") or assertion.get("json_path") or ""))
        return _compare(nested, {**assertion, "operator": assertion.get("inner_operator") or "contains"})
    if operator in {"json_schema", "schema"}:
        return isinstance(actual, dict)
    return expected_text.lower() in actual_text.lower()


def _configured_turn(config: dict[str, Any], technical_index: int) -> dict[str, Any]:
    conversation = _as_dict(config.get("conversation"))
    turns = _as_list(conversation.get("turns"))
    value = turns[technical_index] if 0 <= technical_index < len(turns) else {}
    return _as_dict(value)


def _response_format(config: dict[str, Any]) -> str:
    connection = _as_dict(config.get("connection"))
    mapping = connection.get("response_mapping") or connection.get("responseMapping") or config.get("response_mapping") or config.get("responseMapping")
    mapping = _as_dict(mapping)
    return str(mapping.get("response_format") or "auto").strip().lower()


def _response_is_valid(turn: dict[str, Any], config: dict[str, Any], response_text: str, response: Any) -> bool:
    """Treat extracted plain text as valid for auto/text response modes."""
    if turn.get("response_json_valid") is not False:
        return True
    if _response_format(config) in {"auto", "text"}:
        return bool(str(response_text).strip()) and not turn.get("extraction_error") and (response is not None or bool(str(response_text).strip()))
    return False


def _append_assertion(assertions: list[dict[str, Any]], *, rule: str, expected: Any, actual: Any, passed: bool, source: str = "message", operator: str = "contains") -> None:
    assertions.append({
        "rule": rule,
        "source": source,
        "operator": operator,
        "expected": expected,
        "actual": actual,
        "passed": passed,
    })


def evaluate_manual_chatbot_turn(
    turn: dict[str, Any],
    config: dict[str, Any],
    technical_index: int,
    previous_turns: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Annotate one manual turn with deterministic assertions and a finding."""
    previous_turns = previous_turns or []
    response_text = turn.get("responseText") or turn.get("response_text") or ""
    response = turn.get("response")
    status_code = int(turn.get("statusCode") or turn.get("status_code") or 0)
    error = str(turn.get("error") or "")
    assertions: list[dict[str, Any]] = []
    configured = _configured_turn(config, technical_index)
    expected = _as_dict(configured.get("expected"))
    explicit_assertions = _as_list(configured.get("assertions"))
    deterministic = _as_dict(_as_dict(config.get("evaluation")).get("deterministic"))
    global_assertions = _as_list(config.get("assertions")) + _as_list(config.get("validations")) + _as_list(deterministic.get("assertions"))

    for value in _as_list(expected.get("must_include")):
        passed = _compare(response_text, {"expected": value, "operator": "contains"})
        _append_assertion(assertions, rule="must_include", expected=value, actual=response_text, passed=passed)
    for value in _as_list(expected.get("must_not_include")):
        passed = _compare(response_text, {"expected": value, "operator": "not_contains"})
        _append_assertion(assertions, rule="must_not_include", expected=value, actual=response_text, passed=passed, operator="not_contains")
    if expected.get("regex") is not None:
        passed = _compare(response_text, {"expected": expected.get("regex"), "operator": "regex"})
        _append_assertion(assertions, rule="regex", expected=expected.get("regex"), actual=response_text, passed=passed, operator="regex")

    for raw_assertion in [*explicit_assertions, *global_assertions]:
        assertion = _as_dict(raw_assertion) if isinstance(raw_assertion, dict) else {"expected": raw_assertion}
        source = str(assertion.get("source") or assertion.get("path") or "message")
        actual = response_text if source.lower() == "message" else _path_value(response, assertion.get("path") or source)
        passed = _compare(actual, assertion)
        _append_assertion(
            assertions,
            rule=str(assertion.get("rule") or "assertion"),
            expected=assertion.get("expected", assertion.get("value", assertion.get("equals"))),
            actual=actual,
            passed=passed,
            source=source,
            operator=str(assertion.get("operator") or assertion.get("op") or "contains"),
        )

    required_validations = _as_list(deterministic.get("required_validations"))
    if "response_not_empty" in required_validations:
        _append_assertion(assertions, rule="response_not_empty", expected=True, actual=bool(str(response_text).strip()), passed=bool(str(response_text).strip()), operator="exists")
    if "no_loop" in required_validations and previous_turns:
        previous_response = previous_turns[-1].get("responseText") or previous_turns[-1].get("response_text") or ""
        passed = str(response_text) != str(previous_response)
        _append_assertion(assertions, rule="no_loop", expected="respuesta diferente al turno anterior", actual=response_text, passed=passed)

    safety_match = None
    for pattern in _as_list(deterministic.get("forbidden_patterns")):
        try:
            matched = bool(re.search(str(pattern), str(response_text), flags=re.IGNORECASE))
        except re.error:
            matched = True
        _append_assertion(assertions, rule="forbidden_pattern", expected=pattern, actual=response_text, passed=not matched, operator="not_contains")
        if matched and safety_match is None:
            safety_match = pattern

    timeout = "timeout" in error.lower() or "timed out" in error.lower()
    has_response = bool(str(response_text).strip()) or response is not None
    response_valid = _response_is_valid(turn, config, str(response_text), response)
    failed_assertions = [item for item in assertions if item.get("passed") is False]
    if timeout or status_code == 0:
        failure_type = NO_RESPONSE
    elif status_code >= 400:
        failure_type = HTTP_FAILURE
    elif safety_match is not None:
        failure_type = SAFETY_VIOLATION
    elif failed_assertions:
        failure_type = TURN_EXPECTATION_MISMATCH
    elif not has_response or not response_valid:
        failure_type = INVALID_RESPONSE
    else:
        failure_type = None

    turn["assertions"] = assertions
    turn["failure_type"] = failure_type
    turn["status"] = "FAILED" if failure_type else "PASSED"
    turn["technical_index"] = technical_index
    semantic = _as_dict(_as_dict(config.get("evaluation")).get("semantic"))
    turn["automatic_evaluation"] = {
        "status": turn["status"],
        "failure_type": failure_type,
        "requires_human_review": bool(semantic.get("enabled") or expected.get("semantic")),
    }
    return turn


def manual_result_suggestion(result: dict[str, Any]) -> tuple[str, str | None]:
    turns = _as_list(result.get("turns"))
    failed = [turn for turn in turns if str(turn.get("status") or "").upper() == "FAILED"]
    if not failed:
        return "PASO", None
    failure_types = [str(turn.get("failure_type") or "") for turn in failed]
    if NO_RESPONSE in failure_types:
        return "BLOQUEADO", NO_RESPONSE
    return "FALLO", next((item for item in failure_types if item), INVALID_RESPONSE)

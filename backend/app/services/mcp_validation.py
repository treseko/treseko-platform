from __future__ import annotations
from typing import Any
from uuid import UUID
from jsonschema import Draft7Validator, FormatChecker


class InvalidToolArguments(ValueError):
    def __init__(self, field: str, constraint: str):
        self.field = field[:120]
        self.constraint = constraint[:40]
        super().__init__(f"{self.field}: incumple {self.constraint}")


def validate_tool_arguments(tool: Any, arguments: Any):
    """Use the published JSON Schema as the single admission contract."""
    if not isinstance(arguments, dict):
        raise InvalidToolArguments("arguments", "object")
    result = dict(arguments)
    for key, definition in tool.input_schema.get("properties", {}).items():
        if definition.get("format") == "uuid" and isinstance(result.get(key), str):
            result[key] = result[key].strip()
    if isinstance(result.get("idempotency_key"), str):
        result["idempotency_key"] = result["idempotency_key"].strip()
    error = next(Draft7Validator(tool.input_schema, format_checker=FormatChecker()).iter_errors(result), None)
    if error is not None:
        path = ".".join(str(part) for part in error.absolute_path)
        if error.validator == "required" and isinstance(error.instance, dict):
            missing = next((key for key in error.validator_value if key not in error.instance), None)
            if missing:
                path = ".".join(part for part in (path, str(missing)) if part)
        raise InvalidToolArguments(".".join(part for part in ("arguments", path) if part), str(error.validator))
    for key, definition in tool.input_schema.get("properties", {}).items():
        if definition.get("format") == "uuid" and key in result:
            result[key] = str(UUID(result[key]))
    return result


def sanitize_arguments(value: Any, *, depth: int = 0) -> Any:
    """Bound and redact audit arguments; never persist a prompt or secret."""
    secret_tokens = ("token", "secret", "password", "api_key", "authorization", "cookie", "content_base64")
    if depth > 4:
        return "[max-depth]"
    if isinstance(value, dict):
        result = {}
        for key, item in list(value.items())[:32]:
            key_text = str(key)[:80]
            result[key_text] = "[redacted]" if any(token in key_text.lower() for token in secret_tokens) else sanitize_arguments(item, depth=depth + 1)
        return result
    if isinstance(value, list):
        return [sanitize_arguments(item, depth=depth + 1) for item in value[:32]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value if not isinstance(value, str) else value[:500]
    return str(value)[:200]

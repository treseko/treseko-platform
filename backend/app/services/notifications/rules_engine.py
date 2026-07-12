from typing import Any


SEVERITY_ORDER = {"INFO": 0, "BAJA": 1, "MEDIA": 2, "ALTA": 3, "CRITICA": 4, "CRITICAL": 4}


def resolve_path(data: dict[str, Any], path: str) -> Any:
    current: Any = data
    for part in (path or "").split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def condition_matches(condition: dict[str, Any], context: dict[str, Any]) -> bool:
    field_value = resolve_path(context, condition.get("field", ""))
    op = condition.get("op")
    expected = condition.get("value")
    if op == "equals":
        return field_value == expected
    if op == "not_equals":
        return field_value != expected
    if op == "in":
        return field_value in (expected or [])
    if op == "not_in":
        return field_value not in (expected or [])
    if op == "contains":
        return str(expected or "") in str(field_value or "")
    if op == "exists":
        return field_value is not None
    if op == "severity_at_least":
        return SEVERITY_ORDER.get(str(field_value or "").upper(), 0) >= SEVERITY_ORDER.get(str(expected or "").upper(), 0)
    if op == "changed_to":
        return resolve_path(context, "payload.new_value") == expected or field_value == expected
    return False


def rule_matches(rule: Any, event: Any) -> bool:
    if not getattr(rule, "enabled", False):
        return False
    if event.event_type not in (rule.event_types or []):
        return False
    if rule.scope == "PROYECTO" and rule.proyecto_id and rule.proyecto_id != event.proyecto_id:
        return False
    if rule.scope == "ORGANIZACION" and rule.organizacion_id and rule.organizacion_id != event.organizacion_id:
        return False
    conditions = rule.conditions_json or {}
    context = {"payload": event.payload_json or {}, "event": {"event_type": event.event_type, "severity": event.severity}}
    all_conditions = conditions.get("all") or []
    any_conditions = conditions.get("any") or []
    if all_conditions and not all(condition_matches(item, context) for item in all_conditions):
        return False
    if any_conditions and not any(condition_matches(item, context) for item in any_conditions):
        return False
    return True

"""Shared turn-index normalization for conversational executions.

The public/UI contract is zero-based for ``chatbot_turn_index`` while the
stored transport record historically exposes a one-based ``index``.  Keeping
the conversion here prevents creation, linking and evidence generation from
implementing subtly different rules.
"""

from typing import Any


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def configured_turn_index(item: dict[str, Any], fallback: int) -> int:
    """Return the technical index for a configured turn."""
    explicit = _as_int(item.get("technical_index"))
    if explicit is not None and explicit >= 0:
        return explicit
    order = _as_int(item.get("order"))
    if order is not None and order > 0:
        return order - 1
    return fallback


def executed_turn_index(item: dict[str, Any], fallback: int) -> int:
    """Return the technical index for an observed turn.

    New executions persist ``technical_index``. Legacy manual and engine
    records use ``index`` as a visible one-based number, so they are mapped
    back to the zero-based API contract.
    """
    explicit = _as_int(item.get("technical_index"))
    if explicit is not None and explicit >= 0:
        return explicit
    visible = _as_int(item.get("index", item.get("turn_index")))
    if visible is not None and visible > 0:
        return visible - 1
    return fallback


def find_executed_turn(turns: Any, technical_index: int) -> dict[str, Any] | None:
    if not isinstance(turns, list) or technical_index < 0:
        return None
    for position, item in enumerate(turns):
        if isinstance(item, dict) and executed_turn_index(item, position) == technical_index:
            return item
    return None

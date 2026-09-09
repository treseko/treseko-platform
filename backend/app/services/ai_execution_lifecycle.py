"""Small, database-independent policies for AI execution lifecycle transitions.

The persistence layer owns locking and commits; these functions make the
terminal-state policy explicit and easy to exercise without PostgreSQL.
"""
from __future__ import annotations

from ..domain_models.enums import EstadoResultado, ExecutionMode


ACTIVE_AI_STATE = EstadoResultado.EJECUTANDO_AI


def can_accept_terminal_result(current_state: EstadoResultado) -> bool:
    """Only an active execution may accept a terminal writer."""
    return current_state == ACTIVE_AI_STATE


def resolve_queued_execution_mode(payload: object) -> ExecutionMode:
    """Read the immutable queue mode, with a safe legacy default."""
    if isinstance(payload, dict):
        value = payload.get("execution_mode")
        try:
            return ExecutionMode(str(value))
        except (TypeError, ValueError):
            pass
    return ExecutionMode.IA


def terminal_report_metadata(
    *,
    delivery_id: str,
    completed_via: str,
    human_review_required: bool,
) -> dict[str, object]:
    """Build common terminal metadata for callback, timeout and WebSocket."""
    return {
        "report_complete": True,
        "report_delivery_status": "complete",
        "completed_via": completed_via,
        "terminal_delivery_id": delivery_id,
        "terminal_sequence": 1,
        "human_review_required": human_review_required,
    }

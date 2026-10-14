"""Keep whole-run filtering and the visible result on the same precedence."""
from sqlalchemy import case, exists, select
from .. import models

RESULT_ORDER = (
    (models.EstadoResultado.EJECUTANDO_AI, "EN_PROGRESO", "running"),
    (models.EstadoResultado.FALLO, "FALLO", "failed"),
    (models.EstadoResultado.BLOQUEADO, "BLOQUEADO", "blocked"),
    (models.EstadoResultado.PASO, "PASO", "passed"),
)


def run_result_expression():
    return case(*[(exists(select(models.EjecucionCaso.id).where(
        models.EjecucionCaso.test_run_id == models.TestRun.id,
        models.EjecucionCaso.estado_resultado == state,
    ).correlate(models.TestRun)), result) for state, result, _ in RESULT_ORDER], else_="SIN_CORRER")


def summarize_run_result(executions):
    states = {item.estado_resultado for item in executions}
    return next((status for state, _, status in RESULT_ORDER if state in states), "pending")

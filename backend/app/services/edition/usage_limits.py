from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...time_utils import ensure_utc, utc_now
from .entitlement_service import check_limit


WEEKLY_USAGE_WINDOW_DAYS = 7


def _format_usage_reset_time(reset_at: datetime | None) -> str:
    if not reset_at:
        return "La cuota se libera automaticamente cuando salgan ejecuciones de la ventana semanal."
    reset_at = ensure_utc(reset_at)
    now = utc_now()
    remaining = max(reset_at - now, timedelta())
    total_minutes = max(1, int(remaining.total_seconds() // 60))
    days, remainder = divmod(total_minutes, 24 * 60)
    hours, minutes = divmod(remainder, 60)
    parts = []
    if days:
        parts.append(f"{days} dia{'s' if days != 1 else ''}")
    if hours:
        parts.append(f"{hours} h")
    if not parts and minutes:
        parts.append(f"{minutes} min")
    wait = " ".join(parts) or "menos de 1 min"
    reset_label = reset_at.strftime("%Y-%m-%d %H:%M UTC")
    return (
        f"La cuota usa una ventana movil de {WEEKLY_USAGE_WINDOW_DAYS} dias; "
        f"el proximo cupo se libera en {wait} ({reset_label})."
    )


async def _get_solution_name(db: AsyncSession, solution_id: UUID) -> str:
    result = await db.execute(
        select(models.Organizacion.nombre).filter(models.Organizacion.id == solution_id)
    )
    return str(result.scalar_one_or_none() or "la solucion seleccionada")


async def get_weekly_execution_usage(
    db: AsyncSession,
    modes: Iterable[models.ExecutionMode],
    *,
    solution_id: UUID,
) -> tuple[int, datetime | None]:
    mode_values = list(modes)
    since = utc_now() - timedelta(days=WEEKLY_USAGE_WINDOW_DAYS)
    result = await db.execute(
        select(func.count(), func.min(models.EjecucionCaso.fecha_ejecucion))
        .select_from(models.EjecucionCaso)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .join(models.Proyecto, models.Proyecto.id == models.TestRun.proyecto_id)
        .filter(
            models.Proyecto.organizacion_id == solution_id,
            models.EjecucionCaso.execution_mode.in_(mode_values),
            models.EjecucionCaso.fecha_ejecucion >= since,
        )
    )
    count, oldest_execution = result.one()
    reset_at = oldest_execution + timedelta(days=WEEKLY_USAGE_WINDOW_DAYS) if oldest_execution else None
    return int(count or 0), reset_at


async def count_weekly_executions(
    db: AsyncSession,
    modes: Iterable[models.ExecutionMode],
    *,
    solution_id: UUID,
) -> int:
    count, _reset_at = await get_weekly_execution_usage(db, modes, solution_id=solution_id)
    return count


async def enforce_weekly_execution_limit(
    db: AsyncSession,
    limit_id: str,
    modes: Iterable[models.ExecutionMode],
    *,
    solution_id: UUID,
    increment: int = 1,
) -> None:
    if increment <= 0:
        return
    current, reset_at = await get_weekly_execution_usage(db, modes, solution_id=solution_id)
    result = await check_limit(db, limit_id, current, increment=increment, tenant_id=str(solution_id))
    if result["allowed"]:
        return
    limit = result.get("limit")
    label = str(result.get("label") or limit_id)
    edition = str(result.get("edition") or "community").capitalize()
    solution_name = await _get_solution_name(db, solution_id)
    reset_message = _format_usage_reset_time(reset_at)
    detail = (
        f"Limite de Treseko {edition} alcanzado para {label} en {solution_name}. "
        f"Uso actual: {result['current']} de {limit}. "
        f"Esta accion solicita {result['requested']} ejecucion{'es' if result['requested'] != 1 else ''}. "
        f"{reset_message}"
    )
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def enforce_weekly_automated_execution_limit(
    db: AsyncSession,
    *,
    solution_id: UUID,
    increment: int = 1,
) -> None:
    await enforce_weekly_execution_limit(
        db,
        "max_automated_runs_per_week",
        (models.ExecutionMode.AUTOMATIZADA, models.ExecutionMode.EXTERNA),
        solution_id=solution_id,
        increment=increment,
    )


async def enforce_weekly_ai_execution_limit(
    db: AsyncSession,
    *,
    solution_id: UUID,
    increment: int = 1,
) -> None:
    await enforce_weekly_execution_limit(
        db,
        "max_ai_runs_per_week",
        (models.ExecutionMode.IA,),
        solution_id=solution_id,
        increment=increment,
    )

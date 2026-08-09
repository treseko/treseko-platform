"""Persistence boundary for deterministic Quality Intelligence release risk."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..services.release_risk import calculate_release_risk
from ..time_utils import utc_now
from .quality_intelligence import require_current_quality_analysis


def _payload(row: models.ReleaseRiskEvaluation) -> dict[str, Any]:
    baseline = (row.input_json or {}).get("comparison_baseline")
    comparison = {"available": False}
    if isinstance(baseline, dict) and baseline.get("evaluation_id"):
        comparison = {
            "available": True,
            "evaluation_id": baseline["evaluation_id"],
            "build_id": baseline["build_id"],
            "score": baseline["score"],
            "recommendation": baseline["recommendation"],
            "accepted_at": baseline.get("accepted_at"),
            "score_delta": int(row.score) - int(baseline["score"]),
        }
    return {
        "id": row.id,
        "proyecto_id": row.proyecto_id,
        "build_id": row.build_id,
        "algorithm_version": row.algorithm_version,
        "score": row.score,
        "level": row.level,
        "recommendation": row.recommendation,
        "input_hash": row.input_hash,
        "factors": row.factors_json or [],
        "created_at": row.created_at,
        "accepted_at": row.accepted_at,
        "acceptance_note": row.acceptance_note,
        "comparison": comparison,
    }


async def _build_flakiness_counts(
    db: AsyncSession, proyecto_id: UUID, build_id: UUID,
) -> dict[str, int]:
    """Assess flakiness only from normalized observations of this build."""
    from ..services.quality_intelligence import calculate_quality_health

    rows = (await db.execute(
        select(
            models.QualityExecutionObservation.id,
            models.QualityExecutionObservation.case_master_id,
            models.QualityExecutionObservation.resultado,
            models.QualityExecutionObservation.observed_at,
        )
        .where(models.QualityExecutionObservation.proyecto_id == proyecto_id)
        .where(models.QualityExecutionObservation.build_id == build_id)
    )).all()
    series: dict[UUID, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        series[row.case_master_id].append({
            "id": row.id,
            "resultado": row.resultado,
            "observed_at": row.observed_at,
        })
    return dict(Counter(
        calculate_quality_health(observations).classification
        for observations in series.values()
    ))


async def _accepted_baseline(
    db: AsyncSession, proyecto_id: UUID, build_id: UUID,
) -> dict[str, Any] | None:
    """Return the last human-accepted, different-build risk snapshot."""
    row = await db.scalar(
        select(models.ReleaseRiskEvaluation)
        .where(models.ReleaseRiskEvaluation.proyecto_id == proyecto_id)
        .where(models.ReleaseRiskEvaluation.build_id != build_id)
        .where(models.ReleaseRiskEvaluation.accepted_at.is_not(None))
        .order_by(models.ReleaseRiskEvaluation.accepted_at.desc())
    )
    if row is None:
        return None
    return {
        "evaluation_id": str(row.id),
        "build_id": str(row.build_id),
        "score": int(row.score),
        "recommendation": row.recommendation,
        "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
    }


async def _risk_input(db: AsyncSession, proyecto_id: UUID, build_id: UUID) -> dict[str, Any]:
    from .project_metrics import get_project_metrics

    build = await db.scalar(select(models.Build).where(models.Build.id == build_id, models.Build.proyecto_id == proyecto_id))
    if build is None:
        raise ValueError("Build no encontrada para el proyecto.")
    await require_current_quality_analysis(db, proyecto_id)
    metrics = await get_project_metrics(db, proyecto_id=proyecto_id, build_id=build_id)
    evidence = metrics.get("evidence_summary") or {}
    total_evidence = int(evidence.get("total") or 0)
    complete_evidence = int(evidence.get("complete") or 0)
    health_counts = await _build_flakiness_counts(db, proyecto_id, build_id)
    assessable = sum(health_counts.values()) - health_counts.get("INSUFFICIENT_DATA", 0)
    refs = {
        "coverage": [f"build:{build_id}"],
        "executions": [f"build:{build_id}"],
        "bugs": [f"build:{build_id}"],
        "flakiness": [f"quality-observations:build:{build_id}"],
        "evidence": [f"build:{build_id}"],
    }
    return {
        "coverage_percent": metrics.get("cobertura_porcentaje") or 0,
        "failed_cases": (metrics.get("stats") or {}).get("fallados") or 0,
        "blocked_cases": (metrics.get("stats") or {}).get("bloqueados") or 0,
        "pending_cases": (metrics.get("stats") or {}).get("pendientes") or 0,
        "high_open_bugs": (metrics.get("bug_metrics") or {}).get("high_open") or 0,
        "open_bugs": (metrics.get("bug_metrics") or {}).get("open") or 0,
        "flaky_case_rate": round((health_counts.get("FLAKY", 0) / assessable) * 100, 2) if assessable else 0,
        "evidence_complete_percent": round((complete_evidence / total_evidence) * 100, 2) if total_evidence else 0,
        "total_cases": metrics.get("total_casos_asignados") or 0,
        "evidence_refs": refs,
        "comparison_baseline": await _accepted_baseline(db, proyecto_id, build_id),
    }


async def evaluate_release_risk(
    db: AsyncSession, proyecto_id: UUID, build_id: UUID, user_id: UUID,
) -> dict[str, Any]:
    snapshot = await _risk_input(db, proyecto_id, build_id)
    result = calculate_release_risk(snapshot)
    # Input assembly reads several source tables. Re-check while holding the
    # analysis-state lock before reusing or persisting its immutable result.
    await require_current_quality_analysis(db, proyecto_id, lock=True)
    existing = await db.scalar(
        select(models.ReleaseRiskEvaluation)
        .where(models.ReleaseRiskEvaluation.proyecto_id == proyecto_id)
        .where(models.ReleaseRiskEvaluation.build_id == build_id)
        .where(models.ReleaseRiskEvaluation.algorithm_version == result["algorithm_version"])
        .where(models.ReleaseRiskEvaluation.input_hash == result["input_hash"])
        .order_by(models.ReleaseRiskEvaluation.created_at.desc())
    )
    if existing is not None:
        return _payload(existing)
    row = models.ReleaseRiskEvaluation(
        proyecto_id=proyecto_id,
        build_id=build_id,
        algorithm_version=result["algorithm_version"],
        score=result["score"],
        level=result["level"],
        recommendation=result["recommendation"],
        input_hash=result["input_hash"],
        input_json=snapshot,
        factors_json=result["factors"],
        created_by=user_id,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        # A concurrent evaluator wrote the exact immutable snapshot first.
        # Roll back the failed insert and return that canonical row instead.
        await db.rollback()
        existing = await db.scalar(
            select(models.ReleaseRiskEvaluation)
            .where(models.ReleaseRiskEvaluation.proyecto_id == proyecto_id)
            .where(models.ReleaseRiskEvaluation.build_id == build_id)
            .where(models.ReleaseRiskEvaluation.algorithm_version == result["algorithm_version"])
            .where(models.ReleaseRiskEvaluation.input_hash == result["input_hash"])
            .order_by(models.ReleaseRiskEvaluation.created_at.desc())
        )
        if existing is None:
            raise
        return _payload(existing)
    await db.refresh(row)
    return _payload(row)


async def get_latest_release_risk(
    db: AsyncSession, proyecto_id: UUID, build_id: UUID,
) -> dict[str, Any] | None:
    row = await db.scalar(
        select(models.ReleaseRiskEvaluation)
        .where(models.ReleaseRiskEvaluation.proyecto_id == proyecto_id)
        .where(models.ReleaseRiskEvaluation.build_id == build_id)
        .order_by(models.ReleaseRiskEvaluation.created_at.desc())
    )
    return _payload(row) if row else None


async def accept_release_risk(
    db: AsyncSession, proyecto_id: UUID, evaluation_id: UUID, note: str, user_id: UUID,
) -> dict[str, Any] | None:
    row = await db.scalar(
        select(models.ReleaseRiskEvaluation)
        .where(models.ReleaseRiskEvaluation.id == evaluation_id)
        .where(models.ReleaseRiskEvaluation.proyecto_id == proyecto_id)
        .with_for_update()
    )
    if row is None:
        return None
    if row.accepted_at is not None:
        raise ValueError("La aceptación de riesgo ya fue registrada y conserva su snapshot.")
    await require_current_quality_analysis(db, proyecto_id, lock=True)
    row.accepted_by = user_id
    row.accepted_at = utc_now()
    row.acceptance_note = note.strip()
    await db.flush()
    await db.refresh(row)
    return _payload(row)

"""Read-only Quality Intelligence views, separate from the rebuild projection."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..services.quality_intelligence import ALGORITHM_VERSION
from ..time_utils import ensure_utc
from .quality_intelligence import _analysis_state, _analysis_state_payload


async def get_quality_failure_fingerprints(
    db: AsyncSession,
    proyecto_id: UUID,
    *,
    limit: int = 50,
) -> dict[str, Any]:
    """Return only grouped, non-sensitive failure metadata for one project.

    A fingerprint is an operational correlation signal, not a root-cause
    assertion.  The query deliberately returns no error text, logs, URLs or
    attachments; users continue to reach that evidence through the existing
    execution access controls.
    """
    rows = (await db.execute(
        select(
            models.QualityFailureFingerprint,
            func.count(models.QualityExecutionObservation.id).label("observation_count"),
            func.count(func.distinct(models.QualityExecutionObservation.case_master_id)).label("case_count"),
        )
        .outerjoin(
            models.QualityExecutionObservation,
            models.QualityExecutionObservation.failure_fingerprint_id == models.QualityFailureFingerprint.id,
        )
        .where(models.QualityFailureFingerprint.proyecto_id == proyecto_id)
        .group_by(models.QualityFailureFingerprint.id)
        .order_by(
            models.QualityFailureFingerprint.last_seen_at.desc(),
            models.QualityFailureFingerprint.occurrence_count.desc(),
        )
        .limit(max(1, min(int(limit), 200)))
    )).all()
    return {
        "proyecto_id": proyecto_id,
        "algorithm_version": ALGORITHM_VERSION,
        "items": [
            {
                "id": fingerprint.id,
                "fingerprint": fingerprint.fingerprint,
                "signature_version": fingerprint.signature_version,
                "failure_category": fingerprint.failure_category,
                "occurrence_count": int(observation_count),
                "case_count": int(case_count),
                "first_seen_at": fingerprint.first_seen_at,
                "last_seen_at": fingerprint.last_seen_at,
            }
            for fingerprint, observation_count, case_count in rows
        ],
    }


async def get_quality_execution_observations(
    db: AsyncSession,
    proyecto_id: UUID,
    *,
    suite_id: UUID | None = None,
    build_id: UUID | None = None,
    entorno_id: UUID | None = None,
    runner_id: UUID | None = None,
    case_master_id: UUID | None = None,
    resultado: str | None = None,
    observed_from: object | None = None,
    observed_to: object | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Read a bounded, privacy-safe Quality Intelligence execution history.

    The endpoint is intended to investigate deterministic signals by the
    execution dimensions teams actually use (suite, build, environment and
    worker).  It exposes no raw error text, URLs, attachments or credentials.
    """
    normalized_result = str(resultado or "").strip().upper()
    query = (
        select(models.QualityExecutionObservation)
        .where(models.QualityExecutionObservation.proyecto_id == proyecto_id)
        .order_by(
            models.QualityExecutionObservation.observed_at.desc(),
            models.QualityExecutionObservation.id.desc(),
        )
        .limit(max(1, min(int(limit), 500)))
    )
    if suite_id:
        query = query.where(models.QualityExecutionObservation.suite_id == suite_id)
    if build_id:
        query = query.where(models.QualityExecutionObservation.build_id == build_id)
    if entorno_id:
        query = query.where(models.QualityExecutionObservation.entorno_id == entorno_id)
    if runner_id:
        query = query.where(models.QualityExecutionObservation.runner_id == runner_id)
    if case_master_id:
        query = query.where(models.QualityExecutionObservation.case_master_id == case_master_id)
    if normalized_result:
        query = query.where(models.QualityExecutionObservation.resultado == normalized_result)
    if observed_from:
        query = query.where(models.QualityExecutionObservation.observed_at >= ensure_utc(observed_from))
    if observed_to:
        query = query.where(models.QualityExecutionObservation.observed_at <= ensure_utc(observed_to))

    rows = (await db.execute(query)).scalars().all()
    master_ids = {row.case_master_id for row in rows}
    suite_ids = {row.suite_id for row in rows if row.suite_id}
    build_ids = {row.build_id for row in rows if row.build_id}
    environment_ids = {row.entorno_id for row in rows if row.entorno_id}
    runner_ids = {row.runner_id for row in rows if row.runner_id}
    fingerprint_ids = {row.failure_fingerprint_id for row in rows if row.failure_fingerprint_id}

    cases_by_master: dict[UUID, models.CasoPrueba] = {}
    if master_ids:
        cases = (await db.execute(
            select(models.CasoPrueba)
            .where(models.CasoPrueba.proyecto_id == proyecto_id)
            .where(models.CasoPrueba.master_id.in_(master_ids))
            .order_by(models.CasoPrueba.master_id.asc(), models.CasoPrueba.version.desc())
        )).scalars().all()
        for test_case in cases:
            cases_by_master.setdefault(test_case.master_id, test_case)

    async def names_by_id(model: Any, ids: set[UUID]) -> dict[UUID, str]:
        if not ids:
            return {}
        model_rows = (await db.execute(select(model.id, model.nombre).where(model.id.in_(ids)))).all()
        return {item_id: name for item_id, name in model_rows}

    suite_names = await names_by_id(models.Suite, suite_ids)
    build_names = await names_by_id(models.Build, build_ids)
    environment_names = await names_by_id(models.Entorno, environment_ids)
    runner_names = await names_by_id(models.AutomationRunner, runner_ids)
    categories_by_fingerprint: dict[UUID, str] = {}
    if fingerprint_ids:
        fingerprints = (await db.execute(
            select(models.QualityFailureFingerprint.id, models.QualityFailureFingerprint.failure_category)
            .where(models.QualityFailureFingerprint.id.in_(fingerprint_ids))
            .where(models.QualityFailureFingerprint.proyecto_id == proyecto_id)
        )).all()
        categories_by_fingerprint = {item_id: category for item_id, category in fingerprints}

    state = await _analysis_state(db, proyecto_id)
    return {
        "proyecto_id": proyecto_id,
        "algorithm_version": ALGORITHM_VERSION,
        "analysis_scope": "explicit_rebuild_required",
        "items": [
            {
                "id": row.id,
                "ejecucion_caso_id": row.ejecucion_caso_id,
                "case_master_id": row.case_master_id,
                "case_code": cases_by_master.get(row.case_master_id).codigo if row.case_master_id in cases_by_master else None,
                "case_title": cases_by_master.get(row.case_master_id).titulo if row.case_master_id in cases_by_master else None,
                "build_id": row.build_id,
                "build_name": build_names.get(row.build_id),
                "suite_id": row.suite_id,
                "suite_name": suite_names.get(row.suite_id),
                "entorno_id": row.entorno_id,
                "environment_name": environment_names.get(row.entorno_id),
                "runner_id": row.runner_id,
                "runner_name": runner_names.get(row.runner_id),
                "resultado": row.resultado,
                "execution_mode": row.execution_mode,
                "intento_numero": row.intento_numero,
                "duracion_segundos": row.duracion_segundos,
                "observed_at": row.observed_at,
                "failure_fingerprint_id": row.failure_fingerprint_id,
                "failure_category": categories_by_fingerprint.get(row.failure_fingerprint_id),
                "evidence_summary": row.evidence_summary or {},
            }
            for row in rows
        ],
        **_analysis_state_payload(state),
    }

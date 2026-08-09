"""Persisted, deterministic Quality Intelligence projections.

The source of truth remains the execution history.  This module intentionally
rebuilds a derived projection explicitly instead of mutating test results or
silently analysing partial execution paths.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..services.error_sanitizer import sanitize_external_error
from ..services.quality_intelligence import (
    ALGORITHM_VERSION,
    TERMINAL_RESULTS,
    calculate_quality_health,
    canonical_failure_category,
    canonical_result,
    failure_fingerprint,
    quality_scope_key,
)
from ..time_utils import ensure_utc, utc_now


def _quality_execution_mode_value(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw or models.ExecutionMode.MANUAL.value).strip().upper()


def _failure_context(execution: models.EjecucionCaso, snapshots: list[models.SnapshotPaso]) -> str:
    """Select one bounded source for a fingerprint without persisting raw text."""
    report = execution.ai_report if isinstance(execution.ai_report, dict) else {}
    candidates = [
        execution.observaciones,
        report.get("summary"),
        report.get("error"),
    ]
    for snapshot in snapshots:
        if canonical_result(snapshot.estado_paso) in {"FALLO", "BLOQUEADO"}:
            candidates.extend([snapshot.error_log, snapshot.comentarios])
    for value in candidates:
        if str(value or "").strip():
            return sanitize_external_error(value, max_len=1000)
    return ""


def _evidence_summary(snapshots: list[models.SnapshotPaso], failure_context: str) -> dict[str, Any]:
    statuses = [canonical_result(snapshot.estado_paso) for snapshot in snapshots]
    return {
        "source": "execution-snapshot-v1",
        "snapshot_count": len(snapshots),
        "failed_snapshot_count": statuses.count("FALLO"),
        "blocked_snapshot_count": statuses.count("BLOQUEADO"),
        "evidence_reference_count": sum(1 for snapshot in snapshots if bool(snapshot.evidencia_url)),
        "has_failure_context": bool(failure_context),
    }


async def _analysis_state(
    db: AsyncSession,
    proyecto_id: UUID,
    *,
    lock: bool = False,
    create: bool = False,
) -> models.QualityAnalysisState | None:
    query = select(models.QualityAnalysisState).where(models.QualityAnalysisState.proyecto_id == proyecto_id)
    if lock:
        query = query.with_for_update()
    state = await db.scalar(query)
    if state is None and create:
        state = models.QualityAnalysisState(proyecto_id=proyecto_id)
        db.add(state)
        await db.flush()
    return state


def _analysis_state_payload(state: models.QualityAnalysisState | None) -> dict[str, Any]:
    source_revision = int(state.source_revision or 0) if state else 0
    rebuilt_revision = int(state.rebuilt_revision or 0) if state else 0
    return {
        "source_revision": source_revision,
        "rebuilt_revision": rebuilt_revision,
        "is_stale": source_revision > rebuilt_revision,
        "source_updated_at": state.source_updated_at if state else None,
        "rebuilt_at": state.rebuilt_at if state else None,
    }

async def require_current_quality_analysis(
    db: AsyncSession,
    proyecto_id: UUID,
    *,
    lock: bool = False,
) -> models.QualityAnalysisState:
    """Reject decisions derived from a projection that has become stale.

    Rebuilding remains an explicit user action.  This guard ensures that an
    AI draft or a release-risk snapshot cannot silently be created using a
    previous projection after executions or evidence changed.
    """
    state = await _analysis_state(db, proyecto_id, lock=lock, create=True)
    if int(state.source_revision or 0) > int(state.rebuilt_revision or 0):
        raise ValueError("El análisis de calidad está desactualizado. Reconstrúyelo antes de tomar esta decisión.")
    return state

async def rebuild_quality_intelligence(
    db: AsyncSession,
    proyecto_id: UUID,
    *,
    window_size: int = 20,
    commit: bool = True,
) -> dict[str, int | str]:
    """Rebuild quality projections for one project deterministically.

    A project row lock serializes concurrent rebuilds.  The function is safe
    to retry: every observation is keyed by its execution and health is keyed
    by project, case master, scope and algorithm version.
    """
    if window_size < 3 or window_size > 100:
        raise ValueError("window_size debe estar entre 3 y 100")

    project = await db.scalar(
        select(models.Proyecto).where(models.Proyecto.id == proyecto_id).with_for_update()
    )
    if project is None:
        return {"status": "NOT_FOUND", "observations": 0, "health_records": 0, "fingerprints": 0}
    state = await _analysis_state(db, proyecto_id, lock=True, create=True)

    # An execution may be corrected back to a non-terminal state. Its former
    # projection is not source data and must not survive the explicit rebuild.
    stale_execution_ids = (await db.execute(
        select(models.QualityExecutionObservation.ejecucion_caso_id)
        .join(models.EjecucionCaso, models.EjecucionCaso.id == models.QualityExecutionObservation.ejecucion_caso_id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .where(models.TestRun.proyecto_id == proyecto_id)
        .where(models.EjecucionCaso.estado_resultado.notin_([
            models.EstadoResultado.PASO,
            models.EstadoResultado.FALLO,
            models.EstadoResultado.BLOQUEADO,
        ]))
    )).scalars().all()
    if stale_execution_ids:
        await db.execute(
            delete(models.QualityExecutionObservation)
            .where(models.QualityExecutionObservation.ejecucion_caso_id.in_(stale_execution_ids))
        )

    execution_rows = (await db.execute(
        select(models.EjecucionCaso, models.TestRun, models.CasoPrueba, models.Build)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .outerjoin(models.Build, models.Build.id == models.TestRun.build_id)
        .where(models.TestRun.proyecto_id == proyecto_id)
        .where(models.EjecucionCaso.estado_resultado.in_([
            models.EstadoResultado.PASO,
            models.EstadoResultado.FALLO,
            models.EstadoResultado.BLOQUEADO,
        ]))
        .order_by(models.EjecucionCaso.fecha_ejecucion.asc(), models.EjecucionCaso.id.asc())
    )).all()

    execution_ids = [execution.id for execution, _, _, _ in execution_rows]
    snapshots_by_execution: dict[UUID, list[models.SnapshotPaso]] = defaultdict(list)
    if execution_ids:
        snapshots = (await db.execute(
            select(models.SnapshotPaso)
            .where(models.SnapshotPaso.ejecucion_caso_id.in_(execution_ids))
            .order_by(models.SnapshotPaso.numero_paso.asc(), models.SnapshotPaso.id.asc())
        )).scalars().all()
        for snapshot in snapshots:
            snapshots_by_execution[snapshot.ejecucion_caso_id].append(snapshot)

    runner_by_execution: dict[UUID, UUID] = {}
    if execution_ids:
        automation_rows = (await db.execute(
            select(models.AutomationJob.ejecucion_id, models.AutomationJob.runner_id)
            .where(models.AutomationJob.ejecucion_id.in_(execution_ids))
            .where(models.AutomationJob.runner_id.is_not(None))
            .order_by(
                models.AutomationJob.fecha_fin.desc().nulls_last(),
                models.AutomationJob.fecha_claim.desc().nulls_last(),
                models.AutomationJob.id.desc(),
            )
        )).all()
        for execution_id, runner_id in automation_rows:
            if execution_id and runner_id:
                runner_by_execution.setdefault(execution_id, runner_id)

    existing_observations = {}
    if execution_ids:
        rows = (await db.execute(
            select(models.QualityExecutionObservation)
            .where(models.QualityExecutionObservation.ejecucion_caso_id.in_(execution_ids))
        )).scalars().all()
        existing_observations = {row.ejecucion_caso_id: row for row in rows}

    fingerprints = (await db.execute(
        select(models.QualityFailureFingerprint)
        .where(models.QualityFailureFingerprint.proyecto_id == proyecto_id)
    )).scalars().all()
    fingerprints_by_signature = {
        (row.signature_version, row.fingerprint): row
        for row in fingerprints
    }

    created_observations = 0
    skipped_without_timestamp = 0
    for execution, run, case, build in execution_rows:
        observed_at = ensure_utc(execution.fecha_ejecucion or run.fecha_cierre or run.fecha_creacion)
        if observed_at is None:
            skipped_without_timestamp += 1
            continue
        status = canonical_result(execution.estado_resultado)
        snapshot_rows = snapshots_by_execution.get(execution.id, [])
        failure_context = _failure_context(execution, snapshot_rows)
        category = canonical_failure_category(execution.ai_failure_category)
        signature = failure_fingerprint(category=category, error_text=failure_context)
        fingerprint_row = None
        if status in {"FALLO", "BLOQUEADO"} and signature:
            fingerprint_row = fingerprints_by_signature.get((ALGORITHM_VERSION, signature))
            if fingerprint_row is None:
                fingerprint_row = models.QualityFailureFingerprint(
                    proyecto_id=proyecto_id,
                    fingerprint=signature,
                    signature_version=ALGORITHM_VERSION,
                    failure_category=category,
                )
                db.add(fingerprint_row)
                await db.flush()
                fingerprints_by_signature[(ALGORITHM_VERSION, signature)] = fingerprint_row

        component_id = build.componente_id if build and build.componente_id else case.componente_id
        observation = existing_observations.get(execution.id)
        values = {
            "proyecto_id": proyecto_id,
            "build_id": run.build_id,
            "componente_id": component_id,
            "suite_id": case.suite_id,
            "entorno_id": run.entorno_id,
            "runner_id": runner_by_execution.get(execution.id),
            "case_master_id": case.master_id,
            "resultado": status,
            "execution_mode": _quality_execution_mode_value(execution.execution_mode),
            "intento_numero": max(1, int(execution.intento_numero or 1)),
            "duracion_segundos": max(0, int(execution.duracion_segundos or 0)),
            "observed_at": observed_at,
            "failure_fingerprint_id": fingerprint_row.id if fingerprint_row else None,
            "evidence_summary": _evidence_summary(snapshot_rows, failure_context),
            "source_version": "v1",
        }
        if observation is None:
            observation = models.QualityExecutionObservation(ejecucion_caso_id=execution.id, **values)
            db.add(observation)
            created_observations += 1
        else:
            for field, value in values.items():
                setattr(observation, field, value)

    await db.flush()

    fingerprint_counts = (await db.execute(
        select(
            models.QualityExecutionObservation.failure_fingerprint_id,
            func.count(models.QualityExecutionObservation.id),
            func.min(models.QualityExecutionObservation.observed_at),
            func.max(models.QualityExecutionObservation.observed_at),
        )
        .where(models.QualityExecutionObservation.proyecto_id == proyecto_id)
        .where(models.QualityExecutionObservation.failure_fingerprint_id.is_not(None))
        .group_by(models.QualityExecutionObservation.failure_fingerprint_id)
    )).all()
    used_fingerprint_ids = set()
    for fingerprint_id, count, first_seen, last_seen in fingerprint_counts:
        used_fingerprint_ids.add(fingerprint_id)
        fingerprint = next((row for row in fingerprints_by_signature.values() if row.id == fingerprint_id), None)
        if fingerprint:
            fingerprint.occurrence_count = int(count)
            fingerprint.first_seen_at = ensure_utc(first_seen)
            fingerprint.last_seen_at = ensure_utc(last_seen)
    stale_fingerprint_ids = [
        row.id for row in fingerprints_by_signature.values()
        if row.id not in used_fingerprint_ids
    ]
    if stale_fingerprint_ids:
        await db.execute(
            delete(models.QualityFailureFingerprint).where(models.QualityFailureFingerprint.id.in_(stale_fingerprint_ids))
        )

    observations = (await db.execute(
        select(models.QualityExecutionObservation)
        .where(models.QualityExecutionObservation.proyecto_id == proyecto_id)
        .order_by(models.QualityExecutionObservation.observed_at.asc(), models.QualityExecutionObservation.id.asc())
    )).scalars().all()
    observations_by_series: dict[tuple[UUID, str], list[models.QualityExecutionObservation]] = defaultdict(list)
    for observation in observations:
        scope = quality_scope_key(component_id=observation.componente_id, environment_id=observation.entorno_id)
        observations_by_series[(observation.case_master_id, scope)].append(observation)

    existing_health = (await db.execute(
        select(models.QualityCaseHealth)
        .where(models.QualityCaseHealth.proyecto_id == proyecto_id)
        .where(models.QualityCaseHealth.algorithm_version == ALGORITHM_VERSION)
    )).scalars().all()
    health_by_key = {(row.case_master_id, row.scope_key): row for row in existing_health}
    for (case_master_id, scope), series in observations_by_series.items():
        result = calculate_quality_health(series, window_size=window_size)
        selected = series[-window_size:]
        values = {
            "window_size": window_size,
            "total_observations": result.total_observations,
            "passed_count": result.passed_count,
            "failed_count": result.failed_count,
            "blocked_count": result.blocked_count,
            "transition_count": result.transition_count,
            "flaky_score": result.flaky_score,
            "classification": result.classification,
            "evidence_summary": {
                **result.evidence_summary(),
                "observation_ids": [str(item.id) for item in selected],
            },
            "calculated_at": utc_now(),
        }
        health = health_by_key.get((case_master_id, scope))
        if health is None:
            db.add(models.QualityCaseHealth(
                proyecto_id=proyecto_id,
                case_master_id=case_master_id,
                scope_key=scope,
                algorithm_version=ALGORITHM_VERSION,
                **values,
            ))
        else:
            for field, value in values.items():
                setattr(health, field, value)

    active_health_keys = set(observations_by_series)
    stale_health_ids = [
        health.id for key, health in health_by_key.items()
        if key not in active_health_keys
    ]
    if stale_health_ids:
        await db.execute(delete(models.QualityCaseHealth).where(models.QualityCaseHealth.id.in_(stale_health_ids)))

    # The revision is captured while the state row is locked. A concurrent
    # source transaction waits on that row and increments it after this commit,
    # leaving the projection correctly marked stale instead of falsely fresh.
    state.rebuilt_revision = state.source_revision
    state.rebuilt_at = utc_now()
    # API callers include the audit record in this transaction. Maintenance
    # tools retain the historical default of committing the completed rebuild.
    if commit:
        await db.commit()
    else:
        await db.flush()
    return {
        "status": "COMPLETED",
        "observations": len(observations),
        "observations_created": created_observations,
        "health_records": len(observations_by_series),
        "fingerprints": len(fingerprint_counts),
        "skipped_without_timestamp": skipped_without_timestamp,
        "algorithm_version": ALGORITHM_VERSION,
        **_analysis_state_payload(state),
    }

async def get_quality_health(
    db: AsyncSession,
    proyecto_id: UUID,
    *,
    classification: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """Read the latest deterministic health projection without rebuilding it."""
    normalized_classification = str(classification or "").strip().upper()
    query = (
        select(models.QualityCaseHealth)
        .where(models.QualityCaseHealth.proyecto_id == proyecto_id)
        .where(models.QualityCaseHealth.algorithm_version == ALGORITHM_VERSION)
        .order_by(models.QualityCaseHealth.flaky_score.desc(), models.QualityCaseHealth.calculated_at.desc())
        .limit(max(1, min(int(limit), 500)))
    )
    if normalized_classification:
        query = query.where(models.QualityCaseHealth.classification == normalized_classification)
    rows = (await db.execute(query)).scalars().all()
    master_ids = {row.case_master_id for row in rows}
    cases_by_master: dict[UUID, models.CasoPrueba] = {}
    if master_ids:
        cases = (await db.execute(
            select(models.CasoPrueba)
            .where(models.CasoPrueba.proyecto_id == proyecto_id)
            .where(models.CasoPrueba.master_id.in_(master_ids))
            .order_by(models.CasoPrueba.master_id.asc(), models.CasoPrueba.version.desc())
        )).scalars().all()
        for case in cases:
            cases_by_master.setdefault(case.master_id, case)

    items = []
    for row in rows:
        case = cases_by_master.get(row.case_master_id)
        items.append({
            "case_master_id": row.case_master_id,
            "case_code": case.codigo if case else None,
            "case_title": case.titulo if case else None,
            "scope_key": row.scope_key,
            "algorithm_version": row.algorithm_version,
            "classification": row.classification,
            "flaky_score": row.flaky_score,
            "window_size": row.window_size,
            "total_observations": row.total_observations,
            "passed_count": row.passed_count,
            "failed_count": row.failed_count,
            "blocked_count": row.blocked_count,
            "transition_count": row.transition_count,
            "evidence_summary": row.evidence_summary or {},
            "calculated_at": row.calculated_at,
        })
    state = await _analysis_state(db, proyecto_id)
    return {
        "proyecto_id": proyecto_id,
        "algorithm_version": ALGORITHM_VERSION,
        "analysis_scope": "explicit_rebuild_required",
        "items": items,
        **_analysis_state_payload(state),
    }


# Read and diagnostic concerns are intentionally split from the deterministic
# rebuild so migrations and maintenance tools can load the projection alone.
from .quality_intelligence_observations import (
    get_quality_execution_observations,
    get_quality_failure_fingerprints,
)
from .quality_intelligence_diagnoses import (
    create_quality_diagnosis,
    edit_quality_diagnosis,
    get_quality_diagnoses,
    get_quality_diagnosis_bug_draft,
    review_quality_diagnosis,
)

async def get_quality_intelligence_summary(
    db: AsyncSession,
    proyecto_id: UUID,
) -> dict[str, Any]:
    """Summarize the persisted deterministic projection without recalculating it.

    ``flaky_case_rate`` intentionally excludes `INSUFFICIENT_DATA`: a case
    with too little history must not inflate or dilute an actionable rate.
    The values are descriptive quality signals, not a release decision.
    """
    health_counts = {
        str(classification): int(count)
        for classification, count in (await db.execute(
            select(models.QualityCaseHealth.classification, func.count(models.QualityCaseHealth.id))
            .where(models.QualityCaseHealth.proyecto_id == proyecto_id)
            .where(models.QualityCaseHealth.algorithm_version == ALGORITHM_VERSION)
            .group_by(models.QualityCaseHealth.classification)
        )).all()
    }
    observation_count, terminal_duration_seconds, retry_observations = (await db.execute(
        select(
            func.count(models.QualityExecutionObservation.id),
            func.coalesce(func.sum(models.QualityExecutionObservation.duracion_segundos), 0),
            func.coalesce(func.sum(case((models.QualityExecutionObservation.intento_numero > 1, 1), else_=0)), 0),
        )
        .where(models.QualityExecutionObservation.proyecto_id == proyecto_id)
    )).one()
    latest_calculation = await db.scalar(
        select(func.max(models.QualityCaseHealth.calculated_at))
        .where(models.QualityCaseHealth.proyecto_id == proyecto_id)
        .where(models.QualityCaseHealth.algorithm_version == ALGORITHM_VERSION)
    )
    total_health_cases = sum(health_counts.values())
    assessable_cases = total_health_cases - health_counts.get("INSUFFICIENT_DATA", 0)
    flaky_cases = health_counts.get("FLAKY", 0)
    state = await _analysis_state(db, proyecto_id)
    return {
        "proyecto_id": proyecto_id,
        "algorithm_version": ALGORITHM_VERSION,
        "analysis_scope": "explicit_rebuild_required",
        "health_cases": total_health_cases,
        "assessable_cases": assessable_cases,
        "flaky_cases": flaky_cases,
        "blocked_cases": health_counts.get("BLOCKED", 0),
        "stable_cases": health_counts.get("STABLE", 0),
        "mixed_cases": health_counts.get("MIXED", 0),
        "insufficient_data_cases": health_counts.get("INSUFFICIENT_DATA", 0),
        "flaky_case_rate": round((flaky_cases / assessable_cases) * 100, 2) if assessable_cases else None,
        "terminal_observations": int(observation_count),
        "terminal_duration_seconds": int(terminal_duration_seconds),
        "retry_observations": int(retry_observations),
        "calculated_at": latest_calculation,
        **_analysis_state_payload(state),
    }

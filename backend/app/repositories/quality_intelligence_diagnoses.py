"""Human-reviewable Quality Intelligence diagnosis drafts."""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..time_utils import utc_now
from .quality_intelligence import require_current_quality_analysis


def _quality_diagnosis_payload(row: models.QualityDiagnosis) -> dict[str, Any]:
    return {
        "id": row.id, "proyecto_id": row.proyecto_id, "ejecucion_caso_id": row.ejecucion_caso_id,
        "failure_fingerprint_id": row.failure_fingerprint_id, "source_revision": row.source_revision,
        "status": row.status, "facts": row.facts_json or [], "hypotheses": row.hypotheses_json or [],
        "unknowns": row.unknowns_json or [], "recommended_next_steps": row.recommended_next_steps_json or [],
        "evidence_refs": row.evidence_refs_json or [], "provider": row.provider, "model": row.model,
        "prompt_hash": row.prompt_hash, "metrics": row.metrics_json or {}, "created_at": row.created_at,
        "reviewed_at": row.reviewed_at, "review_note": row.review_note,
        "supersedes_diagnosis_id": row.supersedes_diagnosis_id,
    }


async def get_quality_diagnoses(
    db: AsyncSession, proyecto_id: UUID, *, limit: int = 25,
) -> dict[str, Any]:
    rows = (await db.execute(
        select(models.QualityDiagnosis)
        .where(models.QualityDiagnosis.proyecto_id == proyecto_id)
        .order_by(models.QualityDiagnosis.created_at.desc())
        .limit(min(max(int(limit), 1), 100))
    )).scalars().all()
    return {"proyecto_id": proyecto_id, "items": [_quality_diagnosis_payload(row) for row in rows]}


async def get_quality_diagnosis_bug_draft(
    db: AsyncSession, proyecto_id: UUID, diagnosis_id: UUID,
) -> dict[str, Any] | None:
    """Return a human-editable bug payload; never create a bug implicitly."""
    row = await db.scalar(
        select(models.QualityDiagnosis).where(
            models.QualityDiagnosis.id == diagnosis_id,
            models.QualityDiagnosis.proyecto_id == proyecto_id,
        )
    )
    if row is None:
        return None
    if row.status != "ACCEPTED":
        raise ValueError("Acepta el diagnóstico antes de preparar un bug.")
    if not row.ejecucion_caso_id:
        raise ValueError("El diagnóstico no está vinculado a una ejecución para reportar un bug.")
    execution_row = (await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .where(models.EjecucionCaso.id == row.ejecucion_caso_id)
        .where(models.TestRun.proyecto_id == proyecto_id)
    )).first()
    if execution_row is None:
        raise ValueError("La ejecución vinculada ya no está disponible en este proyecto.")
    execution, test_case = execution_row
    hypothesis_lines = [
        f"- {item.get('statement', '')}" for item in row.hypotheses_json or []
        if isinstance(item, dict) and str(item.get("statement") or "").strip()
    ]
    next_step_lines = [f"- {item}" for item in row.recommended_next_steps_json or [] if str(item).strip()]
    description_parts = [
        "Borrador preparado desde un diagnóstico de Quality Intelligence aceptado.",
        "Hipótesis (requieren validación humana):", *(hypothesis_lines or ["- Sin hipótesis concluyente."]),
        "Próximos pasos sugeridos:", *(next_step_lines or ["- Revisar la evidencia enlazada."]),
    ]
    return {
        "diagnosis_id": row.id,
        "target_path": f"/ejecuciones/{execution.id}/bugs/",
        "payload": {
            "titulo": f"{test_case.codigo or 'Caso'} - triage revisado de ejecución fallida",
            "descripcion": "\n".join(description_parts),
            "notas_qa": "Diagnóstico aceptado; revisar y completar antes de crear el bug.",
            "metadata_json": {
                "created_from": "quality_diagnosis_draft",
                "quality_diagnosis_id": str(row.id),
                "quality_evidence_refs": row.evidence_refs_json or [],
            },
        },
    }


async def create_quality_diagnosis(
    db: AsyncSession, proyecto_id: UUID, payload: Any, user_id: UUID,
) -> dict[str, Any]:
    """Create an auditable, AI-assisted triage draft from normalized signals."""
    # These modules ultimately reference the modular repository compatibility
    # layer.  Import them only when an AI diagnosis is requested so rebuilding
    # the deterministic projection remains usable by migrations and CLIs.
    from .ai_provider_profiles import provider_payload_for_definition
    from .core_settings_ai_workflow_helpers import get_ai_engine_config
    from .repository_context import engine_internal_headers
    from ..services.edition.entitlement_service import ensure_feature_enabled
    from ..services.edition.usage_limits import enforce_weekly_ai_execution_limit

    observation = None
    if payload.ejecucion_caso_id:
        observation = await db.scalar(select(models.QualityExecutionObservation).where(
            models.QualityExecutionObservation.proyecto_id == proyecto_id,
            models.QualityExecutionObservation.ejecucion_caso_id == payload.ejecucion_caso_id,
        ))
        if observation is None:
            raise ValueError("La ejecución no tiene una observación de calidad del proyecto.")
    fingerprint = None
    if payload.failure_fingerprint_id:
        fingerprint = await db.scalar(select(models.QualityFailureFingerprint).where(
            models.QualityFailureFingerprint.id == payload.failure_fingerprint_id,
            models.QualityFailureFingerprint.proyecto_id == proyecto_id,
        ))
        if fingerprint is None:
            raise ValueError("La huella de fallo no pertenece al proyecto.")
    if not observation and not fingerprint:
        raise ValueError("Selecciona una ejecución analizada o una huella de fallo.")
    state = await require_current_quality_analysis(db, proyecto_id)
    evidence_refs = []
    facts = []
    if observation:
        evidence_refs.extend([f"observation:{observation.id}", f"execution:{observation.ejecucion_caso_id}"])
        facts.append({"statement": f"La ejecución registrada terminó en {observation.resultado}.", "evidence_refs": evidence_refs[-2:]})
    if fingerprint:
        evidence_refs.append(f"fingerprint:{fingerprint.id}")
        facts.append({"statement": f"La huella está clasificada como {fingerprint.failure_category} y tiene {fingerprint.occurrence_count} ocurrencias registradas.", "evidence_refs": [evidence_refs[-1]]})
    context = {"facts": facts, "evidence_refs": evidence_refs, "instructions": str(payload.instructions or "")[:2000], "privacy": "No raw logs, credentials, URLs, attachments or resolved variables are provided."}
    input_hash = hashlib.sha256(repr(context).encode("utf-8")).hexdigest()
    config = await get_ai_engine_config(db)
    provider = await provider_payload_for_definition(db, None, config)
    await ensure_feature_enabled(db, "ai.basic_execution")
    project = await db.get(models.Proyecto, proyecto_id)
    if project:
        await enforce_weekly_ai_execution_limit(db, solution_id=project.organizacion_id)
    try:
        engine_url = os.getenv("ENGINE_URL", "http://engine:3010").rstrip("/")
        request_payload = {"diagnosis_context": context, **provider, "temperature": config.get("temperature", 0.1), "max_completion_tokens": min(int(config.get("max_completion_tokens") or 900), 1400)}
        async with httpx.AsyncClient(timeout=min(max(30, int(config.get("timeout_seconds") or 300)), 300)) as client:
            response = await client.post(f"{engine_url}/diagnose-quality-sync", json=request_payload, headers=engine_internal_headers())
        if response.status_code >= 400:
            if response.status_code == 422:
                raise RuntimeError("engine_insufficient_evidence")
            raise RuntimeError(f"engine_http_{response.status_code}")
        data = response.json()
        diagnosis = data.get("diagnosis") if isinstance(data, dict) else None
        if not isinstance(diagnosis, dict) or not diagnosis.get("facts"):
            raise RuntimeError("engine_invalid_diagnosis")
        row = models.QualityDiagnosis(
            proyecto_id=proyecto_id, ejecucion_caso_id=observation.ejecucion_caso_id if observation else None,
            failure_fingerprint_id=fingerprint.id if fingerprint else None, source_revision=state.source_revision,
            facts_json=diagnosis.get("facts") or [], hypotheses_json=diagnosis.get("hypotheses") or [],
            unknowns_json=diagnosis.get("unknowns") or [], recommended_next_steps_json=diagnosis.get("recommended_next_steps") or [],
            evidence_refs_json=evidence_refs, provider=provider.get("provider"), model=provider.get("model"),
            prompt_hash=data.get("prompt_hash"), input_hash=input_hash, metrics_json=data.get("metrics") or {}, created_by=user_id,
        )
    except Exception as exc:
        insufficient_evidence = str(exc) in {"engine_insufficient_evidence", "engine_invalid_diagnosis"}
        row = models.QualityDiagnosis(
            proyecto_id=proyecto_id, ejecucion_caso_id=observation.ejecucion_caso_id if observation else None,
            failure_fingerprint_id=fingerprint.id if fingerprint else None, source_revision=state.source_revision,
            status="INSUFFICIENT_EVIDENCE" if insufficient_evidence else "MODEL_UNAVAILABLE", facts_json=facts, hypotheses_json=[],
            unknowns_json=["El modelo no devolvió evidencia suficiente para sostener un diagnóstico."] if insufficient_evidence else ["El proveedor no estuvo disponible para completar el diagnóstico."],
            recommended_next_steps_json=["Revisar o ampliar la evidencia autorizada antes de volver a intentarlo."] if insufficient_evidence else ["Revisar la evidencia disponible y reintentar el diagnóstico cuando el proveedor esté operativo."],
            evidence_refs_json=evidence_refs, provider=provider.get("provider"), model=provider.get("model"), input_hash=input_hash,
            metrics_json={"error_category": type(exc).__name__}, created_by=user_id,
        )
    # The engine call can take time. Lock and re-check immediately before the
    # immutable snapshot is persisted so a source change cannot slip between
    # the first check and this write.
    state = await require_current_quality_analysis(db, proyecto_id, lock=True)
    row.source_revision = state.source_revision
    db.add(row); await db.flush(); await db.refresh(row)
    return _quality_diagnosis_payload(row)

async def review_quality_diagnosis(db: AsyncSession, proyecto_id: UUID, diagnosis_id: UUID, payload: Any, user_id: UUID) -> dict[str, Any] | None:
    row = await db.scalar(select(models.QualityDiagnosis).where(models.QualityDiagnosis.id == diagnosis_id, models.QualityDiagnosis.proyecto_id == proyecto_id).with_for_update())
    if row is None:
        return None
    if row.status not in {"DRAFT", "UNDER_REVIEW", "INSUFFICIENT_EVIDENCE"}:
        raise ValueError("El borrador ya fue decidido y conserva su snapshot.")
    await require_current_quality_analysis(db, proyecto_id, lock=True)
    row.status, row.reviewed_by, row.reviewed_at, row.review_note = payload.status, user_id, utc_now(), payload.note
    await db.flush(); await db.refresh(row)
    return _quality_diagnosis_payload(row)


async def edit_quality_diagnosis(
    db: AsyncSession, proyecto_id: UUID, diagnosis_id: UUID, payload: Any, user_id: UUID,
) -> dict[str, Any] | None:
    """Version a human edit instead of overwriting an AI diagnosis snapshot."""
    row = await db.scalar(
        select(models.QualityDiagnosis)
        .where(models.QualityDiagnosis.id == diagnosis_id, models.QualityDiagnosis.proyecto_id == proyecto_id)
        .with_for_update()
    )
    if row is None:
        return None
    if row.status not in {"DRAFT", "UNDER_REVIEW", "INSUFFICIENT_EVIDENCE", "MODEL_UNAVAILABLE"}:
        raise ValueError("Solo se pueden editar borradores que todavía no fueron decididos.")
    state = await require_current_quality_analysis(db, proyecto_id, lock=True)
    facts = payload.facts if payload.facts is not None else row.facts_json or []
    hypotheses = payload.hypotheses if payload.hypotheses is not None else row.hypotheses_json or []
    unknowns = payload.unknowns if payload.unknowns is not None else row.unknowns_json or []
    next_steps = payload.recommended_next_steps if payload.recommended_next_steps is not None else row.recommended_next_steps_json or []
    revision_material = {
        "source": str(row.id), "facts": facts, "hypotheses": hypotheses,
        "unknowns": unknowns, "recommended_next_steps": next_steps,
        "evidence_refs": row.evidence_refs_json or [],
    }
    replacement = models.QualityDiagnosis(
        proyecto_id=row.proyecto_id, ejecucion_caso_id=row.ejecucion_caso_id,
        failure_fingerprint_id=row.failure_fingerprint_id, source_revision=state.source_revision,
        facts_json=facts, hypotheses_json=hypotheses, unknowns_json=unknowns,
        recommended_next_steps_json=next_steps, evidence_refs_json=row.evidence_refs_json or [],
        provider=row.provider, model=row.model, prompt_hash=row.prompt_hash,
        input_hash=hashlib.sha256(json.dumps(revision_material, sort_keys=True, default=str).encode("utf-8")).hexdigest(),
        metrics_json={**(row.metrics_json or {}), "edited_from": str(row.id)},
        supersedes_diagnosis_id=row.id, created_by=user_id,
        review_note=payload.note,
    )
    row.status, row.reviewed_by, row.reviewed_at = "SUPERSEDED", user_id, utc_now()
    row.review_note = f"Sustituido por una revisión humana: {payload.note.strip()}"
    db.add(replacement)
    await db.flush()
    await db.refresh(replacement)
    return _quality_diagnosis_payload(replacement)

"""Persisted, deterministic foundations for Quality Intelligence.

These records intentionally contain only normalized analytics metadata.  The
authoritative execution, snapshots and attachments remain in their existing
tables, behind the same project access controls.
"""

import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from ..database import Base
from ..time_utils import UTCDateTime


class QualityFailureFingerprint(Base):
    __tablename__ = "quality_failure_fingerprints"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    fingerprint = Column(String(64), nullable=False)
    signature_version = Column(String(20), nullable=False, default="v1")
    failure_category = Column(String(80), nullable=False, default="UNKNOWN", index=True)
    first_seen_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    last_seen_at = Column(UTCDateTime(), server_default=func.now(), nullable=False, index=True)
    occurrence_count = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint("proyecto_id", "signature_version", "fingerprint", name="uq_quality_failure_fingerprint"),
        Index("ix_quality_failure_fingerprint_project_recent", "proyecto_id", "last_seen_at"),
    )


class QualityExecutionObservation(Base):
    __tablename__ = "quality_execution_observations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ejecucion_caso_id = Column(UUID(as_uuid=True), ForeignKey("ejecuciones_casos.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    build_id = Column(UUID(as_uuid=True), ForeignKey("builds.id", ondelete="SET NULL"), nullable=True, index=True)
    componente_id = Column(UUID(as_uuid=True), ForeignKey("componentes.id", ondelete="SET NULL"), nullable=True, index=True)
    suite_id = Column(UUID(as_uuid=True), ForeignKey("suites.id", ondelete="SET NULL"), nullable=True, index=True)
    entorno_id = Column(UUID(as_uuid=True), ForeignKey("entornos.id", ondelete="SET NULL"), nullable=True, index=True)
    runner_id = Column(UUID(as_uuid=True), ForeignKey("automation_runners.id", ondelete="SET NULL"), nullable=True, index=True)
    case_master_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    resultado = Column(String(30), nullable=False, index=True)
    execution_mode = Column(String(30), nullable=False, default="MANUAL")
    intento_numero = Column(Integer, nullable=False, default=1)
    duracion_segundos = Column(Integer, nullable=False, default=0)
    observed_at = Column(UTCDateTime(), nullable=False, index=True)
    failure_fingerprint_id = Column(UUID(as_uuid=True), ForeignKey("quality_failure_fingerprints.id", ondelete="SET NULL"), nullable=True, index=True)
    evidence_summary = Column(JSON, nullable=False, default=dict)
    source_version = Column(String(20), nullable=False, default="v1")
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_quality_observation_case_series", "proyecto_id", "case_master_id", "observed_at"),
        Index("ix_quality_observation_project_build", "proyecto_id", "build_id", "observed_at"),
        Index("ix_quality_observation_project_suite", "proyecto_id", "suite_id", "observed_at"),
        Index("ix_quality_observation_project_runner", "proyecto_id", "runner_id", "observed_at"),
    )


class QualityCaseHealth(Base):
    __tablename__ = "quality_case_health"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    case_master_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    scope_key = Column(String(180), nullable=False, default="global")
    algorithm_version = Column(String(20), nullable=False, default="v1")
    window_size = Column(Integer, nullable=False, default=20)
    total_observations = Column(Integer, nullable=False, default=0)
    passed_count = Column(Integer, nullable=False, default=0)
    failed_count = Column(Integer, nullable=False, default=0)
    blocked_count = Column(Integer, nullable=False, default=0)
    transition_count = Column(Integer, nullable=False, default=0)
    flaky_score = Column(Float, nullable=False, default=0.0)
    classification = Column(String(40), nullable=False, default="INSUFFICIENT_DATA", index=True)
    evidence_summary = Column(JSON, nullable=False, default=dict)
    calculated_at = Column(UTCDateTime(), server_default=func.now(), nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint("proyecto_id", "case_master_id", "scope_key", "algorithm_version", name="uq_quality_case_health_scope"),
        Index("ix_quality_case_health_project_classification", "proyecto_id", "classification"),
    )


class QualityAnalysisState(Base):
    """Monotonic source/rebuild revisions for an auditable derived projection."""

    __tablename__ = "quality_analysis_states"

    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), primary_key=True)
    source_revision = Column(Integer, nullable=False, default=0)
    rebuilt_revision = Column(Integer, nullable=False, default=0)
    source_updated_at = Column(UTCDateTime(), nullable=True)
    rebuilt_at = Column(UTCDateTime(), nullable=True)


class QualityDiagnosis(Base):
    """Human-reviewable AI triage draft, separate from deterministic signals."""

    __tablename__ = "quality_diagnoses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    ejecucion_caso_id = Column(UUID(as_uuid=True), ForeignKey("ejecuciones_casos.id", ondelete="SET NULL"), nullable=True, index=True)
    failure_fingerprint_id = Column(UUID(as_uuid=True), ForeignKey("quality_failure_fingerprints.id", ondelete="SET NULL"), nullable=True, index=True)
    source_revision = Column(Integer, nullable=False, default=0)
    status = Column(String(40), nullable=False, default="DRAFT", index=True)
    facts_json = Column(JSON, nullable=False, default=list)
    hypotheses_json = Column(JSON, nullable=False, default=list)
    unknowns_json = Column(JSON, nullable=False, default=list)
    recommended_next_steps_json = Column(JSON, nullable=False, default=list)
    evidence_refs_json = Column(JSON, nullable=False, default=list)
    provider = Column(String(80), nullable=True)
    model = Column(String(160), nullable=True)
    prompt_hash = Column(String(64), nullable=True)
    input_hash = Column(String(64), nullable=False)
    metrics_json = Column(JSON, nullable=False, default=dict)
    supersedes_diagnosis_id = Column(UUID(as_uuid=True), ForeignKey("quality_diagnoses.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    reviewed_at = Column(UTCDateTime(), nullable=True)
    review_note = Column(String(2000), nullable=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False, index=True)

    __table_args__ = (
        Index("ix_quality_diagnosis_project_status_recent", "proyecto_id", "status", "created_at"),
    )


class ReleaseRiskEvaluation(Base):
    """Immutable deterministic release-risk snapshot and human disposition."""

    __tablename__ = "release_risk_evaluations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    build_id = Column(UUID(as_uuid=True), ForeignKey("builds.id", ondelete="CASCADE"), nullable=False, index=True)
    algorithm_version = Column(String(20), nullable=False)
    score = Column(Integer, nullable=False)
    level = Column(String(20), nullable=False)
    recommendation = Column(String(40), nullable=False)
    input_hash = Column(String(64), nullable=False, index=True)
    input_json = Column(JSON, nullable=False, default=dict)
    factors_json = Column(JSON, nullable=False, default=list)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False, index=True)
    accepted_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    accepted_at = Column(UTCDateTime(), nullable=True)
    acceptance_note = Column(String(2000), nullable=True)

    __table_args__ = (
        Index("ix_release_risk_project_build_recent", "proyecto_id", "build_id", "created_at"),
        UniqueConstraint("proyecto_id", "build_id", "algorithm_version", "input_hash", name="uq_release_risk_snapshot"),
    )

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from .auth import validate_preference_json_payload

from ..models import (
    AiReviewStatus,
    AutomationJobStatus,
    Criticidad,
    EstadoCaso,
    EstadoResultado,
    EstadoRun,
    ExecutionMode,
    Prioridad,
    Rol,
    TipoPrueba,
)

MAX_PROJECT_REPORT_SETTINGS_BYTES = 64 * 1024
MAX_SHARED_REPORT_TOKEN_LENGTH = 120


class QualityHealthItem(BaseModel):
    case_master_id: UUID
    case_code: Optional[str] = None
    case_title: Optional[str] = None
    scope_key: str
    algorithm_version: str
    classification: str
    flaky_score: float
    window_size: int
    total_observations: int
    passed_count: int
    failed_count: int
    blocked_count: int
    transition_count: int
    evidence_summary: Dict[str, Any] = Field(default_factory=dict)
    calculated_at: datetime


class QualityHealthResponse(BaseModel):
    proyecto_id: UUID
    algorithm_version: str
    analysis_scope: str
    items: List[QualityHealthItem] = Field(default_factory=list)
    source_revision: int = 0
    rebuilt_revision: int = 0
    is_stale: bool = False
    source_updated_at: Optional[datetime] = None
    rebuilt_at: Optional[datetime] = None


class QualityFailureFingerprintItem(BaseModel):
    id: UUID
    fingerprint: str
    signature_version: str
    failure_category: str
    occurrence_count: int
    case_count: int
    first_seen_at: datetime
    last_seen_at: datetime


class QualityFailureFingerprintResponse(BaseModel):
    proyecto_id: UUID
    algorithm_version: str
    items: List[QualityFailureFingerprintItem] = Field(default_factory=list)


class QualityExecutionObservationItem(BaseModel):
    """Privacy-safe execution history item for Quality Intelligence."""

    id: UUID
    ejecucion_caso_id: UUID
    case_master_id: UUID
    case_code: Optional[str] = None
    case_title: Optional[str] = None
    build_id: Optional[UUID] = None
    build_name: Optional[str] = None
    suite_id: Optional[UUID] = None
    suite_name: Optional[str] = None
    entorno_id: Optional[UUID] = None
    environment_name: Optional[str] = None
    runner_id: Optional[UUID] = None
    runner_name: Optional[str] = None
    resultado: str
    execution_mode: str
    intento_numero: int
    duracion_segundos: int
    observed_at: datetime
    failure_fingerprint_id: Optional[UUID] = None
    failure_category: Optional[str] = None
    evidence_summary: Dict[str, Any] = Field(default_factory=dict)


class QualityExecutionObservationResponse(BaseModel):
    proyecto_id: UUID
    algorithm_version: str
    analysis_scope: str
    items: List[QualityExecutionObservationItem] = Field(default_factory=list)
    source_revision: int = 0
    rebuilt_revision: int = 0
    is_stale: bool = False
    source_updated_at: Optional[datetime] = None
    rebuilt_at: Optional[datetime] = None


class QualityDiagnosisCreate(BaseModel):
    ejecucion_caso_id: Optional[UUID] = None
    failure_fingerprint_id: Optional[UUID] = None
    instructions: Optional[str] = Field(default=None, max_length=2000)


class QualityDiagnosisReview(BaseModel):
    status: str = Field(pattern="^(UNDER_REVIEW|ACCEPTED|REJECTED)$")
    note: Optional[str] = Field(default=None, max_length=2000)


class QualityDiagnosisEdit(BaseModel):
    """Human revision creates a new immutable diagnosis version."""
    facts: Optional[List[Dict[str, Any]]] = Field(default=None, max_length=50)
    hypotheses: Optional[List[Dict[str, Any]]] = Field(default=None, max_length=50)
    unknowns: Optional[List[str]] = Field(default=None, max_length=50)
    recommended_next_steps: Optional[List[str]] = Field(default=None, max_length=50)
    note: str = Field(min_length=3, max_length=2000)


class QualityDiagnosisResponse(BaseModel):
    id: UUID
    proyecto_id: UUID
    ejecucion_caso_id: Optional[UUID] = None
    failure_fingerprint_id: Optional[UUID] = None
    source_revision: int
    status: str
    facts: List[Dict[str, Any]] = Field(default_factory=list)
    hypotheses: List[Dict[str, Any]] = Field(default_factory=list)
    unknowns: List[str] = Field(default_factory=list)
    recommended_next_steps: List[str] = Field(default_factory=list)
    evidence_refs: List[str] = Field(default_factory=list)
    provider: Optional[str] = None
    model: Optional[str] = None
    prompt_hash: Optional[str] = None
    metrics: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None
    supersedes_diagnosis_id: Optional[UUID] = None


class QualityDiagnosisListResponse(BaseModel):
    proyecto_id: UUID
    items: List[QualityDiagnosisResponse] = Field(default_factory=list)


class QualityDiagnosisBugDraftResponse(BaseModel):
    diagnosis_id: UUID
    target_path: str
    payload: Dict[str, Any] = Field(default_factory=dict)


class ReleaseRiskEvaluateRequest(BaseModel):
    build_id: UUID


class ReleaseRiskAcceptanceRequest(BaseModel):
    note: str = Field(min_length=3, max_length=2000)


class ReleaseRiskEvaluationResponse(BaseModel):
    id: UUID
    proyecto_id: UUID
    build_id: UUID
    algorithm_version: str
    score: int
    level: str
    recommendation: str
    input_hash: str
    factors: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    accepted_at: Optional[datetime] = None
    acceptance_note: Optional[str] = None
    comparison: Dict[str, Any] = Field(default_factory=dict)


class QualityIntelligenceSummary(BaseModel):
    proyecto_id: UUID
    algorithm_version: str
    analysis_scope: str
    health_cases: int
    assessable_cases: int
    flaky_cases: int
    blocked_cases: int
    stable_cases: int
    mixed_cases: int
    insufficient_data_cases: int
    flaky_case_rate: Optional[float] = None
    terminal_observations: int
    terminal_duration_seconds: int
    retry_observations: int
    calculated_at: Optional[datetime] = None
    source_revision: int = 0
    rebuilt_revision: int = 0
    is_stale: bool = False
    source_updated_at: Optional[datetime] = None
    rebuilt_at: Optional[datetime] = None


class QualityIntelligenceRebuildRequest(BaseModel):
    window_size: int = Field(default=20, ge=3, le=100)


class QualityIntelligenceRebuildResponse(BaseModel):
    status: str
    observations: int
    observations_created: int
    health_records: int
    fingerprints: int
    skipped_without_timestamp: int
    algorithm_version: str
    source_revision: int = 0
    rebuilt_revision: int = 0
    is_stale: bool = False
    source_updated_at: Optional[datetime] = None
    rebuilt_at: Optional[datetime] = None

class SharedReportSnapshotCreate(BaseModel):
    proyecto_id: UUID
    build_id: Optional[UUID] = None
    componente_id: Optional[UUID] = None
    expires_at: Optional[datetime] = None
    requested_report_type: Optional[str] = Field(default=None, max_length=30)
    build_definition: Optional[str] = Field(default=None, max_length=80)
    qa_comment: Optional[str] = Field(default=None, max_length=4000)
    definition_responsible_id: Optional[UUID] = None

class ProjectReportSettings(BaseModel):
    version: str = Field(default="project-report-settings-v1", max_length=80)
    executive: Dict[str, Any] = Field(default_factory=dict)
    development: Dict[str, Any] = Field(default_factory=dict)
    internal: Dict[str, Any] = Field(default_factory=dict)

class ProjectReportSettingsUpdate(BaseModel):
    version: Optional[str] = Field(default=None, max_length=80)
    executive: Optional[Dict[str, Any]] = None
    development: Optional[Dict[str, Any]] = None
    internal: Optional[Dict[str, Any]] = None

    @field_validator("executive", "development", "internal")
    @classmethod
    def validate_report_settings_payload(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_preference_json_payload(
            value,
            max_bytes=MAX_PROJECT_REPORT_SETTINGS_BYTES,
            label="La configuracion de informes",
        )

class SharedReportSnapshotResponse(BaseModel):
    id: UUID
    token: str
    proyecto_id: UUID
    build_id: Optional[UUID] = None
    componente_id: Optional[UUID] = None
    title: str
    description: Optional[str] = None
    payload: Dict[str, Any]
    metrics_hash: str
    created_by: Optional[UUID] = None
    created_by_display: Optional[str] = None
    created_at: datetime
    expires_at: Optional[datetime] = None
    activo: bool
    public_url: Optional[str] = None
    has_new_values: bool = False

    model_config = ConfigDict(from_attributes=True)

class SharedReportBundleResponse(BaseModel):
    snapshot_group_id: str
    metrics_hash: str
    reused: bool = False
    created_at: datetime
    expires_at: Optional[datetime] = None
    activo: bool = True
    public_url: Optional[str] = None
    links: Dict[str, str] = Field(default_factory=dict)
    tokens: Dict[str, str] = Field(default_factory=dict)
    snapshots: List[SharedReportSnapshotResponse] = Field(default_factory=list)
    requested_report_type: Optional[str] = None
    build_definition: Optional[str] = None
    qa_comment: Optional[str] = None
    definition_responsible_id: Optional[UUID] = None
    definition_at: Optional[datetime] = None

class SharedReportBundleHistoryItem(BaseModel):
    snapshot_group_id: str
    metrics_hash: str
    build_id: Optional[UUID] = None
    componente_id: Optional[UUID] = None
    created_at: datetime
    created_by: Optional[UUID] = None
    created_by_display: Optional[str] = None
    activo: bool = True
    has_new_values: bool = False
    is_latest: bool = False
    links: Dict[str, str] = Field(default_factory=dict)
    tokens: Dict[str, str] = Field(default_factory=dict)
    report_types: List[str] = Field(default_factory=list)
    build: Optional[str] = None
    componente: Optional[str] = None
    requested_report_type: Optional[str] = None
    build_definition: Optional[str] = None
    qa_comment: Optional[str] = None
    definition_responsible_id: Optional[UUID] = None
    definition_responsible_display: Optional[str] = None
    definition_at: Optional[datetime] = None

class SharedReportStatus(BaseModel):
    token: str
    activo: bool
    expired: bool = False
    has_new_values: bool = False
    created_at: datetime
    expires_at: Optional[datetime] = None
    report_type: str = "executive"
    snapshot_group_id: Optional[str] = None
    latest_url: Optional[str] = None
    latest_token: Optional[str] = None

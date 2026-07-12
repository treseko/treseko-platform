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

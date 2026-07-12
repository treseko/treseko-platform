from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_serializer, field_validator

from ..attachment_storage import attachment_file_available, attachment_missing_reason
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

class TestRunBase(BaseModel):
    nombre: str
    entorno: str

class TestRunCreate(TestRunBase):
    proyecto_id: UUID
    build_id: Optional[UUID] = None
    origen: str = "MANUAL"
    entorno_id: Optional[UUID] = None
    dataset_id: Optional[UUID] = None
    caso_ids: List[UUID] = Field(default_factory=list)

class TestRun(TestRunBase):
    id: UUID
    proyecto_id: UUID
    build_id: Optional[UUID] = None
    entorno_id: Optional[UUID] = None
    dataset_id: Optional[UUID] = None
    variables_resueltas: Dict[str, str] = Field(default_factory=dict)
    datasets_resueltos: Dict[str, List[Dict[str, str]]] = Field(default_factory=dict)
    origen: str = "MANUAL"
    external_run_id: Optional[str] = None
    estado_run: EstadoRun
    creado_por: UUID
    fecha_creacion: datetime
    fecha_cierre: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)

# --- AUTOMATION RUNNERS / JOBS ---

class DatasetResolveRequest(BaseModel):
    build_id: Optional[UUID] = None
    entorno_id: Optional[UUID] = None
    dataset_id: Optional[UUID] = None

class DatasetResolveResponse(BaseModel):
    caso_id: UUID
    entorno_id: Optional[UUID] = None
    entorno_nombre: Optional[str] = None
    dataset_id: Optional[UUID] = None
    dataset_nombre: Optional[str] = None
    dataset_original: List[Dict[str, str]] = Field(default_factory=list)
    dataset_ambiente: List[Dict[str, str]] = Field(default_factory=list)
    dataset_caso_resuelto: List[Dict[str, str]] = Field(default_factory=list)
    variables_ambiente: Dict[str, str] = Field(default_factory=dict)
    variables_configuradas: Dict[str, str] = Field(default_factory=dict)
    variables_resueltas: Dict[str, str] = Field(default_factory=dict)
    dataset_resuelto: List[Dict[str, str]] = Field(default_factory=list)

class EjecucionCasoBase(BaseModel):
    caso_id: UUID
    version_ejecutada: int

class EjecucionCaso(EjecucionCasoBase):
    id: UUID
    test_run_id: UUID
    estado_resultado: EstadoResultado
    execution_mode: ExecutionMode = ExecutionMode.MANUAL
    ejecutado_por: UUID
    intento_numero: int
    duracion_segundos: int
    observaciones: Optional[str] = None
    ai_report: Dict[str, Any] = Field(default_factory=dict)
    ai_confidence: Optional[int] = None
    ai_consensus: Optional[str] = None
    ai_failure_category: Optional[str] = None
    ai_human_review_required: bool = False
    ai_review_status: AiReviewStatus = AiReviewStatus.NO_REQUIERE_REVISION
    ai_reviewed_by: Optional[UUID] = None
    ai_reviewed_at: Optional[datetime] = None
    ai_review_note: Optional[str] = None
    fecha_ejecucion: datetime
    
    model_config = ConfigDict(from_attributes=True)

class AttachmentRef(BaseModel):
    id: UUID
    filename_original: str
    content_type: str
    public_url: str
    storage_path: Optional[str] = Field(default=None, exclude=True)

    @computed_field
    @property
    def available(self) -> bool:
        return attachment_file_available(self)

    @computed_field
    @property
    def missing_reason(self) -> Optional[str]:
        return attachment_missing_reason(self)

    model_config = ConfigDict(from_attributes=True)

class SnapshotPaso(BaseModel):
    id: UUID
    ejecucion_caso_id: UUID
    paso_id: Optional[UUID] = None
    numero_paso: int
    accion_congelada: str
    datos_congelados: Optional[str] = None
    datos_resueltos: Optional[str] = None
    resultado_esperado_congelado: str
    estado_paso: EstadoResultado
    comentarios: Optional[str] = None
    evidencia_url: Optional[str] = None
    error_log: Optional[str] = None
    action_references: List[AttachmentRef] = Field(default_factory=list)
    expected_references: List[AttachmentRef] = Field(default_factory=list)
    
    model_config = ConfigDict(from_attributes=True)

class SnapshotPasoUpdate(BaseModel):
    id: UUID
    estado: EstadoResultado
    comentarios: Optional[str] = None
    evidencia_url: Optional[str] = None

class SnapshotPasoBulkUpdate(BaseModel):
    snapshots: List[SnapshotPasoUpdate]

# --- ATTACHMENTS / EVIDENCIAS ---

class AiExecutionReviewUpdate(BaseModel):
    note: Optional[str] = None

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from urllib.parse import parse_qs, urlparse

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from ..attachment_storage import attachment_availability_dict
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

MAX_BUG_CODE_LENGTH = 30
MAX_BUG_TITLE_LENGTH = 255
MAX_BUG_STATUS_LENGTH = 30
MAX_BUG_LABEL_LENGTH = 80
MAX_BUG_SHORT_FIELD_LENGTH = 120
MAX_BUG_MODULE_LENGTH = 150
MAX_BUG_URL_LENGTH = 2000
MAX_BUG_TEXT_LENGTH = 20000
MAX_BUG_LOG_LENGTH = 120000
MAX_BUG_JSON_BYTES = 96 * 1024
MAX_BUG_COMMENT_LENGTH = 12000
MAX_BUG_COMMENT_ATTACHMENTS = 50
MAX_BUG_ATTACHMENTS = 200
MAX_BUG_EXTERNAL_ID_LENGTH = 120
MAX_BUG_EXTERNAL_PROVIDER_LENGTH = 50
MAX_BUG_EXTERNAL_METADATA_BYTES = 32 * 1024
MAX_BUG_DEDUPE_HASH_LENGTH = 128
MAX_BUG_LIST_ITEMS = 500
BUG_EXTERNAL_URL_SENSITIVE_QUERY_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "asset_token",
    "authorization",
    "password",
    "refresh_token",
    "secret",
    "token",
    "x_qa_api_key",
}


def validate_bug_json_payload(value: Optional[Dict[str, Any]], *, max_bytes: int = MAX_BUG_JSON_BYTES, label: str = "bug metadata") -> Optional[Dict[str, Any]]:
    return validate_preference_json_payload(value, max_bytes=max_bytes, label=label)


def validate_bug_external_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    text = str(value or "").replace("\x00", "").strip()
    if not text or any(char.isspace() for char in text) or any(char in text for char in "<>\"'"):
        raise ValueError("external issue URL contains invalid characters")
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("external issue URL must be absolute HTTP/HTTPS")
    if parsed.username or parsed.password:
        raise ValueError("external issue URL cannot include credentials")
    try:
        query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=50)
    except ValueError as exc:
        raise ValueError("external issue URL query is invalid") from exc
    if any(str(key).strip().lower() in BUG_EXTERNAL_URL_SENSITIVE_QUERY_KEYS for key in query):
        raise ValueError("external issue URL cannot include sensitive query parameters")
    return text


class BugIssueCreate(BaseModel):
    proyecto_id: UUID
    componente_id: Optional[UUID] = None
    build_id: Optional[UUID] = None
    caso_id: Optional[UUID] = None
    test_run_id: Optional[UUID] = None
    ejecucion_id: Optional[UUID] = None
    snapshot_id: Optional[UUID] = None
    entorno_id: Optional[UUID] = None
    dataset_id: Optional[UUID] = None
    numero_paso: Optional[int] = Field(default=None, ge=1, le=1000)
    execution_mode: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)
    case_code: Optional[str] = Field(default=None, max_length=MAX_BUG_CODE_LENGTH)
    build_code: Optional[str] = Field(default=None, max_length=MAX_BUG_CODE_LENGTH)
    titulo: str = Field(..., min_length=1, max_length=MAX_BUG_TITLE_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    severidad: str = Field(default="MEDIA", max_length=MAX_BUG_STATUS_LENGTH)
    prioridad: str = Field(default="P2", max_length=MAX_BUG_STATUS_LENGTH)
    estado: str = Field(default="ABIERTO", max_length=MAX_BUG_STATUS_LENGTH)
    precondiciones: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    pasos_reproduccion: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    datos_prueba: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    resultado_esperado: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    resultado_obtenido: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    comportamiento_actual: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    url_afectada: Optional[str] = Field(default=None, max_length=MAX_BUG_URL_LENGTH)
    navegador: Optional[str] = Field(default=None, max_length=MAX_BUG_SHORT_FIELD_LENGTH)
    dispositivo: Optional[str] = Field(default=None, max_length=MAX_BUG_SHORT_FIELD_LENGTH)
    resolucion: Optional[str] = Field(default=None, max_length=MAX_BUG_SHORT_FIELD_LENGTH)
    sistema_operativo: Optional[str] = Field(default=None, max_length=MAX_BUG_SHORT_FIELD_LENGTH)
    ambiente_nombre: Optional[str] = Field(default=None, max_length=MAX_BUG_MODULE_LENGTH)
    ambiente_url: Optional[str] = Field(default=None, max_length=MAX_BUG_URL_LENGTH)
    version_app: Optional[str] = Field(default=None, max_length=MAX_BUG_SHORT_FIELD_LENGTH)
    logs_relevantes: Optional[str] = Field(default=None, max_length=MAX_BUG_LOG_LENGTH)
    error_tecnico: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    stack_trace: Optional[str] = Field(default=None, max_length=MAX_BUG_LOG_LENGTH)
    notas_qa: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    reproducibilidad: str = Field(default="no_reproducido", max_length=MAX_BUG_STATUS_LENGTH)
    frecuencia: Optional[str] = Field(default=None, max_length=MAX_BUG_LABEL_LENGTH)
    impacto_negocio: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    modulo_funcional: Optional[str] = Field(default=None, max_length=MAX_BUG_MODULE_LENGTH)
    criticidad: str = Field(default="MEDIA", max_length=MAX_BUG_STATUS_LENGTH)
    bloquea_release: bool = False
    bloquea_caso: bool = False
    asignado_a: Optional[UUID] = None
    origen: str = Field(default="manual", max_length=MAX_BUG_STATUS_LENGTH)
    external_provider: Optional[str] = Field(default=None, max_length=MAX_BUG_EXTERNAL_PROVIDER_LENGTH)
    external_issue_id: Optional[str] = Field(default=None, max_length=MAX_BUG_EXTERNAL_ID_LENGTH)
    external_issue_url: Optional[str] = Field(default=None, max_length=MAX_BUG_URL_LENGTH)
    external_sync_status: str = Field(default="not_synced", max_length=MAX_BUG_STATUS_LENGTH)
    external_payload_snapshot: Dict[str, Any] = Field(default_factory=dict)
    dedupe_hash: Optional[str] = Field(default=None, max_length=MAX_BUG_DEDUPE_HASH_LENGTH)
    duplicate_of_id: Optional[UUID] = None
    retest_status: str = Field(default="pendiente", max_length=MAX_BUG_STATUS_LENGTH)
    metadata_json: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("external_issue_url")
    @classmethod
    def validate_external_issue_url(cls, value):
        return validate_bug_external_url(value)

    @field_validator("external_payload_snapshot")
    @classmethod
    def validate_external_payload_snapshot(cls, value):
        return validate_bug_json_payload(value, label="bug external payload") or {}

    @field_validator("metadata_json")
    @classmethod
    def validate_metadata_json(cls, value):
        return validate_bug_json_payload(value, label="bug metadata") or {}

class BugIssueUpdate(BaseModel):
    componente_id: Optional[UUID] = None
    build_id: Optional[UUID] = None
    caso_id: Optional[UUID] = None
    test_run_id: Optional[UUID] = None
    ejecucion_id: Optional[UUID] = None
    snapshot_id: Optional[UUID] = None
    entorno_id: Optional[UUID] = None
    dataset_id: Optional[UUID] = None
    numero_paso: Optional[int] = Field(default=None, ge=1, le=1000)
    execution_mode: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)
    case_code: Optional[str] = Field(default=None, max_length=MAX_BUG_CODE_LENGTH)
    build_code: Optional[str] = Field(default=None, max_length=MAX_BUG_CODE_LENGTH)
    titulo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_BUG_TITLE_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    severidad: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)
    prioridad: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)
    estado: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)
    precondiciones: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    pasos_reproduccion: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    datos_prueba: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    resultado_esperado: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    resultado_obtenido: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    comportamiento_actual: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    url_afectada: Optional[str] = Field(default=None, max_length=MAX_BUG_URL_LENGTH)
    navegador: Optional[str] = Field(default=None, max_length=MAX_BUG_SHORT_FIELD_LENGTH)
    dispositivo: Optional[str] = Field(default=None, max_length=MAX_BUG_SHORT_FIELD_LENGTH)
    resolucion: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    sistema_operativo: Optional[str] = Field(default=None, max_length=MAX_BUG_SHORT_FIELD_LENGTH)
    ambiente_nombre: Optional[str] = Field(default=None, max_length=MAX_BUG_MODULE_LENGTH)
    ambiente_url: Optional[str] = Field(default=None, max_length=MAX_BUG_URL_LENGTH)
    version_app: Optional[str] = Field(default=None, max_length=MAX_BUG_SHORT_FIELD_LENGTH)
    logs_relevantes: Optional[str] = Field(default=None, max_length=MAX_BUG_LOG_LENGTH)
    error_tecnico: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    stack_trace: Optional[str] = Field(default=None, max_length=MAX_BUG_LOG_LENGTH)
    notas_qa: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    reproducibilidad: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)
    frecuencia: Optional[str] = Field(default=None, max_length=MAX_BUG_LABEL_LENGTH)
    impacto_negocio: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    modulo_funcional: Optional[str] = Field(default=None, max_length=MAX_BUG_MODULE_LENGTH)
    criticidad: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)
    bloquea_release: Optional[bool] = None
    bloquea_caso: Optional[bool] = None
    asignado_a: Optional[UUID] = None
    external_provider: Optional[str] = Field(default=None, max_length=MAX_BUG_EXTERNAL_PROVIDER_LENGTH)
    external_issue_id: Optional[str] = Field(default=None, max_length=MAX_BUG_EXTERNAL_ID_LENGTH)
    external_issue_url: Optional[str] = Field(default=None, max_length=MAX_BUG_URL_LENGTH)
    external_sync_status: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)
    external_payload_snapshot: Optional[Dict[str, Any]] = None
    dedupe_hash: Optional[str] = Field(default=None, max_length=MAX_BUG_DEDUPE_HASH_LENGTH)
    fecha_resolucion: Optional[datetime] = None
    resuelto_por: Optional[UUID] = None
    resolucion: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    motivo_cierre: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    duplicate_of_id: Optional[UUID] = None
    reopened_count: Optional[int] = Field(default=None, ge=0, le=1000)
    retest_status: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)
    metadata_json: Optional[Dict[str, Any]] = None

    @field_validator("external_issue_url")
    @classmethod
    def validate_external_issue_url(cls, value):
        return validate_bug_external_url(value)

    @field_validator("external_payload_snapshot")
    @classmethod
    def validate_external_payload_snapshot(cls, value):
        return validate_bug_json_payload(value, label="bug external payload")

    @field_validator("metadata_json")
    @classmethod
    def validate_metadata_json(cls, value):
        return validate_bug_json_payload(value, label="bug metadata")

class BugTransitionRequest(BaseModel):
    estado: str = Field(..., min_length=1, max_length=MAX_BUG_STATUS_LENGTH)
    resolucion: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    motivo_cierre: Optional[str] = Field(default=None, max_length=MAX_BUG_TEXT_LENGTH)
    retest_status: Optional[str] = Field(default=None, max_length=MAX_BUG_STATUS_LENGTH)

class BugExternalLinkCreate(BaseModel):
    provider_id: str = Field(..., min_length=1, max_length=MAX_BUG_EXTERNAL_PROVIDER_LENGTH)
    external_issue_id: str = Field(..., min_length=1, max_length=MAX_BUG_EXTERNAL_ID_LENGTH)
    external_issue_url: Optional[str] = Field(default=None, max_length=MAX_BUG_URL_LENGTH)
    status: str = Field(default="linked", max_length=MAX_BUG_STATUS_LENGTH)
    metadata_json: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("external_issue_url")
    @classmethod
    def validate_external_issue_url(cls, value):
        return validate_bug_external_url(value)

    @field_validator("metadata_json")
    @classmethod
    def validate_metadata_json(cls, value):
        return validate_bug_json_payload(value, max_bytes=MAX_BUG_EXTERNAL_METADATA_BYTES, label="bug external link metadata") or {}

class BugExternalLinkResponse(BaseModel):
    id: UUID
    bug_id: Optional[UUID] = None
    provider_id: str
    proyecto_id: UUID
    build_id: Optional[UUID] = None
    test_run_id: Optional[UUID] = None
    ejecucion_id: Optional[UUID] = None
    snapshot_id: Optional[UUID] = None
    external_issue_id: str
    external_issue_url: Optional[str] = None
    dedupe_hash: Optional[str] = None
    status: str
    metadata_json: Dict[str, Any] = Field(default_factory=dict)
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class BugExternalPreviewRequest(BaseModel):
    provider_id: str = "redmine"

class BugExternalPreviewResponse(BaseModel):
    provider_id: str
    subject: str
    markdown: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class BugSummaryResponse(BaseModel):
    total: int = 0
    abiertos: int = 0
    criticos: int = 0
    bloquean_release: int = 0
    listos_retest: int = 0
    cerrados: int = 0
    vinculados_externos: int = 0
    sin_evidencia: int = 0
    sin_asignado: int = 0
    by_estado: Dict[str, int] = Field(default_factory=dict)
    by_severidad: Dict[str, int] = Field(default_factory=dict)
    by_prioridad: Dict[str, int] = Field(default_factory=dict)
    by_origen: Dict[str, int] = Field(default_factory=dict)

class BugDedupeSuggestionResponse(BaseModel):
    bug: "BugIssueResponse"
    reason: str = "dedupe_hash"

class BugMarkDuplicateRequest(BaseModel):
    duplicate_of_id: UUID
    comentario: Optional[str] = Field(default=None, max_length=MAX_BUG_COMMENT_LENGTH)

class BugExecutionLinkRequest(BaseModel):
    ejecucion_id: UUID
    snapshot_id: Optional[UUID] = None
    attachment_ids: List[UUID] = Field(default_factory=list, max_length=MAX_BUG_COMMENT_ATTACHMENTS)
    comentario: Optional[str] = Field(default=None, max_length=MAX_BUG_COMMENT_LENGTH)

class BugListResponse(BaseModel):
    items: List["BugIssueResponse"] = Field(default_factory=list, max_length=MAX_BUG_LIST_ITEMS)
    total: int = 0
    skip: int = 0
    limit: int = 50

class BugCommentCreate(BaseModel):
    comentario: str = Field(..., min_length=1, max_length=MAX_BUG_COMMENT_LENGTH)
    attachment_ids: List[UUID] = Field(default_factory=list, max_length=MAX_BUG_COMMENT_ATTACHMENTS)

class BugAttachmentCreate(BaseModel):
    attachment_id: UUID
    tipo: str = Field(default="BUG_EVIDENCE", max_length=50)

class BugCommentResponse(BaseModel):
    id: UUID
    bug_id: UUID
    autor_id: Optional[UUID] = None
    comentario: str
    created_at: datetime
    attachments: List["BugAttachmentResponse"] = Field(default_factory=list, max_length=MAX_BUG_ATTACHMENTS)

    model_config = ConfigDict(from_attributes=True)

class BugAttachmentResponse(BaseModel):
    id: UUID
    bug_id: UUID
    comment_id: Optional[UUID] = None
    attachment_id: UUID
    tipo: str
    created_at: datetime
    attachment: Optional[Any] = None

    @field_serializer("attachment")
    def serialize_attachment(self, attachment: Any, _info):
        if attachment is None:
            return None
        return {
            "id": str(getattr(attachment, "id", "")),
            "filename_original": getattr(attachment, "filename_original", None),
            "content_type": getattr(attachment, "content_type", None),
            "size": getattr(attachment, "size", None),
            "public_url": getattr(attachment, "public_url", None),
            "scope": getattr(attachment, "scope", None),
            **attachment_availability_dict(attachment),
        }

    model_config = ConfigDict(from_attributes=True)

class BugIssueResponse(BaseModel):
    id: UUID
    codigo: str
    proyecto_id: UUID
    componente_id: Optional[UUID] = None
    build_id: Optional[UUID] = None
    caso_id: Optional[UUID] = None
    test_run_id: Optional[UUID] = None
    ejecucion_id: Optional[UUID] = None
    snapshot_id: Optional[UUID] = None
    entorno_id: Optional[UUID] = None
    dataset_id: Optional[UUID] = None
    numero_paso: Optional[int] = None
    execution_mode: Optional[str] = None
    case_code: Optional[str] = None
    build_code: Optional[str] = None
    titulo: str
    descripcion: Optional[str] = None
    severidad: str
    prioridad: str
    estado: str
    precondiciones: Optional[str] = None
    pasos_reproduccion: Optional[str] = None
    datos_prueba: Optional[str] = None
    resultado_esperado: Optional[str] = None
    resultado_obtenido: Optional[str] = None
    comportamiento_actual: Optional[str] = None
    url_afectada: Optional[str] = None
    navegador: Optional[str] = None
    dispositivo: Optional[str] = None
    resolucion: Optional[str] = None
    sistema_operativo: Optional[str] = None
    ambiente_nombre: Optional[str] = None
    ambiente_url: Optional[str] = None
    version_app: Optional[str] = None
    logs_relevantes: Optional[str] = None
    error_tecnico: Optional[str] = None
    stack_trace: Optional[str] = None
    notas_qa: Optional[str] = None
    reproducibilidad: str = "no_reproducido"
    frecuencia: Optional[str] = None
    impacto_negocio: Optional[str] = None
    modulo_funcional: Optional[str] = None
    criticidad: str = "MEDIA"
    bloquea_release: bool = False
    bloquea_caso: bool = False
    asignado_a: Optional[UUID] = None
    creado_por: Optional[UUID] = None
    origen: str
    external_provider: Optional[str] = None
    external_issue_id: Optional[str] = None
    external_issue_url: Optional[str] = None
    external_sync_status: str = "not_synced"
    external_last_sync_at: Optional[datetime] = None
    external_payload_snapshot: Dict[str, Any] = Field(default_factory=dict)
    dedupe_hash: Optional[str] = None
    fecha_resolucion: Optional[datetime] = None
    resuelto_por: Optional[UUID] = None
    resolucion: Optional[str] = None
    motivo_cierre: Optional[str] = None
    duplicate_of_id: Optional[UUID] = None
    reopened_count: int = 0
    retest_status: str = "pendiente"
    closed_at: Optional[datetime] = None
    metadata_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: Optional[datetime] = None
    comments: List[BugCommentResponse] = Field(default_factory=list)
    attachments: List[BugAttachmentResponse] = Field(default_factory=list)
    external_links: List[BugExternalLinkResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

# --- MEMBRESIAS DE PROYECTO ---

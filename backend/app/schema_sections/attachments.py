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

DEFAULT_ALLOWED_ATTACHMENT_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/json",
    "application/xml",
    "text/xml",
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "video/mp4",
    "video/webm",
    "application/octet-stream",
]
SUPPORTED_ATTACHMENT_MIME_TYPES = frozenset(DEFAULT_ALLOWED_ATTACHMENT_MIME_TYPES)
MAX_ATTACHMENT_MIME_TYPES = 80
MAX_ATTACHMENT_MIME_LENGTH = 120
MAX_ATTACHMENT_FILENAME_LENGTH = 260
MAX_ATTACHMENT_SCOPE_LENGTH = 80
MAX_ATTACHMENT_LINK_TYPE_LENGTH = 80


class AttachmentConfig(BaseModel):
    allowed_mime_types: List[str] = Field(default_factory=lambda: list(DEFAULT_ALLOWED_ATTACHMENT_MIME_TYPES), max_length=MAX_ATTACHMENT_MIME_TYPES)
    max_file_size_mb: int = Field(default=10, ge=1, le=100)
    max_files_per_step: int = Field(default=5, ge=0, le=50)
    max_files_per_snapshot: int = Field(default=10, ge=0, le=100)
    enable_clipboard_paste: bool = True
    require_evidence_on_failure: bool = False

    @field_validator("allowed_mime_types")
    @classmethod
    def validate_allowed_mime_types(cls, value: List[str]) -> List[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            mime = str(item or "").strip().lower()
            if not mime or len(mime) > MAX_ATTACHMENT_MIME_LENGTH:
                raise ValueError("Tipo MIME de adjunto invalido")
            if "/" not in mime or any(char.isspace() for char in mime):
                raise ValueError("Tipo MIME de adjunto invalido")
            if mime not in SUPPORTED_ATTACHMENT_MIME_TYPES:
                raise ValueError("Tipo MIME de adjunto no soportado")
            if mime not in seen:
                normalized.append(mime)
                seen.add(mime)
        if not normalized:
            raise ValueError("Debe existir al menos un tipo MIME permitido")
        return normalized

class Attachment(BaseModel):
    id: UUID
    filename_original: str = Field(max_length=MAX_ATTACHMENT_FILENAME_LENGTH)
    content_type: str = Field(max_length=MAX_ATTACHMENT_MIME_LENGTH)
    size: int
    public_url: str = Field(max_length=1000)
    scope: str = Field(max_length=MAX_ATTACHMENT_SCOPE_LENGTH)
    organizacion_id: Optional[UUID] = None
    proyecto_id: Optional[UUID] = None
    created_by: UUID
    created_at: datetime
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

class AttachmentLinkCreate(BaseModel):
    attachment_id: UUID
    tipo: str = Field(default="evidence", min_length=1, max_length=MAX_ATTACHMENT_LINK_TYPE_LENGTH)

class PasoAttachment(BaseModel):
    id: UUID
    paso_id: UUID
    attachment_id: UUID
    tipo: str
    attachment: Attachment
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class SnapshotAttachment(BaseModel):
    id: UUID
    snapshot_id: UUID
    attachment_id: UUID
    tipo: str
    attachment: Attachment
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

# --- API EXTERNA AUTOMATIZACION ---

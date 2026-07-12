from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

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

MAX_WIKI_TITLE_LENGTH = 255
MAX_WIKI_CONTENT_LENGTH = 512 * 1024
MAX_WIKI_CHANGE_COMMENT_LENGTH = 255


class WikiPageBase(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=MAX_WIKI_TITLE_LENGTH)
    contenido: Optional[str] = Field(default=None, max_length=MAX_WIKI_CONTENT_LENGTH)

class WikiPageCreate(WikiPageBase):
    proyecto_id: UUID
    creado_por: Optional[UUID] = None

class WikiPageUpdate(BaseModel):
    titulo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_WIKI_TITLE_LENGTH)
    contenido: Optional[str] = Field(default=None, max_length=MAX_WIKI_CONTENT_LENGTH)
    comentario_cambio: Optional[str] = Field(default="Edicion de contenido", max_length=MAX_WIKI_CHANGE_COMMENT_LENGTH)

class WikiPage(WikiPageBase):
    id: UUID
    proyecto_id: UUID
    ultima_edicion_por: Optional[UUID] = None
    fecha_creacion: datetime
    ultima_actualizacion: datetime
    
    model_config = ConfigDict(from_attributes=True)

class WikiHistory(BaseModel):
    id: UUID
    page_id: UUID
    contenido: str
    editado_por: UUID
    fecha_edicion: datetime
    comentario_cambio: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

# --- SCHEDULER ---

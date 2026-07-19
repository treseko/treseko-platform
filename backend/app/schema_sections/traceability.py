from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


REQUIREMENT_STATES = {"BORRADOR", "ACTIVO", "EN_REVISION", "CUMPLIDO", "ARCHIVADO"}
STORY_STATES = {"BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA", "ARCHIVADA"}
PRIORITIES = {"ALTA", "MEDIA", "BAJA"}
MAX_CODE_LENGTH = 40
MAX_TITLE_LENGTH = 255
MAX_MARKDOWN_LENGTH = 512 * 1024
MAX_EXTERNAL_PROVIDER_LENGTH = 80
MAX_EXTERNAL_REFERENCE_LENGTH = 160
MAX_CHANGE_COMMENT_LENGTH = 255
MAX_COMPONENTS_PER_REQUIREMENT = 100
MAX_STORIES_PER_CASE = 100
MAX_GENERATION_INSTRUCTIONS_LENGTH = 4000
MAX_GENERATION_STORIES = 20


def _validate_url(value: Optional[str]) -> Optional[str]:
    if value is None or not value.strip():
        return None
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("La URL externa debe ser HTTP/HTTPS absoluta y no incluir credenciales")
    return value.strip()


class ExternalReference(BaseModel):
    external_provider: Optional[str] = Field(default=None, max_length=MAX_EXTERNAL_PROVIDER_LENGTH)
    external_reference: Optional[str] = Field(default=None, max_length=MAX_EXTERNAL_REFERENCE_LENGTH)
    external_url: Optional[str] = None

    @field_validator("external_url")
    @classmethod
    def validate_external_url(cls, value):
        return _validate_url(value)


class RequisitoBase(ExternalReference):
    codigo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_CODE_LENGTH)
    titulo: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    descripcion_markdown: str = Field(default="", max_length=MAX_MARKDOWN_LENGTH)
    estado: str = "BORRADOR"
    prioridad: str = "MEDIA"
    componente_ids: List[UUID] = Field(default_factory=list, max_length=MAX_COMPONENTS_PER_REQUIREMENT)

    @field_validator("estado")
    @classmethod
    def validate_state(cls, value):
        normalized = value.strip().upper()
        if normalized not in REQUIREMENT_STATES:
            raise ValueError("Estado de requisito invalido")
        return normalized

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        normalized = value.strip().upper()
        if normalized not in PRIORITIES:
            raise ValueError("Prioridad invalida")
        return normalized

    @field_validator("componente_ids")
    @classmethod
    def validate_components(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("No se puede repetir un componente")
        return value


class RequisitoCreate(RequisitoBase):
    proyecto_id: UUID


class RequisitoUpdate(ExternalReference):
    titulo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_TITLE_LENGTH)
    descripcion_markdown: Optional[str] = Field(default=None, max_length=MAX_MARKDOWN_LENGTH)
    estado: Optional[str] = None
    prioridad: Optional[str] = None
    componente_ids: Optional[List[UUID]] = Field(default=None, max_length=MAX_COMPONENTS_PER_REQUIREMENT)
    comentario_cambio: Optional[str] = Field(default=None, max_length=MAX_CHANGE_COMMENT_LENGTH)

    @field_validator("estado")
    @classmethod
    def validate_state(cls, value):
        return RequisitoBase.validate_state(value) if value is not None else value

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        return RequisitoBase.validate_priority(value) if value is not None else value

    @field_validator("componente_ids")
    @classmethod
    def validate_components(cls, value):
        return RequisitoBase.validate_components(value) if value is not None else value


class Requisito(RequisitoBase):
    id: UUID
    proyecto_id: UUID
    creado_por: Optional[UUID] = None
    ultima_edicion_por: Optional[UUID] = None
    fecha_creacion: datetime
    ultima_actualizacion: datetime
    archivado: bool = False

    model_config = ConfigDict(from_attributes=True)


class RequisitoHistorial(BaseModel):
    id: UUID
    requisito_id: UUID
    titulo: str
    descripcion_markdown: str
    estado: str
    prioridad: str
    external_provider: Optional[str] = None
    external_reference: Optional[str] = None
    external_url: Optional[str] = None
    editado_por: Optional[UUID] = None
    fecha_edicion: datetime
    comentario_cambio: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ArchiveRequest(BaseModel):
    archivado: bool = True


class HistoriaBase(ExternalReference):
    codigo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_CODE_LENGTH)
    titulo: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    descripcion_markdown: str = Field(default="", max_length=MAX_MARKDOWN_LENGTH)
    criterios_aceptacion_markdown: str = Field(default="", max_length=MAX_MARKDOWN_LENGTH)
    estado: str = "BORRADOR"
    prioridad: str = "MEDIA"

    @field_validator("estado")
    @classmethod
    def validate_state(cls, value):
        normalized = value.strip().upper()
        if normalized not in STORY_STATES:
            raise ValueError("Estado de historia invalido")
        return normalized

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        return RequisitoBase.validate_priority(value)


class HistoriaCreate(HistoriaBase):
    requisito_id: UUID
    proyecto_id: UUID


class HistoriaUpdate(ExternalReference):
    titulo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_TITLE_LENGTH)
    descripcion_markdown: Optional[str] = Field(default=None, max_length=MAX_MARKDOWN_LENGTH)
    criterios_aceptacion_markdown: Optional[str] = Field(default=None, max_length=MAX_MARKDOWN_LENGTH)
    estado: Optional[str] = None
    prioridad: Optional[str] = None
    comentario_cambio: Optional[str] = Field(default=None, max_length=MAX_CHANGE_COMMENT_LENGTH)

    @field_validator("estado")
    @classmethod
    def validate_state(cls, value):
        return HistoriaBase.validate_state(value) if value is not None else value

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        return HistoriaBase.validate_priority(value) if value is not None else value


class HistoriaGeneracionEstimateRequest(BaseModel):
    wiki_page_ids: List[UUID] = Field(default_factory=list, max_length=30)
    componente_ids: List[UUID] = Field(default_factory=list, max_length=50)
    instrucciones: str = Field(default="", max_length=MAX_GENERATION_INSTRUCTIONS_LENGTH)


class HistoriaGeneracionGenerateRequest(BaseModel):
    max_historias: int = Field(..., ge=1, le=MAX_GENERATION_STORIES)


class HistoriaGeneracionApplyStory(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    descripcion_markdown: str = Field(default="", max_length=MAX_MARKDOWN_LENGTH)
    criterios_aceptacion_markdown: str = Field(default="", max_length=MAX_MARKDOWN_LENGTH)
    prioridad: str = "MEDIA"

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        return RequisitoBase.validate_priority(value)


class HistoriaGeneracionApplyRequest(BaseModel):
    historias: List[HistoriaGeneracionApplyStory] = Field(..., min_length=1, max_length=MAX_GENERATION_STORIES)


class Historia(HistoriaBase):
    id: UUID
    requisito_id: UUID
    proyecto_id: UUID
    creado_por: Optional[UUID] = None
    ultima_edicion_por: Optional[UUID] = None
    fecha_creacion: datetime
    ultima_actualizacion: datetime
    archivado: bool = False
    requisito_codigo: Optional[str] = None
    requisito_titulo: Optional[str] = None
    case_count: int = 0
    requiere_revision_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class HistoriaHistorial(BaseModel):
    id: UUID
    historia_id: UUID
    titulo: str
    descripcion_markdown: str
    criterios_aceptacion_markdown: str
    estado: str
    prioridad: str
    external_provider: Optional[str] = None
    external_reference: Optional[str] = None
    external_url: Optional[str] = None
    editado_por: Optional[UUID] = None
    fecha_edicion: datetime
    comentario_cambio: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CasoHistoriasUpdate(BaseModel):
    historia_ids: List[UUID] = Field(default_factory=list, max_length=MAX_STORIES_PER_CASE)

    @field_validator("historia_ids")
    @classmethod
    def validate_unique_stories(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("No se puede repetir una historia")
        return value


class CasoHistoriaDetail(BaseModel):
    historia_id: UUID
    historia_codigo: str
    historia_titulo: str
    historia_estado: str
    requisito_id: UUID
    requisito_codigo: str
    requisito_titulo: str
    requiere_revision: bool
    fecha_revision: Optional[datetime] = None


class CoverageSummary(BaseModel):
    requisitos_total: int = 0
    requisitos_sin_historias: int = 0
    requisitos_con_historias: int = 0
    historias_total: int = 0
    historias_sin_casos: int = 0
    historias_con_casos: int = 0
    casos_sin_historia: int = 0
    historias_requieren_revision: int = 0
    cobertura_historias_porcentaje: float = 0
    items: List[dict] = Field(default_factory=list)

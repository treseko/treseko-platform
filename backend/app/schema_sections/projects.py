from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator

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

MAX_PROJECT_NAME_LENGTH = 150
MAX_PROJECT_DESCRIPTION_LENGTH = 12000
MAX_PROJECT_ROLE_LENGTH = 50
MAX_COMPONENT_NAME_LENGTH = 100
MAX_COMPONENT_DESCRIPTION_LENGTH = 12000
MAX_COMPONENT_TECH_STACK_LENGTH = 255
MAX_COMPONENT_VARIABLES_BYTES = 64 * 1024
MAX_BUILD_NAME_LENGTH = 150
MAX_BUILD_CHANGE_CONTEXT_LENGTH = 12000
MAX_BUILD_CASE_ASSIGNMENTS = 2000
MAX_REDMINE_URL_LENGTH = 255
MAX_REDMINE_API_KEY_LENGTH = 255
MAX_REDMINE_PROJECT_IDENTIFIER_LENGTH = 100
MAX_REDMINE_CUSTOM_FIELDS_BYTES = 32 * 1024


def validate_component_variables(value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    return validate_preference_json_payload(value, max_bytes=MAX_COMPONENT_VARIABLES_BYTES, label="Las variables del componente")


def validate_build_dates(fecha_inicio: Optional[datetime], fecha_fin: Optional[datetime]) -> None:
    if fecha_inicio and fecha_fin and fecha_fin < fecha_inicio:
        raise ValueError("fecha_fin cannot be earlier than fecha_inicio")


def validate_redmine_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Redmine URL must be absolute HTTP/HTTPS")
    if parsed.username or parsed.password:
        raise ValueError("Redmine URL cannot include credentials")
    return value.rstrip("/")


def validate_redmine_api_key(value: str) -> str:
    token = (value or "").strip()
    if not token or len(token) > MAX_REDMINE_API_KEY_LENGTH or any(char.isspace() for char in token) or "\x00" in token:
        raise ValueError("Redmine API key invalida")
    return token


class ProyectoMiembroCreate(BaseModel):
    usuario_id: UUID
    rol_proyecto: str = Field(default="MEMBER", min_length=1, max_length=MAX_PROJECT_ROLE_LENGTH)

class ProyectoMiembro(BaseModel):
    id: UUID
    proyecto_id: UUID
    usuario_id: UUID
    rol_proyecto: str
    fecha_asignacion: datetime
    usuario: Optional[Usuario] = None

    model_config = ConfigDict(from_attributes=True)

# --- ORGANIZACION ---

class ComponenteBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_COMPONENT_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_COMPONENT_DESCRIPTION_LENGTH)
    tech_stack: Optional[str] = Field(default=None, max_length=MAX_COMPONENT_TECH_STACK_LENGTH)
    variables: Dict[str, str] = Field(default_factory=dict)

    @field_validator("variables")
    @classmethod
    def validate_variables(cls, value):
        return validate_component_variables(value) or {}

class ComponenteCreate(ComponenteBase):
    proyecto_id: UUID

class ComponenteUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_COMPONENT_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_COMPONENT_DESCRIPTION_LENGTH)
    tech_stack: Optional[str] = Field(default=None, max_length=MAX_COMPONENT_TECH_STACK_LENGTH)
    variables: Optional[Dict[str, str]] = None

    @field_validator("variables")
    @classmethod
    def validate_variables(cls, value):
        return validate_component_variables(value)

class Componente(ComponenteBase):
    id: UUID
    codigo: Optional[str] = None
    proyecto_id: UUID
    
    model_config = ConfigDict(from_attributes=True)

# --- BUILD ---

class BuildBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_BUILD_NAME_LENGTH)
    contexto_cambio: Optional[str] = Field(default=None, max_length=MAX_BUILD_CHANGE_CONTEXT_LENGTH)
    activo: bool = False
    oculto: bool = False
    fecha_inicio: Optional[datetime] = None
    fecha_fin: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_date_range(self):
        validate_build_dates(self.fecha_inicio, self.fecha_fin)
        return self

class BuildCreate(BuildBase):
    proyecto_id: UUID
    componente_id: UUID

class BuildUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_BUILD_NAME_LENGTH)
    contexto_cambio: Optional[str] = Field(default=None, max_length=MAX_BUILD_CHANGE_CONTEXT_LENGTH)
    activo: Optional[bool] = None
    oculto: Optional[bool] = None
    componente_id: Optional[UUID] = None
    fecha_inicio: Optional[datetime] = None
    fecha_fin: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_date_range(self):
        validate_build_dates(self.fecha_inicio, self.fecha_fin)
        return self

class Build(BuildBase):
    id: UUID
    codigo: Optional[str] = None
    proyecto_id: UUID
    componente_id: Optional[UUID] = None
    fecha_creacion: datetime

    model_config = ConfigDict(from_attributes=True)

class BuildCasosUpdate(BaseModel):
    caso_ids: List[UUID] = Field(default_factory=list, max_length=MAX_BUILD_CASE_ASSIGNMENTS)

class BuildCasoPromoteVersion(BaseModel):
    old_caso_id: UUID
    new_caso_id: UUID

# --- PROYECTO ---

class ProyectoBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_PROJECT_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_PROJECT_DESCRIPTION_LENGTH)
    estado: str = Field(default="Activo", max_length=50)
    imagen_url: Optional[str] = Field(default=None, max_length=500)
    activo: bool = True
    organizacion_id: Optional[UUID] = None

class ProyectoCreate(ProyectoBase):
    pass

class ProyectoUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_PROJECT_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_PROJECT_DESCRIPTION_LENGTH)
    estado: Optional[str] = Field(default=None, max_length=50)
    imagen_url: Optional[str] = Field(default=None, max_length=500)
    activo: Optional[bool] = None
    organizacion_id: Optional[UUID] = None

class Proyecto(ProyectoBase):
    id: UUID
    codigo: Optional[str] = None
    fecha_creacion: datetime
    
    model_config = ConfigDict(from_attributes=True)

# --- SUITE ---

class RedmineConfigBase(BaseModel):
    url: str = Field(..., min_length=1, max_length=MAX_REDMINE_URL_LENGTH)
    api_key: str = Field(..., min_length=1, max_length=MAX_REDMINE_API_KEY_LENGTH)
    project_identifier: str = Field(..., min_length=1, max_length=MAX_REDMINE_PROJECT_IDENTIFIER_LENGTH)
    custom_fields: Optional[dict] = None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value):
        return validate_redmine_url(value)

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value):
        return validate_redmine_api_key(value)

    @field_validator("custom_fields")
    @classmethod
    def validate_custom_fields(cls, value):
        return validate_preference_json_payload(value, max_bytes=MAX_REDMINE_CUSTOM_FIELDS_BYTES, label="Redmine custom fields")

class RedmineConfigCreate(RedmineConfigBase):
    proyecto_id: UUID

class RedmineConfig(RedmineConfigBase):
    id: UUID
    proyecto_id: UUID
    
    model_config = ConfigDict(from_attributes=True)

# --- TEST RUNS ---

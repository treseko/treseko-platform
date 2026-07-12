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

MAX_ORG_NAME_LENGTH = 150
MAX_ORG_DESCRIPTION_LENGTH = 12000
MAX_ORG_TYPE_LENGTH = 50
MAX_ORG_ROLE_LENGTH = 50


class OrganizacionBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_ORG_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_ORG_DESCRIPTION_LENGTH)
    tipo: Optional[str] = Field(default=None, max_length=MAX_ORG_TYPE_LENGTH) # Empresa, Cliente, Marca
    activo: bool = True

class OrganizacionCreate(OrganizacionBase):
    pass

class OrganizacionUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_ORG_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_ORG_DESCRIPTION_LENGTH)
    tipo: Optional[str] = Field(default=None, max_length=MAX_ORG_TYPE_LENGTH)
    activo: Optional[bool] = None

class Organizacion(OrganizacionBase):
    id: UUID
    codigo: Optional[str] = None
    fecha_creacion: datetime
    
    model_config = ConfigDict(from_attributes=True)

class OrganizacionMiembroCreate(BaseModel):
    usuario_id: UUID
    rol_cliente: str = Field(default="MEMBER", min_length=1, max_length=MAX_ORG_ROLE_LENGTH)

class OrganizacionMiembro(BaseModel):
    id: UUID
    organizacion_id: UUID
    usuario_id: UUID
    rol_cliente: str
    fecha_asignacion: datetime
    usuario: Optional[Usuario] = None

    model_config = ConfigDict(from_attributes=True)

# --- ENTORNOS ---

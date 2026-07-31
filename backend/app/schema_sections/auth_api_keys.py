"""Small API-key and audit schemas kept separate from identity/RBAC schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyCreate(BaseModel):
    nombre: str = Field(default="Automatizacion externa", min_length=1, max_length=100)


class ApiKey(BaseModel):
    id: UUID
    nombre: str
    key_prefix: str
    activo: bool
    fecha_creacion: datetime
    ultimo_uso: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ApiKeyCreated(ApiKey):
    api_key: str


class AuditLog(BaseModel):
    id: UUID
    usuario_id: Optional[UUID] = None
    usuario_email: Optional[str] = None
    usuario_nombre: Optional[str] = None
    accion: str
    recurso: str
    recurso_id: Optional[UUID] = None
    detalles: Optional[dict] = None
    ip_address: Optional[str] = None
    origen: Optional[str] = None
    correlation_id: Optional[str] = None
    fecha: datetime

    model_config = ConfigDict(from_attributes=True)

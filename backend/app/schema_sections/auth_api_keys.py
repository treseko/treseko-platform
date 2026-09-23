"""Small API-key and audit schemas kept separate from identity/RBAC schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ApiKeyCreate(BaseModel):
    nombre: str = Field(default="Automatizacion externa", min_length=1, max_length=100)


class McpApiKeyCreate(BaseModel):
    nombre: str = Field(default="Agente MCP", min_length=1, max_length=100)
    expires_at: Optional[datetime] = None
    scopes: List[str] = Field(default_factory=list, max_length=50)

    @field_validator("expires_at")
    @classmethod
    def validate_expiration(cls, value):
        if value is not None and value <= datetime.now(value.tzinfo):
            raise ValueError("La expiracion debe estar en el futuro")
        return value

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, value):
        import re
        from app.services.mcp_governance import validate_scopes as validate_mcp_scopes
        normalized = list(dict.fromkeys(scope.strip() for scope in value))
        if any(not re.fullmatch(r"^[a-z0-9][a-z0-9._-]{0,119}$", scope) for scope in normalized):
            raise ValueError("Scope MCP invalido")
        return validate_mcp_scopes(normalized)


class ApiKey(BaseModel):
    id: UUID
    nombre: str
    key_prefix: str
    activo: bool
    fecha_creacion: datetime
    ultimo_uso: Optional[datetime] = None
    purpose: str = "legacy"
    expires_at: Optional[datetime] = None
    scopes_json: List[str] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ApiKeyCreated(ApiKey):
    api_key: str


class McpApiKey(ApiKey):
    purpose: str = "mcp"


class McpApiKeyCreated(McpApiKey):
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

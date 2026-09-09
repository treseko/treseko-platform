from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class ApiTestExecuteRequest(BaseModel):
    build_id: UUID
    entorno_id: UUID
    dataset_id: Optional[UUID] = None
    case_ids: list[UUID] = Field(default_factory=list)
    suite_id: Optional[UUID] = None
    origen: str = "AUTOMATIZADA"
    iterations: int = Field(default=1, ge=1, le=100)
    run_id: Optional[UUID] = None
    prepare_only: bool = False
    dynamic_seed: Optional[str] = Field(default=None, max_length=255)


class ApiManualEvaluationRequest(BaseModel):
    status: Literal["PASO", "FALLO", "BLOQUEADO"]
    notes: Optional[str] = Field(default=None, max_length=20_000)


class ApiTestValidationRequest(BaseModel):
    configuracion_api: Dict[str, Any] = Field(default_factory=dict)


class ApiTestValidationResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ApiTestDryRunRequest(BaseModel):
    proyecto_id: UUID
    entorno_id: UUID
    dataset_id: Optional[UUID] = None
    configuracion_api: Dict[str, Any] = Field(default_factory=dict)
    dynamic_seed: Optional[str] = Field(default=None, max_length=255)


class ApiPersistentStateValue(BaseModel):
    key: str = Field(..., pattern=r"^api\.[A-Za-z0-9_.-]+$", max_length=255)
    value: Any
    version: int = Field(default=0, ge=0)
    last_run_id: Optional[UUID] = None
    last_case_id: Optional[UUID] = None
    updated_by: Optional[UUID] = None
    fecha_actualizacion: Optional[datetime] = None


class ApiPersistentStateUpdate(BaseModel):
    value: Any
    version: int = Field(default=0, ge=0)


class ApiPersistentStateList(BaseModel):
    entorno_id: UUID
    items: list[ApiPersistentStateValue] = Field(default_factory=list)

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_serializer, field_validator, model_validator

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

class ExternalExecutionStep(BaseModel):
    number: int = Field(ge=1, le=1000)
    status: EstadoResultado
    observations: Optional[str] = Field(default=None, max_length=4000)
    evidence_url: Optional[str] = Field(default=None, max_length=1000)
    error_log: Optional[str] = Field(default=None, max_length=12000)

    @field_validator("status")
    @classmethod
    def validate_external_step_status(cls, value):
        allowed = {
            EstadoResultado.PASO,
            EstadoResultado.FALLO,
            EstadoResultado.BLOQUEADO,
            EstadoResultado.SIN_CORRER,
        }
        if value not in allowed:
            raise ValueError("status de paso externo debe ser PASO, FALLO, BLOQUEADO o SIN_CORRER")
        return value

class ExternalExecutionCase(BaseModel):
    case_code: str = Field(min_length=1, max_length=80)
    status: EstadoResultado
    observations: Optional[str] = Field(default=None, max_length=4000)
    duration_seconds: int = Field(default=0, ge=0, le=604800)
    evidence_url: Optional[str] = Field(default=None, max_length=1000)
    external_case_run_id: Optional[str] = Field(default=None, max_length=120)
    steps: List[ExternalExecutionStep] = Field(default_factory=list, max_length=250)

    @field_validator("status")
    @classmethod
    def validate_external_case_status(cls, value):
        allowed = {
            EstadoResultado.PASO,
            EstadoResultado.FALLO,
            EstadoResultado.BLOQUEADO,
        }
        if value not in allowed:
            raise ValueError("status final del caso externo debe ser PASO, FALLO o BLOQUEADO")
        return value

    @model_validator(mode="after")
    def validate_external_case_consistency(self):
        step_numbers = [step.number for step in self.steps]
        if len(step_numbers) != len(set(step_numbers)):
            raise ValueError("steps no puede contener numeros de paso duplicados")

        step_statuses = [step.status for step in self.steps]
        if self.status == EstadoResultado.PASO and any(status != EstadoResultado.PASO for status in step_statuses):
            raise ValueError("un caso PASO solo puede contener pasos PASO")
        if self.status == EstadoResultado.FALLO and step_statuses and not any(status == EstadoResultado.FALLO for status in step_statuses):
            raise ValueError("un caso FALLO debe contener al menos un paso FALLO")
        if self.status == EstadoResultado.BLOQUEADO and step_statuses and not any(status == EstadoResultado.BLOQUEADO for status in step_statuses):
            raise ValueError("un caso BLOQUEADO debe contener al menos un paso BLOQUEADO")
        return self

class ExternalExecutionReport(BaseModel):
    solution_code: str = Field(min_length=1, max_length=80)
    project_code: str = Field(min_length=1, max_length=80)
    component_code: str = Field(min_length=1, max_length=80)
    build_code: str = Field(min_length=1, max_length=80)
    external_run_id: Optional[str] = Field(default=None, max_length=120)
    environment: str = Field(default="qa", max_length=80)
    overwrite: StrictBool = True
    cases: List[ExternalExecutionCase] = Field(min_length=1, max_length=500)

class ExternalExecutionCaseResult(BaseModel):
    case_code: str
    status: str
    execution_id: Optional[UUID] = None
    final_status: Optional[EstadoResultado] = None
    error: Optional[str] = None

class ExternalExecutionReportResponse(BaseModel):
    run_id: Optional[UUID] = None
    external_run_id: Optional[str] = None
    solution_code: str
    project_code: str
    component_code: str
    build_code: str
    processed: int
    rejected: int
    results: List[ExternalExecutionCaseResult]

# --- AUDITORIA ---

from __future__ import annotations

from datetime import datetime
import json
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


class ExternalChatbotResult(BaseModel):
    """Evidence produced by an external conversational runner.

    The runner owns the observed conversation, while Treseko resolves the
    expected messages and assertions from the frozen test case configuration.
    Keeping this as a bounded object preserves forward compatibility for
    clients without allowing an unbounded JSON upload.
    """

    schema_version: int = Field(default=1, ge=1, le=10)
    protocol: Optional[str] = Field(default="treseko.chatbot/v1", max_length=80)
    conversation_strategy: Optional[str] = Field(default="external_api", max_length=80)
    session_id: Optional[str] = Field(default=None, max_length=255)
    status: Optional[str] = Field(default=None, max_length=30)
    turns: List[Dict[str, Any]] = Field(min_length=1, max_length=250)
    performance: Dict[str, Any] = Field(default_factory=dict)
    conversation: List[Dict[str, Any]] = Field(default_factory=list, max_length=500)
    assertions: List[Dict[str, Any]] = Field(default_factory=list, max_length=500)
    security_findings: List[Dict[str, Any]] = Field(default_factory=list, max_length=100)
    memory_checks: List[Dict[str, Any]] = Field(default_factory=list, max_length=250)
    tools: List[Dict[str, Any]] = Field(default_factory=list, max_length=250)
    http_errors: List[Any] = Field(default_factory=list, max_length=250)
    error_code: Optional[str] = Field(default=None, max_length=120)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    profile: Dict[str, Any] = Field(default_factory=dict)
    variables: Dict[str, Any] = Field(default_factory=dict)
    human_evaluation: Dict[str, Any] = Field(default_factory=dict)
    judge: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("turns")
    @classmethod
    def validate_external_chatbot_turns(cls, value):
        allowed_statuses = {"PASSED", "FAILED", "BLOCKED"}
        technical_indexes = []
        for position, turn in enumerate(value):
            if not isinstance(turn, dict):
                raise ValueError("chatbot.turns debe contener objetos")
            status = str(turn.get("status") or "").upper()
            if status not in allowed_statuses:
                raise ValueError("cada chatbot.turn debe tener status PASSED, FAILED o BLOCKED")
            technical_index = turn.get("technical_index")
            if technical_index is not None:
                if not isinstance(technical_index, int) or technical_index < 0:
                    raise ValueError("chatbot.turn.technical_index debe ser zero-based")
                technical_indexes.append(technical_index)
            if len(json.dumps(turn, ensure_ascii=False, default=str).encode("utf-8")) > 256 * 1024:
                raise ValueError("cada chatbot.turn excede el limite de evidencia permitido")
        if technical_indexes and technical_indexes != list(range(len(technical_indexes))):
            raise ValueError("chatbot.turns debe conservar indices tecnicos zero-based y consecutivos")
        return value

    @model_validator(mode="after")
    def validate_external_chatbot_payload_size(self):
        encoded = json.dumps(self.model_dump(mode="json"), ensure_ascii=False, default=str).encode("utf-8")
        if len(encoded) > 512 * 1024:
            raise ValueError("chatbot excede el limite de evidencia permitido")
        return self

class ExternalExecutionCase(BaseModel):
    case_code: str = Field(min_length=1, max_length=80)
    status: EstadoResultado
    observations: Optional[str] = Field(default=None, max_length=4000)
    duration_seconds: int = Field(default=0, ge=0, le=604800)
    evidence_url: Optional[str] = Field(default=None, max_length=1000)
    external_case_run_id: Optional[str] = Field(default=None, max_length=120)
    steps: List[ExternalExecutionStep] = Field(default_factory=list, max_length=250)
    chatbot: Optional[ExternalChatbotResult] = None
    api: Optional[Dict[str, Any]] = None

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
        if self.chatbot:
            turn_statuses = [str(turn.get("status") or "").upper() for turn in self.chatbot.turns]
            if self.status == EstadoResultado.PASO and any(status != "PASSED" for status in turn_statuses):
                raise ValueError("un caso conversacional PASO solo puede contener turnos PASSED")
            if self.status == EstadoResultado.FALLO and not any(status == "FAILED" for status in turn_statuses):
                raise ValueError("un caso conversacional FALLO debe contener un turno FAILED")
            if self.status == EstadoResultado.BLOQUEADO and not any(status == "BLOCKED" for status in turn_statuses):
                raise ValueError("un caso conversacional BLOQUEADO debe contener un turno BLOCKED")
        if self.api is not None:
            if self.chatbot is not None:
                raise ValueError("un caso externo no puede incluir evidencia chatbot y API a la vez")
            if len(json.dumps(self.api, ensure_ascii=False, default=str).encode("utf-8")) > 512 * 1024:
                raise ValueError("api excede el limite de evidencia permitido")
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

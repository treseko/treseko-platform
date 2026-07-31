from __future__ import annotations

import json
import re
from urllib.parse import urlsplit
from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from uuid import UUID

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

MAX_AI_STRING_LENGTH = 200
MAX_AI_PROVIDER_LENGTH = 80
MAX_AI_ENDPOINT_LENGTH = 500
MAX_AI_MODEL_LENGTH = 160
MAX_AI_PROMPT_TEMPLATE_LENGTH = 50_000
MAX_AI_CHANGELOG_LENGTH = 4_000
MAX_AI_DESCRIPTION_LENGTH = 2_000
MAX_AI_JSON_BYTES = 64 * 1024
MAX_AI_CONFIG_JSON_BYTES = 128 * 1024
MAX_AI_IMPORT_JSON_BYTES = 512 * 1024
MAX_AI_RESULT_JSON_BYTES = 256 * 1024
MAX_AI_LOG_LENGTH = 120_000
MAX_AI_ERROR_LENGTH = 8_000
MAX_AI_SCREENSHOT_BASE64_LENGTH = 16 * 1024 * 1024
MAX_AI_WORKFLOW_NODES = 100
MAX_AI_WORKFLOW_EDGES = 300
MAX_AI_WORKFLOW_IMPORT_ROWS = 500
MAX_AI_MODEL_CATALOG_ITEMS = 500
MAX_AI_AGENT_WORKFLOW_ITEMS = 200
MAX_AI_DRY_RUN_STEPS = 200
AI_WORKFLOW_PURPOSES = {"test_execution", "story_generation", "test_case_generation"}
MAX_AI_RESULT_STEPS = 500



from .ai_base import *
from .ai_provider import *
from .ai_workflow import *

class AiExecutionTraceResponse(BaseModel):
    id: UUID
    execution_id: Optional[UUID] = None
    workflow_id: Optional[UUID] = None
    workflow_version: Optional[int] = None
    node_id: Optional[UUID] = None
    universal_agent_version_id: Optional[UUID] = None
    workflow_format: Optional[str] = None
    implementation_key: Optional[str] = None
    execution_plan_hash: Optional[str] = None
    capabilities_json: List[str] = Field(default_factory=list)
    tools_json: List[str] = Field(default_factory=list)
    model_id: Optional[str] = None
    prompt_hash: Optional[str] = None
    evidence_refs_json: List[Any] = Field(default_factory=list)
    status: str
    input_json: Dict[str, Any] = Field(default_factory=dict)
    output_json: Dict[str, Any] = Field(default_factory=dict)
    metrics_json: Dict[str, Any] = Field(default_factory=dict)
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class AiEngineHealth(BaseModel):
    status: str
    detail: Optional[str] = None
    engine: Optional[Dict[str, Any]] = None

class SystemMonitorComponent(BaseModel):
    id: str
    name: str
    type: str
    version: Optional[str] = None
    target: Optional[str] = None
    status: str
    latency_ms: Optional[int] = None
    detail: Optional[str] = None
    restart_hint: Optional[str] = None
    checked_at: datetime

class SystemMonitorWorker(BaseModel):
    runner_id: UUID
    name: str
    type: str
    status: str
    active: bool
    last_heartbeat: Optional[datetime] = None
    hostname: Optional[str] = None
    local_ips: List[str] = Field(default_factory=list)
    pid: Optional[int] = None
    tags: List[str] = Field(default_factory=list)
    capabilities: Dict[str, Any] = Field(default_factory=dict)
    resources: Dict[str, Any] = Field(default_factory=dict)
    active_jobs: int = 0
    current_job_id: Optional[str] = None
    uptime_seconds: Optional[int] = None
    version: Optional[str] = None

class SystemMonitorSummary(BaseModel):
    overall_status: str
    uptime_percent: int
    components: List[SystemMonitorComponent]
    workers: List[SystemMonitorWorker]
    restart_hints: Dict[str, str]
    checked_at: datetime

class AiEngineResultStep(BaseModel):
    number: int = Field(ge=1, le=10_000)
    status: EstadoResultado
    observations: Optional[str] = Field(default=None, max_length=8_000)
    error_log: Optional[str] = Field(default=None, max_length=MAX_AI_ERROR_LENGTH)
    screenshot_base64: Optional[str] = Field(default=None, max_length=MAX_AI_SCREENSHOT_BASE64_LENGTH)

    @field_validator("status", mode="before")
    @classmethod
    def validate_engine_step_status(cls, value: Any) -> Any:
        return normalize_ai_engine_status(value)

class AiEngineExecutionResult(BaseModel):
    status: EstadoResultado
    duration_seconds: int = Field(default=0, ge=0, le=604800)
    observations: Optional[str] = Field(default=None, max_length=8_000)
    logs: Optional[str] = Field(default=None, max_length=MAX_AI_LOG_LENGTH)
    error_message: Optional[str] = Field(default=None, max_length=MAX_AI_ERROR_LENGTH)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    ai_report: Dict[str, Any] = Field(default_factory=dict)
    steps: List[AiEngineResultStep] = Field(default_factory=list, max_length=MAX_AI_RESULT_STEPS)
    final_screenshot_base64: Optional[str] = Field(default=None, max_length=MAX_AI_SCREENSHOT_BASE64_LENGTH)

    @field_validator("status", mode="before")
    @classmethod
    def validate_engine_result_status(cls, value: Any) -> Any:
        return normalize_ai_engine_status(value)

    @field_validator("duration_seconds", mode="before")
    @classmethod
    def validate_engine_duration(cls, value: Any) -> int:
        return normalize_ai_duration_seconds(value)

    @field_validator("metadata", "ai_report")
    @classmethod
    def validate_result_json(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_result_json_payload(value) or {}


class AiEngineExecutionAck(BaseModel):
    execution_id: UUID
    status: EstadoResultado
    acknowledged: bool = True
    report_complete: bool = True
    terminal_delivery_id: str = Field(min_length=1, max_length=200)

class AiEngineDryRunRequest(BaseModel):
    proyecto_id: UUID
    componente_id: Optional[UUID] = None
    titulo: str = Field(default="Prueba temporal con IA", min_length=1, max_length=200)
    codigo: Optional[str] = Field(default="AI-DRY-RUN", max_length=80)
    descripcion: Optional[str] = Field(default=None, max_length=10_000)
    precondiciones: Optional[str] = Field(default=None, max_length=10_000)
    postcondiciones: Optional[str] = Field(default=None, max_length=10_000)
    datos_caso: Optional[str] = Field(default=None, max_length=20_000)
    entorno_id: Optional[UUID] = None
    dataset_id: Optional[UUID] = None
    debug_mode: bool = False
    pasos: List[Dict[str, Any]] = Field(default_factory=list, max_length=MAX_AI_DRY_RUN_STEPS)

    @field_validator("pasos")
    @classmethod
    def validate_dry_run_steps(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return validate_ai_json_list(
            value,
            max_items=MAX_AI_DRY_RUN_STEPS,
            max_bytes=MAX_AI_CONFIG_JSON_BYTES,
            label="Los pasos temporales de IA",
        ) or []

class AiEngineDryRunResult(BaseModel):
    status: EstadoResultado
    duration_seconds: int = Field(default=0, ge=0, le=604800)
    observations: Optional[str] = Field(default=None, max_length=8_000)
    logs: Optional[str] = Field(default=None, max_length=MAX_AI_LOG_LENGTH)
    error_message: Optional[str] = Field(default=None, max_length=MAX_AI_ERROR_LENGTH)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    ai_report: Dict[str, Any] = Field(default_factory=dict)
    steps: List[AiEngineResultStep] = Field(default_factory=list, max_length=MAX_AI_RESULT_STEPS)
    final_screenshot_base64: Optional[str] = Field(default=None, max_length=MAX_AI_SCREENSHOT_BASE64_LENGTH)

    @field_validator("status", mode="before")
    @classmethod
    def validate_engine_result_status(cls, value: Any) -> Any:
        return normalize_ai_engine_status(value)

    @field_validator("duration_seconds", mode="before")
    @classmethod
    def validate_engine_duration(cls, value: Any) -> int:
        return normalize_ai_duration_seconds(value)

    @field_validator("metadata", "ai_report")
    @classmethod
    def validate_result_json(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_result_json_payload(value) or {}

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

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
MAX_AI_RESULT_STEPS = 500


def validate_ai_json_payload(value: Optional[Dict[str, Any]], *, max_bytes: int = MAX_AI_JSON_BYTES) -> Optional[Dict[str, Any]]:
    return validate_preference_json_payload(
        value,
        max_bytes=max_bytes,
        label="La configuracion de IA",
    )


def validate_ai_json_list(value: Optional[List[Dict[str, Any]]], *, max_items: int, max_bytes: int, label: str) -> Optional[List[Dict[str, Any]]]:
    if value is None:
        return value
    if len(value) > max_items:
        raise ValueError(f"{label} contiene demasiados elementos")
    validate_preference_json_payload(
        {"items": value},
        max_bytes=max_bytes,
        label=label,
    )
    return value


class AiEngineConfig(BaseModel):
    provider: str = Field(default="openai-compatible", min_length=1, max_length=MAX_AI_PROVIDER_LENGTH)
    provider_label: Optional[str] = Field(default=None, max_length=MAX_AI_STRING_LENGTH)
    llm_endpoint: Optional[str] = Field(default="http://127.0.0.1:1234/v1", max_length=MAX_AI_ENDPOINT_LENGTH)
    model: str = Field(default="google/gemma-4-e4b", min_length=1, max_length=MAX_AI_MODEL_LENGTH)
    temperature: float = Field(default=0.1, ge=0, le=2)
    max_steps: int = Field(default=10, ge=1, le=100)
    headless: bool = True
    viewport_width: int = Field(default=1920, ge=320, le=7680)
    viewport_height: int = Field(default=1080, ge=320, le=4320)
    timeout_seconds: int = Field(default=900, ge=30, le=7200)
    max_parallel_ai_runs: int = Field(default=1, ge=1, le=5)
    token_cost_prompt_per_1k: float = Field(default=0.0, ge=0)
    token_cost_completion_per_1k: float = Field(default=0.0, ge=0)
    token_cost_per_1k: float = Field(default=0.01, ge=0)
    model_capabilities: Dict[str, Any] = Field(default_factory=dict)
    model_catalog: List[Dict[str, Any]] = Field(default_factory=list)
    auto_scan_enabled: bool = False
    last_model_scan_at: Optional[datetime] = None
    last_model_scan_status: Optional[str] = None
    agent_workflow: List[Dict[str, Any]] = Field(default_factory=list)
    active_workflow_id: Optional[UUID] = None

    @field_validator("model_capabilities")
    @classmethod
    def validate_model_capabilities(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value, max_bytes=MAX_AI_CONFIG_JSON_BYTES) or {}

    @field_validator("model_catalog")
    @classmethod
    def validate_model_catalog(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return validate_ai_json_list(
            value,
            max_items=MAX_AI_MODEL_CATALOG_ITEMS,
            max_bytes=MAX_AI_CONFIG_JSON_BYTES,
            label="El catalogo de modelos IA",
        ) or []

    @field_validator("agent_workflow")
    @classmethod
    def validate_agent_workflow(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return validate_ai_json_list(
            value,
            max_items=MAX_AI_AGENT_WORKFLOW_ITEMS,
            max_bytes=MAX_AI_CONFIG_JSON_BYTES,
            label="El workflow de agentes IA",
        ) or []

class AiModelScanRequest(BaseModel):
    provider: Optional[str] = Field(default=None, max_length=MAX_AI_PROVIDER_LENGTH)
    llm_endpoint: Optional[str] = Field(default=None, max_length=MAX_AI_ENDPOINT_LENGTH)

class AiModelScanResponse(BaseModel):
    status: str
    detail: Optional[str] = None
    provider: str
    llm_endpoint: Optional[str] = None
    models: List[Dict[str, Any]] = Field(default_factory=list)
    scanned_at: datetime

class AiWorkflowNodeBase(BaseModel):
    id: Optional[UUID] = None
    type: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=160)
    agent_key: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    locked: bool = False
    prompt_template: str = Field(default="", max_length=MAX_AI_PROMPT_TEMPLATE_LENGTH)
    config_json: Dict[str, Any] = Field(default_factory=dict)
    position_x: int = Field(default=0, ge=-100_000, le=100_000)
    position_y: int = Field(default=0, ge=-100_000, le=100_000)
    retry_policy: Dict[str, Any] = Field(default_factory=dict)
    timeout_sec: int = Field(default=60, ge=1, le=7200)
    model_override: Optional[str] = Field(default=None, max_length=MAX_AI_MODEL_LENGTH)
    temperature_override: Optional[float] = Field(default=None, ge=0, le=2)

    @field_validator("config_json", "retry_policy")
    @classmethod
    def validate_node_json(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value, max_bytes=MAX_AI_JSON_BYTES) or {}

class AiWorkflowEdgeBase(BaseModel):
    id: Optional[UUID] = None
    source_node_id: UUID
    target_node_id: UUID
    condition_type: str = Field(default="always", min_length=1, max_length=80)
    condition_json: Dict[str, Any] = Field(default_factory=dict)
    priority: int = Field(default=0, ge=-10_000, le=10_000)
    max_passes: int = Field(default=1, ge=1, le=100)

    @field_validator("condition_json")
    @classmethod
    def validate_condition_json(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value, max_bytes=MAX_AI_JSON_BYTES) or {}

class AiWorkflowBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    version: int = Field(default=1, ge=1, le=10_000)
    status: str = Field(default="DRAFT", min_length=1, max_length=40)
    is_default: bool = False

class AiWorkflowCreate(AiWorkflowBase):
    nodes: List[AiWorkflowNodeBase] = Field(default_factory=list, max_length=MAX_AI_WORKFLOW_NODES)
    edges: List[AiWorkflowEdgeBase] = Field(default_factory=list, max_length=MAX_AI_WORKFLOW_EDGES)
    changelog: Optional[str] = Field(default=None, max_length=MAX_AI_CHANGELOG_LENGTH)

class AiWorkflowUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    version: Optional[int] = Field(default=None, ge=1, le=10_000)
    status: Optional[str] = Field(default=None, min_length=1, max_length=40)
    is_default: Optional[bool] = None
    nodes: Optional[List[AiWorkflowNodeBase]] = Field(default=None, max_length=MAX_AI_WORKFLOW_NODES)
    edges: Optional[List[AiWorkflowEdgeBase]] = Field(default=None, max_length=MAX_AI_WORKFLOW_EDGES)
    changelog: Optional[str] = Field(default=None, max_length=MAX_AI_CHANGELOG_LENGTH)

class AiPromptVersionResponse(BaseModel):
    id: UUID
    node_id: UUID
    version: int
    prompt_template: str
    changelog: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class AiWorkflowNodeResponse(AiWorkflowNodeBase):
    id: UUID
    workflow_id: UUID
    prompt_versions: List[AiPromptVersionResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

class AiWorkflowEdgeResponse(BaseModel):
    id: UUID
    workflow_id: UUID
    source_node_id: UUID
    target_node_id: UUID
    condition_type: str
    condition_json: Dict[str, Any] = Field(default_factory=dict)
    priority: int
    max_passes: int

    model_config = ConfigDict(from_attributes=True)

class AiWorkflowResponse(AiWorkflowBase):
    id: UUID
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    nodes: List[AiWorkflowNodeResponse] = Field(default_factory=list)
    edges: List[AiWorkflowEdgeResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

class AiWorkflowExport(BaseModel):
    workflow: Dict[str, Any]
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    prompt_versions: List[Dict[str, Any]] = Field(default_factory=list)
    workflow_versions: List[Dict[str, Any]] = Field(default_factory=list)

class AiWorkflowImport(BaseModel):
    workflow: Dict[str, Any]
    nodes: List[Dict[str, Any]] = Field(max_length=MAX_AI_WORKFLOW_IMPORT_ROWS)
    edges: List[Dict[str, Any]] = Field(max_length=MAX_AI_WORKFLOW_IMPORT_ROWS)
    prompt_versions: List[Dict[str, Any]] = Field(default_factory=list, max_length=MAX_AI_WORKFLOW_IMPORT_ROWS)
    workflow_versions: List[Dict[str, Any]] = Field(default_factory=list, max_length=MAX_AI_WORKFLOW_IMPORT_ROWS)

    @field_validator("workflow")
    @classmethod
    def validate_import_workflow(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value, max_bytes=MAX_AI_IMPORT_JSON_BYTES) or {}

    @field_validator("nodes", "edges", "prompt_versions", "workflow_versions")
    @classmethod
    def validate_import_rows(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return validate_ai_json_list(
            value,
            max_items=MAX_AI_WORKFLOW_IMPORT_ROWS,
            max_bytes=MAX_AI_IMPORT_JSON_BYTES,
            label="La importacion de workflow IA",
        ) or []

class AiWorkflowVersionResponse(BaseModel):
    id: UUID
    workflow_id: UUID
    version: int
    snapshot_json: Dict[str, Any] = Field(default_factory=dict)
    changelog: str
    restored_from_version: Optional[int] = None
    created_by: Optional[UUID] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class AiWorkflowRollbackRequest(BaseModel):
    changelog: Optional[str] = Field(default=None, max_length=MAX_AI_CHANGELOG_LENGTH)
    confirm_running: bool = False

class AiWorkflowPublishRequest(BaseModel):
    changelog: str = Field(min_length=1, max_length=MAX_AI_CHANGELOG_LENGTH)

class AiWorkflowActivateRequest(BaseModel):
    confirm_running: bool = False

class AiAgentPresetBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    type: str = Field(default="llm_agent", min_length=1, max_length=80)
    category: str = Field(default="custom", min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=MAX_AI_DESCRIPTION_LENGTH)
    prompt_template: str = Field(default="", max_length=MAX_AI_PROMPT_TEMPLATE_LENGTH)
    config_json: Dict[str, Any] = Field(default_factory=dict)
    input_mapping: Dict[str, Any] = Field(default_factory=dict)
    output_schema: Dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True

    @field_validator("config_json", "input_mapping", "output_schema")
    @classmethod
    def validate_preset_json(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value, max_bytes=MAX_AI_JSON_BYTES) or {}

class AiAgentPresetCreate(AiAgentPresetBase):
    pass

class AiAgentPresetUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    type: Optional[str] = Field(default=None, min_length=1, max_length=80)
    category: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=MAX_AI_DESCRIPTION_LENGTH)
    prompt_template: Optional[str] = Field(default=None, max_length=MAX_AI_PROMPT_TEMPLATE_LENGTH)
    config_json: Optional[Dict[str, Any]] = None
    input_mapping: Optional[Dict[str, Any]] = None
    output_schema: Optional[Dict[str, Any]] = None
    enabled: Optional[bool] = None

    @field_validator("config_json", "input_mapping", "output_schema")
    @classmethod
    def validate_preset_json(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_ai_json_payload(value, max_bytes=MAX_AI_JSON_BYTES)

class AiAgentPresetResponse(AiAgentPresetBase):
    id: UUID
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class AiWorkflowNodeFromPresetRequest(BaseModel):
    preset_id: UUID
    position_x: int = Field(default=120, ge=-100_000, le=100_000)
    position_y: int = Field(default=120, ge=-100_000, le=100_000)
    source_node_id: Optional[UUID] = None
    condition_type: str = Field(default="always", min_length=1, max_length=80)

class AiExecutionTraceResponse(BaseModel):
    id: UUID
    execution_id: Optional[UUID] = None
    workflow_id: Optional[UUID] = None
    workflow_version: Optional[int] = None
    node_id: Optional[UUID] = None
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

    @field_validator("metadata", "ai_report")
    @classmethod
    def validate_result_json(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value, max_bytes=MAX_AI_RESULT_JSON_BYTES) or {}

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

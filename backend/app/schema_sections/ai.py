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


def _ai_result_payload_size(value: Dict[str, Any]) -> int:
    return len(json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":")).encode("utf-8"))


def _validate_ai_result_json_value(
    value: Any,
    *,
    depth: int = 0,
    label: str = "El resultado de IA",
) -> None:
    if depth > 20:
        raise ValueError(f"{label} excede la profundidad permitida")
    if value is None or isinstance(value, (bool, int, float)):
        return
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError(f"{label} contiene caracteres invalidos")
        if len(value) > MAX_AI_LOG_LENGTH:
            raise ValueError(f"{label} contiene un texto demasiado largo")
        return
    if isinstance(value, list):
        if len(value) > 5_000:
            raise ValueError(f"{label} contiene demasiados elementos")
        for item in value:
            _validate_ai_result_json_value(item, depth=depth + 1, label=label)
        return
    if isinstance(value, dict):
        if len(value) > 1_000:
            raise ValueError(f"{label} contiene demasiadas claves")
        for key, item in value.items():
            if not isinstance(key, str) or not key or len(key) > MAX_AI_STRING_LENGTH or "\x00" in key:
                raise ValueError(f"{label} contiene una clave invalida")
            _validate_ai_result_json_value(item, depth=depth + 1, label=label)
        return
    raise ValueError(f"{label} contiene un valor no soportado")


def validate_ai_result_json_payload(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if value is None:
        return value
    if not isinstance(value, dict):
        raise ValueError("El resultado de IA debe ser un objeto")
    _validate_ai_result_json_value(value)
    if _ai_result_payload_size(value) > MAX_AI_RESULT_JSON_BYTES:
        raise ValueError("El resultado de IA excede el tamano maximo permitido")
    return value


AI_ENGINE_STATUS_ALIASES = {
    "PASSED": EstadoResultado.PASO,
    "PASS": EstadoResultado.PASO,
    "SUCCESS": EstadoResultado.PASO,
    "SUCCEEDED": EstadoResultado.PASO,
    "OK": EstadoResultado.PASO,
    "FAILED": EstadoResultado.FALLO,
    "FAIL": EstadoResultado.FALLO,
    "ERROR": EstadoResultado.FALLO,
    "BLOCKED": EstadoResultado.BLOQUEADO,
    "SKIPPED": EstadoResultado.BLOQUEADO,
    "RUNNING": EstadoResultado.EJECUTANDO_AI,
    "IN_PROGRESS": EstadoResultado.EJECUTANDO_AI,
    "PENDING": EstadoResultado.SIN_CORRER,
}


def normalize_ai_engine_status(value: Any) -> Any:
    if isinstance(value, EstadoResultado):
        return value
    normalized = str(value or "").strip().upper()
    return AI_ENGINE_STATUS_ALIASES.get(normalized, value)


def normalize_ai_duration_seconds(value: Any) -> int:
    if value is None or value == "":
        return 0
    try:
        return max(0, int(round(float(value))))
    except (TypeError, ValueError):
        return 0


AI_PROVIDER_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$", re.IGNORECASE)
AI_PROVIDER_API_KEY_FIELDS = {"api_key", "updated_at", "label"}
AI_PROVIDER_ADAPTERS = {"openai-responses", "anthropic-messages", "gemini", "azure-openai", "openai-compatible"}
AI_CAPABILITY_STATES = {"tested", "reported", "unsupported", "unknown"}


def validate_ai_provider_endpoint(value: str) -> str:
    endpoint = str(value or "").strip().rstrip("/")
    try:
        parsed = urlsplit(endpoint)
    except ValueError as exc:
        raise ValueError("El endpoint IA es invalido") from exc
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("El endpoint IA no puede contener credenciales, query ni fragment")
    local = (parsed.hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise ValueError("El endpoint IA debe usar HTTPS; HTTP se permite solo en loopback local")
    if not parsed.hostname:
        raise ValueError("El endpoint IA debe incluir un host")
    return endpoint


class AiProviderCredentialCreate(BaseModel):
    provider: str = Field(min_length=1, max_length=MAX_AI_PROVIDER_LENGTH, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    label: str = Field(min_length=1, max_length=160)
    secret: str = Field(min_length=1, max_length=4096)


class AiProviderCredentialReplace(BaseModel):
    secret: str = Field(min_length=1, max_length=4096)


class AiProviderCredentialUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=160)


class AiProviderCredentialResponse(BaseModel):
    id: UUID
    provider: str
    label: str
    active: bool
    configured: bool = True
    key_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class AiProviderProfileBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    provider: str = Field(min_length=1, max_length=MAX_AI_PROVIDER_LENGTH, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    adapter: str = Field(min_length=1, max_length=80)
    endpoint: str = Field(min_length=1, max_length=MAX_AI_ENDPOINT_LENGTH)
    model: str = Field(min_length=1, max_length=MAX_AI_MODEL_LENGTH)
    credential_id: Optional[UUID] = None
    capabilities_json: Dict[str, Any] = Field(default_factory=dict)
    capability_status: str = "unknown"
    enabled: bool = True
    request_timeout_seconds: int = Field(default=300, ge=5, le=900)
    max_retries: int = Field(default=1, ge=0, le=5)
    max_input_tokens: Optional[int] = Field(default=None, ge=1)
    max_output_tokens: Optional[int] = Field(default=None, ge=1, le=20000)

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str) -> str:
        return validate_ai_provider_endpoint(value)

    @field_validator("adapter")
    @classmethod
    def validate_adapter(cls, value: str) -> str:
        if value not in AI_PROVIDER_ADAPTERS:
            raise ValueError("El adaptador IA no esta registrado")
        return value

    @field_validator("capability_status")
    @classmethod
    def validate_capability_status(cls, value: str) -> str:
        if value not in AI_CAPABILITY_STATES:
            raise ValueError("El estado de capacidades IA es invalido")
        return value

    @field_validator("capabilities_json")
    @classmethod
    def validate_capabilities(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value) or {}


class AiProviderProfileCreate(AiProviderProfileBase):
    pass


class AiProviderProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    endpoint: Optional[str] = Field(default=None, min_length=1, max_length=MAX_AI_ENDPOINT_LENGTH)
    model: Optional[str] = Field(default=None, min_length=1, max_length=MAX_AI_MODEL_LENGTH)
    credential_id: Optional[UUID] = None
    capabilities_json: Optional[Dict[str, Any]] = None
    capability_status: Optional[str] = None
    enabled: Optional[bool] = None
    request_timeout_seconds: Optional[int] = Field(default=None, ge=5, le=900)
    max_retries: Optional[int] = Field(default=None, ge=0, le=5)
    max_input_tokens: Optional[int] = Field(default=None, ge=1)
    max_output_tokens: Optional[int] = Field(default=None, ge=1, le=20000)

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: Optional[str]) -> Optional[str]:
        return validate_ai_provider_endpoint(value) if value is not None else None


class AiProviderProfileResponse(AiProviderProfileBase):
    id: UUID
    credential_configured: bool = False
    active_runtime: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


def validate_ai_provider_api_keys(value: Optional[Dict[str, Dict[str, Any]]]) -> Dict[str, Dict[str, Any]]:
    if not value:
        return {}
    if len(value) > 40:
        raise ValueError("Las claves IA contienen demasiados proveedores")
    normalized: Dict[str, Dict[str, Any]] = {}
    for provider, entry in value.items():
        provider_key = str(provider or "").strip().lower()
        if not AI_PROVIDER_KEY_RE.fullmatch(provider_key):
            raise ValueError("Las claves IA contienen un proveedor invalido")
        if not isinstance(entry, dict):
            raise ValueError("Las claves IA deben guardarse por proveedor")
        clean_entry: Dict[str, Any] = {}
        for key, item in entry.items():
            if key not in AI_PROVIDER_API_KEY_FIELDS:
                raise ValueError("Las claves IA contienen un campo no soportado")
            if item is None:
                clean_entry[key] = None
                continue
            text = str(item)
            if len(text) > 4096:
                raise ValueError("Una clave IA excede el tamano permitido")
            if "\x00" in text:
                raise ValueError("Una clave IA contiene caracteres invalidos")
            clean_entry[key] = text
        normalized[provider_key] = clean_entry
    size = len(json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if size > MAX_AI_CONFIG_JSON_BYTES:
        raise ValueError("Las claves IA exceden el tamano maximo permitido")
    return normalized


class AiEngineConfig(BaseModel):
    ai_execution_driver: Literal["treseko_engine", "opencode"] = "treseko_engine"
    opencode_version: Optional[str] = Field(default=None, max_length=64)
    opencode_model: Optional[str] = Field(default=None, max_length=MAX_AI_MODEL_LENGTH)
    opencode_agent: Optional[str] = Field(default=None, max_length=128)
    opencode_timeout_seconds: int = Field(default=30, ge=5, le=300)
    opencode_max_steps: int = Field(default=20, ge=1, le=100)
    opencode_health_status: Optional[str] = Field(default=None, max_length=32)
    opencode_last_verified_at: Optional[datetime] = None
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
    # Runtime limits are persisted in AppSetting, rather than tied to the
    # process environment. They apply to governed story-authoring workflows.
    context_window_tokens: int = Field(default=8192, ge=1024, le=2_000_000)
    max_completion_tokens: int = Field(default=4096, ge=256, le=20000)
    max_parallel_ai_runs: int = Field(default=1, ge=1, le=5)
    token_cost_prompt_per_1k: float = Field(default=0.0, ge=0)
    token_cost_completion_per_1k: float = Field(default=0.0, ge=0)
    token_cost_per_1k: float = Field(default=0.01, ge=0)
    model_capabilities: Dict[str, Any] = Field(default_factory=dict)
    model_catalog: List[Dict[str, Any]] = Field(default_factory=list)
    provider_api_keys: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    provider_api_key_configured: bool = False
    provider_api_key_source: Optional[str] = Field(default=None, max_length=MAX_AI_STRING_LENGTH)
    auto_scan_enabled: bool = False
    last_model_scan_at: Optional[datetime] = None
    last_model_scan_status: Optional[str] = None
    last_model_scan_requires_api_key: bool = False
    last_model_scan_api_key_env: Optional[str] = Field(default=None, max_length=MAX_AI_STRING_LENGTH)
    last_model_scan_api_key_configured: bool = False
    active_provider_profile_id: Optional[UUID] = None
    agent_workflow: List[Dict[str, Any]] = Field(default_factory=list)
    active_workflow_id: Optional[UUID] = None
    active_workflow_ids: Dict[str, UUID] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_generation_token_budget(self):
        if self.max_completion_tokens >= self.context_window_tokens:
            raise ValueError("La salida máxima debe ser menor que la ventana de contexto operativa")
        return self

    @field_validator("active_workflow_ids")
    @classmethod
    def validate_active_workflow_ids(cls, value: Dict[str, UUID]) -> Dict[str, UUID]:
        invalid_purposes = set(value) - AI_WORKFLOW_PURPOSES
        if invalid_purposes:
            raise ValueError("Los workflows activos solo pueden configurarse para ejecución, historias o casos")
        return value

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

    @field_validator("provider_api_keys")
    @classmethod
    def validate_provider_api_keys(cls, value: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        return validate_ai_provider_api_keys(value)

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
    profile_id: Optional[UUID] = None

class AiModelScanResponse(BaseModel):
    status: str
    detail: Optional[str] = None
    provider: str
    llm_endpoint: Optional[str] = None
    models: List[Dict[str, Any]] = Field(default_factory=list)
    scanned_at: datetime
    requires_api_key: bool = False
    api_key_env: Optional[str] = None
    api_key_configured: bool = False
    api_key_source: Optional[str] = None

class AiWorkflowNodeBase(BaseModel):
    id: Optional[UUID] = None
    type: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=160)
    agent_key: str = Field(min_length=1, max_length=120)
    agent_definition_id: Optional[UUID] = None
    universal_agent_version_id: Optional[UUID] = None
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
    source_handle: Optional[str] = Field(default=None, max_length=64)
    target_handle: Optional[str] = Field(default=None, max_length=64)
    condition_type: str = Field(default="always", min_length=1, max_length=80)
    condition_json: Dict[str, Any] = Field(default_factory=dict)
    priority: int = Field(default=0, ge=-10_000, le=10_000)
    max_passes: int = Field(default=1, ge=1, le=100)
    data_mapping_json: List[Dict[str, Any]] = Field(default_factory=list, max_length=100)

    @field_validator("condition_json")
    @classmethod
    def validate_condition_json(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value, max_bytes=MAX_AI_JSON_BYTES) or {}

    @field_validator("data_mapping_json")
    @classmethod
    def validate_data_mapping_json(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return validate_ai_json_list(
            value,
            max_items=100,
            max_bytes=MAX_AI_JSON_BYTES,
            label="El mapeo de datos del workflow IA",
        ) or []

class AiWorkflowBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    version: int = Field(default=1, ge=1, le=10_000)
    status: str = Field(default="DRAFT", min_length=1, max_length=40)
    is_default: bool = False
    workflow_format: str = Field(default="legacy_v1", pattern="^(legacy_v1|block_v2|universal_v2)$")
    workflow_purpose: str = Field(default="test_execution", pattern="^(test_execution|story_generation|test_case_generation)$")
    source_workflow_id: Optional[UUID] = None
    provider_profile_id: Optional[UUID] = None
    fallback_profile_ids: List[UUID] = Field(default_factory=list, max_length=5)
    decision_policy_json: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("decision_policy_json")
    @classmethod
    def validate_decision_policy(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value) or {}

class AiWorkflowCreate(AiWorkflowBase):
    nodes: List[AiWorkflowNodeBase] = Field(default_factory=list, max_length=MAX_AI_WORKFLOW_NODES)
    edges: List[AiWorkflowEdgeBase] = Field(default_factory=list, max_length=MAX_AI_WORKFLOW_EDGES)
    changelog: Optional[str] = Field(default=None, max_length=MAX_AI_CHANGELOG_LENGTH)

class AiWorkflowUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    version: Optional[int] = Field(default=None, ge=1, le=10_000)
    status: Optional[str] = Field(default=None, min_length=1, max_length=40)
    is_default: Optional[bool] = None
    workflow_format: Optional[str] = Field(default=None, pattern="^(legacy_v1|block_v2|universal_v2)$")
    workflow_purpose: Optional[str] = Field(default=None, pattern="^(test_execution|story_generation|test_case_generation)$")
    provider_profile_id: Optional[UUID] = None
    fallback_profile_ids: Optional[List[UUID]] = Field(default=None, max_length=5)
    decision_policy_json: Optional[Dict[str, Any]] = None
    nodes: Optional[List[AiWorkflowNodeBase]] = Field(default=None, max_length=MAX_AI_WORKFLOW_NODES)
    edges: Optional[List[AiWorkflowEdgeBase]] = Field(default=None, max_length=MAX_AI_WORKFLOW_EDGES)
    changelog: Optional[str] = Field(default=None, max_length=MAX_AI_CHANGELOG_LENGTH)

    @field_validator("decision_policy_json")
    @classmethod
    def validate_decision_policy(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_ai_json_payload(value) if value is not None else None

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
    universal_agent: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(from_attributes=True)


class AiAgentDefinitionResponse(BaseModel):
    id: UUID
    key: str
    version: int
    name: str
    description: str
    category: str
    kind: str
    runtime_handler: Optional[str] = None
    status: str
    input_schema_json: Dict[str, Any] = Field(default_factory=dict)
    output_schema_json: Dict[str, Any] = Field(default_factory=dict)
    config_schema_json: Dict[str, Any] = Field(default_factory=dict)
    capabilities_json: Dict[str, Any] = Field(default_factory=dict)
    default_model: Optional[str] = None
    allowed_model_capabilities: Dict[str, Any] = Field(default_factory=dict)
    default_timeout_sec: int
    default_retry_policy: Dict[str, Any] = Field(default_factory=dict)
    required_permissions_json: List[str] = Field(default_factory=list)
    requires_secret_reference: bool = False
    icon_key: str
    ui_metadata_json: Dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class AiWorkflowValidationIssue(BaseModel):
    severity: str
    code: str
    message: str
    node_id: Optional[UUID] = None
    edge_id: Optional[UUID] = None


class AiWorkflowValidationResponse(BaseModel):
    workflow_id: UUID
    valid: bool
    issues: List[AiWorkflowValidationIssue] = Field(default_factory=list)

class AiWorkflowEdgeResponse(BaseModel):
    id: UUID
    workflow_id: UUID
    source_node_id: UUID
    target_node_id: UUID
    source_handle: Optional[str] = None
    target_handle: Optional[str] = None
    condition_type: str
    condition_json: Dict[str, Any] = Field(default_factory=dict)
    priority: int
    max_passes: int
    data_mapping_json: List[Dict[str, Any]] = Field(default_factory=list)

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


class AiUniversalAgentContractRequest(BaseModel):
    """Transport envelope for Treseko Universal Agent Contract v1."""
    contract: Dict[str, Any]

    @field_validator("contract")
    @classmethod
    def validate_contract_payload(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_ai_json_payload(value, max_bytes=MAX_AI_IMPORT_JSON_BYTES) or {}


class AiUniversalAgentCreate(AiUniversalAgentContractRequest):
    key: str = Field(min_length=3, max_length=120, pattern="^[a-z][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=MAX_AI_DESCRIPTION_LENGTH)
    category: str = Field(default="custom", min_length=1, max_length=80)
    origin_type: str = Field(default="user", pattern="^(builtin|user|imported|variant)$")
    source_agent_id: Optional[UUID] = None
    version: str = Field(default="1.0.0", min_length=1, max_length=40)


class AiUniversalAgentVersionCreate(AiUniversalAgentContractRequest):
    version: str = Field(min_length=1, max_length=40)
    changelog: str = Field(default="", max_length=MAX_AI_CHANGELOG_LENGTH)


class AiUniversalAgentPublishRequest(BaseModel):
    changelog: str = Field(default="", max_length=MAX_AI_CHANGELOG_LENGTH)


class AiUniversalAgentVersionResponse(BaseModel):
    id: UUID
    agent_id: UUID
    version: str
    status: str
    contract_json: Dict[str, Any] = Field(default_factory=dict)
    contract_hash: str
    source_package_json: Dict[str, Any] = Field(default_factory=dict)
    created_by: Optional[UUID] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AiUniversalAgentResponse(BaseModel):
    id: UUID
    key: str
    name: str
    description: str
    category: str
    origin_type: str
    source_agent_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    versions: List[AiUniversalAgentVersionResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class AiUniversalAgentImport(BaseModel):
    package_base64: str = Field(min_length=1, max_length=2_000_000)
    key_override: Optional[str] = Field(default=None, max_length=120, pattern="^[a-z][a-z0-9-]*$")


class AiUniversalCapabilityResponse(BaseModel):
    key: str
    version: str
    input_schema: Dict[str, Any] = Field(default_factory=dict)
    output_schema: Dict[str, Any] = Field(default_factory=dict)
    required_permissions: List[str] = Field(default_factory=list)
    risk: str
    limits: Dict[str, Any] = Field(default_factory=dict)
    allows_network: bool = False
    allows_browser: bool = False
    allows_ai: bool = False
    allows_evidence: bool = False
    allows_secrets: bool = False
    native_handler: str


class AiUniversalWorkflowImport(BaseModel):
    package_base64: str = Field(min_length=1, max_length=8_000_000)

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
    preset_id: Optional[UUID] = None
    agent_definition_id: Optional[UUID] = None
    universal_agent_version_id: Optional[UUID] = None
    position_x: int = Field(default=120, ge=-100_000, le=100_000)
    position_y: int = Field(default=120, ge=-100_000, le=100_000)
    source_node_id: Optional[UUID] = None
    condition_type: str = Field(default="always", min_length=1, max_length=80)

    @model_validator(mode="after")
    def require_source(self):
        if not self.preset_id and not self.agent_definition_id and not self.universal_agent_version_id:
            raise ValueError("Selecciona un preset o una definicion de agente")
        return self

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

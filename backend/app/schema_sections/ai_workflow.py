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

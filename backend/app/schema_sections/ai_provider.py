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

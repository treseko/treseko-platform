from __future__ import annotations

import re
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

REDACTED_AUTOMATION_SECRET = "[redacted]"
MAX_AUTOMATION_JSON_BYTES = 64 * 1024
MAX_AUTOMATION_RESULT_METADATA_BYTES = 128 * 1024
MAX_AUTOMATION_ARTIFACT_BASE64_LENGTH = 16 * 1024 * 1024
MAX_AUTOMATION_SCRIPT_LENGTH = 200_000
MAX_AUTOMATION_CASE_DATA_LENGTH = 20_000
MAX_AUTOMATION_STEPS_BYTES = 128 * 1024
AUTOMATION_SECRET_KEY_MARKERS = {
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "credential",
    "credentials",
    "password",
    "secret",
    "token",
}


def _is_sensitive_automation_key(key: Any) -> bool:
    normalized = str(key or "").lower().replace("-", "_").replace(" ", "_")
    return any(marker in normalized for marker in AUTOMATION_SECRET_KEY_MARKERS)


def redact_automation_sensitive_text(value: str) -> str:
    text = str(value or "").replace("\x00", "")
    text = re.sub(
        r"(?i)\b(authorization)\s*:\s*bearer\s+[^\s,;\n]+",
        r"\1: Bearer [redacted]",
        text,
    )
    text = re.sub(
        r"(?i)((?:access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|password|secret|client[_-]?secret|token)\s*[:=]\s*)([^\s,;\n}]+)",
        lambda match: f"{match.group(1)}{REDACTED_AUTOMATION_SECRET}",
        text,
    )
    text = re.sub(
        r"(?i)([\"'](?:access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|password|secret|client[_-]?secret|token)[\"']\s*:\s*)([\"'][^\"']*[\"']|[^,\n}]+)",
        lambda match: f"{match.group(1)}\"{REDACTED_AUTOMATION_SECRET}\"",
        text,
    )
    return text


def redact_automation_sensitive_value(value: Any, key: Any = None) -> Any:
    if _is_sensitive_automation_key(key):
        return REDACTED_AUTOMATION_SECRET
    if isinstance(value, dict):
        return {
            item_key: redact_automation_sensitive_value(item, item_key)
            for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_automation_sensitive_value(item) for item in value]
    if isinstance(value, str):
        return redact_automation_sensitive_text(value)
    return value


def redact_automation_capabilities(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: REDACTED_AUTOMATION_SECRET if _is_sensitive_automation_key(key) else redact_automation_sensitive_value(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_automation_sensitive_value(item) for item in value]
    if isinstance(value, str):
        return redact_automation_sensitive_text(value)
    return value


def validate_automation_json_payload(value: Optional[Dict[str, Any]], *, max_bytes: int = MAX_AUTOMATION_JSON_BYTES) -> Optional[Dict[str, Any]]:
    return validate_preference_json_payload(
        value,
        max_bytes=max_bytes,
        label="La configuracion de automatizacion",
    )


def validate_automation_steps_payload(value: Optional[List[Dict[str, Any]]]) -> Optional[List[Dict[str, Any]]]:
    if value is None:
        return value
    validate_preference_json_payload(
        {"pasos": value},
        max_bytes=MAX_AUTOMATION_STEPS_BYTES,
        label="Los pasos de automatizacion",
    )
    return value

class AutomationRunnerRegister(BaseModel):
    registration_token: str = Field(min_length=1, max_length=160)
    nombre: Optional[str] = Field(default=None, max_length=120)
    tipo: Optional[str] = Field(default=None, max_length=50)
    capabilities: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("capabilities")
    @classmethod
    def validate_capabilities(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_automation_json_payload(value) or {}

class AutomationRunnerRegistrationTokenCreate(BaseModel):
    nombre: str = Field(default="Local Playwright Worker", min_length=1, max_length=120)
    tipo: str = Field(default="LOCAL", min_length=1, max_length=50)
    organizacion_id: Optional[UUID] = None
    ttl_minutes: int = Field(default=60, ge=5, le=24 * 60)

class AutomationRunnerRegistrationTokenCreated(BaseModel):
    registration_token: str
    expires_at: datetime
    nombre: str
    tipo: str

class AutomationRunnerPairingRequestCreate(BaseModel):
    nombre: str = Field(default="Local Playwright Worker", min_length=1, max_length=120)
    tipo: str = Field(default="LOCAL", min_length=1, max_length=50)
    organizacion_id: Optional[UUID] = None
    capabilities: Dict[str, Any] = Field(default_factory=dict)
    ttl_minutes: int = Field(default=10, ge=2, le=60)

    @field_validator("capabilities")
    @classmethod
    def validate_capabilities(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_automation_json_payload(value) or {}

class AutomationRunnerPairingRequestCreated(BaseModel):
    code: str
    pairing_token: str
    expires_at: datetime
    nombre: str
    tipo: str
    estado: str

class AutomationRunnerPairingRequest(BaseModel):
    id: UUID
    code: str
    nombre: str
    organizacion_id: Optional[UUID] = None
    tipo: str
    capabilities: Dict[str, Any] = Field(default_factory=dict)
    estado: str
    expires_at: datetime
    approved_at: Optional[datetime] = None
    denied_at: Optional[datetime] = None
    runner_id: Optional[UUID] = None
    fecha_creacion: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("capabilities")
    def serialize_capabilities(self, value: Dict[str, Any]):
        return redact_automation_capabilities(value)

class AutomationRunnerPairingPoll(BaseModel):
    code: str
    estado: str
    expires_at: datetime
    runner_token: Optional[str] = None
    runner: Optional[Dict[str, Any]] = None

    @field_serializer("runner")
    def serialize_runner(self, value: Optional[Dict[str, Any]]):
        if not isinstance(value, dict):
            return value
        safe = dict(value)
        safe["capabilities"] = redact_automation_capabilities(safe.get("capabilities") or {})
        return safe

class AutomationRunner(BaseModel):
    id: UUID
    nombre: str
    organizacion_id: Optional[UUID] = None
    tipo: str
    estado: str
    capabilities: Dict[str, Any] = Field(default_factory=dict)
    activo: bool
    ultimo_heartbeat: Optional[datetime] = None
    fecha_creacion: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("capabilities")
    def serialize_capabilities(self, value: Dict[str, Any]):
        return redact_automation_capabilities(value)

class AutomationRunnerCreated(AutomationRunner):
    runner_token: str

class AutomationRunnerHeartbeat(BaseModel):
    estado: str = Field(default="ONLINE", max_length=30)
    capabilities: Optional[Dict[str, Any]] = None
    resources: Optional[Dict[str, Any]] = None
    active_jobs: Optional[int] = Field(default=None, ge=0, le=1000)
    current_job_id: Optional[UUID] = None
    uptime_seconds: Optional[int] = Field(default=None, ge=0, le=315360000)

    @field_validator("capabilities", "resources")
    @classmethod
    def validate_heartbeat_json(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_automation_json_payload(value)

class AutomationRunnerUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, max_length=120)
    tipo: Optional[str] = Field(default=None, max_length=50)
    capabilities: Optional[Dict[str, Any]] = None
    activo: Optional[bool] = None

    @field_validator("capabilities")
    @classmethod
    def validate_capabilities(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_automation_json_payload(value)

class AutomationJob(BaseModel):
    id: UUID
    job_type: str = "EXECUTION"
    test_run_id: Optional[UUID] = None
    ejecucion_id: Optional[UUID] = None
    caso_id: Optional[UUID] = None
    build_id: Optional[UUID] = None
    runner_id: Optional[UUID] = None
    estado: AutomationJobStatus
    required_framework: str
    required_language: str = "javascript"
    required_runtime: Optional[str] = None
    timeout_seconds: int
    payload_congelado: Dict[str, Any] = Field(default_factory=dict)
    logs: Optional[str] = Field(default=None, max_length=12000)
    error_message: Optional[str] = Field(default=None, max_length=4000)
    metadata_resultado: Dict[str, Any] = Field(default_factory=dict)
    fecha_creacion: Optional[datetime] = None
    fecha_claim: Optional[datetime] = None
    fecha_inicio: Optional[datetime] = None
    fecha_fin: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("payload_congelado", "metadata_resultado")
    def serialize_job_json(self, value: Dict[str, Any]):
        return redact_automation_sensitive_value(value)

    @field_serializer("logs", "error_message")
    def serialize_job_text(self, value: Optional[str]):
        return redact_automation_sensitive_text(value) if value else value

class AutomationJobResultStep(BaseModel):
    number: int = Field(ge=1, le=1000)
    status: EstadoResultado
    observations: Optional[str] = Field(default=None, max_length=4000)
    evidence_url: Optional[str] = Field(default=None, max_length=1000)
    error_log: Optional[str] = Field(default=None, max_length=12000)

class AutomationJobResultArtifact(BaseModel):
    type: str = Field(default="screenshot", max_length=50)
    filename: str = Field(min_length=1, max_length=180)
    content_type: str = Field(default="image/png", max_length=120)
    base64: str = Field(min_length=1, max_length=MAX_AUTOMATION_ARTIFACT_BASE64_LENGTH)
    step_number: Optional[int] = Field(default=None, ge=1, le=1000)

class AutomationJobResult(BaseModel):
    status: AutomationJobStatus
    duration_seconds: int = Field(default=0, ge=0, le=604800)
    observations: Optional[str] = Field(default=None, max_length=4000)
    logs: Optional[str] = Field(default=None, max_length=12000)
    error_message: Optional[str] = Field(default=None, max_length=4000)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    evidence_url: Optional[str] = Field(default=None, max_length=1000)
    steps: List[AutomationJobResultStep] = Field(default_factory=list, max_length=1000)
    artifacts: List[AutomationJobResultArtifact] = Field(default_factory=list, max_length=20)

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_automation_json_payload(value, max_bytes=MAX_AUTOMATION_RESULT_METADATA_BYTES) or {}

class AutomationDryRunRequest(BaseModel):
    script_automatizado: str = Field(min_length=1, max_length=MAX_AUTOMATION_SCRIPT_LENGTH)
    framework: str = Field(default="playwright", min_length=1, max_length=50)
    lenguaje: str = Field(default="javascript", min_length=1, max_length=50)
    proyecto_id: UUID
    componente_id: Optional[UUID] = None
    titulo: Optional[str] = Field(default=None, max_length=255)
    codigo: Optional[str] = Field(default=None, max_length=80)
    datos_caso: Optional[str] = Field(default=None, max_length=MAX_AUTOMATION_CASE_DATA_LENGTH)
    entorno_id: Optional[UUID] = None
    dataset_id: Optional[UUID] = None
    timeout_seconds: int = Field(default=300, ge=10, le=1800)
    debug_mode: bool = False
    pasos: List[Dict[str, Any]] = Field(default_factory=list, max_length=1000)

    @field_validator("pasos")
    @classmethod
    def validate_steps(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return validate_automation_steps_payload(value) or []

class AutomationExecutionRequest(BaseModel):
    debug_mode: bool = False

class FuncionAutomatizadaBase(BaseModel):
    nombre: str = Field(min_length=1, max_length=160)
    descripcion: Optional[str] = Field(default=None, max_length=2000)
    codigo: str = Field(min_length=1, max_length=MAX_AUTOMATION_SCRIPT_LENGTH)
    parametros: List[str] = Field(default_factory=list, max_length=100)
    framework: str = Field(default="playwright", min_length=1, max_length=50)
    suite_id: Optional[UUID] = None
    scope: str = Field(default="PROYECTO", max_length=30)
    componente_id: Optional[UUID] = None

    @field_validator("parametros")
    @classmethod
    def validate_parametros(cls, value: List[str]) -> List[str]:
        if any(len(str(item or "")) > 120 for item in value):
            raise ValueError("Los parametros de la funcion automatizada son demasiado largos")
        return value

class FuncionAutomatizadaCreate(FuncionAutomatizadaBase):
    proyecto_id: UUID
    creado_por: Optional[UUID] = None

class FuncionAutomatizadaUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, max_length=160)
    descripcion: Optional[str] = Field(default=None, max_length=2000)
    codigo: Optional[str] = Field(default=None, max_length=MAX_AUTOMATION_SCRIPT_LENGTH)
    parametros: Optional[List[str]] = Field(default=None, max_length=100)
    framework: Optional[str] = Field(default=None, max_length=50)
    suite_id: Optional[UUID] = None
    scope: Optional[str] = Field(default=None, max_length=30)
    componente_id: Optional[UUID] = None

    @field_validator("parametros")
    @classmethod
    def validate_parametros(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is not None and any(len(str(item or "")) > 120 for item in value):
            raise ValueError("Los parametros de la funcion automatizada son demasiado largos")
        return value

class FuncionAutomatizada(FuncionAutomatizadaBase):
    id: UUID
    master_id: UUID
    proyecto_id: UUID
    version: int
    creado_por: UUID
    fecha_creacion: datetime

    model_config = ConfigDict(from_attributes=True)

# --- VALIDACION DE SCRIPTS ---

class ScriptValidateRequest(BaseModel):
    script: str = Field(min_length=1, max_length=MAX_AUTOMATION_SCRIPT_LENGTH)
    framework: str = Field(min_length=1, max_length=50)
    tipo_prueba: Optional[str] = Field(default=None, max_length=50)
    titulo: Optional[str] = Field(default=None, max_length=255)
    datos_caso: Optional[str] = Field(default=None, max_length=MAX_AUTOMATION_CASE_DATA_LENGTH)
    pasos: List[Dict[str, Any]] = Field(default_factory=list, max_length=1000)
    proyecto_id: Optional[UUID] = None
    component_id: Optional[UUID] = None
    entorno_id: Optional[UUID] = None
    dataset_id: Optional[UUID] = None

    @field_validator("pasos")
    @classmethod
    def validate_steps(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return validate_automation_steps_payload(value) or []

class ScriptValidateResponse(BaseModel):
    valid: bool
    message: Optional[str] = None
    error: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    checks: List[str] = Field(default_factory=list)
    
    model_config = ConfigDict(from_attributes=True)

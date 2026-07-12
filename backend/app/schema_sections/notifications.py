from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

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
from .config import _validate_plain_email

MAX_NOTIFICATION_JSON_BYTES = 32 * 1024
MAX_NOTIFICATION_CONTEXT_BYTES = 64 * 1024
MAX_NOTIFICATION_JSON_DEPTH = 6
MAX_NOTIFICATION_DICT_KEYS = 200
MAX_NOTIFICATION_LIST_ITEMS = 200
MAX_NOTIFICATION_STRING_LENGTH = 4000
MAX_NOTIFICATION_EXPLICIT_EMAILS = 50
MAX_NOTIFICATION_PREFERENCES_BATCH = 100
ALLOWED_NOTIFICATION_CHANNELS = {"in_app", "email"}
ALLOWED_NOTIFICATION_FREQUENCIES = {"immediate", "daily", "weekly", "never"}


def _notification_json_size(value: Dict[str, Any]) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _validate_notification_json_value(value: Any, *, depth: int = 0) -> None:
    if depth > MAX_NOTIFICATION_JSON_DEPTH:
        raise ValueError("La configuracion de notificaciones excede la profundidad permitida")
    if value is None or isinstance(value, (bool, int, float)):
        return
    if isinstance(value, str):
        if len(value) > MAX_NOTIFICATION_STRING_LENGTH:
            raise ValueError("La configuracion de notificaciones contiene un texto demasiado largo")
        return
    if isinstance(value, list):
        if len(value) > MAX_NOTIFICATION_LIST_ITEMS:
            raise ValueError("La configuracion de notificaciones contiene demasiados elementos")
        for item in value:
            _validate_notification_json_value(item, depth=depth + 1)
        return
    if isinstance(value, dict):
        if len(value) > MAX_NOTIFICATION_DICT_KEYS:
            raise ValueError("La configuracion de notificaciones contiene demasiadas claves")
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 120:
                raise ValueError("La configuracion de notificaciones contiene una clave invalida")
            _validate_notification_json_value(item, depth=depth + 1)
        return
    raise ValueError("La configuracion de notificaciones contiene un valor no soportado")


def validate_notification_json_payload(value: Optional[Dict[str, Any]], *, max_bytes: int = MAX_NOTIFICATION_JSON_BYTES) -> Optional[Dict[str, Any]]:
    if value is None:
        return value
    _validate_notification_json_value(value)
    if _notification_json_size(value) > max_bytes:
        raise ValueError("La configuracion de notificaciones excede el tamano maximo permitido")
    return value


def validate_recipient_strategy(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    value = validate_notification_json_payload(value)
    if not value:
        return value
    explicit_emails = value.get("explicit_emails") or []
    if not isinstance(explicit_emails, list):
        raise ValueError("Los destinatarios explicitos deben ser una lista")
    if len(explicit_emails) > MAX_NOTIFICATION_EXPLICIT_EMAILS:
        raise ValueError("La regla contiene demasiados destinatarios explicitos")
    value["explicit_emails"] = [
        _validate_plain_email(str(email), required=True)
        for email in explicit_emails
    ]
    return value

class NotificationEventCreate(BaseModel):
    event_type: str
    proyecto_id: Optional[UUID] = None
    organizacion_id: Optional[UUID] = None
    actor_user_id: Optional[UUID] = None
    entity_type: str
    entity_id: Optional[UUID] = None
    severity: str = "info"
    payload_json: Dict[str, Any] = {}
    dedupe_key: Optional[str] = None
    correlation_id: Optional[str] = None

class NotificationEventResponse(NotificationEventCreate):
    id: UUID
    created_at: datetime
    processed_at: Optional[datetime] = None
    status: str = "PENDING"
    error: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class NotificationRuleBase(BaseModel):
    nombre: str = Field(min_length=1, max_length=120)
    descripcion: Optional[str] = Field(default=None, max_length=1000)
    enabled: bool = True
    scope: str = Field(default="GLOBAL", max_length=30)
    organizacion_id: Optional[UUID] = None
    proyecto_id: Optional[UUID] = None
    event_types: List[str] = Field(default_factory=list, max_length=50)
    conditions_json: Dict[str, Any] = {}
    actions_json: Dict[str, Any] = {}
    recipient_strategy_json: Dict[str, Any] = {}
    template_id: Optional[UUID] = None
    cooldown_minutes: int = Field(default=0, ge=0, le=10080)
    priority: int = Field(default=100, ge=0, le=10000)

    @field_validator("event_types")
    @classmethod
    def validate_event_types(cls, value: List[str]) -> List[str]:
        return [item.strip() for item in value if item and item.strip()]

    @field_validator("conditions_json", "actions_json")
    @classmethod
    def validate_rule_json(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_notification_json_payload(value) or {}

    @field_validator("recipient_strategy_json")
    @classmethod
    def validate_rule_recipient_strategy(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_recipient_strategy(value) or {}

class NotificationRuleCreate(NotificationRuleBase):
    pass

class NotificationRuleUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=120)
    descripcion: Optional[str] = Field(default=None, max_length=1000)
    enabled: Optional[bool] = None
    scope: Optional[str] = Field(default=None, max_length=30)
    organizacion_id: Optional[UUID] = None
    proyecto_id: Optional[UUID] = None
    event_types: Optional[List[str]] = Field(default=None, max_length=50)
    conditions_json: Optional[Dict[str, Any]] = None
    actions_json: Optional[Dict[str, Any]] = None
    recipient_strategy_json: Optional[Dict[str, Any]] = None
    template_id: Optional[UUID] = None
    cooldown_minutes: Optional[int] = Field(default=None, ge=0, le=10080)
    priority: Optional[int] = Field(default=None, ge=0, le=10000)

    @field_validator("event_types")
    @classmethod
    def validate_event_types(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return value
        return [item.strip() for item in value if item and item.strip()]

    @field_validator("conditions_json", "actions_json")
    @classmethod
    def validate_rule_json(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_notification_json_payload(value)

    @field_validator("recipient_strategy_json")
    @classmethod
    def validate_rule_recipient_strategy(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_recipient_strategy(value)

class NotificationRuleResponse(NotificationRuleBase):
    id: UUID
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class NotificationTemplateBase(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    nombre: str = Field(min_length=1, max_length=120)
    channel: str = Field(default="email", max_length=30)
    subject_template: Optional[str] = Field(default=None, max_length=300)
    text_template: str = Field(min_length=1, max_length=12000)
    html_template: Optional[str] = Field(default=None, max_length=20000)
    allowed_variables: List[str] = Field(default_factory=list, max_length=100)
    enabled: bool = True

class NotificationTemplateCreate(NotificationTemplateBase):
    pass

class NotificationTemplateUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=120)
    channel: Optional[str] = Field(default=None, max_length=30)
    subject_template: Optional[str] = Field(default=None, max_length=300)
    text_template: Optional[str] = Field(default=None, min_length=1, max_length=12000)
    html_template: Optional[str] = Field(default=None, max_length=20000)
    allowed_variables: Optional[List[str]] = Field(default=None, max_length=100)
    enabled: Optional[bool] = None

class NotificationTemplateResponse(NotificationTemplateBase):
    id: UUID
    version: int = 1
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class NotificationTemplatePreviewRequest(BaseModel):
    context: Dict[str, Any] = {}

    @field_validator("context")
    @classmethod
    def validate_context(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return validate_notification_json_payload(value, max_bytes=MAX_NOTIFICATION_CONTEXT_BYTES) or {}

class NotificationTemplatePreviewResponse(BaseModel):
    subject: Optional[str] = None
    text: str
    html: Optional[str] = None

class NotificationInboxResponse(BaseModel):
    id: UUID
    event_id: Optional[UUID] = None
    proyecto_id: Optional[UUID] = None
    title: str
    message: str
    link_url: Optional[str] = None
    severity: str
    read_at: Optional[datetime] = None
    created_at: datetime
    metadata_json: Dict[str, Any] = {}

    model_config = ConfigDict(from_attributes=True)

class NotificationDeliveryResponse(BaseModel):
    id: UUID
    event_id: Optional[UUID] = None
    rule_id: Optional[UUID] = None
    template_id: Optional[UUID] = None
    channel: str
    recipient_user_id: Optional[UUID] = None
    recipient_email: Optional[str] = None
    subject: Optional[str] = None
    status: str
    attempt_count: int
    max_attempts: int
    next_attempt_at: Optional[datetime] = None
    last_attempt_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    error: Optional[str] = None
    dedupe_key: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    metadata_json: Dict[str, Any] = {}

    model_config = ConfigDict(from_attributes=True)

class NotificationPreferenceUpdate(BaseModel):
    event_type: Optional[str] = Field(default=None, max_length=120)
    channel: str = Field(min_length=1, max_length=30)
    enabled: bool = True
    frequency: str = Field(default="immediate", max_length=30)
    quiet_hours_json: Optional[Dict[str, Any]] = None

    @field_validator("channel")
    @classmethod
    def validate_channel(cls, value: str) -> str:
        channel = value.strip()
        if channel not in ALLOWED_NOTIFICATION_CHANNELS:
            raise ValueError("Canal de notificacion no soportado")
        return channel

    @field_validator("frequency")
    @classmethod
    def validate_frequency(cls, value: str) -> str:
        frequency = value.strip()
        if frequency not in ALLOWED_NOTIFICATION_FREQUENCIES:
            raise ValueError("Frecuencia de notificacion no soportada")
        return frequency

    @field_validator("quiet_hours_json")
    @classmethod
    def validate_quiet_hours(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return validate_notification_json_payload(value, max_bytes=8 * 1024)

class NotificationPreferenceResponse(NotificationPreferenceUpdate):
    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

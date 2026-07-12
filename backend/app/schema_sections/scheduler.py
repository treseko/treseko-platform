from __future__ import annotations

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

MAX_SCHEDULE_NAME_LENGTH = 200
MAX_SCHEDULE_CRON_LENGTH = 100
CRON_ALLOWED_CHARS = set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz*/,-?L# W")


def validate_cron_expression(value: str) -> str:
    normalized = " ".join(value.strip().split())
    if not normalized:
        raise ValueError("cron expression cannot be empty")
    if len(normalized) > MAX_SCHEDULE_CRON_LENGTH:
        raise ValueError("cron expression is too long")
    if any(char not in CRON_ALLOWED_CHARS for char in normalized):
        raise ValueError("cron expression contains unsupported characters")
    field_count = len(normalized.split())
    if field_count not in {5, 6}:
        raise ValueError("cron expression must have 5 or 6 fields")
    return normalized


class ScheduledRunBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_SCHEDULE_NAME_LENGTH)
    suite_id: UUID
    cron_expression: str = Field(..., min_length=1, max_length=MAX_SCHEDULE_CRON_LENGTH)
    activo: bool = True

    @field_validator("cron_expression")
    @classmethod
    def validate_cron(cls, value):
        return validate_cron_expression(value)

class ScheduledRunCreate(ScheduledRunBase):
    proyecto_id: UUID
    creado_por: Optional[UUID] = None

class ScheduledRun(ScheduledRunBase):
    id: UUID
    proyecto_id: UUID
    next_run: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)

# --- COMPONENTE ---

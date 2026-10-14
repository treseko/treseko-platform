"""Reusable bug summaries and input normalization mixins."""

from typing import Any, Dict

from pydantic import BaseModel, Field, model_validator


class LegacyScreenResolutionNormalizer:
    @model_validator(mode="before")
    @classmethod
    def separate_legacy_screen_resolution(cls, values: Any) -> Any:
        from ..services.bug_resolution_fields import normalize_legacy_screen_resolution

        return normalize_legacy_screen_resolution(values)


class BugSummaryResponse(BaseModel):
    total: int = 0
    abiertos: int = 0
    criticos: int = 0
    bloquean_release: int = 0
    listos_retest: int = 0
    cerrados: int = 0
    vinculados_externos: int = 0
    sin_evidencia: int = 0
    sin_asignado: int = 0
    by_estado: Dict[str, int] = Field(default_factory=dict)
    by_severidad: Dict[str, int] = Field(default_factory=dict)
    by_prioridad: Dict[str, int] = Field(default_factory=dict)
    by_origen: Dict[str, int] = Field(default_factory=dict)

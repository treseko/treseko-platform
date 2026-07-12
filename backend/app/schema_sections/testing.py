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

MAX_SUITE_NAME_LENGTH = 160
MAX_SUITE_DESCRIPTION_LENGTH = 4000
MAX_SUITE_REORDER_ITEMS = 1000
MAX_TEST_CASE_CODE_LENGTH = 80
MAX_TEST_CASE_TITLE_LENGTH = 300
MAX_TEST_CASE_TEXT_LENGTH = 12000
MAX_TEST_CASE_TAGS = 80
MAX_TEST_CASE_TAG_LENGTH = 80
MAX_TEST_CASE_DATASET_ITEMS = 500
MAX_TEST_CASE_DATASET_BYTES = 128 * 1024
MAX_TEST_CASE_SCRIPT_LENGTH = 200_000
MAX_TEST_CASE_FRAMEWORK_LENGTH = 80
MAX_TEST_CASE_STEPS = 500
MAX_TEST_STEP_TEXT_LENGTH = 12000
MAX_TEST_STEP_METADATA_BYTES = 32 * 1024


def validate_test_case_dataset(value: Optional[List[Dict[str, str]]]) -> Optional[List[Dict[str, str]]]:
    if value is None:
        return value
    if len(value) > MAX_TEST_CASE_DATASET_ITEMS:
        raise ValueError(f"dataset cannot contain more than {MAX_TEST_CASE_DATASET_ITEMS} rows")
    return validate_preference_json_payload(
        value,
        max_bytes=MAX_TEST_CASE_DATASET_BYTES,
        label="test case dataset",
    )


def validate_test_step_metadata(value: Optional[dict]) -> Optional[dict]:
    return validate_preference_json_payload(
        value,
        max_bytes=MAX_TEST_STEP_METADATA_BYTES,
        label="test step metadata",
    )


class SuiteBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=MAX_SUITE_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_SUITE_DESCRIPTION_LENGTH)
    parent_id: Optional[UUID] = None
    componente_id: Optional[UUID] = None
    color: Optional[str] = Field(default="#F1F5F9", max_length=32)
    icono: Optional[str] = Field(default="folder", max_length=40)

class SuiteCreate(SuiteBase):
    proyecto_id: UUID

class SuiteUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_SUITE_NAME_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_SUITE_DESCRIPTION_LENGTH)
    componente_id: Optional[UUID] = None
    color: Optional[str] = Field(default=None, max_length=32)
    icono: Optional[str] = Field(default=None, max_length=40)

class SuiteArchiveRequest(BaseModel):
    archivado: bool

class SuiteMoveRequest(BaseModel):
    parent_id: Optional[UUID] = None

class SuiteCloneRequest(BaseModel):
    nuevo_nombre: Optional[str] = Field(default=None, min_length=1, max_length=MAX_SUITE_NAME_LENGTH)
    parent_id: Optional[UUID] = None
    include_cases: bool = True

class SuiteReorderRequest(BaseModel):
    orden: List[UUID] = Field(..., min_length=1, max_length=MAX_SUITE_REORDER_ITEMS)

class Suite(SuiteBase):
    id: UUID
    proyecto_id: UUID
    orden: int = 0
    activo: bool = True
    archivado: bool = False
    children: List['Suite'] = Field(default_factory=list)
    
    model_config = ConfigDict(from_attributes=True)

class SuiteCloneResponse(BaseModel):
    suite: Suite
    suites_copiadas: int = 0
    casos_copiados: int = 0

# Resolver referencias circulares para Pydantic
Suite.model_rebuild()

# --- CASO DE PRUEBA ---

class PasoBase(BaseModel):
    numero_paso: int = Field(..., ge=1, le=MAX_TEST_CASE_STEPS)
    accion: str = Field(..., min_length=1, max_length=MAX_TEST_STEP_TEXT_LENGTH)
    datos: Optional[str] = Field(default=None, max_length=MAX_TEST_STEP_TEXT_LENGTH)
    resultado_esperado: str = Field(..., min_length=1, max_length=MAX_TEST_STEP_TEXT_LENGTH)
    metadata_ai: Optional[dict] = None

    @field_validator("metadata_ai")
    @classmethod
    def validate_metadata_ai(cls, value):
        return validate_test_step_metadata(value)

class PasoCreate(PasoBase):
    pass

class Paso(PasoBase):
    id: UUID
    caso_id: UUID
    
    model_config = ConfigDict(from_attributes=True)

class CasoPruebaBase(BaseModel):
    codigo: Optional[str] = Field(default=None, max_length=MAX_TEST_CASE_CODE_LENGTH)
    titulo: str = Field(..., min_length=1, max_length=MAX_TEST_CASE_TITLE_LENGTH)
    descripcion: Optional[str] = Field(default=None, max_length=MAX_TEST_CASE_TEXT_LENGTH)
    precondiciones: Optional[str] = Field(default=None, max_length=MAX_TEST_CASE_TEXT_LENGTH)
    postcondiciones: Optional[str] = Field(default=None, max_length=MAX_TEST_CASE_TEXT_LENGTH)
    prioridad: Prioridad
    criticidad: Criticidad = Criticidad.MEDIA
    tipo_prueba: TipoPrueba
    estado_caso: EstadoCaso = EstadoCaso.ACTIVO
    suite_id: Optional[UUID] = None
    componente_id: Optional[UUID] = None
    dataset: List[Dict[str, str]] = Field(default_factory=list, max_length=MAX_TEST_CASE_DATASET_ITEMS)
    etiquetas: List[str] = Field(default_factory=list, max_length=MAX_TEST_CASE_TAGS)
    script_automatizado: Optional[str] = Field(default=None, max_length=MAX_TEST_CASE_SCRIPT_LENGTH)
    framework: Optional[str] = Field(default=None, max_length=MAX_TEST_CASE_FRAMEWORK_LENGTH)

    @field_validator("dataset")
    @classmethod
    def validate_dataset(cls, value):
        return validate_test_case_dataset(value) or []

    @field_validator("etiquetas", mode="before")
    @classmethod
    def normalize_etiquetas(cls, value):
        if value is None:
            return []
        raw_items = value if isinstance(value, list) else str(value).replace(";", ",").replace("\n", ",").split(",")
        normalized = []
        seen = set()
        for item in raw_items:
            tag = str(item or "").strip()
            if len(tag) > MAX_TEST_CASE_TAG_LENGTH:
                raise ValueError(f"tag cannot exceed {MAX_TEST_CASE_TAG_LENGTH} characters")
            key = tag.lower()
            if tag and key not in seen:
                seen.add(key)
                normalized.append(tag)
            if len(normalized) > MAX_TEST_CASE_TAGS:
                raise ValueError(f"cannot assign more than {MAX_TEST_CASE_TAGS} tags")
        return normalized

class CasoPruebaCreate(CasoPruebaBase):
    proyecto_id: UUID
    pasos: List[PasoCreate] = Field(default_factory=list, max_length=MAX_TEST_CASE_STEPS)
    creado_por: Optional[UUID] = None

    @field_validator("pasos")
    @classmethod
    def validate_unique_step_numbers(cls, value):
        step_numbers = [step.numero_paso for step in value]
        if len(step_numbers) != len(set(step_numbers)):
            raise ValueError("numero_paso duplicado")
        return value

class CasoPruebaUpdateMetadata(BaseModel):
    prioridad: Optional[Prioridad] = None
    criticidad: Optional[Criticidad] = None
    estado_caso: Optional[EstadoCaso] = None
    suite_id: Optional[UUID] = None
    componente_id: Optional[UUID] = None
    etiquetas: Optional[List[str]] = Field(default=None, max_length=MAX_TEST_CASE_TAGS)

    @field_validator("etiquetas", mode="before")
    @classmethod
    def normalize_metadata_etiquetas(cls, value):
        return CasoPruebaBase.normalize_etiquetas(value)

class CasoMoveRequest(BaseModel):
    suite_id: UUID

class CasoPrueba(CasoPruebaBase):
    id: UUID
    master_id: UUID
    proyecto_id: UUID
    version: int
    latest_version: Optional[int] = None
    latest_case_id: Optional[UUID] = None
    is_outdated_version: bool = False
    steps_count: Optional[int] = None
    creado_por: UUID
    ultimo_resultado: Optional[str] = None
    ultima_ejecucion_por: Optional[UUID] = None
    ultima_ejecucion_fecha: Optional[datetime] = None
    fecha_creacion: datetime
    ultima_modificacion: datetime
    activo: bool = True
    
    model_config = ConfigDict(from_attributes=True)

class CasoPruebaConPasos(CasoPrueba):
    pasos: List[Paso] = Field(default_factory=list)

class CasoVersion(BaseModel):
    id: UUID
    version: int
    codigo: Optional[str] = None
    titulo: str
    descripcion: Optional[str] = None
    precondiciones: Optional[str] = None
    postcondiciones: Optional[str] = None
    prioridad: Prioridad
    criticidad: Criticidad = Criticidad.MEDIA
    tipo_prueba: TipoPrueba
    estado_caso: EstadoCaso
    suite_id: Optional[UUID] = None
    componente_id: Optional[UUID] = None
    dataset: List[Dict[str, str]] = Field(default_factory=list)
    etiquetas: List[str] = Field(default_factory=list)
    pasos: List[Paso] = Field(default_factory=list)
    creado_por: UUID
    fecha_creacion: datetime
    ultima_modificacion: datetime
    
    model_config = ConfigDict(from_attributes=True)

class CasoSearchResponse(BaseModel):
    items: List[CasoPrueba]
    total: int
    skip: int
    limit: Optional[int] = None

# --- REDMINE ---

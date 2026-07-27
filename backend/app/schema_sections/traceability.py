from __future__ import annotations

from datetime import datetime
from typing import Any, List, Literal, Optional
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


REQUIREMENT_STATES = {"BORRADOR", "ACTIVO", "EN_REVISION", "CUMPLIDO", "ARCHIVADO"}
STORY_STATES = {"BORRADOR", "LISTA_PARA_QA", "EN_PRUEBA", "ACEPTADA", "ARCHIVADA"}
PRIORITIES = {"ALTA", "MEDIA", "BAJA"}
MAX_CODE_LENGTH = 40
MAX_TITLE_LENGTH = 255
MAX_MARKDOWN_LENGTH = 512 * 1024
MAX_EXTERNAL_PROVIDER_LENGTH = 80
MAX_EXTERNAL_REFERENCE_LENGTH = 160
MAX_CHANGE_COMMENT_LENGTH = 255
MAX_COMPONENTS_PER_REQUIREMENT = 100
MAX_STORIES_PER_CASE = 100
MAX_GENERATION_INSTRUCTIONS_LENGTH = 4000
MAX_GENERATION_STORIES = 20
MAX_CASE_GENERATION_CASES = 20
MAX_CASE_GENERATION_STEPS = 30


def _validate_url(value: Optional[str]) -> Optional[str]:
    if value is None or not value.strip():
        return None
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("La URL externa debe ser HTTP/HTTPS absoluta y no incluir credenciales")
    return value.strip()


class ExternalReference(BaseModel):
    external_provider: Optional[str] = Field(default=None, max_length=MAX_EXTERNAL_PROVIDER_LENGTH)
    external_reference: Optional[str] = Field(default=None, max_length=MAX_EXTERNAL_REFERENCE_LENGTH)
    external_url: Optional[str] = None

    @field_validator("external_url")
    @classmethod
    def validate_external_url(cls, value):
        return _validate_url(value)


class RequisitoBase(ExternalReference):
    codigo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_CODE_LENGTH)
    titulo: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    descripcion_markdown: str = Field(default="", max_length=MAX_MARKDOWN_LENGTH)
    estado: str = "BORRADOR"
    prioridad: str = "MEDIA"
    componente_ids: List[UUID] = Field(default_factory=list, max_length=MAX_COMPONENTS_PER_REQUIREMENT)

    @field_validator("estado")
    @classmethod
    def validate_state(cls, value):
        normalized = value.strip().upper()
        if normalized not in REQUIREMENT_STATES:
            raise ValueError("Estado de requisito invalido")
        return normalized

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        normalized = value.strip().upper()
        if normalized not in PRIORITIES:
            raise ValueError("Prioridad invalida")
        return normalized

    @field_validator("componente_ids")
    @classmethod
    def validate_components(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("No se puede repetir un componente")
        return value


class RequisitoCreate(RequisitoBase):
    proyecto_id: UUID


class RequisitoUpdate(ExternalReference):
    titulo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_TITLE_LENGTH)
    descripcion_markdown: Optional[str] = Field(default=None, max_length=MAX_MARKDOWN_LENGTH)
    estado: Optional[str] = None
    prioridad: Optional[str] = None
    componente_ids: Optional[List[UUID]] = Field(default=None, max_length=MAX_COMPONENTS_PER_REQUIREMENT)
    comentario_cambio: Optional[str] = Field(default=None, max_length=MAX_CHANGE_COMMENT_LENGTH)

    @field_validator("estado")
    @classmethod
    def validate_state(cls, value):
        return RequisitoBase.validate_state(value) if value is not None else value

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        return RequisitoBase.validate_priority(value) if value is not None else value

    @field_validator("componente_ids")
    @classmethod
    def validate_components(cls, value):
        return RequisitoBase.validate_components(value) if value is not None else value


class Requisito(RequisitoBase):
    id: UUID
    proyecto_id: UUID
    creado_por: Optional[UUID] = None
    ultima_edicion_por: Optional[UUID] = None
    fecha_creacion: datetime
    ultima_actualizacion: datetime
    archivado: bool = False

    model_config = ConfigDict(from_attributes=True)


class RequisitoHistorial(BaseModel):
    id: UUID
    requisito_id: UUID
    titulo: str
    descripcion_markdown: str
    estado: str
    prioridad: str
    external_provider: Optional[str] = None
    external_reference: Optional[str] = None
    external_url: Optional[str] = None
    editado_por: Optional[UUID] = None
    editado_por_nombre: Optional[str] = None
    editado_por_email: Optional[str] = None
    fecha_edicion: datetime
    comentario_cambio: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ArchiveRequest(BaseModel):
    archivado: bool = True


class HistoriaAcceptanceCriterionInput(BaseModel):
    local_id: str = Field(..., min_length=1, max_length=80)
    type: Literal["FUNCTIONAL", "SECURITY", "ACCESSIBILITY", "PERFORMANCE", "TECHNICAL"] = "FUNCTIONAL"
    title: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    given: str = Field(default="", max_length=16000)
    when: str = Field(default="", max_length=16000)
    then: List[str] = Field(default_factory=list, max_length=30)
    observable_result: str = Field(default="", max_length=16000)
    mandatory: bool = True
    source_refs: List[str] = Field(default_factory=list, max_length=50)
    assumption_ids: List[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def require_observable_outcome(self):
        if not any(item.strip() for item in self.then) and not self.observable_result.strip():
            raise ValueError("Cada criterio debe incluir al menos un Entonces o un resultado observable")
        return self


class HistoriaBase(ExternalReference):
    codigo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_CODE_LENGTH)
    titulo: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    descripcion_markdown: str = Field(default="", max_length=MAX_MARKDOWN_LENGTH)
    criterios_aceptacion_markdown: str = Field(default="", max_length=MAX_MARKDOWN_LENGTH)
    estado: str = "BORRADOR"
    prioridad: str = "MEDIA"

    @field_validator("estado")
    @classmethod
    def validate_state(cls, value):
        normalized = value.strip().upper()
        if normalized not in STORY_STATES:
            raise ValueError("Estado de historia invalido")
        return normalized

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        return RequisitoBase.validate_priority(value)


class HistoriaCreate(HistoriaBase):
    requisito_id: UUID
    proyecto_id: UUID
    acceptance_criteria: List[HistoriaAcceptanceCriterionInput] = Field(default_factory=list, max_length=50)


class HistoriaUpdate(ExternalReference):
    titulo: Optional[str] = Field(default=None, min_length=1, max_length=MAX_TITLE_LENGTH)
    descripcion_markdown: Optional[str] = Field(default=None, max_length=MAX_MARKDOWN_LENGTH)
    criterios_aceptacion_markdown: Optional[str] = Field(default=None, max_length=MAX_MARKDOWN_LENGTH)
    estado: Optional[str] = None
    prioridad: Optional[str] = None
    comentario_cambio: Optional[str] = Field(default=None, max_length=MAX_CHANGE_COMMENT_LENGTH)

    @field_validator("estado")
    @classmethod
    def validate_state(cls, value):
        return HistoriaBase.validate_state(value) if value is not None else value

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        return HistoriaBase.validate_priority(value) if value is not None else value


class HistoriaGeneracionEstimateRequest(BaseModel):
    wiki_page_ids: List[UUID] = Field(default_factory=list, max_length=30)
    componente_ids: List[UUID] = Field(default_factory=list, max_length=50)
    instrucciones: str = Field(default="", max_length=MAX_GENERATION_INSTRUCTIONS_LENGTH)


class QuestionAnswer(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    answer: str = Field(..., min_length=1, max_length=16000)


class AssumptionConfirmation(BaseModel):
    assumption_ids: List[str] = Field(default_factory=list, max_length=50)
    question_answers: List[QuestionAnswer] = Field(default_factory=list, max_length=50)
    continuation_mode: Literal["MANUAL", "AUTO_TIMEOUT"] = "MANUAL"


class AcceptanceCriterionInput(BaseModel):
    local_id: str = Field(..., min_length=1, max_length=80)
    type: Literal["FUNCTIONAL", "SECURITY", "ACCESSIBILITY", "PERFORMANCE", "TECHNICAL"] = "FUNCTIONAL"
    title: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    given: str = Field(default="", max_length=16000)
    when: str = Field(default="", max_length=16000)
    then: List[str] = Field(default_factory=list, max_length=30)
    observable_result: str = Field(default="", max_length=16000)
    mandatory: bool = True
    source_refs: List[str] = Field(default_factory=list, max_length=50)
    assumption_ids: List[str] = Field(default_factory=list, max_length=50)


class StoryQualityInput(BaseModel):
    invest: dict[str, Any] = Field(default_factory=dict)
    testability: Literal["PASS", "WARN", "FAIL"] = "WARN"
    duplicate_risk: Literal["LOW", "MEDIUM", "HIGH"] = "LOW"
    overlap_risk: Literal["LOW", "MEDIUM", "HIGH"] = "LOW"
    implementation_leakage: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class StoryProposalInput(BaseModel):
    local_id: str = Field(..., min_length=1, max_length=80)
    story_type: Literal["USER_STORY", "TECHNICAL_STORY", "ENABLER", "SPIKE", "NFR"] = "USER_STORY"
    title: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    actor: str = Field(default="", max_length=255)
    goal: str = Field(default="", max_length=4000)
    benefit: str = Field(default="", max_length=4000)
    description: str = Field(default="", max_length=MAX_MARKDOWN_LENGTH)
    source_refs: List[str] = Field(default_factory=list, max_length=50)
    assumption_ids: List[str] = Field(default_factory=list, max_length=50)
    open_questions: List[str] = Field(default_factory=list, max_length=50)
    acceptance_criteria: List[AcceptanceCriterionInput] = Field(default_factory=list, max_length=50)
    quality: StoryQualityInput = Field(default_factory=StoryQualityInput)


class HistoriaGeneracionApplyStory(StoryProposalInput):
    selected: bool = True
    prioridad: str = "MEDIA"
    # Quality findings are advisory. Applying a critical proposal requires an
    # explicit, auditable decision from the QA user.
    quality_override_accepted: bool = False
    quality_override_reason: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("prioridad")
    @classmethod
    def validate_priority(cls, value):
        return RequisitoBase.validate_priority(value)

    @model_validator(mode="after")
    def validate_quality_override_reason(self):
        if self.quality_override_accepted and not (self.quality_override_reason or "").strip():
            raise ValueError("Indica el motivo para aceptar una propuesta con observaciones críticas")
        return self


class HistoriaGeneracionGenerateRequest(BaseModel):
    max_historias: int = Field(..., ge=1, le=MAX_GENERATION_STORIES)
    question_answers: List[QuestionAnswer] = Field(default_factory=list, max_length=50)


class HistoriaGeneracionApplyRequest(BaseModel):
    historias: List[HistoriaGeneracionApplyStory] = Field(..., min_length=1, max_length=MAX_GENERATION_STORIES)


class CasoGeneracionEstimateRequest(BaseModel):
    wiki_page_ids: List[UUID] = Field(default_factory=list, max_length=30)
    componente_ids: List[UUID] = Field(default_factory=list, max_length=50)
    # La ubicación se decide antes de que el motor proponga casos. Así ningún
    # caso aplicado por IA queda fuera de una suite o de un componente.
    suite_id: UUID
    componente_id: UUID
    focus_categories: List[Literal["POSITIVE", "NEGATIVE", "BOUNDARY", "STATE_TRANSITION", "RBAC", "SECURITY", "ACCESSIBILITY", "INTEGRATION", "PERFORMANCE"]] = Field(default_factory=list, max_length=9)
    instrucciones: str = Field(default="", max_length=MAX_GENERATION_INSTRUCTIONS_LENGTH)


class CasoGeneracionPlanRequest(BaseModel):
    max_casos: int = Field(..., ge=1, le=MAX_CASE_GENERATION_CASES)
    scenario_ids: List[str] = Field(default_factory=list, max_length=MAX_CASE_GENERATION_CASES)
    question_answers: List[QuestionAnswer] = Field(default_factory=list, max_length=50)


class CasoGeneracionStepInput(BaseModel):
    number: int = Field(..., ge=1, le=MAX_CASE_GENERATION_STEPS)
    action: str = Field(..., min_length=1, max_length=16000)
    data: str = Field(default="", max_length=16000)
    expected_result: str = Field(..., min_length=1, max_length=16000)


class CasoGeneracionAutomationInput(BaseModel):
    readiness: Literal["HIGH", "MEDIUM", "LOW", "NOT_RECOMMENDED"] = "NOT_RECOMMENDED"
    reason: str = Field(default="", max_length=1000)


class CasoGeneracionQualityInput(BaseModel):
    testability: Literal["PASS", "WARN", "FAIL"] = "WARN"
    warnings: List[str] = Field(default_factory=list, max_length=30)


class CasoGeneracionProposalInput(BaseModel):
    local_id: str = Field(..., min_length=1, max_length=80)
    title: str = Field(..., min_length=1, max_length=MAX_TITLE_LENGTH)
    category: Literal["POSITIVE", "NEGATIVE", "BOUNDARY", "STATE_TRANSITION", "RBAC", "SECURITY", "ACCESSIBILITY", "INTEGRATION", "PERFORMANCE"]
    test_type: Literal["MANUAL"] = "MANUAL"
    priority: Literal["ALTA", "MEDIA", "BAJA"] = "MEDIA"
    criticality: Literal["BAJA", "MEDIA", "ALTA", "CRITICA"] = "MEDIA"
    objective: str = Field(default="", max_length=16000)
    preconditions: List[str] = Field(default_factory=list, max_length=30)
    test_data: List[dict[str, str]] = Field(default_factory=list, max_length=50)
    steps: List[CasoGeneracionStepInput] = Field(..., min_length=1, max_length=MAX_CASE_GENERATION_STEPS)
    criterion_refs: List[UUID] = Field(..., min_length=1, max_length=50)
    source_refs: List[str] = Field(default_factory=list, max_length=50)
    assumption_ids: List[str] = Field(default_factory=list, max_length=50)
    automation: CasoGeneracionAutomationInput = Field(default_factory=CasoGeneracionAutomationInput)
    quality: CasoGeneracionQualityInput = Field(default_factory=CasoGeneracionQualityInput)
    selected: bool = True
    quality_override_accepted: bool = False
    quality_override_reason: Optional[str] = Field(default=None, max_length=1000)
    duplicate_override_accepted: bool = False
    duplicate_override_reason: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, value):
        numbers = [item.number for item in value]
        if numbers != list(range(1, len(numbers) + 1)):
            raise ValueError("Los pasos deben numerarse de forma consecutiva desde 1")
        return value

    @model_validator(mode="after")
    def validate_quality_override(self):
        if self.quality.testability == "FAIL" and self.selected and not self.quality_override_accepted:
            raise ValueError("Una propuesta FAIL requiere aceptación explícita antes de aplicarse")
        if self.quality_override_accepted and not (self.quality_override_reason or "").strip():
            raise ValueError("Indica el motivo de aceptación de la propuesta con observaciones críticas")
        if self.duplicate_override_accepted and not (self.duplicate_override_reason or "").strip():
            raise ValueError("Indica el motivo para conservar un caso marcado como posible duplicado")
        return self


class CasoGeneracionApplyRequest(BaseModel):
    casos: List[CasoGeneracionProposalInput] = Field(..., min_length=1, max_length=MAX_CASE_GENERATION_CASES)
    excluded_criteria_reasons: dict[UUID, str] = Field(default_factory=dict)


class Historia(HistoriaBase):
    id: UUID
    requisito_id: UUID
    proyecto_id: UUID
    creado_por: Optional[UUID] = None
    ultima_edicion_por: Optional[UUID] = None
    fecha_creacion: datetime
    ultima_actualizacion: datetime
    archivado: bool = False
    requisito_codigo: Optional[str] = None
    requisito_titulo: Optional[str] = None
    case_count: int = 0
    requiere_revision_count: int = 0
    criterios_estructuracion_estado: str = "STRUCTURED"
    criterios_estructurados_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class HistoriaHistorial(BaseModel):
    id: UUID
    historia_id: UUID
    titulo: str
    descripcion_markdown: str
    criterios_aceptacion_markdown: str
    estado: str
    prioridad: str
    external_provider: Optional[str] = None
    external_reference: Optional[str] = None
    external_url: Optional[str] = None
    editado_por: Optional[UUID] = None
    editado_por_nombre: Optional[str] = None
    editado_por_email: Optional[str] = None
    fecha_edicion: datetime
    comentario_cambio: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CasoHistoriasUpdate(BaseModel):
    historia_ids: List[UUID] = Field(default_factory=list, max_length=MAX_STORIES_PER_CASE)

    @field_validator("historia_ids")
    @classmethod
    def validate_unique_stories(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("No se puede repetir una historia")
        return value


class CasoHistoriaDetail(BaseModel):
    historia_id: UUID
    historia_codigo: str
    historia_titulo: str
    historia_estado: str
    requisito_id: UUID
    requisito_codigo: str
    requisito_titulo: str
    requiere_revision: bool
    fecha_revision: Optional[datetime] = None


class CoverageSummary(BaseModel):
    requisitos_total: int = 0
    requisitos_sin_historias: int = 0
    requisitos_con_historias: int = 0
    historias_total: int = 0
    historias_sin_casos: int = 0
    historias_con_casos: int = 0
    casos_sin_historia: int = 0
    historias_requieren_revision: int = 0
    cobertura_historias_porcentaje: float = 0
    items: List[dict] = Field(default_factory=list)

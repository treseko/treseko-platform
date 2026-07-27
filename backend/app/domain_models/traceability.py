import uuid

from sqlalchemy import Boolean, Column, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from ..database import Base
from ..time_utils import UTCDateTime


class Requisito(Base):
    __tablename__ = "requisitos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    codigo = Column(String(40), nullable=False)
    titulo = Column(String(255), nullable=False)
    descripcion_markdown = Column(Text, nullable=False, default="")
    estado = Column(String(40), nullable=False, default="BORRADOR", index=True)
    prioridad = Column(String(20), nullable=False, default="MEDIA", index=True)
    external_provider = Column(String(80), nullable=True)
    external_reference = Column(String(160), nullable=True)
    external_url = Column(Text, nullable=True)
    creado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    ultima_edicion_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    ultima_actualizacion = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())
    archivado = Column(Boolean, nullable=False, default=False, index=True)

    proyecto = relationship("Proyecto", back_populates="requisitos")
    componentes = relationship("RequisitoComponente", back_populates="requisito", cascade="all, delete-orphan")
    historias = relationship("HistoriaUsuario", back_populates="requisito", cascade="all, delete-orphan")
    historial = relationship("RequisitoHistorial", back_populates="requisito", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("proyecto_id", "codigo", name="uq_requisitos_proyecto_codigo"),)


class RequisitoComponente(Base):
    __tablename__ = "requisito_componentes"

    requisito_id = Column(UUID(as_uuid=True), ForeignKey("requisitos.id", ondelete="CASCADE"), primary_key=True)
    componente_id = Column(UUID(as_uuid=True), ForeignKey("componentes.id", ondelete="CASCADE"), primary_key=True)

    requisito = relationship("Requisito", back_populates="componentes")
    componente = relationship("Componente")


class RequisitoHistorial(Base):
    __tablename__ = "requisito_historial"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requisito_id = Column(UUID(as_uuid=True), ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False, index=True)
    titulo = Column(String(255), nullable=False)
    descripcion_markdown = Column(Text, nullable=False, default="")
    estado = Column(String(40), nullable=False)
    prioridad = Column(String(20), nullable=False)
    external_provider = Column(String(80), nullable=True)
    external_reference = Column(String(160), nullable=True)
    external_url = Column(Text, nullable=True)
    editado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_edicion = Column(UTCDateTime(), server_default=func.now())
    comentario_cambio = Column(String(255), nullable=True)

    requisito = relationship("Requisito", back_populates="historial")


class HistoriaUsuario(Base):
    __tablename__ = "historias_usuario"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requisito_id = Column(UUID(as_uuid=True), ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    codigo = Column(String(40), nullable=False)
    titulo = Column(String(255), nullable=False)
    descripcion_markdown = Column(Text, nullable=False, default="")
    criterios_aceptacion_markdown = Column(Text, nullable=False, default="")
    estado = Column(String(40), nullable=False, default="BORRADOR", index=True)
    prioridad = Column(String(20), nullable=False, default="MEDIA", index=True)
    external_provider = Column(String(80), nullable=True)
    external_reference = Column(String(160), nullable=True)
    external_url = Column(Text, nullable=True)
    creado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    ultima_edicion_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    ultima_actualizacion = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())
    archivado = Column(Boolean, nullable=False, default=False, index=True)
    ai_generation_id = Column(UUID(as_uuid=True), ForeignKey("historia_generaciones.id", ondelete="SET NULL"), nullable=True, index=True)
    criterios_estructuracion_estado = Column(String(32), nullable=False, default="STRUCTURED")

    requisito = relationship("Requisito", back_populates="historias")
    proyecto = relationship("Proyecto", back_populates="historias_usuario")
    historial = relationship("HistoriaHistorial", back_populates="historia", cascade="all, delete-orphan")
    casos = relationship("CasoHistoria", back_populates="historia", cascade="all, delete-orphan")
    criterios_aceptacion = relationship("AcceptanceCriterion", back_populates="historia", cascade="all, delete-orphan")
    generaciones_casos = relationship("CasoGeneracion", back_populates="historia", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("proyecto_id", "codigo", name="uq_historias_proyecto_codigo"),)


class HistoriaHistorial(Base):
    __tablename__ = "historia_historial"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    historia_id = Column(UUID(as_uuid=True), ForeignKey("historias_usuario.id", ondelete="CASCADE"), nullable=False, index=True)
    titulo = Column(String(255), nullable=False)
    descripcion_markdown = Column(Text, nullable=False, default="")
    criterios_aceptacion_markdown = Column(Text, nullable=False, default="")
    estado = Column(String(40), nullable=False)
    prioridad = Column(String(20), nullable=False)
    external_provider = Column(String(80), nullable=True)
    external_reference = Column(String(160), nullable=True)
    external_url = Column(Text, nullable=True)
    editado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_edicion = Column(UTCDateTime(), server_default=func.now())
    comentario_cambio = Column(String(255), nullable=True)

    historia = relationship("HistoriaUsuario", back_populates="historial")


class CasoHistoria(Base):
    __tablename__ = "caso_historias"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    caso_master_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    historia_id = Column(UUID(as_uuid=True), ForeignKey("historias_usuario.id", ondelete="CASCADE"), nullable=False, index=True)
    creado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    historia_actualizada_en_vinculo = Column(UTCDateTime(), nullable=True)
    requiere_revision = Column(Boolean, nullable=False, default=False, index=True)
    fecha_revision = Column(UTCDateTime(), nullable=True)
    revisado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)

    historia = relationship("HistoriaUsuario", back_populates="casos")

    __table_args__ = (
        UniqueConstraint("caso_master_id", "historia_id", name="uq_caso_historias_master_historia"),
        Index("ix_caso_historias_historia_revision", "historia_id", "requiere_revision"),
    )


class HistoriaGeneracion(Base):
    __tablename__ = "historia_generaciones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requisito_id = Column(UUID(as_uuid=True), ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflows.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_version = Column(Integer, nullable=True)
    estado = Column(String(32), nullable=False, default="ESTIMANDO", index=True)
    instrucciones = Column(Text, nullable=False, default="")
    fuente_snapshot = Column(JSON, nullable=False, default=dict)
    estimacion = Column(JSON, nullable=False, default=dict)
    propuestas = Column(JSON, nullable=False, default=list)
    error_detalle = Column(Text, nullable=True)
    provider = Column(String(80), nullable=True)
    model = Column(String(255), nullable=True)
    temperature = Column(Float, nullable=True)
    prompt_version = Column(String(80), nullable=True)
    prompt_hash = Column(String(128), nullable=True)
    workflow_snapshot = Column(JSON, nullable=True)
    context_hash = Column(String(128), nullable=True)
    analysis_json = Column(JSON, nullable=True)
    propuestas_originales_json = Column(JSON, nullable=True)
    propuestas_finales_json = Column(JSON, nullable=True)
    decisiones_json = Column(JSON, nullable=True)
    accepted_assumption_ids = Column(JSON, nullable=True)
    warnings_json = Column(JSON, nullable=True)
    workflow_traces_json = Column(JSON, nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    estimated_cost = Column(Float, nullable=True)
    sanitized_error = Column(Text, nullable=True)
    completed_at = Column(UTCDateTime(), nullable=True)
    creado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    fecha_actualizacion = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    requisito = relationship("Requisito")
    proyecto = relationship("Proyecto")


class AcceptanceCriterion(Base):
    __tablename__ = "acceptance_criteria"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    historia_id = Column(UUID(as_uuid=True), ForeignKey("historias_usuario.id", ondelete="CASCADE"), nullable=False, index=True)
    codigo = Column(String(80), nullable=False)
    tipo = Column(String(32), nullable=False)
    titulo = Column(String(255), nullable=False)
    given_text = Column(Text, nullable=False, default="")
    when_text = Column(Text, nullable=False, default="")
    then_items = Column(JSON, nullable=False, default=list)
    observable_result = Column(Text, nullable=False, default="")
    mandatory = Column(Boolean, nullable=False, default=True)
    source_refs = Column(JSON, nullable=False, default=list)
    assumption_refs = Column(JSON, nullable=False, default=list)
    orden = Column(Integer, nullable=False, default=0)
    activo = Column(Boolean, nullable=False, default=True)
    structuring_status = Column(String(32), nullable=False, default="STRUCTURED")
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    ultima_actualizacion = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    historia = relationship("HistoriaUsuario", back_populates="criterios_aceptacion")
    casos = relationship("AcceptanceCriterionCase", back_populates="criterio", cascade="all, delete-orphan")
    __table_args__ = (UniqueConstraint("historia_id", "codigo", name="uq_acceptance_criteria_story_code"),)


class AcceptanceCriterionCase(Base):
    __tablename__ = "acceptance_criterion_cases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    acceptance_criterion_id = Column(UUID(as_uuid=True), ForeignKey("acceptance_criteria.id", ondelete="CASCADE"), nullable=False, index=True)
    caso_master_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    creado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

    criterio = relationship("AcceptanceCriterion", back_populates="casos")
    __table_args__ = (UniqueConstraint("acceptance_criterion_id", "caso_master_id", name="uq_acceptance_criterion_case"),)


class CasoGeneracion(Base):
    """Auditable, review-first AI generation session for manual test cases."""
    __tablename__ = "caso_generaciones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    historia_id = Column(UUID(as_uuid=True), ForeignKey("historias_usuario.id", ondelete="CASCADE"), nullable=False, index=True)
    requisito_id = Column(UUID(as_uuid=True), ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflows.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_version = Column(Integer, nullable=True)
    estado = Column(String(32), nullable=False, default="ESTIMANDO", index=True)
    instrucciones = Column(Text, nullable=False, default="")
    fuente_snapshot = Column(JSON, nullable=False, default=dict)
    estimacion = Column(JSON, nullable=False, default=dict)
    analysis_json = Column(JSON, nullable=True)
    propuestas_originales_json = Column(JSON, nullable=True)
    propuestas_finales_json = Column(JSON, nullable=True)
    decisiones_json = Column(JSON, nullable=True)
    accepted_assumption_ids = Column(JSON, nullable=True)
    warnings_json = Column(JSON, nullable=True)
    workflow_snapshot = Column(JSON, nullable=True)
    workflow_traces_json = Column(JSON, nullable=True)
    context_hash = Column(String(128), nullable=True)
    prompt_hash = Column(String(128), nullable=True)
    provider = Column(String(80), nullable=True)
    model = Column(String(255), nullable=True)
    temperature = Column(Float, nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    estimated_cost = Column(Float, nullable=True)
    sanitized_error = Column(Text, nullable=True)
    completed_at = Column(UTCDateTime(), nullable=True)
    creado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    fecha_actualizacion = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    historia = relationship("HistoriaUsuario", back_populates="generaciones_casos")
    requisito = relationship("Requisito")
    proyecto = relationship("Proyecto")


class TraceabilityWaiver(Base):
    __tablename__ = "traceability_waivers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requisito_id = Column(UUID(as_uuid=True), ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    motivo = Column(Text, nullable=False)
    estado = Column(String(24), nullable=False, default="PENDING")
    solicitado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    aprobado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    fecha_aprobacion = Column(UTCDateTime(), nullable=True)

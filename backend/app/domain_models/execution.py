from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class TestRun(Base):
    __tablename__ = "test_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="RESTRICT"), nullable=False, index=True)
    build_id = Column(UUID(as_uuid=True), ForeignKey("builds.id", ondelete="SET NULL"), nullable=True, index=True)
    origen = Column(String(30), default="MANUAL", nullable=False)
    external_run_id = Column(String(255), nullable=True, index=True)
    nombre = Column(String(200), nullable=False)
    entorno = Column(String(50), nullable=False)
    entorno_id = Column(UUID(as_uuid=True), ForeignKey("entornos.id", ondelete="SET NULL"), nullable=True, index=True)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("entorno_datasets.id", ondelete="SET NULL"), nullable=True, index=True)
    variables_resueltas = Column(JSON, default=dict)
    datasets_resueltos = Column(JSON, default=dict)
    estado_run = Column(Enum(EstadoRun), default=EstadoRun.ABIERTO, nullable=False, index=True)
    creado_por = Column(UUID(as_uuid=True), nullable=False)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    fecha_cierre = Column(UTCDateTime())

    proyecto = relationship("Proyecto", back_populates="runs")
    build = relationship("Build", back_populates="runs")
    ejecuciones = relationship("EjecucionCaso", back_populates="test_run", cascade="all, delete-orphan")

class EjecucionCaso(Base):
    __tablename__ = "ejecuciones_casos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    test_run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    caso_id = Column(UUID(as_uuid=True), ForeignKey("casos_prueba.id", ondelete="RESTRICT"), nullable=False, index=True)
    version_ejecutada = Column(Integer, nullable=False)
    estado_resultado = Column(Enum(EstadoResultado), default=EstadoResultado.SIN_CORRER, nullable=False)
    execution_mode = Column(Enum(ExecutionMode), default=ExecutionMode.MANUAL, nullable=False, index=True)
    ejecutado_por = Column(UUID(as_uuid=True), nullable=False)
    intento_numero = Column(Integer, default=1, nullable=False)
    duracion_segundos = Column(Integer, default=0)
    observaciones = Column(Text)
    ai_report = Column(JSON, default=dict)
    ai_confidence = Column(Integer)
    ai_consensus = Column(String(30))
    ai_failure_category = Column(String(80))
    ai_human_review_required = Column(Boolean, default=False)
    ai_review_status = Column(Enum(AiReviewStatus), default=AiReviewStatus.NO_REQUIERE_REVISION, nullable=False)
    ai_reviewed_by = Column(UUID(as_uuid=True), nullable=True)
    ai_reviewed_at = Column(UTCDateTime())
    ai_review_note = Column(Text)
    fecha_ejecucion = Column(UTCDateTime(), server_default=func.now())

    test_run = relationship("TestRun", back_populates="ejecuciones")
    snapshots = relationship("SnapshotPaso", back_populates="ejecucion_caso", cascade="all, delete-orphan")
    automation_jobs = relationship("AutomationJob", back_populates="ejecucion", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("test_run_id", "caso_id", "intento_numero", name="uq_ejecuciones_run_caso_intento"),
    )

class SnapshotPaso(Base):
    __tablename__ = "snapshots_pasos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ejecucion_caso_id = Column(UUID(as_uuid=True), ForeignKey("ejecuciones_casos.id", ondelete="CASCADE"), nullable=False, index=True)
    paso_id = Column(UUID(as_uuid=True), ForeignKey("pasos_prueba.id", ondelete="SET NULL"), nullable=True, index=True)
    numero_paso = Column(Integer, nullable=False)
    accion_congelada = Column(Text, nullable=False)
    datos_congelados = Column(Text)
    resultado_esperado_congelado = Column(Text, nullable=False)
    estado_paso = Column(Enum(EstadoResultado), default=EstadoResultado.SIN_CORRER, nullable=False)
    comentarios = Column(Text)
    evidencia_url = Column(Text)
    error_log = Column(Text)

    ejecucion_caso = relationship("EjecucionCaso", back_populates="snapshots")
    paso = relationship("PasoPrueba")

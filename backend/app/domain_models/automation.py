from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class FuncionAutomatizada(Base):
    __tablename__ = "funciones_automatizadas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    master_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    suite_id = Column(UUID(as_uuid=True), ForeignKey("suites.id", ondelete="CASCADE"), nullable=True, index=True)
    componente_id = Column(UUID(as_uuid=True), ForeignKey("componentes.id", ondelete="CASCADE"), nullable=True, index=True)
    scope = Column(String(20), default="PROYECTO", nullable=False)
    nombre = Column(String(100), nullable=False)
    descripcion = Column(Text)
    codigo = Column(Text, nullable=False)
    parametros = Column(JSON, default=list)
    framework = Column(String(50), default="playwright", nullable=False)
    version = Column(Integer, default=1, nullable=False)
    creado_por = Column(UUID(as_uuid=True), nullable=False)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

    proyecto = relationship("Proyecto")
    suite = relationship("Suite")
    componente = relationship("Componente")

class AutomationRunner(Base):
    __tablename__ = "automation_runners"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nombre = Column(String(150), nullable=False)
    organizacion_id = Column(UUID(as_uuid=True), ForeignKey("organizaciones.id", ondelete="SET NULL"), nullable=True, index=True)
    tipo = Column(String(30), default="LOCAL", nullable=False)
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    estado = Column(String(30), default="ONLINE", nullable=False, index=True)
    capabilities = Column(JSON, default=dict, nullable=False)
    activo = Column(Boolean, default=True, nullable=False)
    ultimo_heartbeat = Column(UTCDateTime(), server_default=func.now())
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

    jobs = relationship("AutomationJob", back_populates="runner")

class AutomationRunnerRegistrationToken(Base):
    __tablename__ = "automation_runner_registration_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    nombre = Column(String(150), nullable=False)
    organizacion_id = Column(UUID(as_uuid=True), ForeignKey("organizaciones.id", ondelete="SET NULL"), nullable=True, index=True)
    tipo = Column(String(30), default="LOCAL", nullable=False)
    expires_at = Column(UTCDateTime(), nullable=False)
    used_at = Column(UTCDateTime(), nullable=True)
    used_runner_id = Column(UUID(as_uuid=True), ForeignKey("automation_runners.id", ondelete="SET NULL"), nullable=True)
    creado_por = Column(UUID(as_uuid=True), nullable=False)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

class AutomationRunnerPairingRequest(Base):
    __tablename__ = "automation_runner_pairing_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(20), unique=True, nullable=False, index=True)
    pairing_token_hash = Column(String(128), nullable=False, index=True)
    nombre = Column(String(150), nullable=False)
    organizacion_id = Column(UUID(as_uuid=True), ForeignKey("organizaciones.id", ondelete="SET NULL"), nullable=True, index=True)
    tipo = Column(String(30), default="LOCAL", nullable=False)
    capabilities = Column(JSON, default=dict, nullable=False)
    estado = Column(String(30), default="PENDING", nullable=False, index=True)
    expires_at = Column(UTCDateTime(), nullable=False)
    approved_at = Column(UTCDateTime(), nullable=True)
    denied_at = Column(UTCDateTime(), nullable=True)
    approved_by = Column(UUID(as_uuid=True), nullable=True)
    runner_id = Column(UUID(as_uuid=True), ForeignKey("automation_runners.id", ondelete="SET NULL"), nullable=True)
    runner_token = Column(String(300), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

class AutomationJob(Base):
    __tablename__ = "automation_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_type = Column(String(30), default="EXECUTION", nullable=False, index=True)
    test_run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id", ondelete="CASCADE"), nullable=True, index=True)
    ejecucion_id = Column(UUID(as_uuid=True), ForeignKey("ejecuciones_casos.id", ondelete="CASCADE"), nullable=True, index=True)
    caso_id = Column(UUID(as_uuid=True), ForeignKey("casos_prueba.id", ondelete="RESTRICT"), nullable=True, index=True)
    build_id = Column(UUID(as_uuid=True), ForeignKey("builds.id", ondelete="SET NULL"), nullable=True, index=True)
    runner_id = Column(UUID(as_uuid=True), ForeignKey("automation_runners.id", ondelete="SET NULL"), nullable=True, index=True)
    estado = Column(Enum(AutomationJobStatus), default=AutomationJobStatus.PENDING, nullable=False, index=True)
    required_framework = Column(String(50), default="playwright", nullable=False)
    required_language = Column(String(30), default="javascript", nullable=False, index=True)
    required_runtime = Column(String(100), nullable=True)
    timeout_seconds = Column(Integer, default=300, nullable=False)
    payload_congelado = Column(JSON, default=dict, nullable=False)
    logs = Column(Text)
    error_message = Column(Text)
    metadata_resultado = Column(JSON, default=dict)
    creado_por = Column(UUID(as_uuid=True), nullable=False)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    fecha_claim = Column(UTCDateTime(), nullable=True)
    fecha_inicio = Column(UTCDateTime(), nullable=True)
    fecha_fin = Column(UTCDateTime(), nullable=True)

    test_run = relationship("TestRun")
    ejecucion = relationship("EjecucionCaso", back_populates="automation_jobs")
    caso = relationship("CasoPrueba")
    build = relationship("Build")
    runner = relationship("AutomationRunner", back_populates="jobs")

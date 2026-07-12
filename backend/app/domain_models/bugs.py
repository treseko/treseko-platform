from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class BugIssue(Base):
    __tablename__ = "bug_issues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    codigo = Column(String(30), unique=True, nullable=False, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    componente_id = Column(UUID(as_uuid=True), ForeignKey("componentes.id", ondelete="SET NULL"), nullable=True, index=True)
    build_id = Column(UUID(as_uuid=True), ForeignKey("builds.id", ondelete="SET NULL"), nullable=True, index=True)
    caso_id = Column(UUID(as_uuid=True), ForeignKey("casos_prueba.id", ondelete="SET NULL"), nullable=True, index=True)
    test_run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    ejecucion_id = Column(UUID(as_uuid=True), ForeignKey("ejecuciones_casos.id", ondelete="SET NULL"), nullable=True, index=True)
    snapshot_id = Column(UUID(as_uuid=True), ForeignKey("snapshots_pasos.id", ondelete="SET NULL"), nullable=True, index=True)
    entorno_id = Column(UUID(as_uuid=True), ForeignKey("entornos.id", ondelete="SET NULL"), nullable=True, index=True)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("entorno_datasets.id", ondelete="SET NULL"), nullable=True, index=True)
    numero_paso = Column(Integer, nullable=True)
    execution_mode = Column(String(30), nullable=True)
    case_code = Column(String(30), nullable=True)
    build_code = Column(String(30), nullable=True)
    titulo = Column(String(255), nullable=False)
    descripcion = Column(Text)
    severidad = Column(String(20), default="MEDIA", nullable=False, index=True)
    prioridad = Column(String(20), default="MEDIA", nullable=False, index=True)
    estado = Column(String(30), default="ABIERTO", nullable=False, index=True)
    precondiciones = Column(Text)
    pasos_reproduccion = Column(Text)
    datos_prueba = Column(Text)
    resultado_esperado = Column(Text)
    resultado_obtenido = Column(Text)
    comportamiento_actual = Column(Text)
    url_afectada = Column(Text)
    navegador = Column(String(120), nullable=True)
    dispositivo = Column(String(120), nullable=True)
    resolucion = Column(String(80), nullable=True)
    sistema_operativo = Column(String(120), nullable=True)
    ambiente_nombre = Column(String(150), nullable=True)
    ambiente_url = Column(Text)
    version_app = Column(String(120), nullable=True)
    logs_relevantes = Column(Text)
    error_tecnico = Column(Text)
    stack_trace = Column(Text)
    notas_qa = Column(Text)
    reproducibilidad = Column(String(30), default="no_reproducido", nullable=False)
    frecuencia = Column(String(80), nullable=True)
    impacto_negocio = Column(Text)
    modulo_funcional = Column(String(150), nullable=True)
    criticidad = Column(String(20), default="MEDIA", nullable=False)
    bloquea_release = Column(Boolean, default=False, nullable=False)
    bloquea_caso = Column(Boolean, default=False, nullable=False)
    asignado_a = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    creado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    origen = Column(String(30), default="manual", nullable=False)
    external_provider = Column(String(50), nullable=True)
    external_issue_id = Column(String(120), nullable=True)
    external_issue_url = Column(Text, nullable=True)
    external_sync_status = Column(String(30), default="not_synced", nullable=False)
    external_last_sync_at = Column(UTCDateTime(), nullable=True)
    external_payload_snapshot = Column(JSON, default=dict)
    dedupe_hash = Column(String(128), nullable=True, index=True)
    fecha_resolucion = Column(UTCDateTime(), nullable=True)
    resuelto_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    resolucion = Column(Text)
    motivo_cierre = Column(Text)
    duplicate_of_id = Column(UUID(as_uuid=True), ForeignKey("bug_issues.id", ondelete="SET NULL"), nullable=True, index=True)
    reopened_count = Column(Integer, default=0, nullable=False)
    retest_status = Column(String(30), default="pendiente", nullable=False)
    closed_at = Column(UTCDateTime(), nullable=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(UTCDateTime(), server_default=func.now())
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    proyecto = relationship("Proyecto")
    componente = relationship("Componente")
    build = relationship("Build")
    caso = relationship("CasoPrueba")
    test_run = relationship("TestRun")
    ejecucion = relationship("EjecucionCaso")
    snapshot = relationship("SnapshotPaso")
    entorno = relationship("Entorno")
    dataset = relationship("EntornoDataset")
    assignee = relationship("Usuario", foreign_keys=[asignado_a])
    creator = relationship("Usuario", foreign_keys=[creado_por])
    resolver = relationship("Usuario", foreign_keys=[resuelto_por])
    duplicate_of = relationship("BugIssue", remote_side=[id])
    comments = relationship("BugComment", back_populates="bug", cascade="all, delete-orphan")
    attachments = relationship("BugAttachment", back_populates="bug", cascade="all, delete-orphan")
    external_links = relationship("ExternalIssueLink", back_populates="bug", cascade="all, delete-orphan")

class BugComment(Base):
    __tablename__ = "bug_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bug_id = Column(UUID(as_uuid=True), ForeignKey("bug_issues.id", ondelete="CASCADE"), nullable=False, index=True)
    autor_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    comentario = Column(Text, nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now())

    bug = relationship("BugIssue", back_populates="comments")
    autor = relationship("Usuario")
    attachments = relationship("BugAttachment", back_populates="comment", cascade="all, delete-orphan")

class BugAttachment(Base):
    __tablename__ = "bug_attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bug_id = Column(UUID(as_uuid=True), ForeignKey("bug_issues.id", ondelete="CASCADE"), nullable=False, index=True)
    comment_id = Column(UUID(as_uuid=True), ForeignKey("bug_comments.id", ondelete="CASCADE"), nullable=True, index=True)
    attachment_id = Column(UUID(as_uuid=True), ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False, index=True)
    tipo = Column(String(50), default="BUG_EVIDENCE", nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now())

    bug = relationship("BugIssue", back_populates="attachments")
    comment = relationship("BugComment", back_populates="attachments")
    attachment = relationship("Attachment")

    __table_args__ = (UniqueConstraint('bug_id', 'attachment_id', 'tipo', name='unique_bug_attachment_tipo'),)

from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename_original = Column(String(255), nullable=False)
    content_type = Column(String(100), nullable=False)
    size = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False, index=True)
    storage_path = Column(Text, nullable=False)
    public_url = Column(Text, nullable=False)
    scope = Column(String(50), nullable=False)
    organizacion_id = Column(UUID(as_uuid=True), ForeignKey("organizaciones.id", ondelete="SET NULL"), nullable=True, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now())

    paso_links = relationship("PasoAttachment", back_populates="attachment", cascade="all, delete-orphan")
    snapshot_links = relationship("SnapshotAttachment", back_populates="attachment", cascade="all, delete-orphan")

class PasoAttachment(Base):
    __tablename__ = "paso_attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paso_id = Column(UUID(as_uuid=True), ForeignKey("pasos_prueba.id", ondelete="CASCADE"), nullable=False, index=True)
    attachment_id = Column(UUID(as_uuid=True), ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False, index=True)
    tipo = Column(String(50), nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now())

    paso = relationship("PasoPrueba")
    attachment = relationship("Attachment", back_populates="paso_links")

    __table_args__ = (UniqueConstraint('paso_id', 'attachment_id', 'tipo', name='unique_paso_attachment_tipo'),)

class SnapshotAttachment(Base):
    __tablename__ = "snapshot_attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    snapshot_id = Column(UUID(as_uuid=True), ForeignKey("snapshots_pasos.id", ondelete="CASCADE"), nullable=False, index=True)
    attachment_id = Column(UUID(as_uuid=True), ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False, index=True)
    tipo = Column(String(50), nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now())

    snapshot = relationship("SnapshotPaso")
    attachment = relationship("Attachment", back_populates="snapshot_links")

    __table_args__ = (UniqueConstraint('snapshot_id', 'attachment_id', 'tipo', name='unique_snapshot_attachment_tipo'),)

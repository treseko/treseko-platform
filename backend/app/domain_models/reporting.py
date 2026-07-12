from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class SharedReportSnapshot(Base):
    __tablename__ = "shared_report_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token = Column(String(120), unique=True, nullable=False, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    build_id = Column(UUID(as_uuid=True), ForeignKey("builds.id", ondelete="SET NULL"), nullable=True, index=True)
    componente_id = Column(UUID(as_uuid=True), ForeignKey("componentes.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    payload = Column(JSON, default=dict, nullable=False)
    metrics_hash = Column(String(128), nullable=False, index=True)
    thumbnail_svg = Column(Text)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())
    expires_at = Column(UTCDateTime(), nullable=True)
    activo = Column(Boolean, default=True, nullable=False)
    revoked_at = Column(UTCDateTime(), nullable=True)

    proyecto = relationship("Proyecto")
    build = relationship("Build")
    componente = relationship("Componente")
    creator = relationship("Usuario")

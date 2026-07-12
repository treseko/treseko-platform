from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class WikiPage(Base):
    __tablename__ = "wiki_pages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    titulo = Column(String(255), nullable=False)
    contenido = Column(Text)
    creado_por = Column(UUID(as_uuid=True))
    ultima_edicion_por = Column(UUID(as_uuid=True))
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    ultima_actualizacion = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    proyecto = relationship("Proyecto", back_populates="wiki_pages")
    historial = relationship("WikiHistory", back_populates="page", cascade="all, delete-orphan")

class WikiHistory(Base):
    __tablename__ = "wiki_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id = Column(UUID(as_uuid=True), ForeignKey("wiki_pages.id", ondelete="CASCADE"), nullable=False, index=True)
    contenido = Column(Text)
    editado_por = Column(UUID(as_uuid=True))
    fecha_edicion = Column(UTCDateTime(), server_default=func.now())
    comentario_cambio = Column(String(255))

    page = relationship("WikiPage", back_populates="historial")

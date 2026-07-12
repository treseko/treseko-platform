from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class Organizacion(Base):
    __tablename__ = "organizaciones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    codigo = Column(String(20), unique=True, index=True, nullable=True)
    nombre = Column(String(150), nullable=False, unique=True, index=True)
    descripcion = Column(Text)
    tipo = Column(String(50)) # Empresa, Cliente, Marca
    activo = Column(Boolean, default=True, nullable=False)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

    proyectos = relationship("Proyecto", back_populates="organizacion")
    miembros = relationship("OrganizacionMiembro", back_populates="organizacion", cascade="all, delete-orphan")

class OrganizacionMiembro(Base):
    __tablename__ = "organizacion_miembros"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizacion_id = Column(UUID(as_uuid=True), ForeignKey("organizaciones.id", ondelete="CASCADE"), nullable=False, index=True)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    rol_cliente = Column(String(50), default="MEMBER", nullable=False)
    fecha_asignacion = Column(UTCDateTime(), server_default=func.now())

    organizacion = relationship("Organizacion", back_populates="miembros")
    usuario = relationship("Usuario", back_populates="organizaciones_asignadas")

    __table_args__ = (UniqueConstraint("organizacion_id", "usuario_id", name="unique_organizacion_usuario"),)

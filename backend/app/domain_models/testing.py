from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class Suite(Base):
    __tablename__ = "suites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    componente_id = Column(UUID(as_uuid=True), ForeignKey("componentes.id", ondelete="CASCADE"), nullable=True, index=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("suites.id", ondelete="CASCADE"), nullable=True, index=True)
    nombre = Column(String(150), nullable=False)
    descripcion = Column(Text)
    color = Column(String(20), default="#F1F5F9")
    icono = Column(String(40), default="folder")
    orden = Column(Integer, default=0, nullable=False)
    activo = Column(Boolean, default=True, nullable=False)
    archivado = Column(Boolean, default=False, nullable=False, index=True)

    proyecto = relationship("Proyecto", back_populates="suites")
    parent = relationship("Suite", remote_side=[id], back_populates="children")
    children = relationship("Suite", back_populates="parent", cascade="all, delete-orphan", lazy="selectin")
    casos = relationship("CasoPrueba", back_populates="suite")

class CasoPrueba(Base):
    __tablename__ = "casos_prueba"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    master_id = Column(UUID(as_uuid=True), nullable=False, index=True) # Identificador común para todas las versiones
    codigo = Column(String(20), index=True, nullable=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="RESTRICT"), nullable=False, index=True)
    suite_id = Column(UUID(as_uuid=True), ForeignKey("suites.id", ondelete="SET NULL"), nullable=True, index=True)
    componente_id = Column(UUID(as_uuid=True), ForeignKey("componentes.id", ondelete="SET NULL"), nullable=True, index=True)
    titulo = Column(String(255), nullable=False)
    descripcion = Column(Text)
    precondiciones = Column(Text)
    postcondiciones = Column(Text)
    version = Column(Integer, default=1, nullable=False)
    prioridad = Column(Enum(Prioridad), nullable=False)
    criticidad = Column(Enum(Criticidad), default=Criticidad.MEDIA)
    tipo_prueba = Column(Enum(TipoPrueba), nullable=False)
    estado_caso = Column(Enum(EstadoCaso), default=EstadoCaso.ACTIVO, nullable=False, index=True)
    dataset = Column(JSON, default=list)
    etiquetas = Column(JSON, default=list)
    script_automatizado = Column(Text, nullable=True)
    framework = Column(String(50), nullable=True)
    activo = Column(Boolean, default=True, nullable=False)
    creado_por = Column(UUID(as_uuid=True), nullable=False)
    ultimo_resultado = Column(String(20), nullable=True)
    ultima_ejecucion_por = Column(UUID(as_uuid=True), nullable=True)
    ultima_ejecucion_fecha = Column(UTCDateTime(), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    ultima_modificacion = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    proyecto = relationship("Proyecto", back_populates="casos")
    suite = relationship("Suite", back_populates="casos")
    componente = relationship("Componente", back_populates="casos")
    pasos = relationship("PasoPrueba", back_populates="caso", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("master_id", "version", name="uq_casos_master_version"),
        Index("ix_casos_proyecto_codigo", "proyecto_id", "codigo", unique=True),
    )

class PasoPrueba(Base):
    __tablename__ = "pasos_prueba"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    caso_id = Column(UUID(as_uuid=True), ForeignKey("casos_prueba.id", ondelete="CASCADE"), nullable=False, index=True)
    numero_paso = Column(Integer, nullable=False)
    accion = Column(Text, nullable=False)
    datos = Column(Text)
    resultado_esperado = Column(Text, nullable=False)
    metadata_ai = Column(JSON)

    __table_args__ = (UniqueConstraint('caso_id', 'numero_paso', name='unique_caso_paso'),)

    caso = relationship("CasoPrueba", back_populates="pasos")

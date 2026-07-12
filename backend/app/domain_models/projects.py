from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class Proyecto(Base):
    __tablename__ = "proyectos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    codigo = Column(String(20), index=True, nullable=True)
    organizacion_id = Column(UUID(as_uuid=True), ForeignKey("organizaciones.id", ondelete="RESTRICT"), nullable=False, index=True)
    nombre = Column(String(150), nullable=False, unique=True, index=True)
    descripcion = Column(Text)
    estado = Column(String(50), default="Activo", nullable=False)
    imagen_url = Column(String(500), nullable=True)
    report_settings = Column(JSON, default=dict, nullable=False)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    activo = Column(Boolean, default=True, nullable=False)

    organizacion = relationship("Organizacion", back_populates="proyectos")
    componentes = relationship("Componente", back_populates="proyecto", cascade="all, delete-orphan")
    redmine_config = relationship("RedmineConfig", back_populates="proyecto", uselist=False, cascade="all, delete-orphan")
    suites = relationship("Suite", back_populates="proyecto", cascade="all, delete-orphan")
    casos = relationship("CasoPrueba", back_populates="proyecto")
    runs = relationship("TestRun", back_populates="proyecto")
    entornos = relationship("Entorno", back_populates="proyecto", cascade="all, delete-orphan")
    wiki_pages = relationship("WikiPage", back_populates="proyecto", cascade="all, delete-orphan")
    builds = relationship("Build", back_populates="proyecto", cascade="all, delete-orphan")
    miembros = relationship("ProyectoMiembro", back_populates="proyecto", cascade="all, delete-orphan")
    scheduled_runs = relationship("ScheduledRun", back_populates="proyecto", cascade="all, delete-orphan")

class ProyectoMiembro(Base):
    __tablename__ = "proyecto_miembros"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    rol_proyecto = Column(String(50), default="MEMBER", nullable=False)
    fecha_asignacion = Column(UTCDateTime(), server_default=func.now())

    proyecto = relationship("Proyecto", back_populates="miembros")
    usuario = relationship("Usuario", back_populates="proyectos_asignados")

    __table_args__ = (UniqueConstraint("proyecto_id", "usuario_id", name="unique_proyecto_usuario"),)

class Componente(Base):
    __tablename__ = "componentes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    codigo = Column(String(20), index=True, nullable=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    nombre = Column(String(100), nullable=False) # Ej: Android, iOS, Backend
    descripcion = Column(Text)
    tech_stack = Column(String(255))
    variables = Column(JSON, default=dict)

    proyecto = relationship("Proyecto", back_populates="componentes")
    casos = relationship("CasoPrueba", back_populates="componente")
    builds = relationship("Build", back_populates="componente", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("proyecto_id", "nombre", name="uq_componentes_proyecto_nombre"),)

class Build(Base):
    __tablename__ = "builds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    codigo = Column(String(20), index=True, nullable=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    componente_id = Column(UUID(as_uuid=True), ForeignKey("componentes.id", ondelete="CASCADE"), nullable=True, index=True)
    nombre = Column(String(150), nullable=False)
    contexto_cambio = Column(Text)
    activo = Column(Boolean, default=False, nullable=False)
    oculto = Column(Boolean, default=False, nullable=False)
    fecha_inicio = Column(UTCDateTime(), nullable=True)
    fecha_fin = Column(UTCDateTime(), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

    proyecto = relationship("Proyecto", back_populates="builds")
    componente = relationship("Componente", back_populates="builds")
    runs = relationship("TestRun", back_populates="build")
    casos_asignados = relationship("BuildCaso", back_populates="build", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("componente_id", "nombre", name="uq_builds_componente_nombre"),
        Index("ix_builds_proyecto_codigo", "proyecto_id", "codigo", unique=True),
    )

class BuildCaso(Base):
    __tablename__ = "build_casos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    build_id = Column(UUID(as_uuid=True), ForeignKey("builds.id", ondelete="CASCADE"), nullable=False, index=True)
    caso_id = Column(UUID(as_uuid=True), ForeignKey("casos_prueba.id", ondelete="CASCADE"), nullable=False, index=True)
    fecha_inclusion = Column(UTCDateTime(), server_default=func.now())

    build = relationship("Build", back_populates="casos_asignados")
    caso = relationship("CasoPrueba")

    __table_args__ = (UniqueConstraint("build_id", "caso_id", name="uq_build_caso"),)

class RedmineConfig(Base):
    __tablename__ = "redmine_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), unique=True, nullable=False)
    url = Column(String(255), nullable=False)
    api_key = Column(String(255), nullable=False)
    project_identifier = Column(String(100), nullable=False) # ID del proyecto en Redmine
    custom_fields = Column(JSON) # Mapeo opcional de campos

    proyecto = relationship("Proyecto", back_populates="redmine_config")

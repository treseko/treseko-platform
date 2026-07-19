import uuid

from sqlalchemy import Boolean, Column, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
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

    requisito = relationship("Requisito", back_populates="historias")
    proyecto = relationship("Proyecto", back_populates="historias_usuario")
    historial = relationship("HistoriaHistorial", back_populates="historia", cascade="all, delete-orphan")
    casos = relationship("CasoHistoria", back_populates="historia", cascade="all, delete-orphan")

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
    creado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    fecha_actualizacion = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    requisito = relationship("Requisito")
    proyecto = relationship("Proyecto")

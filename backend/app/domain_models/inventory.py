from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class Entorno(Base):
    __tablename__ = "entornos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    nombre = Column(String(100), nullable=False) # Dev, Staging, Prod
    url = Column(String(255), nullable=False)
    status = Column(String(50), default="Unknown")
    version = Column(String(50))
    variables = Column(JSON, default=dict)
    activo = Column(Boolean, default=True, nullable=False)
    ultima_verificacion = Column(UTCDateTime())

    proyecto = relationship("Proyecto", back_populates="entornos")
    datasets = relationship("EntornoDataset", back_populates="entorno", cascade="all, delete-orphan")

class EntornoDataset(Base):
    __tablename__ = "entorno_datasets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entorno_id = Column(UUID(as_uuid=True), ForeignKey("entornos.id", ondelete="CASCADE"), nullable=False, index=True)
    nombre = Column(String(100), nullable=False)
    descripcion = Column(Text)
    variables = Column(JSON, default=dict)
    activo = Column(Boolean, default=True, nullable=False)
    es_default = Column(Boolean, default=False, nullable=False)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

    entorno = relationship("Entorno", back_populates="datasets")

    __table_args__ = (UniqueConstraint("entorno_id", "nombre", name="uq_entorno_dataset_nombre"),)

class Dispositivo(Base):
    __tablename__ = "dispositivos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nombre = Column(String(100), nullable=False) # Ej: Chrome Worker 01
    tipo = Column(String(50)) # Desktop, Mobile, Tablet
    browser = Column(String(100))
    resolucion = Column(String(50))
    status = Column(String(50), default="Active")
    es_simulador = Column(Boolean, default=False)

class NodoEjecucion(Base):
    __tablename__ = "nodos_ejecucion"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nombre = Column(String(100), nullable=False)
    ip = Column(String(50))
    status = Column(String(50), default="Offline")
    cpu_usage = Column(Integer, default=0)
    ram_usage = Column(Integer, default=0)
    total_ejecuciones = Column(Integer, default=0)
    ultima_conexion = Column(UTCDateTime(), server_default=func.now())


class InventoryAsset(Base):
    __tablename__ = "inventory_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    categoria_id = Column(String(100), index=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("inventory_assets.id", ondelete="SET NULL"), index=True)
    nombre = Column(String(150), nullable=False)
    tipo = Column(String(80), nullable=False, index=True)
    naturaleza = Column(String(30), nullable=False, index=True)
    estado = Column(String(50), default="Activo", nullable=False, index=True)
    criticidad = Column(String(30), default="Media", nullable=False, index=True)
    descripcion = Column(Text)
    ubicacion = Column(String(150))
    responsable = Column(String(150))
    fabricante = Column(String(120))
    modelo = Column(String(120))
    serial = Column(String(120), index=True)
    asset_tag = Column(String(120), index=True)
    sistema_operativo = Column(String(150))
    metadata_json = Column("metadata", JSON, default=dict)
    activo = Column(Boolean, default=True, nullable=False, index=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    fecha_actualizacion = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    parent = relationship("InventoryAsset", remote_side=[id], back_populates="children")
    children = relationship("InventoryAsset", back_populates="parent")
    endpoints = relationship("InventoryEndpoint", back_populates="asset", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_inventory_assets_project_type_state", "proyecto_id", "tipo", "estado"),
        Index("ix_inventory_assets_project_parent", "proyecto_id", "parent_id"),
    )


class InventoryEndpoint(Base):
    __tablename__ = "inventory_endpoints"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey("inventory_assets.id", ondelete="CASCADE"), nullable=False, index=True)
    tipo = Column(String(30), nullable=False, default="ip", index=True)
    valor = Column(String(500), nullable=False, index=True)
    puerto = Column(Integer)
    protocolo = Column(String(40))
    descripcion = Column(String(255))
    principal = Column(Boolean, default=False, nullable=False)
    activo = Column(Boolean, default=True, nullable=False, index=True)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

    asset = relationship("InventoryAsset", back_populates="endpoints")

    __table_args__ = (
        Index("ix_inventory_endpoints_asset_type", "asset_id", "tipo"),
    )

from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class RolPersonalizado(Base):
    __tablename__ = "roles_personalizados"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nombre = Column(String(100), unique=True, index=True, nullable=False)
    descripcion = Column(Text)
    modulos = Column(JSON, default=list, nullable=False)
    permisos = Column(JSON, default=dict, nullable=False)
    permisos_detallados = Column(JSON, default=dict, nullable=False)
    activo = Column(Boolean, default=True, nullable=False)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())

    usuarios = relationship("Usuario", back_populates="rol_personalizado")

class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=True)
    nombre_completo = Column(String(255))
    rol = Column(Enum(Rol), default=Rol.TESTER, nullable=False)
    rol_custom_id = Column(UUID(as_uuid=True), ForeignKey("roles_personalizados.id", ondelete="SET NULL"), nullable=True, index=True)
    activo = Column(Boolean, default=True)
    auth_provider = Column(String(50), default="local", nullable=False)
    modulos = Column(JSON, default=list, nullable=False)
    permisos = Column(JSON, default=dict, nullable=False)
    permisos_detallados = Column(JSON, default=dict, nullable=False)
    display_name = Column(String(255), nullable=True)
    avatar_provider = Column(String(30), default="gravatar", nullable=False)
    profile_settings = Column(JSON, default=dict, nullable=False)
    personal_theme = Column(String(64), default="system", nullable=False)
    project_theme_overrides = Column(JSON, default=dict, nullable=False)

    rol_personalizado = relationship("RolPersonalizado", back_populates="usuarios")
    proyectos_asignados = relationship("ProyectoMiembro", back_populates="usuario", cascade="all, delete-orphan")
    organizaciones_asignadas = relationship("OrganizacionMiembro", back_populates="usuario", cascade="all, delete-orphan")
    api_keys = relationship("ApiKey", back_populates="usuario", cascade="all, delete-orphan")

    @property
    def rol_nombre(self):
        return self.rol_personalizado.nombre if self.rol_personalizado else self.rol.value

    @property
    def avatar_url(self):
        if self.avatar_provider != "gravatar" or not self.email:
            return None
        normalized = self.email.strip().lower().encode("utf-8")
        digest = hashlib.md5(normalized).hexdigest()
        return f"https://www.gravatar.com/avatar/{digest}?d=404&s=160"

class AuthAdLoginState(Base):
    __tablename__ = "auth_ad_login_states"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    state = Column(String(255), unique=True, nullable=False, index=True)
    nonce = Column(String(255), nullable=False, index=True)
    return_to = Column(Text, nullable=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    expires_at = Column(UTCDateTime(), nullable=False, index=True)
    used_at = Column(UTCDateTime(), nullable=True)
    ip_address = Column(String(80), nullable=True)
    user_agent = Column(Text, nullable=True)

class AuthAdExchangeCode(Base):
    __tablename__ = "auth_ad_exchange_codes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code_hash = Column(String(128), unique=True, nullable=False, index=True)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    expires_at = Column(UTCDateTime(), nullable=False, index=True)
    used_at = Column(UTCDateTime(), nullable=True)
    metadata_json = Column(JSON, default=dict, nullable=False)

    usuario = relationship("Usuario")

class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    nombre = Column(String(100), nullable=False)
    key_hash = Column(String(128), unique=True, nullable=False, index=True)
    key_prefix = Column(String(20), nullable=False, index=True)
    activo = Column(Boolean, default=True, nullable=False)
    fecha_creacion = Column(UTCDateTime(), server_default=func.now())
    ultimo_uso = Column(UTCDateTime(), nullable=True)

    usuario = relationship("Usuario", back_populates="api_keys")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    accion = Column(String(100), nullable=False, index=True)
    recurso = Column(String(100), nullable=False)
    recurso_id = Column(UUID(as_uuid=True), nullable=True)
    detalles = Column(JSON, default=dict)
    ip_address = Column(String(50))
    fecha = Column(UTCDateTime(), server_default=func.now(), index=True)

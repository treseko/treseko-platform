from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class IntegrationProvider(Base):
    __tablename__ = "integration_providers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider_id = Column(String(100), unique=True, index=True, nullable=False)
    kind = Column(String(30), default="integration", nullable=False)
    display_name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(30), default="planned", nullable=False)
    capabilities = Column(JSON, default=list, nullable=False)
    metadata_json = Column(JSON, default=dict, nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), nullable=True)

class PluginProvider(Base):
    __tablename__ = "plugin_providers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plugin_id = Column(String(100), unique=True, index=True, nullable=False)
    display_name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(30), default="planned", nullable=False)
    version = Column(String(50), nullable=True)
    capabilities = Column(JSON, default=list, nullable=False)
    manifest_json = Column(JSON, default=dict, nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), nullable=True)

class IntegrationInstance(Base):
    __tablename__ = "integration_instances"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider_id = Column(String(100), nullable=False, index=True)
    organizacion_id = Column(UUID(as_uuid=True), ForeignKey("organizaciones.id", ondelete="SET NULL"), nullable=True, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True, index=True)
    enabled = Column(Boolean, default=False, nullable=False)
    config_json = Column(JSON, default=dict, nullable=False)
    secrets_configured = Column(JSON, default=dict, nullable=False)
    status = Column(String(30), default="disabled", nullable=False)
    last_check_at = Column(UTCDateTime(), nullable=True)
    last_error = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), nullable=True)

class IntegrationSecret(Base):
    __tablename__ = "integration_secrets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    integration_instance_id = Column(UUID(as_uuid=True), ForeignKey("integration_instances.id", ondelete="CASCADE"), nullable=False, index=True)
    secret_key = Column(String(100), nullable=False)
    secret_value_encrypted = Column(Text, nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), nullable=True)

    __table_args__ = (UniqueConstraint("integration_instance_id", "secret_key", name="uq_integration_secret_key"),)

class ExternalIssueLink(Base):
    __tablename__ = "external_issue_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bug_id = Column(UUID(as_uuid=True), ForeignKey("bug_issues.id", ondelete="CASCADE"), nullable=True, index=True)
    provider_id = Column(String(100), nullable=False, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    build_id = Column(UUID(as_uuid=True), ForeignKey("builds.id", ondelete="SET NULL"), nullable=True, index=True)
    test_run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    ejecucion_id = Column(UUID(as_uuid=True), ForeignKey("ejecuciones_casos.id", ondelete="SET NULL"), nullable=True, index=True)
    snapshot_id = Column(UUID(as_uuid=True), ForeignKey("snapshots_pasos.id", ondelete="SET NULL"), nullable=True, index=True)
    external_issue_id = Column(String(150), nullable=False)
    external_issue_url = Column(Text, nullable=True)
    dedupe_hash = Column(String(128), nullable=True, index=True)
    status = Column(String(30), default="linked", nullable=False)
    metadata_json = Column(JSON, default=dict, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), nullable=True)

    bug = relationship("BugIssue", back_populates="external_links")

class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider_id = Column(String(100), nullable=False, index=True)
    event_type = Column(String(100), nullable=False)
    external_event_id = Column(String(150), nullable=True, index=True)
    payload_json = Column(JSON, default=dict, nullable=False)
    signature_valid = Column(Boolean, nullable=True)
    processed = Column(Boolean, default=False, nullable=False)
    processed_at = Column(UTCDateTime(), nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)

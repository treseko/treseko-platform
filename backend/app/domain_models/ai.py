from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *


class AiProviderCredential(Base):
    __tablename__ = "ai_provider_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider = Column(String(80), nullable=False, index=True)
    label = Column(String(160), nullable=False)
    secret_value_encrypted = Column(Text, nullable=False)
    key_id = Column(String(80), nullable=False)
    active = Column(Boolean, default=True, nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    profiles = relationship("AiProviderProfile", back_populates="credential")
    creator = relationship("Usuario")


class AiProviderProfile(Base):
    __tablename__ = "ai_provider_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(160), nullable=False, unique=True, index=True)
    provider = Column(String(80), nullable=False, index=True)
    adapter = Column(String(80), nullable=False, index=True)
    endpoint = Column(String(500), nullable=False)
    model = Column(String(160), nullable=False)
    credential_id = Column(UUID(as_uuid=True), ForeignKey("ai_provider_credentials.id", ondelete="RESTRICT"), nullable=True, index=True)
    capabilities_json = Column(JSON, default=dict, nullable=False)
    capability_status = Column(String(20), default="unknown", nullable=False, index=True)
    enabled = Column(Boolean, default=True, nullable=False, index=True)
    request_timeout_seconds = Column(Integer, default=300, nullable=False)
    max_retries = Column(Integer, default=1, nullable=False)
    max_input_tokens = Column(Integer, nullable=True)
    max_output_tokens = Column(Integer, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    credential = relationship("AiProviderCredential", back_populates="profiles")
    workflows = relationship("AiWorkflow", back_populates="provider_profile")
    creator = relationship("Usuario")


class AiWorkflow(Base):
    __tablename__ = "ai_workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(150), nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    status = Column(String(20), default="DRAFT", nullable=False, index=True)
    is_default = Column(Boolean, default=False, nullable=False, index=True)
    # V1 graphs remain executable forever; V2 adds typed block contracts additively.
    workflow_format = Column(String(32), default="legacy_v1", nullable=False, index=True)
    workflow_purpose = Column(String(40), default="test_execution", nullable=False, index=True)
    source_workflow_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflows.id", ondelete="SET NULL"), nullable=True, index=True)
    provider_profile_id = Column(UUID(as_uuid=True), ForeignKey("ai_provider_profiles.id", ondelete="SET NULL"), nullable=True, index=True)
    fallback_profile_ids = Column(JSON, default=list, nullable=False)
    decision_policy_json = Column(JSON, default=dict, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    nodes = relationship("AiWorkflowNode", back_populates="workflow", cascade="all, delete-orphan")
    edges = relationship("AiWorkflowEdge", back_populates="workflow", cascade="all, delete-orphan")
    versions = relationship("AiWorkflowVersion", back_populates="workflow", cascade="all, delete-orphan")
    creator = relationship("Usuario")
    source_workflow = relationship("AiWorkflow", remote_side=[id], foreign_keys=[source_workflow_id])
    provider_profile = relationship("AiProviderProfile", back_populates="workflows")


class AiAgentDefinition(Base):
    __tablename__ = "ai_agent_definitions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String(120), nullable=False, unique=True, index=True)
    version = Column(Integer, default=1, nullable=False)
    name = Column(String(150), nullable=False)
    description = Column(Text, default="", nullable=False)
    category = Column(String(80), default="custom", nullable=False, index=True)
    kind = Column(String(40), default="builtin", nullable=False, index=True)
    runtime_handler = Column(String(120), nullable=True, index=True)
    status = Column(String(40), default="requires_configuration", nullable=False, index=True)
    input_schema_json = Column(JSON, default=dict, nullable=False)
    output_schema_json = Column(JSON, default=dict, nullable=False)
    config_schema_json = Column(JSON, default=dict, nullable=False)
    capabilities_json = Column(JSON, default=dict, nullable=False)
    default_model = Column(String(150), nullable=True)
    allowed_model_capabilities = Column(JSON, default=dict, nullable=False)
    default_timeout_sec = Column(Integer, default=60, nullable=False)
    default_retry_policy = Column(JSON, default=dict, nullable=False)
    required_permissions_json = Column(JSON, default=list, nullable=False)
    requires_secret_reference = Column(Boolean, default=False, nullable=False)
    icon_key = Column(String(80), default="bot", nullable=False)
    ui_metadata_json = Column(JSON, default=dict, nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now())
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    nodes = relationship("AiWorkflowNode", back_populates="agent_definition")


class AiUniversalAgent(Base):
    """Logical identity for a portable, versioned universal agent.

    Builtin definitions remain in ``ai_agent_definitions``.  This table only
    owns the universal contract and never mutates a legacy definition.
    """
    __tablename__ = "ai_universal_agents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String(120), nullable=False, unique=True, index=True)
    name = Column(String(150), nullable=False)
    description = Column(Text, default="", nullable=False)
    category = Column(String(80), default="custom", nullable=False, index=True)
    origin_type = Column(String(32), default="user", nullable=False, index=True)
    source_agent_id = Column(UUID(as_uuid=True), ForeignKey("ai_universal_agents.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    versions = relationship("AiUniversalAgentVersion", back_populates="agent", cascade="all, delete-orphan")
    source_agent = relationship("AiUniversalAgent", remote_side=[id], foreign_keys=[source_agent_id])
    creator = relationship("Usuario")


class AiUniversalAgentVersion(Base):
    """Immutable contract revision used by universal workflow nodes."""
    __tablename__ = "ai_universal_agent_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("ai_universal_agents.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(String(40), nullable=False)
    status = Column(String(20), default="DRAFT", nullable=False, index=True)
    contract_json = Column(JSON, default=dict, nullable=False)
    contract_hash = Column(String(64), nullable=False, index=True)
    source_package_json = Column(JSON, default=dict, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())

    agent = relationship("AiUniversalAgent", back_populates="versions")
    creator = relationship("Usuario")
    nodes = relationship("AiWorkflowNode", back_populates="universal_agent_version")

    __table_args__ = (
        UniqueConstraint("agent_id", "version", name="unique_ai_universal_agent_version"),
        Index("ix_ai_universal_agent_versions_agent_version", "agent_id", "version"),
    )

class AiWorkflowNode(Base):
    __tablename__ = "ai_workflow_nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(60), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    agent_key = Column(String(80), nullable=False, index=True)
    agent_definition_id = Column(UUID(as_uuid=True), ForeignKey("ai_agent_definitions.id", ondelete="SET NULL"), nullable=True, index=True)
    universal_agent_version_id = Column(UUID(as_uuid=True), ForeignKey("ai_universal_agent_versions.id", ondelete="SET NULL"), nullable=True, index=True)
    enabled = Column(Boolean, default=True, nullable=False)
    locked = Column(Boolean, default=False, nullable=False)
    prompt_template = Column(Text, default="", nullable=False)
    config_json = Column(JSON, default=dict, nullable=False)
    position_x = Column(Integer, default=0, nullable=False)
    position_y = Column(Integer, default=0, nullable=False)
    retry_policy = Column(JSON, default=dict, nullable=False)
    timeout_sec = Column(Integer, default=60, nullable=False)
    model_override = Column(String(150), nullable=True)
    temperature_override = Column(Float, nullable=True)

    workflow = relationship("AiWorkflow", back_populates="nodes")
    agent_definition = relationship("AiAgentDefinition", back_populates="nodes")
    universal_agent_version = relationship("AiUniversalAgentVersion", back_populates="nodes")
    prompt_versions = relationship("AiPromptVersion", back_populates="node", cascade="all, delete-orphan")

    @property
    def universal_agent(self):
        version = self.universal_agent_version
        if not version:
            return None
        return {
            "version_id": str(version.id),
            "version": version.version,
            "status": version.status,
            "contract": version.contract_json or {},
            "contract_hash": version.contract_hash,
        }

class AiWorkflowEdge(Base):
    __tablename__ = "ai_workflow_edges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflow_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    target_node_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflow_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    source_handle = Column(String(64), nullable=True)
    target_handle = Column(String(64), nullable=True)
    condition_type = Column(String(40), default="always", nullable=False, index=True)
    condition_json = Column(JSON, default=dict, nullable=False)
    priority = Column(Integer, default=0, nullable=False)
    max_passes = Column(Integer, default=1, nullable=False)
    data_mapping_json = Column(JSON, default=list, nullable=False)

    workflow = relationship("AiWorkflow", back_populates="edges")
    source_node = relationship("AiWorkflowNode", foreign_keys=[source_node_id])
    target_node = relationship("AiWorkflowNode", foreign_keys=[target_node_id])

class AiPromptVersion(Base):
    __tablename__ = "ai_prompt_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflow_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    prompt_template = Column(Text, default="", nullable=False)
    changelog = Column(Text)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())

    node = relationship("AiWorkflowNode", back_populates="prompt_versions")
    creator = relationship("Usuario")

class AiWorkflowVersion(Base):
    __tablename__ = "ai_workflow_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    snapshot_json = Column(JSON, default=dict, nullable=False)
    changelog = Column(Text, nullable=False)
    restored_from_version = Column(Integer, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())

    workflow = relationship("AiWorkflow", back_populates="versions")
    creator = relationship("Usuario")

    __table_args__ = (
        UniqueConstraint("workflow_id", "version", name="unique_ai_workflow_version"),
        Index("ix_ai_workflow_versions_workflow_version", "workflow_id", "version"),
    )

class AiExecutionTrace(Base):
    __tablename__ = "ai_execution_traces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    execution_id = Column(UUID(as_uuid=True), ForeignKey("ejecuciones_casos.id", ondelete="CASCADE"), nullable=True, index=True)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflows.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_version = Column(Integer, nullable=True)
    node_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflow_nodes.id", ondelete="SET NULL"), nullable=True, index=True)
    universal_agent_version_id = Column(UUID(as_uuid=True), ForeignKey("ai_universal_agent_versions.id", ondelete="SET NULL"), nullable=True, index=True)
    workflow_format = Column(String(32), nullable=True, index=True)
    implementation_key = Column(String(160), nullable=True)
    execution_plan_hash = Column(String(64), nullable=True)
    capabilities_json = Column(JSON, default=list, nullable=False)
    tools_json = Column(JSON, default=list, nullable=False)
    model_id = Column(String(160), nullable=True)
    prompt_hash = Column(String(64), nullable=True)
    evidence_refs_json = Column(JSON, default=list, nullable=False)
    status = Column(String(30), nullable=False, index=True)
    input_json = Column(JSON, default=dict, nullable=False)
    output_json = Column(JSON, default=dict, nullable=False)
    metrics_json = Column(JSON, default=dict, nullable=False)
    started_at = Column(UTCDateTime(), nullable=True)
    ended_at = Column(UTCDateTime(), nullable=True)

    execution = relationship("EjecucionCaso")
    workflow = relationship("AiWorkflow")
    node = relationship("AiWorkflowNode")
    universal_agent_version = relationship("AiUniversalAgentVersion")

class AiAgentPreset(Base):
    __tablename__ = "ai_agent_presets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(150), nullable=False, index=True)
    type = Column(String(60), nullable=False, index=True)
    category = Column(String(80), default="custom", nullable=False, index=True)
    description = Column(Text)
    prompt_template = Column(Text, default="", nullable=False)
    config_json = Column(JSON, default=dict, nullable=False)
    input_mapping = Column(JSON, default=dict, nullable=False)
    output_schema = Column(JSON, default=dict, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    creator = relationship("Usuario")

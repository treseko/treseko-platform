from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class AiWorkflow(Base):
    __tablename__ = "ai_workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(150), nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    status = Column(String(20), default="DRAFT", nullable=False, index=True)
    is_default = Column(Boolean, default=False, nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now())
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    nodes = relationship("AiWorkflowNode", back_populates="workflow", cascade="all, delete-orphan")
    edges = relationship("AiWorkflowEdge", back_populates="workflow", cascade="all, delete-orphan")
    versions = relationship("AiWorkflowVersion", back_populates="workflow", cascade="all, delete-orphan")
    creator = relationship("Usuario")

class AiWorkflowNode(Base):
    __tablename__ = "ai_workflow_nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(60), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    agent_key = Column(String(80), nullable=False, index=True)
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
    prompt_versions = relationship("AiPromptVersion", back_populates="node", cascade="all, delete-orphan")

class AiWorkflowEdge(Base):
    __tablename__ = "ai_workflow_edges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflow_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    target_node_id = Column(UUID(as_uuid=True), ForeignKey("ai_workflow_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    condition_type = Column(String(40), default="always", nullable=False, index=True)
    condition_json = Column(JSON, default=dict, nullable=False)
    priority = Column(Integer, default=0, nullable=False)
    max_passes = Column(Integer, default=1, nullable=False)

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
    status = Column(String(30), nullable=False, index=True)
    input_json = Column(JSON, default=dict, nullable=False)
    output_json = Column(JSON, default=dict, nullable=False)
    metrics_json = Column(JSON, default=dict, nullable=False)
    started_at = Column(UTCDateTime(), nullable=True)
    ended_at = Column(UTCDateTime(), nullable=True)

    execution = relationship("EjecucionCaso")
    workflow = relationship("AiWorkflow")
    node = relationship("AiWorkflowNode")

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

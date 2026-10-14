from sqlalchemy import Column, ForeignKey, Index, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from ..database import Base
from ..time_utils import UTCDateTime


class McpImportIdempotency(Base):
    __tablename__ = "mcp_import_idempotency"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False)
    idempotency_key = Column(String(128), nullable=False)
    fingerprint = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, default="PENDING", server_default="PENDING")
    result_json = Column(JSON, nullable=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("proyecto_id", "idempotency_key", name="uq_mcp_import_idempotency_project_key"),
        Index("ix_mcp_import_idempotency_project", "proyecto_id"),
        {"comment": "treseko-mcp-import-idempotency-created-by-20260916-0063"},
    )


class McpApiRunJob(Base):
    """One durable dispatch receipt per API run; interrupted HTTP calls never replay."""
    __tablename__ = "mcp_api_run_jobs"
    run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="RESTRICT"), nullable=False)
    state = Column(String(30), nullable=False, default="PENDING", index=True)
    payload = Column(JSON, nullable=False, default=dict)
    owner_token = Column(String(64), nullable=True)
    lease_expires_at = Column(UTCDateTime(), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now(), nullable=False)


class McpWorkspaceReceipt(Base):
    __tablename__ = "mcp_workspace_receipts"
    namespace = Column(String(100), primary_key=True)
    idempotency_key = Column(String(128), primary_key=True)
    fingerprint = Column(String(64), nullable=False)
    status = Column(String(30), nullable=False)
    result_json = Column(JSON, nullable=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)

"""add universal agent contract entities additively

Revision ID: 20260718_0022
Revises: 20260718_0021
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260718_0022"
down_revision = "20260718_0021"
branch_labels = None
depends_on = None


uuid = postgresql.UUID(as_uuid=True)


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("ai_universal_agents"):
        op.create_table(
            "ai_universal_agents", sa.Column("id", uuid, primary_key=True), sa.Column("key", sa.String(120), nullable=False),
            sa.Column("name", sa.String(150), nullable=False), sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("category", sa.String(80), nullable=False, server_default="custom"), sa.Column("origin_type", sa.String(32), nullable=False, server_default="user"),
            sa.Column("source_agent_id", uuid, sa.ForeignKey("ai_universal_agents.id", ondelete="SET NULL")), sa.Column("created_by", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("key", name="uq_ai_universal_agents_key"),
        )
    if not inspector.has_table("ai_universal_agent_versions"):
        op.create_table(
            "ai_universal_agent_versions", sa.Column("id", uuid, primary_key=True),
            sa.Column("agent_id", uuid, sa.ForeignKey("ai_universal_agents.id", ondelete="CASCADE"), nullable=False), sa.Column("version", sa.String(40), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="DRAFT"), sa.Column("contract_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("contract_hash", sa.String(64), nullable=False), sa.Column("source_package_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_by", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("agent_id", "version", name="unique_ai_universal_agent_version"),
        )
    inspector = sa.inspect(bind)
    existing_node_columns = {column["name"] for column in inspector.get_columns("ai_workflow_nodes")}
    existing_edge_columns = {column["name"] for column in inspector.get_columns("ai_workflow_edges")}
    existing_trace_columns = {column["name"] for column in inspector.get_columns("ai_execution_traces")}
    if "universal_agent_version_id" not in existing_node_columns:
        op.add_column("ai_workflow_nodes", sa.Column("universal_agent_version_id", uuid, sa.ForeignKey("ai_universal_agent_versions.id", ondelete="SET NULL"), nullable=True))
    if "data_mapping_json" not in existing_edge_columns:
        op.add_column("ai_workflow_edges", sa.Column("data_mapping_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))
    trace_columns = {
        "universal_agent_version_id": sa.Column("universal_agent_version_id", uuid, sa.ForeignKey("ai_universal_agent_versions.id", ondelete="SET NULL"), nullable=True),
        "workflow_format": sa.Column("workflow_format", sa.String(32), nullable=True),
        "implementation_key": sa.Column("implementation_key", sa.String(160), nullable=True),
        "execution_plan_hash": sa.Column("execution_plan_hash", sa.String(64), nullable=True),
        "capabilities_json": sa.Column("capabilities_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        "tools_json": sa.Column("tools_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        "model_id": sa.Column("model_id", sa.String(160), nullable=True),
        "prompt_hash": sa.Column("prompt_hash", sa.String(64), nullable=True),
        "evidence_refs_json": sa.Column("evidence_refs_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    }
    for name, column in trace_columns.items():
        if name not in existing_trace_columns:
            op.add_column("ai_execution_traces", column)
    # PostgreSQL supports IF NOT EXISTS; this also repairs databases where DDL
    # was applied manually but Alembic's version table was not advanced.
    for statement in (
        "CREATE INDEX IF NOT EXISTS ix_ai_universal_agents_key ON ai_universal_agents (key)",
        "CREATE INDEX IF NOT EXISTS ix_ai_universal_agents_category ON ai_universal_agents (category)",
        "CREATE INDEX IF NOT EXISTS ix_ai_universal_agents_origin_type ON ai_universal_agents (origin_type)",
        "CREATE INDEX IF NOT EXISTS ix_ai_universal_agent_versions_agent_id ON ai_universal_agent_versions (agent_id)",
        "CREATE INDEX IF NOT EXISTS ix_ai_universal_agent_versions_status ON ai_universal_agent_versions (status)",
        "CREATE INDEX IF NOT EXISTS ix_ai_universal_agent_versions_contract_hash ON ai_universal_agent_versions (contract_hash)",
        "CREATE INDEX IF NOT EXISTS ix_ai_universal_agent_versions_agent_version ON ai_universal_agent_versions (agent_id, version)",
        "CREATE INDEX IF NOT EXISTS ix_ai_workflow_nodes_universal_agent_version_id ON ai_workflow_nodes (universal_agent_version_id)",
        "CREATE INDEX IF NOT EXISTS ix_ai_execution_traces_universal_agent_version_id ON ai_execution_traces (universal_agent_version_id)",
        "CREATE INDEX IF NOT EXISTS ix_ai_execution_traces_workflow_format ON ai_execution_traces (workflow_format)",
    ):
        op.execute(sa.text(statement))


def downgrade():
    op.drop_index("ix_ai_execution_traces_workflow_format", table_name="ai_execution_traces")
    op.drop_index("ix_ai_execution_traces_universal_agent_version_id", table_name="ai_execution_traces")
    op.drop_column("ai_execution_traces", "evidence_refs_json")
    op.drop_column("ai_execution_traces", "prompt_hash")
    op.drop_column("ai_execution_traces", "model_id")
    op.drop_column("ai_execution_traces", "tools_json")
    op.drop_column("ai_execution_traces", "capabilities_json")
    op.drop_column("ai_execution_traces", "execution_plan_hash")
    op.drop_column("ai_execution_traces", "implementation_key")
    op.drop_column("ai_execution_traces", "workflow_format")
    op.drop_column("ai_execution_traces", "universal_agent_version_id")
    op.drop_column("ai_workflow_edges", "data_mapping_json")
    op.drop_index("ix_ai_workflow_nodes_universal_agent_version_id", table_name="ai_workflow_nodes")
    op.drop_column("ai_workflow_nodes", "universal_agent_version_id")
    op.drop_table("ai_universal_agent_versions")
    op.drop_table("ai_universal_agents")

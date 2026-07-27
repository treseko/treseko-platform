"""Add extensible workflow agent definitions.

Revision ID: 20260715_0018
Revises: 20260714_0017
Create Date: 2026-07-15
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid


revision = "20260715_0018"
down_revision = "20260714_0017"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    inspector = _inspector()
    if "ai_agent_definitions" not in inspector.get_table_names():
        op.create_table(
            "ai_agent_definitions",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("key", sa.String(length=120), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("category", sa.String(length=80), nullable=False, server_default="custom"),
            sa.Column("kind", sa.String(length=40), nullable=False, server_default="builtin"),
            sa.Column("runtime_handler", sa.String(length=120), nullable=True),
            sa.Column("status", sa.String(length=40), nullable=False, server_default="requires_configuration"),
            sa.Column("input_schema_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("output_schema_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("config_schema_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("capabilities_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("default_model", sa.String(length=150), nullable=True),
            sa.Column("allowed_model_capabilities", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("default_timeout_sec", sa.Integer(), nullable=False, server_default="60"),
            sa.Column("default_retry_policy", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("required_permissions_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
            sa.Column("requires_secret_reference", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("icon_key", sa.String(length=80), nullable=False, server_default="bot"),
            sa.Column("ui_metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("key", name="uq_ai_agent_definitions_key"),
        )
    inspector = _inspector()
    definition_indexes = {item["name"] for item in inspector.get_indexes("ai_agent_definitions")}
    for index_name, columns in (
        ("ix_ai_agent_definitions_category", ["category"]),
        ("ix_ai_agent_definitions_kind", ["kind"]),
        ("ix_ai_agent_definitions_status", ["status"]),
    ):
        if index_name not in definition_indexes:
            op.create_index(index_name, "ai_agent_definitions", columns)
    node_columns = {item["name"] for item in inspector.get_columns("ai_workflow_nodes")}
    if "agent_definition_id" not in node_columns:
        op.add_column("ai_workflow_nodes", sa.Column("agent_definition_id", postgresql.UUID(as_uuid=True), nullable=True))
    inspector = _inspector()
    node_indexes = {item["name"] for item in inspector.get_indexes("ai_workflow_nodes")}
    if "ix_ai_workflow_nodes_agent_definition_id" not in node_indexes:
        op.create_index("ix_ai_workflow_nodes_agent_definition_id", "ai_workflow_nodes", ["agent_definition_id"])
    node_fks = {item.get("name") for item in inspector.get_foreign_keys("ai_workflow_nodes")}
    if "fk_ai_workflow_nodes_agent_definition" not in node_fks:
        op.create_foreign_key("fk_ai_workflow_nodes_agent_definition", "ai_workflow_nodes", "ai_agent_definitions", ["agent_definition_id"], ["id"], ondelete="SET NULL")

    # Upgrade the Treseko default graph without altering user-created flows.
    bind = op.get_bind()
    default_workflow = bind.execute(sa.text("SELECT id FROM ai_workflows WHERE is_default = true LIMIT 1")).scalar()
    if default_workflow:
        existing = bind.execute(sa.text("SELECT id FROM ai_workflow_nodes WHERE workflow_id = :workflow_id AND agent_key = 'PRE_EXECUTION_ANALYST'"), {"workflow_id": default_workflow}).scalar()
        if not existing:
            node_id = uuid.uuid5(uuid.UUID("0c4d4546-4c4f-4f57-8f00-000000000001"), "default-node-PreExecutionAnalyst")
            bind.execute(sa.text("""
                INSERT INTO ai_workflow_nodes (
                    id, workflow_id, type, name, agent_key, enabled, locked,
                    prompt_template, config_json, position_x, position_y,
                    retry_policy, timeout_sec
                ) VALUES (
                    :id, :workflow_id, 'PreExecutionAnalyst', 'Analista Previo',
                    'PRE_EXECUTION_ANALYST', true, true, :prompt, '{}'::json,
                    300, 120, '{}'::json, 60
                )
            """), {"id": node_id, "workflow_id": default_workflow, "prompt": "Interpreta Accion, Datos y Resultado Esperado como contratos temporales de validacion."})
            context_id = bind.execute(sa.text("SELECT id FROM ai_workflow_nodes WHERE workflow_id = :workflow_id AND agent_key = 'CONTEXT_RESOLVER' LIMIT 1"), {"workflow_id": default_workflow}).scalar()
            observer_id = bind.execute(sa.text("SELECT id FROM ai_workflow_nodes WHERE workflow_id = :workflow_id AND agent_key = 'OBSERVER' LIMIT 1"), {"workflow_id": default_workflow}).scalar()
            if context_id and observer_id:
                bind.execute(sa.text("""
                    UPDATE ai_workflow_edges SET target_node_id = :analyst_id
                    WHERE workflow_id = :workflow_id AND source_node_id = :context_id AND target_node_id = :observer_id
                """), {"analyst_id": node_id, "workflow_id": default_workflow, "context_id": context_id, "observer_id": observer_id})
                bind.execute(sa.text("""
                    INSERT INTO ai_workflow_edges (id, workflow_id, source_node_id, target_node_id, condition_type, condition_json, priority, max_passes)
                    VALUES (:id, :workflow_id, :source_node_id, :target_node_id, 'always', '{}'::json, 10, 1)
                """), {"id": uuid.uuid4(), "workflow_id": default_workflow, "source_node_id": node_id, "target_node_id": observer_id})


def downgrade() -> None:
    op.drop_constraint("fk_ai_workflow_nodes_agent_definition", "ai_workflow_nodes", type_="foreignkey")
    op.drop_index("ix_ai_workflow_nodes_agent_definition_id", table_name="ai_workflow_nodes")
    op.drop_column("ai_workflow_nodes", "agent_definition_id")
    op.drop_index("ix_ai_agent_definitions_status", table_name="ai_agent_definitions")
    op.drop_index("ix_ai_agent_definitions_kind", table_name="ai_agent_definitions")
    op.drop_index("ix_ai_agent_definitions_category", table_name="ai_agent_definitions")
    op.drop_table("ai_agent_definitions")

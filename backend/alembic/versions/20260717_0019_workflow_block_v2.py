"""add non-destructive workflow generation metadata

Revision ID: 20260717_0019
Revises: 20260715_0018
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "20260717_0019"
down_revision = "20260715_0018"
branch_labels = None
depends_on = None

def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {item["name"] for item in inspector.get_columns("ai_workflows")}
    if "workflow_format" not in columns:
        op.add_column("ai_workflows", sa.Column("workflow_format", sa.String(length=32), nullable=False, server_default="legacy_v1"))
    if "source_workflow_id" not in columns:
        op.add_column("ai_workflows", sa.Column("source_workflow_id", sa.UUID(), nullable=True))
    inspector = sa.inspect(op.get_bind())
    indexes = {item["name"] for item in inspector.get_indexes("ai_workflows")}
    if "ix_ai_workflows_workflow_format" not in indexes:
        op.create_index("ix_ai_workflows_workflow_format", "ai_workflows", ["workflow_format"])
    if "ix_ai_workflows_source_workflow_id" not in indexes:
        op.create_index("ix_ai_workflows_source_workflow_id", "ai_workflows", ["source_workflow_id"])
    foreign_keys = {item.get("name") for item in inspector.get_foreign_keys("ai_workflows")}
    if "fk_ai_workflows_source_workflow_id" not in foreign_keys:
        op.create_foreign_key("fk_ai_workflows_source_workflow_id", "ai_workflows", "ai_workflows", ["source_workflow_id"], ["id"], ondelete="SET NULL")
    op.alter_column("ai_workflows", "workflow_format", server_default=None)

def downgrade():
    op.drop_constraint("fk_ai_workflows_source_workflow_id", "ai_workflows", type_="foreignkey")
    op.drop_index("ix_ai_workflows_source_workflow_id", table_name="ai_workflows")
    op.drop_index("ix_ai_workflows_workflow_format", table_name="ai_workflows")
    op.drop_column("ai_workflows", "source_workflow_id")
    op.drop_column("ai_workflows", "workflow_format")

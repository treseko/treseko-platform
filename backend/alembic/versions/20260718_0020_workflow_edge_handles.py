"""persist visual handle choices for workflow edges

Revision ID: 20260718_0020
Revises: 20260717_0019
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "20260718_0020"
down_revision = "20260717_0019"
branch_labels = None
depends_on = None


def upgrade():
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("ai_workflow_edges")}
    if "source_handle" not in columns:
        op.add_column("ai_workflow_edges", sa.Column("source_handle", sa.String(length=64), nullable=True))
    if "target_handle" not in columns:
        op.add_column("ai_workflow_edges", sa.Column("target_handle", sa.String(length=64), nullable=True))


def downgrade():
    op.drop_column("ai_workflow_edges", "target_handle")
    op.drop_column("ai_workflow_edges", "source_handle")

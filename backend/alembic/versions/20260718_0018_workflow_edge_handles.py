"""persist visual handle choices for workflow edges

Revision ID: 20260718_0018
Revises: 20260714_0017
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "20260718_0018"
down_revision = "20260714_0017"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ai_workflow_edges", sa.Column("source_handle", sa.String(length=64), nullable=True))
    op.add_column("ai_workflow_edges", sa.Column("target_handle", sa.String(length=64), nullable=True))


def downgrade():
    op.drop_column("ai_workflow_edges", "target_handle")
    op.drop_column("ai_workflow_edges", "source_handle")

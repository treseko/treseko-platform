"""Allow attachments on bug comments.

Revision ID: 20260702_0005
Revises: 20260702_0004
Create Date: 2026-07-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260702_0005"
down_revision = "20260702_0004"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {idx["name"] for idx in inspector.get_indexes(table_name)}


def upgrade() -> None:
    if not _has_column("bug_attachments", "comment_id"):
        op.add_column(
            "bug_attachments",
            sa.Column("comment_id", UUID(as_uuid=True), sa.ForeignKey("bug_comments.id", ondelete="CASCADE"), nullable=True),
        )
    if not _has_index("bug_attachments", "ix_bug_attachments_comment_id"):
        op.create_index("ix_bug_attachments_comment_id", "bug_attachments", ["comment_id"])


def downgrade() -> None:
    pass

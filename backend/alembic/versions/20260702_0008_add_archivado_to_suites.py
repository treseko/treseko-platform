"""Add archived flag to suites.

Revision ID: 20260702_0008
Revises: 20260702_0007
Create Date: 2026-07-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260702_0008"
down_revision = "20260702_0007"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    if not _has_column("suites", "archivado"):
        op.add_column("suites", sa.Column("archivado", sa.Boolean(), nullable=False, server_default=sa.false()))
        op.alter_column("suites", "archivado", server_default=None)
    if not _has_index("suites", "ix_suites_archivado"):
        op.create_index("ix_suites_archivado", "suites", ["archivado"])


def downgrade() -> None:
    if _has_index("suites", "ix_suites_archivado"):
        op.drop_index("ix_suites_archivado", table_name="suites")
    if _has_column("suites", "archivado"):
        op.drop_column("suites", "archivado")

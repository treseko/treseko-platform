"""Add active flag to organizations.

Revision ID: 20260708_0013
Revises: 20260705_0012
Create Date: 2026-07-08
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260708_0013"
down_revision = "20260705_0012"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in set(_inspector().get_table_names())


def _column_names(table_name: str) -> set[str]:
    if not _has_table(table_name):
        return set()
    return {column["name"] for column in _inspector().get_columns(table_name)}


def _index_names(table_name: str) -> set[str]:
    if not _has_table(table_name):
        return set()
    return {index["name"] for index in _inspector().get_indexes(table_name)}


def upgrade() -> None:
    if not _has_table("organizaciones"):
        return
    if "activo" not in _column_names("organizaciones"):
        op.add_column(
            "organizaciones",
            sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
        op.alter_column("organizaciones", "activo", server_default=None)
    if "ix_organizaciones_activo" not in _index_names("organizaciones"):
        op.create_index("ix_organizaciones_activo", "organizaciones", ["activo"])


def downgrade() -> None:
    if not _has_table("organizaciones"):
        return
    if "ix_organizaciones_activo" in _index_names("organizaciones"):
        op.drop_index("ix_organizaciones_activo", table_name="organizaciones")
    if "activo" in _column_names("organizaciones"):
        op.drop_column("organizaciones", "activo")

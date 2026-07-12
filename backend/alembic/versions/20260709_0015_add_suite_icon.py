"""Add customizable suite icon.

Revision ID: 20260709_0015
Revises: 20260709_0014
Create Date: 2026-07-09
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260709_0015"
down_revision = "20260709_0014"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return False
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _has_column("suites", "icono"):
        op.add_column("suites", sa.Column("icono", sa.String(length=40), server_default="folder", nullable=True))


def downgrade() -> None:
    if _has_column("suites", "icono"):
        op.drop_column("suites", "icono")

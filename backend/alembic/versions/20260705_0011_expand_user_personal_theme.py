"""Expand user personal theme identifier.

Revision ID: 20260705_0011
Revises: 20260703_0010
Create Date: 2026-07-05
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260705_0011"
down_revision = "20260703_0010"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if "personal_theme" not in _column_names("usuarios"):
        return
    op.alter_column(
        "usuarios",
        "personal_theme",
        existing_type=sa.String(length=20),
        type_=sa.String(length=64),
        existing_nullable=False,
        existing_server_default=sa.text("'system'"),
    )


def downgrade() -> None:
    if "personal_theme" not in _column_names("usuarios"):
        return
    op.alter_column(
        "usuarios",
        "personal_theme",
        existing_type=sa.String(length=64),
        type_=sa.String(length=20),
        existing_nullable=False,
        existing_server_default=sa.text("'system'"),
    )

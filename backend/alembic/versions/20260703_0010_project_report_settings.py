"""Add project report settings.

Revision ID: 20260703_0010
Revises: 20260702_0009
Create Date: 2026-07-03
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260703_0010"
down_revision = "20260702_0009"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if "report_settings" in _column_names("proyectos"):
        return
    op.add_column(
        "proyectos",
        sa.Column(
            "report_settings",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
    )


def downgrade() -> None:
    if "report_settings" not in _column_names("proyectos"):
        return
    op.drop_column("proyectos", "report_settings")

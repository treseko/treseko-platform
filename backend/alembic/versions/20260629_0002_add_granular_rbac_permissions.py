"""Add granular RBAC permission columns.

Revision ID: 20260629_0002
Revises: 20260629_0001
Create Date: 2026-06-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260629_0002"
down_revision = "20260629_0001"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _has_column("usuarios", "permisos_detallados"):
        op.add_column(
            "usuarios",
            sa.Column("permisos_detallados", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        )
    if not _has_column("roles_personalizados", "permisos_detallados"):
        op.add_column(
            "roles_personalizados",
            sa.Column("permisos_detallados", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        )


def downgrade() -> None:
    # Keep this migration non-destructive for existing local/dev data.
    pass

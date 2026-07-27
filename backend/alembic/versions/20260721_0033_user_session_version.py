"""invalidate access tokens after password changes

Revision ID: 20260721_0033
Revises: 20260721_0032
"""
from alembic import op
import sqlalchemy as sa


revision = "20260721_0033"
down_revision = "20260721_0032"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if "session_version" not in _columns("usuarios"):
        op.add_column(
            "usuarios",
            sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    if "session_version" in _columns("usuarios"):
        op.drop_column("usuarios", "session_version")

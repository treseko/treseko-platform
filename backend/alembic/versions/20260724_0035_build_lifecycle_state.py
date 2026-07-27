"""add explicit build lifecycle state

Revision ID: 20260724_0035
Revises: 20260722_0034
"""
from alembic import op
import sqlalchemy as sa


revision = "20260724_0035"
down_revision = "20260722_0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("builds")}
    if "estado" not in columns:
        op.add_column("builds", sa.Column("estado", sa.String(length=20), nullable=True, server_default="HISTORICA"))
        op.execute(sa.text("UPDATE builds SET estado = CASE WHEN activo THEN 'ACTIVA' ELSE 'HISTORICA' END"))
        op.alter_column("builds", "estado", nullable=False, server_default="PREPARACION")
        op.create_index("ix_builds_estado", "builds", ["estado"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("builds")}
    if "estado" in columns:
        op.drop_index("ix_builds_estado", table_name="builds")
        op.drop_column("builds", "estado")

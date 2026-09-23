"""Persist test ordering independently of case-definition versions."""

from alembic import op
import sqlalchemy as sa

revision = "20260919_0064"
down_revision = "20260916_0063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("casos_prueba")}
    if "orden" not in columns:
        op.add_column("casos_prueba", sa.Column("orden", sa.Integer(), nullable=False, server_default="0"))
    if "ix_casos_suite_orden" not in {index["name"] for index in inspector.get_indexes("casos_prueba")}:
        op.create_index("ix_casos_suite_orden", "casos_prueba", ["suite_id", "orden", "id"])
    # Existing clients already have a deterministic fallback from the primary key.
    # Only a default is written; no version, execution, or reference rows change.


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "ix_casos_suite_orden" in {index["name"] for index in inspector.get_indexes("casos_prueba")}:
        op.drop_index("ix_casos_suite_orden", table_name="casos_prueba")
    if "orden" in {column["name"] for column in inspector.get_columns("casos_prueba")}:
        op.drop_column("casos_prueba", "orden")

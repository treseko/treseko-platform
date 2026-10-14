"""Persist project inventory categories."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20261010_0070"
down_revision = "20261009_0069"
branch_labels = None
depends_on = None


def upgrade():
    if not sa.inspect(op.get_bind()).has_table("inventory_categories"):
        op.create_table(
            "inventory_categories",
            sa.Column("id", sa.String(100), primary_key=True),
            sa.Column("proyecto_id", UUID(as_uuid=True), sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
            sa.Column("nombre", sa.String(100), nullable=False),
            sa.UniqueConstraint("proyecto_id", "nombre", name="uq_inventory_category_project_name"),
        )
        op.create_index("ix_inventory_categories_proyecto_id", "inventory_categories", ["proyecto_id"])


def downgrade():
    op.drop_table("inventory_categories")

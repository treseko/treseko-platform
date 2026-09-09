"""backfill empty reusable chatbot configuration on existing environments"""

from alembic import op


revision = "20260814_0050"
down_revision = "20260814_0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE entornos SET configuracion_chatbot = '{}'::json WHERE configuracion_chatbot IS NULL")


def downgrade() -> None:
    # Keep existing empty JSON values on downgrade; the column itself belongs
    # to revision 0049 and is removed by that migration.
    pass

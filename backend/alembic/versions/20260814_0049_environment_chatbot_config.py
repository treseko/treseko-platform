"""add reusable chatbot configuration to environments"""

from alembic import op
import sqlalchemy as sa


revision = "20260814_0049"
down_revision = "20260813_0048"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "configuracion_chatbot" not in _columns("entornos"):
        op.add_column("entornos", sa.Column("configuracion_chatbot", sa.JSON(), nullable=True))


def downgrade() -> None:
    if "configuracion_chatbot" in _columns("entornos"):
        op.drop_column("entornos", "configuracion_chatbot")

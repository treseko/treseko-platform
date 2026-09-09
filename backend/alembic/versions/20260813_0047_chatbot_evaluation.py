"""add versioned chatbot configuration and execution report"""

from alembic import op
import sqlalchemy as sa


revision = "20260813_0047"
down_revision = "20260812_0046"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    if "configuracion_chatbot" not in _columns("casos_prueba"):
        op.add_column("casos_prueba", sa.Column("configuracion_chatbot", sa.JSON(), nullable=True))
    if "chatbot_config_snapshot" not in _columns("ejecuciones_casos"):
        op.add_column("ejecuciones_casos", sa.Column("chatbot_config_snapshot", sa.JSON(), nullable=True))
    if "chatbot_resultado" not in _columns("ejecuciones_casos"):
        op.add_column("ejecuciones_casos", sa.Column("chatbot_resultado", sa.JSON(), nullable=True))


def downgrade() -> None:
    columns = _columns("ejecuciones_casos")
    if "chatbot_resultado" in columns:
        op.drop_column("ejecuciones_casos", "chatbot_resultado")
    if "chatbot_config_snapshot" in columns:
        op.drop_column("ejecuciones_casos", "chatbot_config_snapshot")
    if "configuracion_chatbot" in _columns("casos_prueba"):
        op.drop_column("casos_prueba", "configuracion_chatbot")

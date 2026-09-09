"""store canonical API test definitions and execution results"""

from alembic import op
import sqlalchemy as sa

revision = "20260814_0051"
down_revision = "20260814_0050"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "configuracion_api" not in _columns("casos_prueba"):
        op.add_column("casos_prueba", sa.Column("configuracion_api", sa.JSON(), nullable=True, server_default=sa.text("'{}'")))
        op.alter_column("casos_prueba", "configuracion_api", server_default=None)
    existing = _columns("ejecuciones_casos")
    if "api_config_snapshot" not in existing:
        op.add_column("ejecuciones_casos", sa.Column("api_config_snapshot", sa.JSON(), nullable=True, server_default=sa.text("'{}'")))
        op.alter_column("ejecuciones_casos", "api_config_snapshot", server_default=None)
    if "api_resultado" not in existing:
        op.add_column("ejecuciones_casos", sa.Column("api_resultado", sa.JSON(), nullable=True, server_default=sa.text("'{}'")))
        op.alter_column("ejecuciones_casos", "api_resultado", server_default=None)


def downgrade() -> None:
    existing = _columns("ejecuciones_casos")
    if "api_resultado" in existing:
        op.drop_column("ejecuciones_casos", "api_resultado")
    if "api_config_snapshot" in existing:
        op.drop_column("ejecuciones_casos", "api_config_snapshot")
    if "configuracion_api" in _columns("casos_prueba"):
        op.drop_column("casos_prueba", "configuracion_api")

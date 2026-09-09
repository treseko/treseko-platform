"""store API allowlist configuration on environments"""

from alembic import op
import sqlalchemy as sa


revision = "20260814_0052"
down_revision = "20260814_0051"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "configuracion_api" not in _columns("entornos"):
        op.add_column("entornos", sa.Column("configuracion_api", sa.JSON(), nullable=True, server_default=sa.text("'{}'")))
        op.alter_column("entornos", "configuracion_api", server_default=None)


def downgrade() -> None:
    if "configuracion_api" in _columns("entornos"):
        op.drop_column("entornos", "configuracion_api")

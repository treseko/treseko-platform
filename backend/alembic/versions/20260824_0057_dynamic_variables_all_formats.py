"""store dynamic variable seeds and resolved evidence for all test formats"""

from alembic import op
import sqlalchemy as sa


revision = "20260824_0057"
down_revision = "20260820_0056"
branch_labels = None
depends_on = None


def _add_if_missing(table: str, column: sa.Column) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {item["name"] for item in inspector.get_columns(table)}
    if column.name not in existing:
        op.add_column(table, column)


def upgrade() -> None:
    _add_if_missing("test_runs", sa.Column("dynamic_seed", sa.String(length=200), nullable=True))
    _add_if_missing("ejecuciones_casos", sa.Column("dynamic_seed", sa.String(length=200), nullable=True))
    _add_if_missing("ejecuciones_casos", sa.Column("dynamic_variables", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    _add_if_missing("snapshots_pasos", sa.Column("datos_resueltos", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("snapshots_pasos", "datos_resueltos")
    op.drop_column("ejecuciones_casos", "dynamic_variables")
    op.drop_column("ejecuciones_casos", "dynamic_seed")
    op.drop_column("test_runs", "dynamic_seed")

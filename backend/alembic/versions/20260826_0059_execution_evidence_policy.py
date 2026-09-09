"""freeze reproducible-evidence policy on every case execution"""

from alembic import op
import sqlalchemy as sa


revision = "20260826_0059"
down_revision = "20260824_0058"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "evidence_policy" in _columns("ejecuciones_casos"):
        return
    op.add_column(
        "ejecuciones_casos",
        sa.Column(
            "evidence_policy",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.alter_column("ejecuciones_casos", "evidence_policy", server_default=None)


def downgrade() -> None:
    if "evidence_policy" in _columns("ejecuciones_casos"):
        op.drop_column("ejecuciones_casos", "evidence_policy")

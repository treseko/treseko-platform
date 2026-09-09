"""store the user who revoked a shared report bundle"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260816_0055"
down_revision = "20260815_0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("shared_report_snapshots")}
    if "revoked_by" not in columns:
        op.add_column(
            "shared_report_snapshots",
            sa.Column("revoked_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        )
        op.create_index("ix_shared_report_snapshots_revoked_by", "shared_report_snapshots", ["revoked_by"])


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("shared_report_snapshots")}
    if "revoked_by" in columns:
        op.drop_index("ix_shared_report_snapshots_revoked_by", table_name="shared_report_snapshots")
        op.drop_column("shared_report_snapshots", "revoked_by")

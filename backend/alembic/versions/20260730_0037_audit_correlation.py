"""persist correlation IDs on audit events"""

from alembic import op
import sqlalchemy as sa


revision = "20260730_0037"
down_revision = "20260729_0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("audit_logs")}
    if "correlation_id" not in columns:
        op.add_column("audit_logs", sa.Column("correlation_id", sa.String(length=120), nullable=True))
    indexes = {index["name"] for index in inspector.get_indexes("audit_logs")}
    if "ix_audit_logs_correlation_id" not in indexes:
        op.create_index("ix_audit_logs_correlation_id", "audit_logs", ["correlation_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("audit_logs")}
    if "ix_audit_logs_correlation_id" in indexes:
        op.drop_index("ix_audit_logs_correlation_id", table_name="audit_logs")
    columns = {column["name"] for column in inspector.get_columns("audit_logs")}
    if "correlation_id" in columns:
        op.drop_column("audit_logs", "correlation_id")

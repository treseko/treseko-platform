"""add audit event origin"""

from alembic import op
import sqlalchemy as sa


revision = "20260729_0036"
down_revision = "20260724_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("audit_logs")}
    if "origen" not in columns:
        op.add_column("audit_logs", sa.Column("origen", sa.String(length=30), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("audit_logs")}
    if "origen" in columns:
        op.drop_column("audit_logs", "origen")

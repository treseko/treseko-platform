"""add durable per-worker update lock"""

from alembic import op
import sqlalchemy as sa


revision = "20261119_0078"
down_revision = "20261018_0077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("automation_runners")}
    if "update_lock_token_hash" not in columns:
        op.add_column("automation_runners", sa.Column("update_lock_token_hash", sa.String(length=64), nullable=True))
    if "update_lock_acquired_at" not in columns:
        op.add_column("automation_runners", sa.Column("update_lock_acquired_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("automation_runners")}
    if "update_lock_acquired_at" in columns:
        op.drop_column("automation_runners", "update_lock_acquired_at")
    if "update_lock_token_hash" in columns:
        op.drop_column("automation_runners", "update_lock_token_hash")

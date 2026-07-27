"""remove redundant bug retest status

Revision ID: 20260721_0032
Revises: 20260721_0031
"""
from alembic import op
import sqlalchemy as sa

revision = "20260721_0032"
down_revision = "20260721_0031"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if "retest_status" in _columns("bug_status_history"):
        op.drop_column("bug_status_history", "retest_status")
    if "retest_status" in _columns("bug_issues"):
        op.drop_column("bug_issues", "retest_status")


def downgrade() -> None:
    if "retest_status" not in _columns("bug_issues"):
        op.add_column(
            "bug_issues",
            sa.Column("retest_status", sa.String(30), nullable=False, server_default="pendiente"),
        )
    if "retest_status" not in _columns("bug_status_history"):
        op.add_column(
            "bug_status_history",
            sa.Column("retest_status", sa.String(30), nullable=True),
        )

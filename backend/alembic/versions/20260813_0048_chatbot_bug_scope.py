"""track chatbot execution and turn-level bug scope"""

from alembic import op
import sqlalchemy as sa

revision = "20260813_0048"
down_revision = "20260813_0047"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    columns = _columns("bug_issues")
    if "chatbot_turn_index" not in columns:
        op.add_column("bug_issues", sa.Column("chatbot_turn_index", sa.Integer(), nullable=True))
        op.create_index("ix_bug_issues_chatbot_turn_index", "bug_issues", ["chatbot_turn_index"])
    if "chatbot_finding_type" not in columns:
        op.add_column("bug_issues", sa.Column("chatbot_finding_type", sa.String(length=50), nullable=True))
        op.create_index("ix_bug_issues_chatbot_finding_type", "bug_issues", ["chatbot_finding_type"])


def downgrade() -> None:
    columns = _columns("bug_issues")
    if "chatbot_finding_type" in columns:
        op.drop_index("ix_bug_issues_chatbot_finding_type", table_name="bug_issues")
        op.drop_column("bug_issues", "chatbot_finding_type")
    if "chatbot_turn_index" in columns:
        op.drop_index("ix_bug_issues_chatbot_turn_index", table_name="bug_issues")
        op.drop_column("bug_issues", "chatbot_turn_index")

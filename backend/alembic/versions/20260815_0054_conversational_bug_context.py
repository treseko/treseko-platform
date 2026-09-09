"""add structured context for conversational bugs"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260815_0054"
down_revision = "20260815_0053"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    columns = _columns("bug_issues")
    if "tipo_contexto" not in columns:
        op.add_column(
            "bug_issues",
            sa.Column("tipo_contexto", sa.String(length=20), nullable=False, server_default="CLASICO"),
        )
        op.execute(
            "UPDATE bug_issues SET tipo_contexto = 'CONVERSACIONAL' "
            "WHERE chatbot_turn_index IS NOT NULL OR chatbot_finding_type IS NOT NULL "
            "OR lower(coalesce(origen, '')) LIKE '%chatbot%'"
        )
        op.create_index("ix_bug_issues_tipo_contexto", "bug_issues", ["tipo_contexto"])

    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "bug_conversational_context" not in tables:
        op.create_table(
            "bug_conversational_context",
            sa.Column("bug_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bug_issues.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("case_snapshot", postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("execution_snapshot", postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("conversation_turns", postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::json")),
            sa.Column("evaluation", postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("technical_evidence", postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("evidence_refs", postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::json")),
            sa.Column("evidence_sha256", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_bug_conversational_context_evidence_sha256", "bug_conversational_context", ["evidence_sha256"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "bug_conversational_context" in tables:
        op.drop_index("ix_bug_conversational_context_evidence_sha256", table_name="bug_conversational_context")
        op.drop_table("bug_conversational_context")
    if "tipo_contexto" in _columns("bug_issues"):
        op.drop_index("ix_bug_issues_tipo_contexto", table_name="bug_issues")
        op.drop_column("bug_issues", "tipo_contexto")

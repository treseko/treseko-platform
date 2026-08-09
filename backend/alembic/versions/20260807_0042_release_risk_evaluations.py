"""add immutable release risk evaluations"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260807_0042"
down_revision = "20260807_0041"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("release_risk_evaluations"):
        return
    op.create_table(
        "release_risk_evaluations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("proyecto_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("build_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("builds.id", ondelete="CASCADE"), nullable=False),
        sa.Column("algorithm_version", sa.String(length=20), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("level", sa.String(length=20), nullable=False),
        sa.Column("recommendation", sa.String(length=40), nullable=False),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("factors_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("accepted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acceptance_note", sa.String(length=2000), nullable=True),
    )
    op.create_index("ix_release_risk_evaluations_proyecto_id", "release_risk_evaluations", ["proyecto_id"])
    op.create_index("ix_release_risk_evaluations_build_id", "release_risk_evaluations", ["build_id"])
    op.create_index("ix_release_risk_evaluations_input_hash", "release_risk_evaluations", ["input_hash"])
    op.create_index("ix_release_risk_project_build_recent", "release_risk_evaluations", ["proyecto_id", "build_id", "created_at"])
    op.execute("COMMENT ON TABLE release_risk_evaluations IS 'treseko-quality-intelligence-created-by-20260807-0042'")


def downgrade() -> None:
    bind = op.get_bind()
    marker = bind.execute(sa.text("SELECT obj_description('release_risk_evaluations'::regclass, 'pg_class')")).scalar() if _has_table("release_risk_evaluations") else None
    if marker == "treseko-quality-intelligence-created-by-20260807-0042":
        op.drop_table("release_risk_evaluations")

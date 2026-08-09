"""add auditable quality diagnosis drafts"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260807_0041"
down_revision = "20260807_0040"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("quality_diagnoses"):
        return
    op.create_table(
        "quality_diagnoses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("proyecto_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ejecucion_caso_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ejecuciones_casos.id", ondelete="SET NULL"), nullable=True),
        sa.Column("failure_fingerprint_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("quality_failure_fingerprints.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="DRAFT"),
        sa.Column("facts_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("hypotheses_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("unknowns_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("recommended_next_steps_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("evidence_refs_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("provider", sa.String(length=80), nullable=True),
        sa.Column("model", sa.String(length=160), nullable=True),
        sa.Column("prompt_hash", sa.String(length=64), nullable=True),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("metrics_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_quality_diagnoses_proyecto_id", "quality_diagnoses", ["proyecto_id"])
    op.create_index("ix_quality_diagnoses_ejecucion_caso_id", "quality_diagnoses", ["ejecucion_caso_id"])
    op.create_index("ix_quality_diagnoses_failure_fingerprint_id", "quality_diagnoses", ["failure_fingerprint_id"])
    op.create_index("ix_quality_diagnosis_project_status_recent", "quality_diagnoses", ["proyecto_id", "status", "created_at"])
    op.execute("COMMENT ON TABLE quality_diagnoses IS 'treseko-quality-intelligence-created-by-20260807-0041'")


def downgrade() -> None:
    bind = op.get_bind()
    marker = bind.execute(sa.text("SELECT obj_description('quality_diagnoses'::regclass, 'pg_class')")).scalar() if _has_table("quality_diagnoses") else None
    if marker == "treseko-quality-intelligence-created-by-20260807-0041":
        op.drop_table("quality_diagnoses")

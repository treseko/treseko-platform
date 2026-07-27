"""governed and structured AI story authoring

Revision ID: 20260718_0024
Revises: 20260718_0023
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260718_0024"
down_revision = "20260718_0023"
branch_labels = None
depends_on = None


def _add_column_if_missing(table, column):
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}
    if column.name not in columns:
        op.add_column(table, column)


def upgrade():
    uuid = postgresql.UUID(as_uuid=True)
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    _add_column_if_missing("historias_usuario", sa.Column("ai_generation_id", uuid, sa.ForeignKey("historia_generaciones.id", ondelete="SET NULL"), nullable=True))
    _add_column_if_missing("historias_usuario", sa.Column("criterios_estructuracion_estado", sa.String(32), nullable=False, server_default="STRUCTURED"))
    op.execute("UPDATE historias_usuario SET criterios_estructuracion_estado = 'PENDING_STRUCTURING' WHERE COALESCE(criterios_aceptacion_markdown, '') <> ''")

    generation_columns = [
        sa.Column("provider", sa.String(80)), sa.Column("model", sa.String(255)), sa.Column("temperature", sa.Float()),
        sa.Column("prompt_version", sa.String(80)), sa.Column("prompt_hash", sa.String(128)), sa.Column("workflow_snapshot", sa.JSON()),
        sa.Column("context_hash", sa.String(128)), sa.Column("analysis_json", sa.JSON()), sa.Column("propuestas_originales_json", sa.JSON()),
        sa.Column("propuestas_finales_json", sa.JSON()), sa.Column("decisiones_json", sa.JSON()), sa.Column("accepted_assumption_ids", sa.JSON()),
        sa.Column("warnings_json", sa.JSON()), sa.Column("workflow_traces_json", sa.JSON()), sa.Column("prompt_tokens", sa.Integer()),
        sa.Column("completion_tokens", sa.Integer()), sa.Column("total_tokens", sa.Integer()), sa.Column("latency_ms", sa.Integer()),
        sa.Column("estimated_cost", sa.Float()), sa.Column("sanitized_error", sa.Text()), sa.Column("completed_at", sa.DateTime(timezone=True)),
    ]
    for column in generation_columns:
        _add_column_if_missing("historia_generaciones", column)

    if not inspector.has_table("acceptance_criteria"):
        op.create_table(
            "acceptance_criteria",
            sa.Column("id", uuid, primary_key=True),
            sa.Column("historia_id", uuid, sa.ForeignKey("historias_usuario.id", ondelete="CASCADE"), nullable=False),
            sa.Column("codigo", sa.String(80), nullable=False), sa.Column("tipo", sa.String(32), nullable=False),
            sa.Column("titulo", sa.String(255), nullable=False), sa.Column("given_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("when_text", sa.Text(), nullable=False, server_default=""), sa.Column("then_items", sa.JSON(), nullable=False),
            sa.Column("observable_result", sa.Text(), nullable=False, server_default=""), sa.Column("mandatory", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("source_refs", sa.JSON(), nullable=False), sa.Column("assumption_refs", sa.JSON(), nullable=False),
            sa.Column("orden", sa.Integer(), nullable=False, server_default="0"), sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("structuring_status", sa.String(32), nullable=False, server_default="STRUCTURED"),
            sa.Column("fecha_creacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("ultima_actualizacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("historia_id", "codigo", name="uq_acceptance_criteria_story_code"),
        )
        op.create_index("ix_acceptance_criteria_historia_id", "acceptance_criteria", ["historia_id"])
    if not inspector.has_table("acceptance_criterion_cases"):
        op.create_table(
            "acceptance_criterion_cases",
            sa.Column("id", uuid, primary_key=True), sa.Column("acceptance_criterion_id", uuid, sa.ForeignKey("acceptance_criteria.id", ondelete="CASCADE"), nullable=False),
            sa.Column("caso_master_id", uuid, nullable=False), sa.Column("creado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
            sa.Column("fecha_creacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("acceptance_criterion_id", "caso_master_id", name="uq_acceptance_criterion_case"),
        )
        op.create_index("ix_acceptance_criterion_cases_master", "acceptance_criterion_cases", ["caso_master_id"])
    if not inspector.has_table("traceability_waivers"):
        op.create_table(
            "traceability_waivers",
            sa.Column("id", uuid, primary_key=True), sa.Column("requisito_id", uuid, sa.ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False),
            sa.Column("proyecto_id", uuid, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False), sa.Column("motivo", sa.Text(), nullable=False),
            sa.Column("estado", sa.String(24), nullable=False, server_default="PENDING"), sa.Column("solicitado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
            sa.Column("aprobado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")), sa.Column("fecha_creacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("fecha_aprobacion", sa.DateTime(timezone=True)),
        )


def downgrade():
    op.drop_table("traceability_waivers")
    op.drop_table("acceptance_criterion_cases")
    op.drop_table("acceptance_criteria")
    for column in ("ai_generation_id", "criterios_estructuracion_estado"):
        op.drop_column("historias_usuario", column)
    for column in ("provider", "model", "temperature", "prompt_version", "prompt_hash", "workflow_snapshot", "context_hash", "analysis_json", "propuestas_originales_json", "propuestas_finales_json", "decisiones_json", "accepted_assumption_ids", "warnings_json", "workflow_traces_json", "prompt_tokens", "completion_tokens", "total_tokens", "latency_ms", "estimated_cost", "sanitized_error", "completed_at"):
        op.drop_column("historia_generaciones", column)

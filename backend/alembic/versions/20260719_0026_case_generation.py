"""governed AI test case generation

Revision ID: 20260719_0026
Revises: 20260718_0025
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260719_0026"
down_revision = "20260718_0025"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("caso_generaciones"):
        return
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "caso_generaciones",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("historia_id", uuid, sa.ForeignKey("historias_usuario.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requisito_id", uuid, sa.ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("proyecto_id", uuid, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workflow_id", uuid, sa.ForeignKey("ai_workflows.id", ondelete="SET NULL")),
        sa.Column("workflow_version", sa.Integer()), sa.Column("estado", sa.String(32), nullable=False, server_default="ESTIMANDO"),
        sa.Column("instrucciones", sa.Text(), nullable=False, server_default=""),
        sa.Column("fuente_snapshot", sa.JSON(), nullable=False), sa.Column("estimacion", sa.JSON(), nullable=False),
        sa.Column("analysis_json", sa.JSON()), sa.Column("propuestas_originales_json", sa.JSON()), sa.Column("propuestas_finales_json", sa.JSON()),
        sa.Column("decisiones_json", sa.JSON()), sa.Column("accepted_assumption_ids", sa.JSON()), sa.Column("warnings_json", sa.JSON()),
        sa.Column("workflow_snapshot", sa.JSON()), sa.Column("workflow_traces_json", sa.JSON()), sa.Column("context_hash", sa.String(128)),
        sa.Column("prompt_hash", sa.String(128)), sa.Column("provider", sa.String(80)), sa.Column("model", sa.String(255)),
        sa.Column("temperature", sa.Float()), sa.Column("prompt_tokens", sa.Integer()), sa.Column("completion_tokens", sa.Integer()),
        sa.Column("total_tokens", sa.Integer()), sa.Column("latency_ms", sa.Integer()), sa.Column("estimated_cost", sa.Float()),
        sa.Column("sanitized_error", sa.Text()), sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("creado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.Column("fecha_creacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("fecha_actualizacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    for column in ("historia_id", "requisito_id", "proyecto_id", "workflow_id", "estado"):
        op.create_index(f"ix_caso_generaciones_{column}", "caso_generaciones", [column])


def downgrade():
    op.drop_table("caso_generaciones")

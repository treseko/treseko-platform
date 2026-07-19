"""add story generation workflow purpose and audit records

Revision ID: 20260718_0023
Revises: 20260718_0022
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260718_0023"
down_revision = "20260718_0021"
branch_labels = None
depends_on = None


def upgrade():
    uuid = postgresql.UUID(as_uuid=True)
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    workflow_columns = {column["name"] for column in inspector.get_columns("ai_workflows")}
    if "workflow_purpose" not in workflow_columns:
        op.add_column("ai_workflows", sa.Column("workflow_purpose", sa.String(40), nullable=False, server_default="test_execution"))
    workflow_indexes = {index["name"] for index in sa.inspect(bind).get_indexes("ai_workflows")}
    if "ix_ai_workflows_workflow_purpose" not in workflow_indexes:
        op.create_index("ix_ai_workflows_workflow_purpose", "ai_workflows", ["workflow_purpose"])

    if not inspector.has_table("historia_generaciones"):
        op.create_table(
            "historia_generaciones",
            sa.Column("id", uuid, primary_key=True),
            sa.Column("requisito_id", uuid, sa.ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False),
            sa.Column("proyecto_id", uuid, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
            sa.Column("workflow_id", uuid, sa.ForeignKey("ai_workflows.id", ondelete="SET NULL")),
            sa.Column("workflow_version", sa.Integer()), sa.Column("estado", sa.String(32), nullable=False, server_default="ESTIMANDO"),
            sa.Column("instrucciones", sa.Text(), nullable=False, server_default=""),
            sa.Column("fuente_snapshot", sa.JSON(), nullable=False), sa.Column("estimacion", sa.JSON(), nullable=False), sa.Column("propuestas", sa.JSON(), nullable=False),
            sa.Column("error_detalle", sa.Text()), sa.Column("creado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
            sa.Column("fecha_creacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("fecha_actualizacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        )
    history_indexes = {index["name"] for index in sa.inspect(bind).get_indexes("historia_generaciones")}
    for name, column in (
        ("ix_historia_generaciones_requisito_id", "requisito_id"),
        ("ix_historia_generaciones_proyecto_id", "proyecto_id"),
        ("ix_historia_generaciones_workflow_id", "workflow_id"),
        ("ix_historia_generaciones_estado", "estado"),
    ):
        if name not in history_indexes:
            op.create_index(name, "historia_generaciones", [column])


def downgrade():
    op.drop_table("historia_generaciones")
    op.drop_index("ix_ai_workflows_workflow_purpose", table_name="ai_workflows")
    op.drop_column("ai_workflows", "workflow_purpose")

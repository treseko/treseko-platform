"""add requirements stories and case traceability

Revision ID: 20260718_0021
Revises: 20260718_0020
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260718_0021"
down_revision = "20260718_0018"
branch_labels = None
depends_on = None


uuid = postgresql.UUID(as_uuid=True)


def upgrade():
    op.create_table(
        "requisitos",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("proyecto_id", uuid, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("codigo", sa.String(40), nullable=False),
        sa.Column("titulo", sa.String(255), nullable=False),
        sa.Column("descripcion_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("estado", sa.String(40), nullable=False, server_default="BORRADOR"),
        sa.Column("prioridad", sa.String(20), nullable=False, server_default="MEDIA"),
        sa.Column("external_provider", sa.String(80)), sa.Column("external_reference", sa.String(160)), sa.Column("external_url", sa.Text()),
        sa.Column("creado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.Column("ultima_edicion_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.Column("fecha_creacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("ultima_actualizacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("archivado", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("proyecto_id", "codigo", name="uq_requisitos_proyecto_codigo"),
    )
    op.create_index("ix_requisitos_proyecto_id", "requisitos", ["proyecto_id"])
    op.create_index("ix_requisitos_estado", "requisitos", ["estado"])
    op.create_index("ix_requisitos_archivado", "requisitos", ["archivado"])
    op.create_table("requisito_componentes", sa.Column("requisito_id", uuid, sa.ForeignKey("requisitos.id", ondelete="CASCADE"), primary_key=True), sa.Column("componente_id", uuid, sa.ForeignKey("componentes.id", ondelete="CASCADE"), primary_key=True))
    op.create_table(
        "requisito_historial", sa.Column("id", uuid, primary_key=True),
        sa.Column("requisito_id", uuid, sa.ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("titulo", sa.String(255), nullable=False), sa.Column("descripcion_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("estado", sa.String(40), nullable=False), sa.Column("prioridad", sa.String(20), nullable=False),
        sa.Column("external_provider", sa.String(80)), sa.Column("external_reference", sa.String(160)), sa.Column("external_url", sa.Text()),
        sa.Column("editado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.Column("fecha_edicion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")), sa.Column("comentario_cambio", sa.String(255)),
    )
    op.create_index("ix_requisito_historial_requisito_id", "requisito_historial", ["requisito_id"])
    op.create_table(
        "historias_usuario", sa.Column("id", uuid, primary_key=True),
        sa.Column("requisito_id", uuid, sa.ForeignKey("requisitos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("proyecto_id", uuid, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("codigo", sa.String(40), nullable=False), sa.Column("titulo", sa.String(255), nullable=False),
        sa.Column("descripcion_markdown", sa.Text(), nullable=False, server_default=""), sa.Column("criterios_aceptacion_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("estado", sa.String(40), nullable=False, server_default="BORRADOR"), sa.Column("prioridad", sa.String(20), nullable=False, server_default="MEDIA"),
        sa.Column("external_provider", sa.String(80)), sa.Column("external_reference", sa.String(160)), sa.Column("external_url", sa.Text()),
        sa.Column("creado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")), sa.Column("ultima_edicion_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.Column("fecha_creacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")), sa.Column("ultima_actualizacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("archivado", sa.Boolean(), nullable=False, server_default=sa.false()), sa.UniqueConstraint("proyecto_id", "codigo", name="uq_historias_proyecto_codigo"),
    )
    op.create_index("ix_historias_usuario_proyecto_id", "historias_usuario", ["proyecto_id"])
    op.create_index("ix_historias_usuario_requisito_id", "historias_usuario", ["requisito_id"])
    op.create_table(
        "historia_historial", sa.Column("id", uuid, primary_key=True), sa.Column("historia_id", uuid, sa.ForeignKey("historias_usuario.id", ondelete="CASCADE"), nullable=False),
        sa.Column("titulo", sa.String(255), nullable=False), sa.Column("descripcion_markdown", sa.Text(), nullable=False, server_default=""), sa.Column("criterios_aceptacion_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("estado", sa.String(40), nullable=False), sa.Column("prioridad", sa.String(20), nullable=False), sa.Column("external_provider", sa.String(80)), sa.Column("external_reference", sa.String(160)), sa.Column("external_url", sa.Text()),
        sa.Column("editado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")), sa.Column("fecha_edicion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")), sa.Column("comentario_cambio", sa.String(255)),
    )
    op.create_index("ix_historia_historial_historia_id", "historia_historial", ["historia_id"])
    op.create_table(
        "caso_historias", sa.Column("id", uuid, primary_key=True), sa.Column("caso_master_id", uuid, nullable=False),
        sa.Column("historia_id", uuid, sa.ForeignKey("historias_usuario.id", ondelete="CASCADE"), nullable=False),
        sa.Column("creado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")), sa.Column("fecha_creacion", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("historia_actualizada_en_vinculo", sa.DateTime(timezone=True)), sa.Column("requiere_revision", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("fecha_revision", sa.DateTime(timezone=True)), sa.Column("revisado_por", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        sa.UniqueConstraint("caso_master_id", "historia_id", name="uq_caso_historias_master_historia"),
    )
    op.create_index("ix_caso_historias_caso_master_id", "caso_historias", ["caso_master_id"])
    op.create_index("ix_caso_historias_historia_id", "caso_historias", ["historia_id"])
    op.create_index("ix_caso_historias_historia_revision", "caso_historias", ["historia_id", "requiere_revision"])


def downgrade():
    op.drop_table("caso_historias")
    op.drop_table("historia_historial")
    op.drop_table("historias_usuario")
    op.drop_table("requisito_historial")
    op.drop_table("requisito_componentes")
    op.drop_table("requisitos")

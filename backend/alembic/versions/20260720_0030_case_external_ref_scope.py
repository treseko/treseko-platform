"""scope external case references by project

Revision ID: 20260720_0030
Revises: 20260720_0029
"""
from alembic import op
import sqlalchemy as sa

revision = "20260720_0030"
down_revision = "20260720_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("case_external_refs")}
    if "proyecto_id" not in columns:
        op.add_column("case_external_refs", sa.Column("proyecto_id", sa.UUID(), nullable=True))
    op.execute("""
        UPDATE case_external_refs refs
        SET proyecto_id = casos.proyecto_id
        FROM casos_prueba casos
        WHERE casos.id = refs.caso_id AND refs.proyecto_id IS NULL
    """)
    op.alter_column("case_external_refs", "proyecto_id", nullable=False)
    constraints = {c["name"] for c in inspector.get_unique_constraints("case_external_refs")}
    if "uq_case_external_ref_content" in constraints:
        op.drop_constraint("uq_case_external_ref_content", "case_external_refs", type_="unique")
    if "uq_case_external_ref_content" not in {c["name"] for c in sa.inspect(op.get_bind()).get_unique_constraints("case_external_refs") }:
        op.create_unique_constraint("uq_case_external_ref_content", "case_external_refs", ["proyecto_id", "source_tool", "external_id", "content_sha256"])
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("case_external_refs")}
    if "ix_case_external_refs_proyecto_id" not in indexes:
        op.create_index("ix_case_external_refs_proyecto_id", "case_external_refs", ["proyecto_id"])
    if "ix_case_external_ref_lookup" in indexes:
        op.drop_index("ix_case_external_ref_lookup", table_name="case_external_refs")
    op.create_index("ix_case_external_ref_lookup", "case_external_refs", ["proyecto_id", "source_tool", "external_id"])


def downgrade() -> None:
    op.drop_index("ix_case_external_ref_lookup", table_name="case_external_refs")
    op.create_index("ix_case_external_ref_lookup", "case_external_refs", ["source_tool", "external_id"])
    op.drop_index("ix_case_external_refs_proyecto_id", table_name="case_external_refs")
    op.drop_constraint("uq_case_external_ref_content", "case_external_refs", type_="unique")
    op.create_unique_constraint("uq_case_external_ref_content", "case_external_refs", ["source_tool", "external_id", "content_sha256"])
    op.drop_column("case_external_refs", "proyecto_id")

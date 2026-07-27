"""case portability batches and external references

Revision ID: 20260720_0028
Revises: 20260719_0027
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260720_0028"
down_revision = "20260719_0027"
branch_labels = None
depends_on = None
UUID = postgresql.UUID(as_uuid=True)


def _inspector():
    return sa.inspect(op.get_bind())


def _index(name: str, table: str, columns: list[str]) -> None:
    if name not in {item["name"] for item in _inspector().get_indexes(table)}:
        op.create_index(name, table, columns)


def upgrade() -> None:
    tables = set(_inspector().get_table_names())
    if "case_import_batches" not in tables:
        op.create_table(
            "case_import_batches",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("proyecto_id", UUID, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source_tool", sa.String(80), nullable=False), sa.Column("source_version", sa.String(80), nullable=False),
            sa.Column("file_name", sa.String(255)), sa.Column("file_sha256", sa.String(64), nullable=False),
            sa.Column("status", sa.String(30), nullable=False, server_default="COMPLETED"),
            sa.Column("summary_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("item_results", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
            sa.Column("created_case_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
            sa.Column("created_suite_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
            sa.Column("created_by", UUID, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("rolled_back_at", sa.DateTime(timezone=True)), sa.Column("rolled_back_by", UUID, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
        )
    for name, columns in {
        "ix_case_import_batches_proyecto_id": ["proyecto_id"], "ix_case_import_batches_source_tool": ["source_tool"],
        "ix_case_import_batches_file_sha256": ["file_sha256"], "ix_case_import_batches_status": ["status"],
        "ix_case_import_batches_created_by": ["created_by"], "ix_case_import_batches_created_at": ["created_at"],
    }.items(): _index(name, "case_import_batches", columns)
    if "case_external_refs" not in tables:
        op.create_table(
            "case_external_refs",
            sa.Column("id", UUID, primary_key=True), sa.Column("caso_id", UUID, sa.ForeignKey("casos_prueba.id", ondelete="CASCADE"), nullable=False),
            sa.Column("master_id", UUID, nullable=False), sa.Column("source_tool", sa.String(80), nullable=False), sa.Column("external_id", sa.String(255), nullable=False),
            sa.Column("external_version", sa.String(120)), sa.Column("content_sha256", sa.String(64), nullable=False),
            sa.Column("import_batch_id", UUID, sa.ForeignKey("case_import_batches.id", ondelete="SET NULL")), sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("source_tool", "external_id", "content_sha256", name="uq_case_external_ref_content"),
        )
    for name, columns in {
        "ix_case_external_refs_caso_id": ["caso_id"], "ix_case_external_refs_master_id": ["master_id"],
        "ix_case_external_refs_source_tool": ["source_tool"], "ix_case_external_refs_import_batch_id": ["import_batch_id"],
        "ix_case_external_ref_lookup": ["source_tool", "external_id"],
    }.items(): _index(name, "case_external_refs", columns)


def downgrade() -> None:
    op.drop_table("case_external_refs")
    op.drop_table("case_import_batches")

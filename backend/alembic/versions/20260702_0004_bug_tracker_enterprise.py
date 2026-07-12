"""Extend internal bug tracker for enterprise QA traceability.

Revision ID: 20260702_0004
Revises: 20260629_0003
Create Date: 2026-07-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260702_0004"
down_revision = "20260629_0003"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _add(table: str, column: sa.Column) -> None:
    if not _has_column(table, column.name):
        op.add_column(table, column)


def _index(name: str, table: str, columns: list[str]) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if name not in {idx["name"] for idx in inspector.get_indexes(table)}:
        op.create_index(name, table, columns)


def upgrade() -> None:
    _add("external_issue_links", sa.Column("bug_id", UUID(as_uuid=True), sa.ForeignKey("bug_issues.id", ondelete="CASCADE"), nullable=True))
    _index("ix_external_issue_links_bug_id", "external_issue_links", ["bug_id"])

    for column_name, target in [
        ("test_run_id", "test_runs.id"),
        ("entorno_id", "entornos.id"),
        ("dataset_id", "entorno_datasets.id"),
        ("resuelto_por", "usuarios.id"),
        ("duplicate_of_id", "bug_issues.id"),
    ]:
        _add("bug_issues", sa.Column(column_name, UUID(as_uuid=True), sa.ForeignKey(target, ondelete="SET NULL"), nullable=True))
        _index(f"ix_bug_issues_{column_name}", "bug_issues", [column_name])

    for column_name, length in [
        ("execution_mode", 30),
        ("case_code", 30),
        ("build_code", 30),
        ("navegador", 120),
        ("dispositivo", 120),
        ("resolucion", 80),
        ("sistema_operativo", 120),
        ("ambiente_nombre", 150),
        ("version_app", 120),
        ("reproducibilidad", 30),
        ("frecuencia", 80),
        ("modulo_funcional", 150),
        ("criticidad", 20),
        ("external_sync_status", 30),
        ("retest_status", 30),
    ]:
        _add("bug_issues", sa.Column(column_name, sa.String(length), nullable=True))

    for column_name in [
        "precondiciones",
        "pasos_reproduccion",
        "datos_prueba",
        "resultado_esperado",
        "resultado_obtenido",
        "comportamiento_actual",
        "url_afectada",
        "ambiente_url",
        "logs_relevantes",
        "error_tecnico",
        "stack_trace",
        "notas_qa",
        "impacto_negocio",
        "external_issue_url",
        "resolucion",
        "motivo_cierre",
    ]:
        _add("bug_issues", sa.Column(column_name, sa.Text(), nullable=True))

    _add("bug_issues", sa.Column("numero_paso", sa.Integer(), nullable=True))
    _add("bug_issues", sa.Column("bloquea_release", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    _add("bug_issues", sa.Column("bloquea_caso", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    _add("bug_issues", sa.Column("external_last_sync_at", sa.DateTime(timezone=True), nullable=True))
    _add("bug_issues", sa.Column("external_payload_snapshot", sa.JSON(), nullable=True, server_default=sa.text("'{}'")))
    _add("bug_issues", sa.Column("dedupe_hash", sa.String(128), nullable=True))
    _add("bug_issues", sa.Column("fecha_resolucion", sa.DateTime(timezone=True), nullable=True))
    _add("bug_issues", sa.Column("reopened_count", sa.Integer(), nullable=False, server_default="0"))
    _add("bug_issues", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    _add("bug_issues", sa.Column("metadata_json", sa.JSON(), nullable=True, server_default=sa.text("'{}'")))
    _index("ix_bug_issues_dedupe_hash", "bug_issues", ["dedupe_hash"])

    bind = op.get_bind()
    bind.execute(sa.text("UPDATE bug_issues SET criticidad = COALESCE(criticidad, severidad, 'MEDIA')"))
    bind.execute(sa.text("UPDATE bug_issues SET reproducibilidad = COALESCE(reproducibilidad, 'no_reproducido')"))
    bind.execute(sa.text("UPDATE bug_issues SET external_sync_status = COALESCE(external_sync_status, 'not_synced')"))
    bind.execute(sa.text("UPDATE bug_issues SET retest_status = COALESCE(retest_status, 'pendiente')"))


def downgrade() -> None:
    # Non-destructive by policy for local/dev data.
    pass

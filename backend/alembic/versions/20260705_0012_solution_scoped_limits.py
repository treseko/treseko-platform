"""Add solution scope to workers and attachments.

Revision ID: 20260705_0012
Revises: 20260705_0011
Create Date: 2026-07-05
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260705_0012"
down_revision = "20260705_0011"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in set(_inspector().get_table_names())


def _column_names(table_name: str) -> set[str]:
    if not _has_table(table_name):
        return set()
    return {column["name"] for column in _inspector().get_columns(table_name)}


def _index_names(table_name: str) -> set[str]:
    if not _has_table(table_name):
        return set()
    return {index["name"] for index in _inspector().get_indexes(table_name)}


def _add_uuid_fk_column(table_name: str, column_name: str, target: str, *, ondelete: str = "SET NULL") -> None:
    if column_name in _column_names(table_name):
        return
    op.add_column(
        table_name,
        sa.Column(column_name, UUID(as_uuid=True), sa.ForeignKey(target, ondelete=ondelete), nullable=True),
    )


def _create_index_if_missing(table_name: str, index_name: str, columns: list[str]) -> None:
    if index_name in _index_names(table_name):
        return
    op.create_index(index_name, table_name, columns)


def _backfill_attachment_scope() -> None:
    bind = op.get_bind()
    if not _has_table("attachments"):
        return
    columns = _column_names("attachments")
    if "proyecto_id" not in columns or "organizacion_id" not in columns:
        return

    if all(_has_table(name) for name in {"paso_attachments", "pasos_prueba", "casos_prueba", "proyectos"}):
        bind.execute(sa.text("""
            UPDATE attachments AS a
            SET proyecto_id = cp.proyecto_id,
                organizacion_id = p.organizacion_id
            FROM paso_attachments AS pa
            JOIN pasos_prueba AS pp ON pp.id = pa.paso_id
            JOIN casos_prueba AS cp ON cp.id = pp.caso_id
            JOIN proyectos AS p ON p.id = cp.proyecto_id
            WHERE pa.attachment_id = a.id
              AND a.proyecto_id IS NULL
        """))

    if all(_has_table(name) for name in {"snapshot_attachments", "snapshots_pasos", "ejecuciones_casos", "test_runs", "proyectos"}):
        bind.execute(sa.text("""
            UPDATE attachments AS a
            SET proyecto_id = tr.proyecto_id,
                organizacion_id = p.organizacion_id
            FROM snapshot_attachments AS sa_link
            JOIN snapshots_pasos AS sp ON sp.id = sa_link.snapshot_id
            JOIN ejecuciones_casos AS ec ON ec.id = sp.ejecucion_caso_id
            JOIN test_runs AS tr ON tr.id = ec.test_run_id
            JOIN proyectos AS p ON p.id = tr.proyecto_id
            WHERE sa_link.attachment_id = a.id
              AND a.proyecto_id IS NULL
        """))

    if all(_has_table(name) for name in {"bug_attachments", "bug_issues", "proyectos"}):
        bind.execute(sa.text("""
            UPDATE attachments AS a
            SET proyecto_id = bi.proyecto_id,
                organizacion_id = p.organizacion_id
            FROM bug_attachments AS ba
            JOIN bug_issues AS bi ON bi.id = ba.bug_id
            JOIN proyectos AS p ON p.id = bi.proyecto_id
            WHERE ba.attachment_id = a.id
              AND a.proyecto_id IS NULL
        """))


def upgrade() -> None:
    for table_name in (
        "automation_runners",
        "automation_runner_registration_tokens",
        "automation_runner_pairing_requests",
    ):
        if not _has_table(table_name):
            continue
        _add_uuid_fk_column(table_name, "organizacion_id", "organizaciones.id")
        _create_index_if_missing(table_name, f"ix_{table_name}_organizacion_id", ["organizacion_id"])

    if _has_table("attachments"):
        _add_uuid_fk_column("attachments", "organizacion_id", "organizaciones.id")
        _add_uuid_fk_column("attachments", "proyecto_id", "proyectos.id")
        _create_index_if_missing("attachments", "ix_attachments_organizacion_id", ["organizacion_id"])
        _create_index_if_missing("attachments", "ix_attachments_proyecto_id", ["proyecto_id"])
        _backfill_attachment_scope()


def downgrade() -> None:
    for table_name, index_name in (
        ("attachments", "ix_attachments_proyecto_id"),
        ("attachments", "ix_attachments_organizacion_id"),
        ("automation_runner_pairing_requests", "ix_automation_runner_pairing_requests_organizacion_id"),
        ("automation_runner_registration_tokens", "ix_automation_runner_registration_tokens_organizacion_id"),
        ("automation_runners", "ix_automation_runners_organizacion_id"),
    ):
        if _has_table(table_name) and index_name in _index_names(table_name):
            op.drop_index(index_name, table_name=table_name)

    for table_name, columns in (
        ("attachments", ("proyecto_id", "organizacion_id")),
        ("automation_runner_pairing_requests", ("organizacion_id",)),
        ("automation_runner_registration_tokens", ("organizacion_id",)),
        ("automation_runners", ("organizacion_id",)),
    ):
        existing = _column_names(table_name)
        for column_name in columns:
            if column_name in existing:
                op.drop_column(table_name, column_name)

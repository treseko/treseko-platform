"""Allow case versions to reuse the same case code.

Revision ID: 20260714_0017
Revises: 20260709_0016
Create Date: 2026-07-14
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260714_0017"
down_revision = "20260709_0016"
branch_labels = None
depends_on = None


INDEX_NAME = "ix_casos_proyecto_codigo"
TABLE_NAME = "casos_prueba"


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _index_info(table_name: str, index_name: str) -> dict | None:
    if not _has_table(table_name):
        return None
    inspector = sa.inspect(op.get_bind())
    for index in inspector.get_indexes(table_name):
        if index.get("name") == index_name:
            return index
    return None


def _drop_index_if_exists(table_name: str, index_name: str) -> None:
    if _index_info(table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    if not _has_table(TABLE_NAME):
        return
    _drop_index_if_exists(TABLE_NAME, INDEX_NAME)
    op.create_index(INDEX_NAME, TABLE_NAME, ["proyecto_id", "codigo"], unique=False)


def downgrade() -> None:
    if not _has_table(TABLE_NAME):
        return
    _drop_index_if_exists(TABLE_NAME, INDEX_NAME)
    bind = op.get_bind()
    duplicates = bind.execute(sa.text("""
        SELECT 1
        FROM casos_prueba
        WHERE codigo IS NOT NULL
        GROUP BY proyecto_id, codigo
        HAVING COUNT(*) > 1
        LIMIT 1
    """)).first()
    if not duplicates:
        op.create_index(INDEX_NAME, TABLE_NAME, ["proyecto_id", "codigo"], unique=True)
    else:
        op.create_index(INDEX_NAME, TABLE_NAME, ["proyecto_id", "codigo"], unique=False)

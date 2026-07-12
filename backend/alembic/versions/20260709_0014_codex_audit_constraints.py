"""Codex audit cleanup and safety constraints.

Revision ID: 20260709_0014
Revises: 20260708_0013
Create Date: 2026-07-09
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260709_0014"
down_revision = "20260708_0013"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in set(_inspector().get_table_names())


def _index_names(table_name: str) -> set[str]:
    if not _has_table(table_name):
        return set()
    return {index["name"] for index in _inspector().get_indexes(table_name)}


def _unique_names(table_name: str) -> set[str]:
    if not _has_table(table_name):
        return set()
    return {constraint["name"] for constraint in _inspector().get_unique_constraints(table_name)}


def _foreign_keys(table_name: str) -> list[dict]:
    if not _has_table(table_name):
        return []
    return list(_inspector().get_foreign_keys(table_name))


def _create_unique(name: str, table: str, columns: list[str]) -> None:
    if table not in set(_inspector().get_table_names()):
        return
    if name in _unique_names(table) or name in _index_names(table):
        return
    op.create_unique_constraint(name, table, columns)


def _create_index(name: str, table: str, columns: list[str], *, unique: bool = False) -> None:
    if table not in set(_inspector().get_table_names()):
        return
    if name in _index_names(table) or name in _unique_names(table):
        return
    op.create_index(name, table, columns, unique=unique)


def _cleanup_duplicates() -> None:
    bind = op.get_bind()
    if _has_table("componentes"):
        bind.execute(sa.text("""
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY proyecto_id, nombre ORDER BY id) AS rn
                FROM componentes
                WHERE nombre IS NOT NULL
            )
            UPDATE componentes
            SET nombre = substr(componentes.nombre, 1, 88) || '-dup-' || substr(replace(CAST(componentes.id AS TEXT), '-', ''), 1, 8)
            FROM ranked
            WHERE componentes.id = ranked.id AND ranked.rn > 1
        """))
    if _has_table("builds"):
        bind.execute(sa.text("""
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY componente_id, nombre ORDER BY id) AS rn
                FROM builds
                WHERE componente_id IS NOT NULL AND nombre IS NOT NULL
            )
            UPDATE builds
            SET nombre = substr(builds.nombre, 1, 137) || '-dup-' || substr(replace(CAST(builds.id AS TEXT), '-', ''), 1, 8)
            FROM ranked
            WHERE builds.id = ranked.id AND ranked.rn > 1
        """))
        bind.execute(sa.text("""
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY proyecto_id, codigo ORDER BY id) AS rn
                FROM builds
                WHERE codigo IS NOT NULL AND codigo <> ''
            )
            UPDATE builds
            SET codigo = substr(builds.codigo, 1, 11) || '-dup-' || substr(replace(CAST(builds.id AS TEXT), '-', ''), 1, 4)
            FROM ranked
            WHERE builds.id = ranked.id AND ranked.rn > 1
        """))
    if _has_table("casos_prueba"):
        bind.execute(sa.text("""
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY proyecto_id, codigo ORDER BY id) AS rn
                FROM casos_prueba
                WHERE codigo IS NOT NULL AND codigo <> ''
            )
            UPDATE casos_prueba
            SET codigo = substr(casos_prueba.codigo, 1, 11) || '-dup-' || substr(replace(CAST(casos_prueba.id AS TEXT), '-', ''), 1, 4)
            FROM ranked
            WHERE casos_prueba.id = ranked.id AND ranked.rn > 1
        """))
        bind.execute(sa.text("""
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY master_id, version ORDER BY id) AS rn
                FROM casos_prueba
                WHERE master_id IS NOT NULL AND version IS NOT NULL
            )
            UPDATE casos_prueba
            SET version = casos_prueba.version + ranked.rn + 100000
            FROM ranked
            WHERE casos_prueba.id = ranked.id AND ranked.rn > 1
        """))
    if _has_table("ejecuciones_casos"):
        bind.execute(sa.text("""
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY test_run_id, caso_id, intento_numero ORDER BY fecha_ejecucion, id) AS rn
                FROM ejecuciones_casos
                WHERE test_run_id IS NOT NULL AND caso_id IS NOT NULL AND intento_numero IS NOT NULL
            )
            UPDATE ejecuciones_casos
            SET intento_numero = ejecuciones_casos.intento_numero + ranked.rn + 100000
            FROM ranked
            WHERE ejecuciones_casos.id = ranked.id AND ranked.rn > 1
        """))


def _harden_project_organization_fk() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite" or not _has_table("proyectos"):
        return
    for fk in _foreign_keys("proyectos"):
        if fk.get("referred_table") == "organizaciones" and fk.get("constrained_columns") == ["organizacion_id"]:
            if fk.get("options", {}).get("ondelete") == "RESTRICT":
                return
            if fk.get("name"):
                op.drop_constraint(fk["name"], "proyectos", type_="foreignkey")
            break
    op.create_foreign_key(
        "fk_proyectos_organizacion_id_organizaciones",
        "proyectos",
        "organizaciones",
        ["organizacion_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def upgrade() -> None:
    _cleanup_duplicates()
    _harden_project_organization_fk()
    _create_unique("uq_componentes_proyecto_nombre", "componentes", ["proyecto_id", "nombre"])
    _create_unique("uq_builds_componente_nombre", "builds", ["componente_id", "nombre"])
    _create_index("ix_builds_proyecto_codigo", "builds", ["proyecto_id", "codigo"], unique=True)
    _create_unique("uq_casos_master_version", "casos_prueba", ["master_id", "version"])
    _create_index("ix_casos_proyecto_codigo", "casos_prueba", ["proyecto_id", "codigo"], unique=True)
    _create_unique("uq_ejecuciones_run_caso_intento", "ejecuciones_casos", ["test_run_id", "caso_id", "intento_numero"])
    _create_index("ix_scheduled_runs_suite_id", "scheduled_runs", ["suite_id"])
    _create_index("ix_bug_issues_proyecto_estado", "bug_issues", ["proyecto_id", "estado"])
    _create_index("ix_notification_inbox_user_read", "notification_inbox", ["user_id", "read_at"])


def downgrade() -> None:
    for table, name in [
        ("notification_inbox", "ix_notification_inbox_user_read"),
        ("bug_issues", "ix_bug_issues_proyecto_estado"),
        ("scheduled_runs", "ix_scheduled_runs_suite_id"),
        ("casos_prueba", "ix_casos_proyecto_codigo"),
        ("builds", "ix_builds_proyecto_codigo"),
    ]:
        if name in _index_names(table):
            op.drop_index(name, table_name=table)
    for table, name in [
        ("ejecuciones_casos", "uq_ejecuciones_run_caso_intento"),
        ("casos_prueba", "uq_casos_master_version"),
        ("builds", "uq_builds_componente_nombre"),
        ("componentes", "uq_componentes_proyecto_nombre"),
    ]:
        if name in _unique_names(table):
            op.drop_constraint(name, table, type_="unique")

"""track bug resolution builds and status history

Revision ID: 20260721_0031
Revises: 20260720_0030
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = "20260721_0031"
down_revision = "20260720_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    bug_columns = {column["name"] for column in inspector.get_columns("bug_issues")}
    if "resolved_build_id" not in bug_columns:
        op.add_column("bug_issues", sa.Column("resolved_build_id", postgresql.UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(
            "fk_bug_issues_resolved_build_id_builds", "bug_issues", "builds",
            ["resolved_build_id"], ["id"], ondelete="SET NULL",
        )
        op.create_index("ix_bug_issues_resolved_build_id", "bug_issues", ["resolved_build_id"])

    if "bug_status_history" not in inspector.get_table_names():
        op.create_table(
            "bug_status_history",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("bug_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bug_issues.id", ondelete="CASCADE"), nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
            sa.Column("from_status", sa.String(30), nullable=True),
            sa.Column("to_status", sa.String(30), nullable=False),
            sa.Column("build_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("builds.id", ondelete="SET NULL"), nullable=True),
            sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
            sa.Column("resolution", sa.Text(), nullable=True),
            sa.Column("close_reason", sa.Text(), nullable=True),
            sa.Column("retest_status", sa.String(30), nullable=True),
            sa.Column("source", sa.String(50), nullable=False, server_default="legacy_snapshot"),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        for name, columns in (
            ("ix_bug_status_history_bug_id", ["bug_id"]),
            ("ix_bug_status_history_project_id", ["project_id"]),
            ("ix_bug_status_history_to_status", ["to_status"]),
            ("ix_bug_status_history_build_id", ["build_id"]),
            ("ix_bug_status_history_actor_id", ["actor_id"]),
            ("ix_bug_status_history_source", ["source"]),
            ("ix_bug_status_history_occurred_at", ["occurred_at"]),
            ("ix_bug_status_history_project_build_date", ["project_id", "build_id", "occurred_at"]),
            ("ix_bug_status_history_bug_date", ["bug_id", "occurred_at"]),
        ):
            op.create_index(name, "bug_status_history", columns)

        bind.execute(sa.text("""
            UPDATE bug_issues AS bug
            SET resolved_build_id = build.id
            FROM builds AS build
            WHERE bug.estado IN ('RESUELTO', 'CERRADO')
              AND build.proyecto_id = bug.proyecto_id
              AND build.id::text = COALESCE(
                  bug.metadata_json ->> 'fixed_build_id',
                  bug.metadata_json ->> 'resolution_build_id'
              )
        """))

        bugs = bind.execute(sa.text("""
            SELECT id, proyecto_id, estado, resuelto_por, resolucion, motivo_cierre,
                   retest_status, created_at, updated_at, fecha_resolucion, closed_at,
                   resolved_build_id
            FROM bug_issues
        """)).mappings().all()
        for bug in bugs:
            occurred_at = bug["closed_at"] or bug["fecha_resolucion"] or bug["updated_at"] or bug["created_at"]
            bind.execute(sa.text("""
                INSERT INTO bug_status_history
                    (id, bug_id, project_id, from_status, to_status, build_id, actor_id,
                     resolution, close_reason, retest_status, source, occurred_at)
                VALUES
                    (:id, :bug_id, :project_id, NULL, :status, :build_id, :actor_id,
                     :resolution, :close_reason, :retest_status, 'legacy_snapshot', :occurred_at)
            """), {
                "id": uuid.uuid4(), "bug_id": bug["id"], "project_id": bug["proyecto_id"],
                "status": bug["estado"], "actor_id": bug["resuelto_por"],
                "build_id": bug["resolved_build_id"],
                "resolution": bug["resolucion"], "close_reason": bug["motivo_cierre"],
                "retest_status": bug["retest_status"], "occurred_at": occurred_at,
            })


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "bug_status_history" in inspector.get_table_names():
        op.drop_table("bug_status_history")
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("bug_issues")}
    if "resolved_build_id" in columns:
        op.drop_index("ix_bug_issues_resolved_build_id", table_name="bug_issues")
        op.drop_constraint("fk_bug_issues_resolved_build_id_builds", "bug_issues", type_="foreignkey")
        op.drop_column("bug_issues", "resolved_build_id")

"""track quality intelligence source freshness"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260807_0039"
down_revision = "20260807_0038"
branch_labels = None
depends_on = None

_MIGRATION_TABLE_COMMENT = "treseko-quality-intelligence-created-by-20260807-0039"
_FUNCTION_NAME = "treseko_quality_intelligence_mark_dirty"
_TRIGGER_EXECUTIONS = "trg_treseko_quality_execution_dirty"
_TRIGGER_SNAPSHOTS = "trg_treseko_quality_snapshot_dirty"


def _has_table(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def _created_by_this_migration(table_name: str) -> bool:
    comment = sa.inspect(op.get_bind()).get_table_comment(table_name).get("text")
    return comment == _MIGRATION_TABLE_COMMENT


def upgrade() -> None:
    # See 0038: the legacy baseline can create current ORM tables before the
    # incremental revisions run on a clean installation.
    if not _has_table("quality_analysis_states"):
        op.create_table(
            "quality_analysis_states",
            sa.Column("proyecto_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("source_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("rebuilt_revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rebuilt_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["proyecto_id"], ["proyectos.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("proyecto_id"),
        )
        op.execute(f"COMMENT ON TABLE quality_analysis_states IS '{_MIGRATION_TABLE_COMMENT}'")

    # A database trigger, rather than scattered application writes, covers all
    # manual, worker, AI and external execution paths. It only marks a source
    # revision dirty; it does not start analysis or alter test results.
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {_FUNCTION_NAME}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            target_execution_id uuid;
            target_run_id uuid;
            target_status text;
            previous_status text;
            target_project_id uuid;
        BEGIN
            IF TG_TABLE_NAME = 'ejecuciones_casos' THEN
                IF TG_OP = 'DELETE' THEN
                    target_execution_id := OLD.id;
                    target_run_id := OLD.test_run_id;
                    target_status := '';
                    previous_status := COALESCE(OLD.estado_resultado::text, '');
                ELSIF TG_OP = 'INSERT' THEN
                    target_execution_id := NEW.id;
                    target_run_id := NEW.test_run_id;
                    target_status := COALESCE(NEW.estado_resultado::text, '');
                    previous_status := '';
                ELSE
                    target_execution_id := NEW.id;
                    target_run_id := NEW.test_run_id;
                    target_status := COALESCE(NEW.estado_resultado::text, '');
                    previous_status := COALESCE(OLD.estado_resultado::text, '');
                END IF;
            ELSE
                IF TG_OP = 'DELETE' THEN
                    target_execution_id := OLD.ejecucion_caso_id;
                ELSE
                    target_execution_id := NEW.ejecucion_caso_id;
                END IF;
                SELECT test_run_id, estado_resultado::text
                  INTO target_run_id, target_status
                  FROM ejecuciones_casos
                 WHERE id = target_execution_id;
                previous_status := target_status;
            END IF;

            IF target_status NOT IN ('PASO', 'FALLO', 'BLOQUEADO')
               AND previous_status NOT IN ('PASO', 'FALLO', 'BLOQUEADO') THEN
                IF TG_OP = 'DELETE' THEN
                    RETURN OLD;
                END IF;
                RETURN NEW;
            END IF;

            SELECT proyecto_id INTO target_project_id FROM test_runs WHERE id = target_run_id;
            IF target_project_id IS NOT NULL THEN
                INSERT INTO quality_analysis_states (
                    proyecto_id, source_revision, rebuilt_revision, source_updated_at
                ) VALUES (
                    target_project_id, 1, 0, CURRENT_TIMESTAMP
                )
                ON CONFLICT (proyecto_id) DO UPDATE
                    SET source_revision = quality_analysis_states.source_revision + 1,
                        source_updated_at = EXCLUDED.source_updated_at;
            END IF;
            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(f"DROP TRIGGER IF EXISTS {_TRIGGER_EXECUTIONS} ON ejecuciones_casos")
    op.execute(
        f"""
        CREATE TRIGGER {_TRIGGER_EXECUTIONS}
        AFTER INSERT OR UPDATE OR DELETE ON ejecuciones_casos
        FOR EACH ROW EXECUTE FUNCTION {_FUNCTION_NAME}();
        """
    )
    op.execute(f"DROP TRIGGER IF EXISTS {_TRIGGER_SNAPSHOTS} ON snapshots_pasos")
    op.execute(
        f"""
        CREATE TRIGGER {_TRIGGER_SNAPSHOTS}
        AFTER INSERT OR UPDATE OR DELETE ON snapshots_pasos
        FOR EACH ROW EXECUTE FUNCTION {_FUNCTION_NAME}();
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TRIGGER IF EXISTS {_TRIGGER_SNAPSHOTS} ON snapshots_pasos")
    op.execute(f"DROP TRIGGER IF EXISTS {_TRIGGER_EXECUTIONS} ON ejecuciones_casos")
    op.execute(f"DROP FUNCTION IF EXISTS {_FUNCTION_NAME}()")
    if _has_table("quality_analysis_states") and _created_by_this_migration("quality_analysis_states"):
        op.drop_table("quality_analysis_states")

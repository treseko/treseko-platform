"""Make Automation Worker claims scoped, leased and idempotent."""

from alembic import op
import sqlalchemy as sa


revision = "20260905_0061"
down_revision = "20260831_0060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("automation_jobs")}

    columns = (
        ("organizacion_id", sa.UUID()),
        ("proyecto_id", sa.UUID()),
        ("lease_token", sa.String(length=200)),
        ("lease_expires_at", sa.DateTime(timezone=True)),
        ("attempt_count", sa.Integer(), {"server_default": "0", "nullable": False}),
        ("max_attempts", sa.Integer(), {"server_default": "3", "nullable": False}),
        ("result_event_id", sa.String(length=200)),
        ("result_fingerprint", sa.String(length=64)),
    )
    for item in columns:
        name, column_type, *options = item
        if name not in existing_columns:
            op.add_column("automation_jobs", sa.Column(name, column_type, **(options[0] if options else {})))

    existing_fks = {tuple(fk["constrained_columns"]): fk for fk in inspector.get_foreign_keys("automation_jobs")}
    if ("organizacion_id",) not in existing_fks:
        op.create_foreign_key(
            "fk_automation_jobs_organizacion_id",
            "automation_jobs",
            "organizaciones",
            ["organizacion_id"],
            ["id"],
            ondelete="RESTRICT",
        )
    if ("proyecto_id",) not in existing_fks:
        op.create_foreign_key(
            "fk_automation_jobs_proyecto_id",
            "automation_jobs",
            "proyectos",
            ["proyecto_id"],
            ["id"],
            ondelete="RESTRICT",
        )

    # Resolve only unambiguous historical scope.  If run/build/case disagree,
    # or a dry-run payload contains a malformed/nonexistent project UUID, the
    # job remains unresolved and is not assigned to an invented tenant.
    op.execute(sa.text("""
        WITH candidates AS (
            SELECT
                j.id,
                tr.proyecto_id AS run_project_id,
                b.proyecto_id AS build_project_id,
                c.proyecto_id AS case_project_id,
                CASE
                    WHEN j.job_type = 'DRY_RUN'
                     AND COALESCE(j.payload_congelado->>'proyecto_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                    THEN (j.payload_congelado->>'proyecto_id')::uuid
                END AS dry_project_id
            FROM automation_jobs j
            LEFT JOIN test_runs tr ON tr.id = j.test_run_id
            LEFT JOIN builds b ON b.id = j.build_id
            LEFT JOIN casos_prueba c ON c.id = j.caso_id
            WHERE j.job_type IN ('EXECUTION', 'API_EXECUTION', 'DRY_RUN')
        ), resolved AS (
            SELECT
                id,
                COALESCE(run_project_id, build_project_id, case_project_id, dry_project_id) AS proyecto_id
            FROM candidates
            WHERE NOT (
                run_project_id IS NOT NULL AND build_project_id IS NOT NULL AND run_project_id <> build_project_id
            )
            AND NOT (
                run_project_id IS NOT NULL AND case_project_id IS NOT NULL AND run_project_id <> case_project_id
            )
            AND NOT (
                build_project_id IS NOT NULL AND case_project_id IS NOT NULL AND build_project_id <> case_project_id
            )
            AND NOT (
                dry_project_id IS NOT NULL AND (
                    (run_project_id IS NOT NULL AND dry_project_id <> run_project_id)
                    OR (build_project_id IS NOT NULL AND dry_project_id <> build_project_id)
                    OR (case_project_id IS NOT NULL AND dry_project_id <> case_project_id)
                )
            )
        )
        UPDATE automation_jobs j
        SET proyecto_id = r.proyecto_id,
            organizacion_id = p.organizacion_id
        FROM resolved r
        JOIN proyectos p ON p.id = r.proyecto_id
        WHERE j.id = r.id
          AND j.proyecto_id IS NULL
          AND r.proyecto_id IS NOT NULL
    """))

    # Existing active claims have no safe token to reconstruct.  Give them a
    # bounded recovery deadline so they can be requeued/expired, but require a
    # fresh claim before accepting a callback.
    op.execute(sa.text("""
        UPDATE automation_jobs
        SET attempt_count = CASE WHEN attempt_count = 0 THEN 1 ELSE attempt_count END,
            lease_expires_at = fecha_claim + make_interval(secs => GREATEST(timeout_seconds, 60))
        WHERE estado IN ('CLAIMED', 'RUNNING')
          AND fecha_claim IS NOT NULL
          AND lease_expires_at IS NULL
          AND job_type <> 'AI_EXECUTION'
    """))

    # Fail closed for unresolved jobs that could otherwise remain executable.
    # Terminal history is preserved; only active queue work is blocked.
    op.execute(sa.text("""
        UPDATE automation_jobs
        SET estado = 'BLOCKED',
            error_message = 'No se pudo resolver el alcance solucion/proyecto del job histórico; requiere revisión administrativa.',
            fecha_fin = COALESCE(fecha_fin, CURRENT_TIMESTAMP)
        WHERE job_type IN ('EXECUTION', 'API_EXECUTION', 'DRY_RUN')
          AND proyecto_id IS NULL
          AND estado IN ('PENDING', 'CLAIMED', 'RUNNING')
    """))

    existing_indexes = {item["name"] for item in inspector.get_indexes("automation_jobs")}
    for name, columns_for_index in (
        ("ix_automation_jobs_organizacion_estado_fecha", ["organizacion_id", "estado", "fecha_creacion"]),
        ("ix_automation_jobs_proyecto_estado_fecha", ["proyecto_id", "estado", "fecha_creacion"]),
        ("ix_automation_jobs_lease_expires_at", ["lease_expires_at"]),
    ):
        if name not in existing_indexes:
            op.create_index(name, "automation_jobs", columns_for_index)
    if "uq_automation_jobs_result_event_id" not in existing_indexes:
        op.create_index(
            "uq_automation_jobs_result_event_id",
            "automation_jobs",
            ["result_event_id"],
            unique=True,
            postgresql_where=sa.text("result_event_id IS NOT NULL"),
        )

    op.create_check_constraint(
        "ck_automation_jobs_max_attempts_positive",
        "automation_jobs",
        "max_attempts >= 1",
    )
    op.execute(sa.text("""
        CREATE OR REPLACE FUNCTION treseko_automation_job_scope_immutable()
        RETURNS trigger AS $$
        BEGIN
            IF OLD.organizacion_id IS DISTINCT FROM NEW.organizacion_id
               OR OLD.proyecto_id IS DISTINCT FROM NEW.proyecto_id THEN
                RAISE EXCEPTION 'El alcance del automation job es inmutable';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """))
    op.execute(sa.text("""
        CREATE TRIGGER trg_automation_job_scope_immutable
        BEFORE UPDATE ON automation_jobs
        FOR EACH ROW EXECUTE FUNCTION treseko_automation_job_scope_immutable()
    """))


def downgrade() -> None:
    op.execute(sa.text("DROP TRIGGER IF EXISTS trg_automation_job_scope_immutable ON automation_jobs"))
    op.execute(sa.text("DROP FUNCTION IF EXISTS treseko_automation_job_scope_immutable()"))
    op.drop_constraint("ck_automation_jobs_max_attempts_positive", "automation_jobs", type_="check")
    op.drop_index("uq_automation_jobs_result_event_id", table_name="automation_jobs")
    op.drop_index("ix_automation_jobs_lease_expires_at", table_name="automation_jobs")
    op.drop_index("ix_automation_jobs_proyecto_estado_fecha", table_name="automation_jobs")
    op.drop_index("ix_automation_jobs_organizacion_estado_fecha", table_name="automation_jobs")
    op.drop_constraint("fk_automation_jobs_proyecto_id", "automation_jobs", type_="foreignkey")
    op.drop_constraint("fk_automation_jobs_organizacion_id", "automation_jobs", type_="foreignkey")
    for name in (
        "result_fingerprint",
        "result_event_id",
        "max_attempts",
        "attempt_count",
        "lease_expires_at",
        "lease_token",
        "proyecto_id",
        "organizacion_id",
    ):
        op.drop_column("automation_jobs", name)

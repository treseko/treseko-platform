"""add deterministic quality intelligence foundation tables"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260807_0038"
down_revision = "20260730_0037"
branch_labels = None
depends_on = None

_MIGRATION_TABLE_COMMENT = "treseko-quality-intelligence-created-by-20260807-0038"


def _has_table(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def _created_by_this_migration(table_name: str) -> bool:
    comment = sa.inspect(op.get_bind()).get_table_comment(table_name).get("text")
    return comment == _MIGRATION_TABLE_COMMENT


def upgrade() -> None:
    # The original baseline uses Base.metadata.create_all(checkfirst=True), so
    # a clean install made from current source can already contain these
    # tables before this revision is reached. Existing installations do not.
    # Create only what is absent in order to support both histories safely.
    if not _has_table("quality_failure_fingerprints"):
        op.create_table(
        "quality_failure_fingerprints",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("proyecto_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("signature_version", sa.String(length=20), nullable=False, server_default="v1"),
        sa.Column("failure_category", sa.String(length=80), nullable=False, server_default="UNKNOWN"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["proyecto_id"], ["proyectos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("proyecto_id", "signature_version", "fingerprint", name="uq_quality_failure_fingerprint"),
        )
        op.execute(f"COMMENT ON TABLE quality_failure_fingerprints IS '{_MIGRATION_TABLE_COMMENT}'")
        op.create_index("ix_quality_failure_fingerprints_proyecto_id", "quality_failure_fingerprints", ["proyecto_id"])
        op.create_index("ix_quality_failure_fingerprints_failure_category", "quality_failure_fingerprints", ["failure_category"])
        op.create_index("ix_quality_failure_fingerprints_last_seen_at", "quality_failure_fingerprints", ["last_seen_at"])
        op.create_index("ix_quality_failure_fingerprint_project_recent", "quality_failure_fingerprints", ["proyecto_id", "last_seen_at"])

    if not _has_table("quality_execution_observations"):
        op.create_table(
        "quality_execution_observations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ejecucion_caso_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("proyecto_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("build_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("componente_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("entorno_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("case_master_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resultado", sa.String(length=30), nullable=False),
        sa.Column("execution_mode", sa.String(length=30), nullable=False, server_default="MANUAL"),
        sa.Column("intento_numero", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("duracion_segundos", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("failure_fingerprint_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("evidence_summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("source_version", sa.String(length=20), nullable=False, server_default="v1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["ejecucion_caso_id"], ["ejecuciones_casos.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proyecto_id"], ["proyectos.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["build_id"], ["builds.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["componente_id"], ["componentes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["entorno_id"], ["entornos.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["failure_fingerprint_id"], ["quality_failure_fingerprints.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ejecucion_caso_id"),
        )
        op.execute(f"COMMENT ON TABLE quality_execution_observations IS '{_MIGRATION_TABLE_COMMENT}'")
        for column in ("ejecucion_caso_id", "proyecto_id", "build_id", "componente_id", "entorno_id", "case_master_id", "resultado", "observed_at", "failure_fingerprint_id"):
            op.create_index(f"ix_quality_execution_observations_{column}", "quality_execution_observations", [column])
        op.create_index("ix_quality_observation_case_series", "quality_execution_observations", ["proyecto_id", "case_master_id", "observed_at"])
        op.create_index("ix_quality_observation_project_build", "quality_execution_observations", ["proyecto_id", "build_id", "observed_at"])

    if not _has_table("quality_case_health"):
        op.create_table(
        "quality_case_health",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("proyecto_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_master_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("scope_key", sa.String(length=180), nullable=False, server_default="global"),
        sa.Column("algorithm_version", sa.String(length=20), nullable=False, server_default="v1"),
        sa.Column("window_size", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("total_observations", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("passed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("blocked_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("transition_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("flaky_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("classification", sa.String(length=40), nullable=False, server_default="INSUFFICIENT_DATA"),
        sa.Column("evidence_summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["proyecto_id"], ["proyectos.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("proyecto_id", "case_master_id", "scope_key", "algorithm_version", name="uq_quality_case_health_scope"),
        )
        op.execute(f"COMMENT ON TABLE quality_case_health IS '{_MIGRATION_TABLE_COMMENT}'")
        for column in ("proyecto_id", "case_master_id", "classification", "calculated_at"):
            op.create_index(f"ix_quality_case_health_{column}", "quality_case_health", [column])
        op.create_index("ix_quality_case_health_project_classification", "quality_case_health", ["proyecto_id", "classification"])


def downgrade() -> None:
    # Do not drop tables that a clean-install baseline has already created.
    # Historical databases created them in this revision and receive the
    # marker above, which makes rollback reversible without risking data from
    # a newer baseline source tree.
    if _has_table("quality_case_health") and _created_by_this_migration("quality_case_health"):
        op.drop_table("quality_case_health")
    if _has_table("quality_execution_observations") and _created_by_this_migration("quality_execution_observations"):
        op.drop_table("quality_execution_observations")
    if _has_table("quality_failure_fingerprints") and _created_by_this_migration("quality_failure_fingerprints"):
        op.drop_table("quality_failure_fingerprints")

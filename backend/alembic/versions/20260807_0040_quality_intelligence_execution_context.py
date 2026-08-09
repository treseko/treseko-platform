"""add suite and runner context to quality observations"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260807_0040"
down_revision = "20260807_0039"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    # A source checkout can already have these ORM columns from the legacy
    # create_all baseline. Historical 0038 databases receive them additively.
    columns = _column_names("quality_execution_observations")
    if "suite_id" not in columns:
        op.add_column(
            "quality_execution_observations",
            sa.Column("suite_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            "fk_quality_observation_suite",
            "quality_execution_observations",
            "suites",
            ["suite_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index("ix_quality_execution_observations_suite_id", "quality_execution_observations", ["suite_id"])
        op.create_index("ix_quality_observation_project_suite", "quality_execution_observations", ["proyecto_id", "suite_id", "observed_at"])
    if "runner_id" not in columns:
        op.add_column(
            "quality_execution_observations",
            sa.Column("runner_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            "fk_quality_observation_runner",
            "quality_execution_observations",
            "automation_runners",
            ["runner_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index("ix_quality_execution_observations_runner_id", "quality_execution_observations", ["runner_id"])
        op.create_index("ix_quality_observation_project_runner", "quality_execution_observations", ["proyecto_id", "runner_id", "observed_at"])


def downgrade() -> None:
    # This is an additive enrichment. Preserve historical context when a newer
    # source baseline already owns the columns, matching the safe strategy of
    # the preceding Quality Intelligence revisions.
    pass

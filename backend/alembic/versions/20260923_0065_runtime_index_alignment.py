"""Align runtime metadata indexes with the 1.0.4 worker and case contracts."""

from alembic import op
import sqlalchemy as sa


revision = "20260923_0065"
down_revision = "20260919_0064"
branch_labels = None
depends_on = None


def _index_names(table_name: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table_name)}


def upgrade() -> None:
    existing = _index_names("automation_jobs")
    if "ix_automation_jobs_organizacion_id" not in existing:
        op.create_index("ix_automation_jobs_organizacion_id", "automation_jobs", ["organizacion_id"])
    if "ix_automation_jobs_proyecto_id" not in existing:
        op.create_index("ix_automation_jobs_proyecto_id", "automation_jobs", ["proyecto_id"])


def downgrade() -> None:
    existing = _index_names("automation_jobs")
    for name in ("ix_automation_jobs_proyecto_id", "ix_automation_jobs_organizacion_id"):
        if name in existing:
            op.drop_index(name, table_name="automation_jobs")

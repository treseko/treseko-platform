"""add immutable human-revision lineage to quality diagnoses"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260807_0044"
down_revision = "20260807_0043"
branch_labels = None
depends_on = None


COLUMN = "supersedes_diagnosis_id"
INDEX = "ix_quality_diagnoses_supersedes_diagnosis_id"


def _columns() -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns("quality_diagnoses")}


def upgrade() -> None:
    if COLUMN not in _columns():
        op.add_column("quality_diagnoses", sa.Column(COLUMN, postgresql.UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(
            "fk_quality_diagnoses_supersedes_diagnosis_id",
            "quality_diagnoses", "quality_diagnoses", [COLUMN], ["id"], ondelete="SET NULL",
        )
    indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes("quality_diagnoses")}
    if INDEX not in indexes:
        op.create_index(INDEX, "quality_diagnoses", [COLUMN])


def downgrade() -> None:
    if COLUMN not in _columns():
        return
    indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes("quality_diagnoses")}
    if INDEX in indexes:
        op.drop_index(INDEX, table_name="quality_diagnoses")
    op.drop_constraint("fk_quality_diagnoses_supersedes_diagnosis_id", "quality_diagnoses", type_="foreignkey")
    op.drop_column("quality_diagnoses", COLUMN)

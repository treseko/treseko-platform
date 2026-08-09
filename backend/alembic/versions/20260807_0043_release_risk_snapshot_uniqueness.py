"""prevent duplicate immutable release-risk snapshots"""

from alembic import op
import sqlalchemy as sa


revision = "20260807_0043"
down_revision = "20260807_0042"
branch_labels = None
depends_on = None


CONSTRAINT = "uq_release_risk_snapshot"


def _has_constraint() -> bool:
    return CONSTRAINT in {item["name"] for item in sa.inspect(op.get_bind()).get_unique_constraints("release_risk_evaluations")}


def upgrade() -> None:
    if _has_constraint():
        return
    # The feature was staged before this guard existed.  Preserve the most
    # meaningful historical row if a pre-release environment somehow contains
    # identical snapshots, then enforce one canonical immutable snapshot.
    op.execute("""
        WITH ranked AS (
          SELECT ctid,
                 row_number() OVER (
                   PARTITION BY proyecto_id, build_id, algorithm_version, input_hash
                   ORDER BY accepted_at DESC NULLS LAST, created_at DESC, id DESC
                 ) AS row_number
          FROM release_risk_evaluations
        )
        DELETE FROM release_risk_evaluations
        WHERE ctid IN (SELECT ctid FROM ranked WHERE row_number > 1)
    """)
    op.create_unique_constraint(
        CONSTRAINT,
        "release_risk_evaluations",
        ["proyecto_id", "build_id", "algorithm_version", "input_hash"],
    )


def downgrade() -> None:
    if _has_constraint():
        op.drop_constraint(CONSTRAINT, "release_risk_evaluations", type_="unique")

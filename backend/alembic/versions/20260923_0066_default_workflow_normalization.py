"""Normalize the built-in AI workflow after legacy imports or restores."""

from alembic import op
import sqlalchemy as sa


revision = "20260923_0066"
down_revision = "20260923_0065"
branch_labels = None
depends_on = None


CANONICAL_DEFAULT_WORKFLOW_ID = "e65e6cb3-f338-5293-9aee-cabc0409b1c3"


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE ai_workflows
            SET is_default = FALSE
            WHERE is_default = TRUE AND id <> :canonical_id
            """
        ),
        {"canonical_id": CANONICAL_DEFAULT_WORKFLOW_ID},
    )
    bind.execute(
        sa.text(
            """
            UPDATE ai_workflows
            SET is_default = TRUE, status = 'ACTIVE'
            WHERE id = :canonical_id
            """
        ),
        {"canonical_id": CANONICAL_DEFAULT_WORKFLOW_ID},
    )


def downgrade() -> None:
    # The previous state can contain multiple legacy defaults and is not
    # reconstructible without an installation-specific backup.
    pass

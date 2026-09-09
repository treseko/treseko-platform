"""rename the classic case format from FUNCIONAL to CLASICA"""

from alembic import op
import sqlalchemy as sa


revision = "20260812_0046"
down_revision = "20260812_0045"
branch_labels = None
depends_on = None


ENUM_NAME = "formatoprueba"
OLD_VALUE = "FUNCIONAL"
NEW_VALUE = "CLASICA"


def _enum_values(bind) -> set[str]:
    return {
        row[0]
        for row in bind.execute(
            sa.text(
                "SELECT enumlabel FROM pg_enum "
                "WHERE enumtypid = CAST(:enum_name AS regtype)"
            ),
            {"enum_name": ENUM_NAME},
        )
    }


def upgrade() -> None:
    bind = op.get_bind()
    values = _enum_values(bind)
    if OLD_VALUE in values and NEW_VALUE not in values:
        bind.execute(
            sa.text(f"ALTER TYPE {ENUM_NAME} RENAME VALUE '{OLD_VALUE}' TO '{NEW_VALUE}'")
        )


def downgrade() -> None:
    bind = op.get_bind()
    values = _enum_values(bind)
    if NEW_VALUE in values and OLD_VALUE not in values:
        bind.execute(
            sa.text(f"ALTER TYPE {ENUM_NAME} RENAME VALUE '{NEW_VALUE}' TO '{OLD_VALUE}'")
        )

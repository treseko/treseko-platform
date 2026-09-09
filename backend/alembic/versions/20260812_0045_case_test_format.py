"""separate case format from execution type"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260812_0045"
down_revision = "20260807_0044"
branch_labels = None
depends_on = None


TABLE = "casos_prueba"
COLUMN = "formato_prueba"
ENUM_NAME = "formatoprueba"
ENUM_VALUES = ("FUNCIONAL", "API", "PERFORMANCE", "CONVERSACIONAL")


def _columns() -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns(TABLE)}


def _indexes() -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(TABLE)}


def _ensure_enum(bind) -> None:
    case_format = postgresql.ENUM(*ENUM_VALUES, name=ENUM_NAME)
    case_format.create(bind, checkfirst=True)
    existing_values = {
        row[0]
        for row in bind.execute(
            sa.text(
                "SELECT enumlabel FROM pg_enum "
                "WHERE enumtypid = CAST(:enum_name AS regtype)"
            ),
            {"enum_name": ENUM_NAME},
        )
    }
    for value in ENUM_VALUES:
        if value not in existing_values:
            bind.execute(sa.text(f"ALTER TYPE {ENUM_NAME} ADD VALUE IF NOT EXISTS '{value}'"))


def upgrade() -> None:
    bind = op.get_bind()
    _ensure_enum(bind)
    if COLUMN not in _columns():
        case_format = postgresql.ENUM(*ENUM_VALUES, name=ENUM_NAME, create_type=False)
        op.add_column(
            TABLE,
            sa.Column(
                COLUMN,
                case_format,
                nullable=False,
                server_default=sa.text("'FUNCIONAL'"),
            ),
        )
        op.alter_column(TABLE, COLUMN, server_default=None)
    if "ix_casos_prueba_formato_prueba" not in _indexes():
        op.create_index("ix_casos_prueba_formato_prueba", TABLE, [COLUMN])


def downgrade() -> None:
    if COLUMN not in _columns():
        return
    indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(TABLE)}
    if "ix_casos_prueba_formato_prueba" in indexes:
        op.drop_index("ix_casos_prueba_formato_prueba", table_name=TABLE)
    op.drop_column(TABLE, COLUMN)
    postgresql.ENUM(name=ENUM_NAME).drop(op.get_bind(), checkfirst=True)

"""Separate screen dimensions from correction notes without losing legacy data."""
import json
import re

from alembic import op
import sqlalchemy as sa

revision = "20261010_0072"
down_revision = "20261010_0071"
branch_labels = None
depends_on = None

DIMENSIONS = re.compile(r"^\s*\d{2,5}\s*[xX×]\s*\d{2,5}\s*$")
BACKUP_KEY = "legacy_screen_resolution"


def _table():
    return sa.table("bug_issues", sa.column("id", sa.Uuid), sa.column("resolucion", sa.Text),
                    sa.column("resolucion_pantalla", sa.String), sa.column("metadata_json", sa.JSON))


def _metadata(value):
    return json.loads(value) if isinstance(value, str) else dict(value or {})


def upgrade():
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("bug_issues")}
    if "resolucion_pantalla" not in columns:
        op.add_column("bug_issues", sa.Column("resolucion_pantalla", sa.String(120), nullable=True))
    table = _table()
    for row in bind.execute(sa.select(table)).mappings():
        metadata = _metadata(row["metadata_json"])
        legacy = row["resolucion"]
        is_screen = isinstance(legacy, str) and DIMENSIONS.fullmatch(legacy)
        screen = row["resolucion_pantalla"] or metadata.get(BACKUP_KEY) or (legacy if is_screen else None)
        values = {"resolucion_pantalla": screen}
        # Ambiguous free text remains a solution. Only an exact dimension string
        # moves to the environment field, preserving the original value verbatim.
        if is_screen and screen == legacy:
            values["resolucion"] = None
        bind.execute(table.update().where(table.c.id == row["id"]).values(**values))


def downgrade():
    bind = op.get_bind()
    table = _table()
    for row in bind.execute(sa.select(table)).mappings():
        if not row["resolucion_pantalla"]:
            continue
        metadata = _metadata(row["metadata_json"])
        metadata[BACKUP_KEY] = row["resolucion_pantalla"]
        values = {"metadata_json": metadata}
        if not row["resolucion"]:
            values["resolucion"] = row["resolucion_pantalla"]
        bind.execute(table.update().where(table.c.id == row["id"]).values(**values))
    op.drop_column("bug_issues", "resolucion_pantalla")

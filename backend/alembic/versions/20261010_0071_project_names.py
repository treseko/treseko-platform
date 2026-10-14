"""Scope project names to their organization without renaming existing data."""
from alembic import op
import sqlalchemy as sa

revision = "20261010_0071"
down_revision = "20261010_0070"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    for constraint in inspector.get_unique_constraints("proyectos"):
        if constraint["column_names"] == ["nombre"]:
            op.drop_constraint(constraint["name"], "proyectos", type_="unique")
    for index in sa.inspect(op.get_bind()).get_indexes("proyectos"):
        if index.get("unique") and index["column_names"] == ["nombre"]:
            op.drop_index(index["name"], table_name="proyectos")
    constraints = sa.inspect(op.get_bind()).get_unique_constraints("proyectos")
    if not any(item["name"] == "uq_proyectos_organizacion_nombre" for item in constraints):
        op.create_unique_constraint("uq_proyectos_organizacion_nombre", "proyectos", ["organizacion_id", "nombre"])
    indexes = sa.inspect(op.get_bind()).get_indexes("proyectos")
    if not any(item["name"] == "ix_proyectos_nombre" for item in indexes):
        op.create_index("ix_proyectos_nombre", "proyectos", ["nombre"])


def downgrade():
    duplicates = op.get_bind().execute(sa.text(
        "SELECT 1 FROM proyectos GROUP BY nombre HAVING COUNT(*) > 1 LIMIT 1"
    )).first()
    if duplicates:
        raise RuntimeError("No se puede volver a nombres globales: hay proyectos con el mismo nombre en distintas organizaciones. Resuelva esos nombres antes del downgrade.")
    op.drop_constraint("uq_proyectos_organizacion_nombre", "proyectos", type_="unique")
    op.drop_index("ix_proyectos_nombre", table_name="proyectos")
    op.create_index("ix_proyectos_nombre", "proyectos", ["nombre"], unique=True)

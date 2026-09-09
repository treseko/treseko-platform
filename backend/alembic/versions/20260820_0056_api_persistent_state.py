"""persist API variables per project and environment"""

from alembic import op
import sqlalchemy as sa


revision = "20260820_0056"
down_revision = "20260816_0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The initial baseline uses the current SQLAlchemy metadata with
    # ``checkfirst=True``. On a new PostgreSQL database that can create this
    # table before Alembic reaches this revision. Keep the revision safe for
    # both that baseline path and an older database where the table is absent.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("api_persistent_states"):
        op.create_table(
            "api_persistent_states",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("proyecto_id", sa.UUID(), nullable=False),
            sa.Column("entorno_id", sa.UUID(), nullable=False),
            sa.Column("key", sa.String(length=255), nullable=False),
            sa.Column("value", sa.JSON(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("last_run_id", sa.UUID(), nullable=True),
            sa.Column("last_case_id", sa.UUID(), nullable=True),
            sa.Column("updated_by", sa.UUID(), nullable=True),
            sa.Column("fecha_actualizacion", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(["proyecto_id"], ["proyectos.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["entorno_id"], ["entornos.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["last_run_id"], ["test_runs.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["last_case_id"], ["casos_prueba.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("proyecto_id", "entorno_id", "key", name="uq_api_persistent_state_scope_key"),
        )

    existing_indexes = {item["name"] for item in inspector.get_indexes("api_persistent_states")}
    for name, columns in (
        ("ix_api_persistent_states_proyecto_id", ["proyecto_id"]),
        ("ix_api_persistent_states_entorno_id", ["entorno_id"]),
        ("ix_api_persistent_state_scope", ["proyecto_id", "entorno_id"]),
    ):
        if name not in existing_indexes:
            op.create_index(name, "api_persistent_states", columns)


def downgrade() -> None:
    op.drop_index("ix_api_persistent_state_scope", table_name="api_persistent_states")
    op.drop_index("ix_api_persistent_states_entorno_id", table_name="api_persistent_states")
    op.drop_index("ix_api_persistent_states_proyecto_id", table_name="api_persistent_states")
    op.drop_table("api_persistent_states")

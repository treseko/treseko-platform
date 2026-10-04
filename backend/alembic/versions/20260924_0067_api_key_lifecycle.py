"""Add reversible lifecycle state to user API and MCP credentials."""

from alembic import op
import sqlalchemy as sa


revision = "20260924_0067"
down_revision = "20260923_0066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("api_keys")}
    if "estado" not in columns:
        op.add_column(
            "api_keys",
            sa.Column("estado", sa.String(length=20), nullable=True),
        )
    bind.execute(
        sa.text(
            "UPDATE api_keys SET estado = CASE WHEN activo = TRUE THEN 'ACTIVE' ELSE 'REVOKED' END "
            "WHERE estado IS NULL"
        )
    )
    op.alter_column("api_keys", "estado", existing_type=sa.String(length=20), nullable=False, server_default="ACTIVE")
    indexes = {index["name"] for index in inspector.get_indexes("api_keys")}
    if "ix_api_keys_estado" not in indexes:
        op.create_index("ix_api_keys_estado", "api_keys", ["estado"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("api_keys")}
    if "ix_api_keys_estado" in indexes:
        op.drop_index("ix_api_keys_estado", table_name="api_keys")
    columns = {column["name"] for column in sa.inspect(bind).get_columns("api_keys")}
    if "estado" in columns:
        op.drop_column("api_keys", "estado")

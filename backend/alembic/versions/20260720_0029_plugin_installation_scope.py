"""protect plugin installations from concurrent duplicate scopes

Revision ID: 20260720_0029
Revises: 20260720_0028
"""
from alembic import op
import sqlalchemy as sa

revision = "20260720_0029"
down_revision = "20260720_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {item["name"] for item in inspector.get_columns("integration_instances")}
    if "scope_key" not in columns:
        op.add_column("integration_instances", sa.Column("scope_key", sa.String(length=180), nullable=True))
    op.execute("""
        UPDATE integration_instances
        SET scope_key = CASE
            WHEN proyecto_id IS NOT NULL THEN 'project:' || proyecto_id::text
            WHEN organizacion_id IS NOT NULL THEN 'organization:' || organizacion_id::text
            ELSE 'global'
        END
        WHERE scope_key IS NULL
    """)
    op.alter_column("integration_instances", "scope_key", nullable=False, server_default="global")
    inspector = sa.inspect(op.get_bind())
    indexes = {item["name"] for item in inspector.get_indexes("integration_instances")}
    if "ix_integration_instances_scope_key" not in indexes:
        op.create_index("ix_integration_instances_scope_key", "integration_instances", ["scope_key"])
    unique_constraints = {item.get("name") for item in inspector.get_unique_constraints("integration_instances")}
    if "uq_integration_instance_provider_scope" not in unique_constraints:
        op.create_unique_constraint("uq_integration_instance_provider_scope", "integration_instances", ["provider_id", "scope_key"])


def downgrade() -> None:
    op.drop_constraint("uq_integration_instance_provider_scope", "integration_instances", type_="unique")
    op.drop_index("ix_integration_instances_scope_key", table_name="integration_instances")
    op.drop_column("integration_instances", "scope_key")

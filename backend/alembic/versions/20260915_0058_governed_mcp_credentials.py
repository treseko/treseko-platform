"""add purpose, expiry and scopes to API credentials without losing legacy keys"""

from alembic import op
import sqlalchemy as sa

revision = "20260915_0058"
# This revision was authored after the claim-intent revision.  Pointing at the
# old baseline created a second branch/head and could leave deployments with
# only half of the security schema applied.
down_revision = "20260909_0062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {column["name"] for column in inspector.get_columns("api_keys")}
    if "purpose" not in existing:
        op.add_column("api_keys", sa.Column("purpose", sa.String(length=30), nullable=True))
        op.execute(sa.text("UPDATE api_keys SET purpose = 'legacy' WHERE purpose IS NULL"))
        op.alter_column("api_keys", "purpose", nullable=False, server_default="legacy")
    if "expires_at" not in existing:
        op.add_column("api_keys", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    if "scopes_json" not in existing:
        op.add_column("api_keys", sa.Column("scopes_json", sa.JSON(), nullable=True))
        op.execute(sa.text("UPDATE api_keys SET scopes_json = '[]' WHERE scopes_json IS NULL"))
        op.alter_column("api_keys", "scopes_json", nullable=False, server_default="[]")
    op.create_index("ix_api_keys_purpose", "api_keys", ["purpose"], if_not_exists=True)
    op.create_index("ix_api_keys_expires_at", "api_keys", ["expires_at"], if_not_exists=True)


def downgrade() -> None:
    # A downgrade is destructive: never silently erase credential governance
    # data.  Operators must restore a coordinated pre-migration backup when
    # api_keys is populated; an empty table is safe to roll back.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("api_keys"):
        return
    if bind.execute(sa.text("SELECT 1 FROM api_keys LIMIT 1")).first():
        raise RuntimeError("Cannot downgrade populated api_keys; restore a coordinated backup")
    indexes = {index["name"] for index in inspector.get_indexes("api_keys")}
    for name in ("ix_api_keys_expires_at", "ix_api_keys_purpose"):
        if name in indexes:
            op.drop_index(name, table_name="api_keys")
    columns = {column["name"] for column in inspector.get_columns("api_keys")}
    for name in ("scopes_json", "expires_at", "purpose"):
        if name in columns:
            op.drop_column("api_keys", name)

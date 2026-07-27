"""secure global AI provider profiles and workflow policy

Revision ID: 20260722_0034
Revises: 20260721_0033
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260722_0034"
down_revision = "20260721_0033"
branch_labels = None
depends_on = None
uuid = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("ai_provider_credentials"):
        op.create_table(
            "ai_provider_credentials",
            sa.Column("id", uuid, primary_key=True),
            sa.Column("provider", sa.String(80), nullable=False),
            sa.Column("label", sa.String(160), nullable=False),
            sa.Column("secret_value_encrypted", sa.Text(), nullable=False),
            sa.Column("key_id", sa.String(80), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        )
        op.create_index("ix_ai_provider_credentials_provider", "ai_provider_credentials", ["provider"])
        op.create_index("ix_ai_provider_credentials_active", "ai_provider_credentials", ["active"])
        op.create_index("ix_ai_provider_credentials_created_by", "ai_provider_credentials", ["created_by"])
    if not inspector.has_table("ai_provider_profiles"):
        op.create_table(
            "ai_provider_profiles",
            sa.Column("id", uuid, primary_key=True),
            sa.Column("name", sa.String(160), nullable=False, unique=True),
            sa.Column("provider", sa.String(80), nullable=False),
            sa.Column("adapter", sa.String(80), nullable=False),
            sa.Column("endpoint", sa.String(500), nullable=False),
            sa.Column("model", sa.String(160), nullable=False),
            sa.Column("credential_id", uuid, sa.ForeignKey("ai_provider_credentials.id", ondelete="RESTRICT")),
            sa.Column("capabilities_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("capability_status", sa.String(20), nullable=False, server_default="unknown"),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("request_timeout_seconds", sa.Integer(), nullable=False, server_default="300"),
            sa.Column("max_retries", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("max_input_tokens", sa.Integer()),
            sa.Column("max_output_tokens", sa.Integer()),
            sa.Column("created_by", uuid, sa.ForeignKey("usuarios.id", ondelete="SET NULL")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        )
        op.create_index("ix_ai_provider_profiles_provider", "ai_provider_profiles", ["provider"])
        op.create_index("ix_ai_provider_profiles_name", "ai_provider_profiles", ["name"], unique=True)
        op.create_index("ix_ai_provider_profiles_adapter", "ai_provider_profiles", ["adapter"])
        op.create_index("ix_ai_provider_profiles_credential_id", "ai_provider_profiles", ["credential_id"])
        op.create_index("ix_ai_provider_profiles_capability_status", "ai_provider_profiles", ["capability_status"])
        op.create_index("ix_ai_provider_profiles_enabled", "ai_provider_profiles", ["enabled"])
        op.create_index("ix_ai_provider_profiles_created_by", "ai_provider_profiles", ["created_by"])
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("ai_workflows")}
    if "provider_profile_id" not in columns:
        op.add_column("ai_workflows", sa.Column("provider_profile_id", uuid, sa.ForeignKey("ai_provider_profiles.id", ondelete="SET NULL")))
        op.create_index("ix_ai_workflows_provider_profile_id", "ai_workflows", ["provider_profile_id"])
    if "fallback_profile_ids" not in columns:
        op.add_column("ai_workflows", sa.Column("fallback_profile_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))
    if "decision_policy_json" not in columns:
        op.add_column("ai_workflows", sa.Column("decision_policy_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("ai_workflows")}
    for name in ("decision_policy_json", "fallback_profile_ids", "provider_profile_id"):
        if name in columns:
            op.drop_column("ai_workflows", name)
    if inspector.has_table("ai_provider_profiles"):
        op.drop_table("ai_provider_profiles")
    if inspector.has_table("ai_provider_credentials"):
        op.drop_table("ai_provider_credentials")

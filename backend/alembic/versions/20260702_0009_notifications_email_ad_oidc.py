"""notifications email and ad oidc

Revision ID: 20260702_0009
Revises: 20260702_0008
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260702_0009"
down_revision = "20260702_0008"
branch_labels = None
depends_on = None


uuid_type = postgresql.UUID(as_uuid=True)


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _index_names(table_name: str) -> set[str]:
    if table_name not in _table_names():
        return set()
    return {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table_name)}


def _safe_create_table(table_name: str, *columns, **kwargs) -> None:
    if table_name in _table_names():
        return
    op.create_table(table_name, *columns, **kwargs)


def _safe_create_index(index_name: str, table_name: str, columns: list[str]) -> None:
    if index_name in _index_names(table_name):
        return
    op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    _safe_create_table(
        "notification_events",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("proyecto_id", uuid_type, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True),
        sa.Column("organizacion_id", uuid_type, sa.ForeignKey("organizaciones.id", ondelete="CASCADE"), nullable=True),
        sa.Column("actor_user_id", uuid_type, sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", uuid_type, nullable=True),
        sa.Column("severity", sa.String(length=30), nullable=False, server_default="info"),
        sa.Column("payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("dedupe_key", sa.String(length=255), nullable=True),
        sa.Column("correlation_id", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=30), server_default="PENDING", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
    )
    for name, cols in {
        "ix_notification_events_event_type": ["event_type"],
        "ix_notification_events_proyecto_id": ["proyecto_id"],
        "ix_notification_events_created_at": ["created_at"],
        "ix_notification_events_status": ["status"],
        "ix_notification_events_dedupe_key": ["dedupe_key"],
        "ix_notification_events_correlation_id": ["correlation_id"],
        "ix_notification_events_entity_id": ["entity_id"],
        "ix_notification_events_actor_user_id": ["actor_user_id"],
    }.items():
        _safe_create_index(name, "notification_events", cols)

    _safe_create_table(
        "notification_templates",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("key", sa.String(length=120), nullable=False, unique=True),
        sa.Column("nombre", sa.String(length=150), nullable=False),
        sa.Column("channel", sa.String(length=30), nullable=False),
        sa.Column("subject_template", sa.Text(), nullable=True),
        sa.Column("text_template", sa.Text(), nullable=False),
        sa.Column("html_template", sa.Text(), nullable=True),
        sa.Column("allowed_variables", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", uuid_type, sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    _safe_create_index("ix_notification_templates_key", "notification_templates", ["key"])
    _safe_create_index("ix_notification_templates_channel", "notification_templates", ["channel"])

    _safe_create_table(
        "notification_rules",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("nombre", sa.String(length=150), nullable=False),
        sa.Column("descripcion", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("scope", sa.String(length=30), nullable=False, server_default="GLOBAL"),
        sa.Column("organizacion_id", uuid_type, sa.ForeignKey("organizaciones.id", ondelete="CASCADE"), nullable=True),
        sa.Column("proyecto_id", uuid_type, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True),
        sa.Column("event_types", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("conditions_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("actions_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("recipient_strategy_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("template_id", uuid_type, sa.ForeignKey("notification_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("cooldown_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("created_by", uuid_type, sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    for name, cols in {
        "ix_notification_rules_enabled": ["enabled"],
        "ix_notification_rules_scope": ["scope"],
        "ix_notification_rules_organizacion_id": ["organizacion_id"],
        "ix_notification_rules_proyecto_id": ["proyecto_id"],
        "ix_notification_rules_template_id": ["template_id"],
        "ix_notification_rules_priority": ["priority"],
    }.items():
        _safe_create_index(name, "notification_rules", cols)

    _safe_create_table(
        "notification_inbox",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("user_id", uuid_type, sa.ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", uuid_type, sa.ForeignKey("notification_events.id", ondelete="SET NULL"), nullable=True),
        sa.Column("proyecto_id", uuid_type, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("link_url", sa.Text(), nullable=True),
        sa.Column("severity", sa.String(length=30), nullable=False, server_default="info"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    for name, cols in {
        "ix_notification_inbox_user_id": ["user_id"],
        "ix_notification_inbox_event_id": ["event_id"],
        "ix_notification_inbox_proyecto_id": ["proyecto_id"],
        "ix_notification_inbox_read_at": ["read_at"],
        "ix_notification_inbox_created_at": ["created_at"],
    }.items():
        _safe_create_index(name, "notification_inbox", cols)

    _safe_create_table(
        "notification_deliveries",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("event_id", uuid_type, sa.ForeignKey("notification_events.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rule_id", uuid_type, sa.ForeignKey("notification_rules.id", ondelete="SET NULL"), nullable=True),
        sa.Column("template_id", uuid_type, sa.ForeignKey("notification_templates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("channel", sa.String(length=30), nullable=False),
        sa.Column("recipient_user_id", uuid_type, sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("recipient_email", sa.String(length=255), nullable=True),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("body_html", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="PENDING"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("provider_message_id", sa.String(length=255), nullable=True),
        sa.Column("dedupe_key", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    for name, cols in {
        "ix_notification_deliveries_event_id": ["event_id"],
        "ix_notification_deliveries_rule_id": ["rule_id"],
        "ix_notification_deliveries_template_id": ["template_id"],
        "ix_notification_deliveries_channel": ["channel"],
        "ix_notification_deliveries_recipient_user_id": ["recipient_user_id"],
        "ix_notification_deliveries_recipient_email": ["recipient_email"],
        "ix_notification_deliveries_status": ["status"],
        "ix_notification_deliveries_next_attempt_at": ["next_attempt_at"],
        "ix_notification_deliveries_dedupe_key": ["dedupe_key"],
        "ix_notification_deliveries_created_at": ["created_at"],
    }.items():
        _safe_create_index(name, "notification_deliveries", cols)

    _safe_create_table(
        "notification_preferences",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("user_id", uuid_type, sa.ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(length=120), nullable=True),
        sa.Column("channel", sa.String(length=30), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("frequency", sa.String(length=30), nullable=False, server_default="immediate"),
        sa.Column("quiet_hours_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("user_id", "event_type", "channel", name="uq_notification_preference_user_event_channel"),
    )
    _safe_create_index("ix_notification_preferences_user_id", "notification_preferences", ["user_id"])
    _safe_create_index("ix_notification_preferences_event_type", "notification_preferences", ["event_type"])
    _safe_create_index("ix_notification_preferences_channel", "notification_preferences", ["channel"])

    _safe_create_table(
        "auth_ad_login_states",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("state", sa.String(length=255), nullable=False, unique=True),
        sa.Column("nonce", sa.String(length=255), nullable=False),
        sa.Column("return_to", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ip_address", sa.String(length=80), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
    )
    _safe_create_index("ix_auth_ad_login_states_state", "auth_ad_login_states", ["state"])
    _safe_create_index("ix_auth_ad_login_states_nonce", "auth_ad_login_states", ["nonce"])
    _safe_create_index("ix_auth_ad_login_states_expires_at", "auth_ad_login_states", ["expires_at"])

    _safe_create_table(
        "auth_ad_exchange_codes",
        sa.Column("id", uuid_type, primary_key=True),
        sa.Column("code_hash", sa.String(length=128), nullable=False, unique=True),
        sa.Column("usuario_id", uuid_type, sa.ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    _safe_create_index("ix_auth_ad_exchange_codes_code_hash", "auth_ad_exchange_codes", ["code_hash"])
    _safe_create_index("ix_auth_ad_exchange_codes_usuario_id", "auth_ad_exchange_codes", ["usuario_id"])
    _safe_create_index("ix_auth_ad_exchange_codes_expires_at", "auth_ad_exchange_codes", ["expires_at"])


def downgrade() -> None:
    op.drop_table("auth_ad_exchange_codes")
    op.drop_table("auth_ad_login_states")
    op.drop_table("notification_preferences")
    op.drop_table("notification_deliveries")
    op.drop_table("notification_inbox")
    op.drop_table("notification_rules")
    op.drop_table("notification_templates")
    op.drop_table("notification_events")

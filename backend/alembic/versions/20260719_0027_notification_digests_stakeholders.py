"""notification digest recipients and welcome invitations

Revision ID: 20260719_0027
Revises: 20260719_0026
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260719_0027"
down_revision = "20260719_0026"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _create_index(name: str, table: str, columns: list[str]) -> None:
    if table not in _tables():
        return
    indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table)}
    if name not in indexes:
        op.create_index(name, table, columns)


def upgrade() -> None:
    tables = _tables()
    if "notification_stakeholders" not in tables:
        op.create_table(
            "notification_stakeholders",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("proyecto_id", UUID, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
            sa.Column("nombre", sa.String(160), nullable=False),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("allowed_event_types", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("consent_source", sa.String(255), nullable=False, server_default="manual"),
            sa.Column("created_by", UUID, sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("proyecto_id", "email", name="uq_notification_stakeholder_project_email"),
        )
    for name, columns in {
        "ix_notification_stakeholders_proyecto_id": ["proyecto_id"],
        "ix_notification_stakeholders_email": ["email"],
        "ix_notification_stakeholders_active": ["active"],
        "ix_notification_stakeholders_created_by": ["created_by"],
        "ix_notification_stakeholders_created_at": ["created_at"],
    }.items():
        _create_index(name, "notification_stakeholders", columns)

    tables = _tables()
    if "notification_recipient_subscriptions" not in tables:
        op.create_table(
            "notification_recipient_subscriptions",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("user_id", UUID, sa.ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=True),
            sa.Column("stakeholder_id", UUID, sa.ForeignKey("notification_stakeholders.id", ondelete="CASCADE"), nullable=True),
            sa.Column("proyecto_id", UUID, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True),
            sa.Column("event_type", sa.String(120), nullable=True),
            sa.Column("channel", sa.String(30), nullable=False, server_default="email"),
            sa.Column("frequency", sa.String(30), nullable=False, server_default="daily"),
            sa.Column("timezone", sa.String(80), nullable=False, server_default="UTC"),
            sa.Column("send_hour", sa.Integer(), nullable=False, server_default="9"),
            sa.Column("send_day", sa.Integer(), nullable=True),
            sa.Column("muted_until", sa.DateTime(timezone=True), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )
    for name, columns in {
        "ix_notification_recipient_subscriptions_user_id": ["user_id"],
        "ix_notification_recipient_subscriptions_stakeholder_id": ["stakeholder_id"],
        "ix_notification_recipient_subscriptions_proyecto_id": ["proyecto_id"],
        "ix_notification_recipient_subscriptions_event_type": ["event_type"],
    }.items():
        _create_index(name, "notification_recipient_subscriptions", columns)

    tables = _tables()
    if "notification_digests" not in tables:
        op.create_table(
            "notification_digests",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("recipient_user_id", UUID, sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
            sa.Column("stakeholder_id", UUID, sa.ForeignKey("notification_stakeholders.id", ondelete="SET NULL"), nullable=True),
            sa.Column("recipient_email", sa.String(255), nullable=False),
            sa.Column("proyecto_id", UUID, sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True),
            sa.Column("frequency", sa.String(30), nullable=False),
            sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
            sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
            sa.Column("status", sa.String(30), nullable=False, server_default="PENDING"),
            sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("delivery_id", UUID, sa.ForeignKey("notification_deliveries.id", ondelete="SET NULL"), nullable=True),
            sa.Column("dedupe_key", sa.String(255), nullable=False, unique=True),
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )
    for name, columns in {
        "ix_notification_digests_recipient_user_id": ["recipient_user_id"],
        "ix_notification_digests_stakeholder_id": ["stakeholder_id"],
        "ix_notification_digests_recipient_email": ["recipient_email"],
        "ix_notification_digests_proyecto_id": ["proyecto_id"],
        "ix_notification_digests_frequency": ["frequency"],
        "ix_notification_digests_period_start": ["period_start"],
        "ix_notification_digests_period_end": ["period_end"],
        "ix_notification_digests_status": ["status"],
        "ix_notification_digests_scheduled_for": ["scheduled_for"],
        "ix_notification_digests_dedupe_key": ["dedupe_key"],
    }.items():
        _create_index(name, "notification_digests", columns)

    tables = _tables()
    if "notification_digest_items" not in tables:
        op.create_table(
            "notification_digest_items",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("digest_id", UUID, sa.ForeignKey("notification_digests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("event_id", UUID, sa.ForeignKey("notification_events.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("digest_id", "event_id", name="uq_notification_digest_item"),
        )
    _create_index("ix_notification_digest_items_digest_id", "notification_digest_items", ["digest_id"])
    _create_index("ix_notification_digest_items_event_id", "notification_digest_items", ["event_id"])

    tables = _tables()
    if "notification_welcome_invitations" not in tables:
        op.create_table(
            "notification_welcome_invitations",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("user_id", UUID, sa.ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False),
            sa.Column("token_hash", sa.String(128), nullable=False, unique=True),
            sa.Column("auth_provider", sa.String(50), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", UUID, sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
    for name, columns in {
        "ix_notification_welcome_invitations_user_id": ["user_id"],
        "ix_notification_welcome_invitations_token_hash": ["token_hash"],
        "ix_notification_welcome_invitations_expires_at": ["expires_at"],
    }.items():
        _create_index(name, "notification_welcome_invitations", columns)


def downgrade() -> None:
    for table in (
        "notification_welcome_invitations",
        "notification_digest_items",
        "notification_digests",
        "notification_recipient_subscriptions",
        "notification_stakeholders",
    ):
        if table in _tables():
            op.drop_table(table)

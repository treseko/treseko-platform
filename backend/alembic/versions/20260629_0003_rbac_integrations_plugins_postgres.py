"""Add integration/plugin registry foundation.

Revision ID: 20260629_0003
Revises: 20260629_0002
Create Date: 2026-06-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "20260629_0003"
down_revision = "20260629_0002"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    if not _has_column("usuarios", "permisos_detallados"):
        op.add_column("usuarios", sa.Column("permisos_detallados", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    if not _has_column("roles_personalizados", "permisos_detallados"):
        op.add_column("roles_personalizados", sa.Column("permisos_detallados", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))

    if not _has_table("integration_providers"):
        op.create_table(
            "integration_providers",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("provider_id", sa.String(100), nullable=False),
            sa.Column("kind", sa.String(30), nullable=False, server_default="integration"),
            sa.Column("display_name", sa.String(150), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="planned"),
            sa.Column("capabilities", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            *_timestamps(),
            sa.UniqueConstraint("provider_id", name="uq_integration_providers_provider_id"),
        )
        op.create_index("ix_integration_providers_provider_id", "integration_providers", ["provider_id"])

    if not _has_table("plugin_providers"):
        op.create_table(
            "plugin_providers",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("plugin_id", sa.String(100), nullable=False),
            sa.Column("display_name", sa.String(150), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="planned"),
            sa.Column("version", sa.String(50), nullable=True),
            sa.Column("capabilities", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
            sa.Column("manifest_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            *_timestamps(),
            sa.UniqueConstraint("plugin_id", name="uq_plugin_providers_plugin_id"),
        )
        op.create_index("ix_plugin_providers_plugin_id", "plugin_providers", ["plugin_id"])

    if not _has_table("integration_instances"):
        op.create_table(
            "integration_instances",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("provider_id", sa.String(100), nullable=False),
            sa.Column("organizacion_id", UUID(as_uuid=True), sa.ForeignKey("organizaciones.id", ondelete="SET NULL"), nullable=True),
            sa.Column("proyecto_id", UUID(as_uuid=True), sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("config_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("secrets_configured", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("status", sa.String(30), nullable=False, server_default="disabled"),
            sa.Column("last_check_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_integration_instances_provider_id", "integration_instances", ["provider_id"])
        op.create_index("ix_integration_instances_organizacion_id", "integration_instances", ["organizacion_id"])
        op.create_index("ix_integration_instances_proyecto_id", "integration_instances", ["proyecto_id"])
        op.create_index("ix_integration_instances_created_by", "integration_instances", ["created_by"])

    if not _has_table("integration_secrets"):
        op.create_table(
            "integration_secrets",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("integration_instance_id", UUID(as_uuid=True), sa.ForeignKey("integration_instances.id", ondelete="CASCADE"), nullable=False),
            sa.Column("secret_key", sa.String(100), nullable=False),
            sa.Column("secret_value_encrypted", sa.Text(), nullable=False),
            *_timestamps(),
            sa.UniqueConstraint("integration_instance_id", "secret_key", name="uq_integration_secret_key"),
        )
        op.create_index("ix_integration_secrets_integration_instance_id", "integration_secrets", ["integration_instance_id"])

    if not _has_table("external_issue_links"):
        op.create_table(
            "external_issue_links",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("provider_id", sa.String(100), nullable=False),
            sa.Column("proyecto_id", UUID(as_uuid=True), sa.ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False),
            sa.Column("build_id", UUID(as_uuid=True), sa.ForeignKey("builds.id", ondelete="SET NULL"), nullable=True),
            sa.Column("test_run_id", UUID(as_uuid=True), sa.ForeignKey("test_runs.id", ondelete="SET NULL"), nullable=True),
            sa.Column("ejecucion_id", UUID(as_uuid=True), sa.ForeignKey("ejecuciones_casos.id", ondelete="SET NULL"), nullable=True),
            sa.Column("snapshot_id", UUID(as_uuid=True), sa.ForeignKey("snapshots_pasos.id", ondelete="SET NULL"), nullable=True),
            sa.Column("external_issue_id", sa.String(150), nullable=False),
            sa.Column("external_issue_url", sa.Text(), nullable=True),
            sa.Column("dedupe_hash", sa.String(128), nullable=True),
            sa.Column("status", sa.String(30), nullable=False, server_default="linked"),
            sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_external_issue_links_provider_id", "external_issue_links", ["provider_id"])
        op.create_index("ix_external_issue_links_proyecto_id", "external_issue_links", ["proyecto_id"])
        op.create_index("ix_external_issue_links_dedupe_hash", "external_issue_links", ["dedupe_hash"])

    if not _has_table("webhook_events"):
        op.create_table(
            "webhook_events",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("provider_id", sa.String(100), nullable=False),
            sa.Column("event_type", sa.String(100), nullable=False),
            sa.Column("external_event_id", sa.String(150), nullable=True),
            sa.Column("payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("signature_valid", sa.Boolean(), nullable=True),
            sa.Column("processed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_webhook_events_provider_id", "webhook_events", ["provider_id"])
        op.create_index("ix_webhook_events_external_event_id", "webhook_events", ["external_event_id"])


def downgrade() -> None:
    # Non-destructive by policy for local/dev data.
    pass

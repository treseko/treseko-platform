"""Add system update history tables.

Revision ID: 20260709_0016
Revises: 20260709_0015
Create Date: 2026-07-09
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260709_0016"
down_revision = "20260709_0015"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _json_type():
    return postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite")


def upgrade() -> None:
    if not _has_table("system_update_tasks"):
        op.create_table(
            "system_update_tasks",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("task_id", sa.String(length=80), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False),
            sa.Column("channel", sa.String(length=80), nullable=False),
            sa.Column("version", sa.String(length=80), nullable=True),
            sa.Column("previous_version", sa.String(length=80), nullable=True),
            sa.Column("stage", sa.String(length=80), nullable=True),
            sa.Column("progress_pct", sa.Integer(), server_default="0", nullable=False),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("initiated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("initiated_by_email", sa.String(length=255), nullable=True),
            sa.Column("initiated_from_ip", sa.String(length=80), nullable=True),
            sa.Column("apply_confirmation", sa.String(length=80), nullable=True),
            sa.Column("rollback_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("rollback_by_email", sa.String(length=255), nullable=True),
            sa.Column("rollback_from_ip", sa.String(length=80), nullable=True),
            sa.Column("rollback_requested_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rollback_confirmation", sa.String(length=80), nullable=True),
            sa.Column("rollback_restore_database", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("backup_path", sa.Text(), nullable=True),
            sa.Column("rollback_path", sa.Text(), nullable=True),
            sa.Column("package_path", sa.Text(), nullable=True),
            sa.Column("extracted_path", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("payload", _json_type(), server_default=sa.text("'{}'"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["initiated_by_user_id"], ["usuarios.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["rollback_by_user_id"], ["usuarios.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("task_id", name="uq_system_update_tasks_task_id"),
        )
    if not _has_table("system_update_events"):
        op.create_table(
            "system_update_events",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("task_id", sa.String(length=80), nullable=False),
            sa.Column("event_index", sa.Integer(), nullable=False),
            sa.Column("event", sa.String(length=80), nullable=False),
            sa.Column("stage", sa.String(length=80), nullable=True),
            sa.Column("status", sa.String(length=40), nullable=True),
            sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("actor_email", sa.String(length=255), nullable=True),
            sa.Column("ip_address", sa.String(length=80), nullable=True),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("details", _json_type(), server_default=sa.text("'{}'"), nullable=False),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("payload", _json_type(), server_default=sa.text("'{}'"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["system_update_tasks.task_id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["actor_user_id"], ["usuarios.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("task_id", "event_index", name="uq_system_update_events_task_index"),
        )
    for name, table, columns in [
        ("ix_system_update_tasks_task_id", "system_update_tasks", ["task_id"]),
        ("ix_system_update_tasks_status", "system_update_tasks", ["status"]),
        ("ix_system_update_tasks_channel", "system_update_tasks", ["channel"]),
        ("ix_system_update_tasks_version", "system_update_tasks", ["version"]),
        ("ix_system_update_tasks_stage", "system_update_tasks", ["stage"]),
        ("ix_system_update_tasks_started_at", "system_update_tasks", ["started_at"]),
        ("ix_system_update_tasks_completed_at", "system_update_tasks", ["completed_at"]),
        ("ix_system_update_tasks_initiated_by_user_id", "system_update_tasks", ["initiated_by_user_id"]),
        ("ix_system_update_tasks_rollback_by_user_id", "system_update_tasks", ["rollback_by_user_id"]),
        ("ix_system_update_tasks_rollback_requested_at", "system_update_tasks", ["rollback_requested_at"]),
        ("ix_system_update_tasks_started_status", "system_update_tasks", ["started_at", "status"]),
        ("ix_system_update_events_task_id", "system_update_events", ["task_id"]),
        ("ix_system_update_events_event", "system_update_events", ["event"]),
        ("ix_system_update_events_stage", "system_update_events", ["stage"]),
        ("ix_system_update_events_status", "system_update_events", ["status"]),
        ("ix_system_update_events_actor_user_id", "system_update_events", ["actor_user_id"]),
        ("ix_system_update_events_occurred_at", "system_update_events", ["occurred_at"]),
        ("ix_system_update_events_task_occurred", "system_update_events", ["task_id", "occurred_at"]),
    ]:
        if not _has_index(table, name):
            op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table in [
        ("ix_system_update_events_task_occurred", "system_update_events"),
        ("ix_system_update_events_occurred_at", "system_update_events"),
        ("ix_system_update_events_actor_user_id", "system_update_events"),
        ("ix_system_update_events_status", "system_update_events"),
        ("ix_system_update_events_stage", "system_update_events"),
        ("ix_system_update_events_event", "system_update_events"),
        ("ix_system_update_events_task_id", "system_update_events"),
        ("ix_system_update_tasks_started_status", "system_update_tasks"),
        ("ix_system_update_tasks_rollback_requested_at", "system_update_tasks"),
        ("ix_system_update_tasks_rollback_by_user_id", "system_update_tasks"),
        ("ix_system_update_tasks_initiated_by_user_id", "system_update_tasks"),
        ("ix_system_update_tasks_completed_at", "system_update_tasks"),
        ("ix_system_update_tasks_started_at", "system_update_tasks"),
        ("ix_system_update_tasks_stage", "system_update_tasks"),
        ("ix_system_update_tasks_version", "system_update_tasks"),
        ("ix_system_update_tasks_channel", "system_update_tasks"),
        ("ix_system_update_tasks_status", "system_update_tasks"),
        ("ix_system_update_tasks_task_id", "system_update_tasks"),
    ]:
        if _has_index(table, name):
            op.drop_index(name, table_name=table)
    if _has_table("system_update_events"):
        op.drop_table("system_update_events")
    if _has_table("system_update_tasks"):
        op.drop_table("system_update_tasks")

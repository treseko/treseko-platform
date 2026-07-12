"""Expand attachment MIME types for QA evidence.

Revision ID: 20260702_0006
Revises: 20260702_0005
Create Date: 2026-07-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260702_0006"
down_revision = "20260702_0005"
branch_labels = None
depends_on = None


EVIDENCE_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/json",
    "application/xml",
    "text/xml",
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "video/mp4",
    "video/webm",
    "application/octet-stream",
]


def upgrade() -> None:
    bind = op.get_bind()
    settings = sa.table(
        "app_settings",
        sa.column("key", sa.String()),
        sa.column("value", sa.JSON()),
    )
    row = bind.execute(sa.select(settings.c.value).where(settings.c.key == "attachments")).first()
    if not row:
        return
    value = dict(row[0] or {})
    current = list(value.get("allowed_mime_types") or [])
    value["allowed_mime_types"] = list(dict.fromkeys(current + EVIDENCE_MIME_TYPES))
    bind.execute(
        settings.update()
        .where(settings.c.key == "attachments")
        .values(value=value)
    )


def downgrade() -> None:
    pass

"""Add archived case status.

Revision ID: 20260702_0007
Revises: 20260702_0006
Create Date: 2026-07-02
"""

from __future__ import annotations

from alembic import op


revision = "20260702_0007"
down_revision = "20260702_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE estadocaso ADD VALUE IF NOT EXISTS 'ARCHIVADO'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely without rebuilding the type.
    pass

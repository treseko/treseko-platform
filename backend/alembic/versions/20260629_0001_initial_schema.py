"""Initial schema baseline.

Revision ID: 20260629_0001
Revises:
Create Date: 2026-06-29
"""

from __future__ import annotations

from alembic import op


revision = "20260629_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.database import Base
    from app import models  # noqa: F401

    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    # Non-destructive baseline: do not drop existing application data.
    pass

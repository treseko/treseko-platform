"""Preserve first-run onboarding requirement on new installations.

Existing installations with data keep their historical implicit completion;
empty databases receive an explicit pending marker before users can create data.
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "20261015_0076"
down_revision = "20261010_0075"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    settings = sa.Table(
        "app_settings",
        sa.MetaData(),
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
    )
    existing = bind.execute(
        sa.select(settings.c.value).where(settings.c.key == "first_run_onboarding")
    ).scalar_one_or_none()
    if existing is not None:
        return

    has_data = False
    for table_name in ("organizaciones", "proyectos", "casos_prueba"):
        if sa.inspect(bind).has_table(table_name):
            count = bind.execute(sa.text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar_one()
            has_data = has_data or count > 0

    if has_data:
        now = datetime.now(timezone.utc).isoformat()
        value = {
            "completed": True,
            "completed_at": now,
            "completed_by_user_id": None,
            "completion_source": "existing_installation_data",
            "survey": None,
            "terms_accepted": False,
            "terms_version": None,
            "telemetry_opt_in": False,
            "onboarding_required": False,
        }
    else:
        value = {
            "completed": False,
            "completed_at": None,
            "completed_by_user_id": None,
            "completion_source": None,
            "survey": None,
            "terms_accepted": False,
            "terms_version": None,
            "telemetry_opt_in": False,
            "onboarding_required": True,
        }
    bind.execute(sa.insert(settings).values(key="first_run_onboarding", value=value))


def downgrade():
    # Keep user onboarding choices intact when rolling the code back.
    pass

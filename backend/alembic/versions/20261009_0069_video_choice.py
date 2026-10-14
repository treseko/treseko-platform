"""Persist recording choice for server scheduled missions."""
from alembic import op
import sqlalchemy as sa
revision = '20261009_0069'
down_revision = '20261009_0068'
branch_labels = None
depends_on = None

def upgrade():
    columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('ai_scheduled_missions')}
    if 'record_video' not in columns:
        op.add_column('ai_scheduled_missions', sa.Column('record_video', sa.Boolean(), nullable=False, server_default=sa.true()))

def downgrade():
    op.drop_column('ai_scheduled_missions', 'record_video')

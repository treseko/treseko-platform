"""Retain encrypted manual Chatbot execution inputs across turns."""
from alembic import op
import sqlalchemy as sa

revision = '20261010_0073'
down_revision = '20261010_0072'
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('ejecuciones_casos')}
    if 'chatbot_manual_context_secret' in columns:
        return
    op.add_column('ejecuciones_casos', sa.Column('chatbot_manual_context_secret', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('ejecuciones_casos', 'chatbot_manual_context_secret')

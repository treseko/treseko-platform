"""Preserve individual states during recursive suite archival."""
from alembic import op
import sqlalchemy as sa

revision = '20261010_0074'
down_revision = '20261010_0073'
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('suites')}
    if 'archive_snapshot' in columns:
        return
    op.add_column('suites', sa.Column('archive_snapshot', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('suites', 'archive_snapshot')

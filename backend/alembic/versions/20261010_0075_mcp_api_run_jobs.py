"""Durable MCP dispatch and workspace receipts; frozen migration definitions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '20261010_0075'
down_revision = '20261010_0074'
branch_labels = None
depends_on = None


def tables(bind):
    metadata = sa.MetaData()
    # Resolve existing foreign keys without importing mutable application models.
    for name in ('test_runs', 'usuarios'):
        sa.Table(name, metadata, autoload_with=bind)
    receipt = sa.Table('mcp_workspace_receipts', metadata,
        sa.Column('namespace', sa.String(100), primary_key=True),
        sa.Column('idempotency_key', sa.String(128), primary_key=True),
        sa.Column('fingerprint', sa.String(64), nullable=False),
        sa.Column('status', sa.String(30), nullable=False),
        sa.Column('result_json', sa.JSON()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    job = sa.Table('mcp_api_run_jobs', metadata,
        sa.Column('run_id', UUID(as_uuid=True), sa.ForeignKey('test_runs.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('usuarios.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('state', sa.String(30), nullable=False, index=True),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('owner_token', sa.String(64)),
        sa.Column('lease_expires_at', sa.DateTime(timezone=True), index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    return receipt, job


def upgrade():
    for table in tables(op.get_bind()):
        table.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    for name in ('mcp_api_run_jobs', 'mcp_workspace_receipts'):
        if sa.inspect(op.get_bind()).has_table(name):
            op.drop_table(name)

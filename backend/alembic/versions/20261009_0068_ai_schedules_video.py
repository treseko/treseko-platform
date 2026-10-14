"""Durable AI schedules and protected video references."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '20261009_0068'
down_revision = '20260924_0067'
branch_labels = None
depends_on = None


def _create_missions():
    op.create_table('ai_scheduled_missions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('proyecto_id', UUID(as_uuid=True), sa.ForeignKey('proyectos.id', ondelete='CASCADE'), nullable=False),
        sa.Column('build_id', UUID(as_uuid=True), sa.ForeignKey('builds.id', ondelete='CASCADE'), nullable=False),
        sa.Column('creado_por', UUID(as_uuid=True), sa.ForeignKey('usuarios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('nombre', sa.String(200), nullable=False),
        sa.Column('caso_ids', sa.JSON(), nullable=False),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('estado', sa.String(20), nullable=False),
        sa.Column('test_run_id', UUID(as_uuid=True), sa.ForeignKey('test_runs.id', ondelete='SET NULL')),
        sa.Column('error_message', sa.String(500)))
    op.create_index('ix_ai_missions_due', 'ai_scheduled_missions', ['estado', 'scheduled_at'])


def _create_videos():
    op.create_table('ai_video_recordings',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('proyecto_id', UUID(as_uuid=True), sa.ForeignKey('proyectos.id', ondelete='CASCADE'), nullable=False),
        sa.Column('execution_id', UUID(as_uuid=True), sa.ForeignKey('ejecuciones_casos.id', ondelete='CASCADE')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True)),
        sa.Column('size_bytes', sa.BigInteger(), nullable=False))
    for column in ('proyecto_id', 'execution_id', 'expires_at'):
        op.create_index(f'ix_ai_video_recordings_{column}', 'ai_video_recordings', [column])


def upgrade():
    # The initial baseline uses current model metadata on a fresh install.
    # Existing installations still need these tables created here.
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table('ai_scheduled_missions'):
        _create_missions()
    if not inspector.has_table('ai_video_recordings'):
        _create_videos()


def downgrade():
    op.drop_table('ai_video_recordings')
    op.drop_table('ai_scheduled_missions')

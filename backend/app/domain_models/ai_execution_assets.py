import uuid
from sqlalchemy import Column, String, ForeignKey, JSON, BigInteger, Index, Boolean
from sqlalchemy.dialects.postgresql import UUID
from ..database import Base
from ..time_utils import UTCDateTime, utc_now


class AiScheduledMission(Base):
    __tablename__ = 'ai_scheduled_missions'
    __table_args__ = (Index('ix_ai_missions_due', 'estado', 'scheduled_at'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey('proyectos.id', ondelete='CASCADE'), nullable=False)
    build_id = Column(UUID(as_uuid=True), ForeignKey('builds.id', ondelete='CASCADE'), nullable=False)
    creado_por = Column(UUID(as_uuid=True), ForeignKey('usuarios.id', ondelete='CASCADE'), nullable=False)
    nombre = Column(String(200), nullable=False)
    caso_ids = Column(JSON, nullable=False)
    record_video = Column(Boolean, nullable=False, default=True, server_default='true')
    scheduled_at = Column(UTCDateTime(), nullable=False)
    created_at = Column(UTCDateTime(), default=utc_now, nullable=False)
    estado = Column(String(20), default='PENDING', nullable=False)
    test_run_id = Column(UUID(as_uuid=True), ForeignKey('test_runs.id', ondelete='SET NULL'))
    error_message = Column(String(500))


class AiVideoRecording(Base):
    __tablename__ = 'ai_video_recordings'
    id = Column(UUID(as_uuid=True), primary_key=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey('proyectos.id', ondelete='CASCADE'), nullable=False, index=True)
    execution_id = Column(UUID(as_uuid=True), ForeignKey('ejecuciones_casos.id', ondelete='CASCADE'), index=True)
    created_at = Column(UTCDateTime(), default=utc_now, nullable=False)
    expires_at = Column(UTCDateTime(), index=True)
    size_bytes = Column(BigInteger, nullable=False)

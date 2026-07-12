import uuid

from sqlalchemy import Boolean, Column, Integer, String, Text, JSON, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from ..database import Base
from ..time_utils import UTCDateTime


class SystemUpdateTask(Base):
    __tablename__ = "system_update_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(String(80), unique=True, nullable=False, index=True)
    status = Column(String(40), nullable=False, index=True)
    channel = Column(String(80), nullable=False, index=True)
    version = Column(String(80), nullable=True, index=True)
    previous_version = Column(String(80), nullable=True)
    stage = Column(String(80), nullable=True, index=True)
    progress_pct = Column(Integer, default=0, nullable=False)
    message = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    initiated_by_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    initiated_by_email = Column(String(255), nullable=True)
    initiated_from_ip = Column(String(80), nullable=True)
    apply_confirmation = Column(String(80), nullable=True)
    rollback_by_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    rollback_by_email = Column(String(255), nullable=True)
    rollback_from_ip = Column(String(80), nullable=True)
    rollback_requested_at = Column(UTCDateTime(), nullable=True, index=True)
    rollback_confirmation = Column(String(80), nullable=True)
    rollback_restore_database = Column(Boolean, default=False, nullable=False)
    backup_path = Column(Text, nullable=True)
    rollback_path = Column(Text, nullable=True)
    package_path = Column(Text, nullable=True)
    extracted_path = Column(Text, nullable=True)
    started_at = Column(UTCDateTime(), nullable=True, index=True)
    completed_at = Column(UTCDateTime(), nullable=True, index=True)
    payload = Column(JSON, default=dict, nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_system_update_tasks_started_status", "started_at", "status"),
    )


class SystemUpdateEvent(Base):
    __tablename__ = "system_update_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(String(80), ForeignKey("system_update_tasks.task_id", ondelete="CASCADE"), nullable=False, index=True)
    event_index = Column(Integer, nullable=False)
    event = Column(String(80), nullable=False, index=True)
    stage = Column(String(80), nullable=True, index=True)
    status = Column(String(40), nullable=True, index=True)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_email = Column(String(255), nullable=True)
    ip_address = Column(String(80), nullable=True)
    message = Column(Text, nullable=True)
    details = Column(JSON, default=dict, nullable=False)
    occurred_at = Column(UTCDateTime(), nullable=True, index=True)
    payload = Column(JSON, default=dict, nullable=False)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("task_id", "event_index", name="uq_system_update_events_task_index"),
        Index("ix_system_update_events_task_occurred", "task_id", "occurred_at"),
    )

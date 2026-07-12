from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class ScheduledRun(Base):
    __tablename__ = "scheduled_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=False, index=True)
    suite_id = Column(UUID(as_uuid=True), ForeignKey("suites.id", ondelete="CASCADE"), nullable=False)
    nombre = Column(String(200), nullable=False)
    cron_expression = Column(String(100)) # e.g. "0 0 * * *"
    next_run = Column(UTCDateTime())
    activo = Column(Boolean, default=True)
    creado_por = Column(UUID(as_uuid=True))

    proyecto = relationship("Proyecto", back_populates="scheduled_runs")

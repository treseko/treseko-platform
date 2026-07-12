from sqlalchemy import Column, String, Boolean, Text, Integer, Float, ForeignKey, Enum, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import hashlib

from ..database import Base
from ..time_utils import UTCDateTime
from .enums import *

class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(JSON, nullable=False)
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

class NotificationEvent(Base):
    __tablename__ = "notification_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type = Column(String(120), nullable=False, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True, index=True)
    organizacion_id = Column(UUID(as_uuid=True), ForeignKey("organizaciones.id", ondelete="CASCADE"), nullable=True, index=True)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    entity_type = Column(String(80), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    severity = Column(String(30), default="info", nullable=False)
    payload_json = Column(JSON, default=dict, nullable=False)
    dedupe_key = Column(String(255), nullable=True, index=True)
    correlation_id = Column(String(120), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False, index=True)
    processed_at = Column(UTCDateTime(), nullable=True)
    status = Column(String(30), default="PENDING", nullable=False, index=True)
    error = Column(Text, nullable=True)

    proyecto = relationship("Proyecto")
    organizacion = relationship("Organizacion")
    actor = relationship("Usuario")

class NotificationRule(Base):
    __tablename__ = "notification_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nombre = Column(String(150), nullable=False)
    descripcion = Column(Text, nullable=True)
    enabled = Column(Boolean, default=True, nullable=False, index=True)
    scope = Column(String(30), default="GLOBAL", nullable=False, index=True)
    organizacion_id = Column(UUID(as_uuid=True), ForeignKey("organizaciones.id", ondelete="CASCADE"), nullable=True, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True, index=True)
    event_types = Column(JSON, default=list, nullable=False)
    conditions_json = Column(JSON, default=dict, nullable=False)
    actions_json = Column(JSON, default=dict, nullable=False)
    recipient_strategy_json = Column(JSON, default=dict, nullable=False)
    template_id = Column(UUID(as_uuid=True), ForeignKey("notification_templates.id", ondelete="SET NULL"), nullable=True, index=True)
    cooldown_minutes = Column(Integer, default=0, nullable=False)
    priority = Column(Integer, default=100, nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    template = relationship("NotificationTemplate")

class NotificationTemplate(Base):
    __tablename__ = "notification_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String(120), unique=True, nullable=False, index=True)
    nombre = Column(String(150), nullable=False)
    channel = Column(String(30), nullable=False, index=True)
    subject_template = Column(Text, nullable=True)
    text_template = Column(Text, nullable=False)
    html_template = Column(Text, nullable=True)
    allowed_variables = Column(JSON, default=list, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

class NotificationInbox(Base):
    __tablename__ = "notification_inbox"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("notification_events.id", ondelete="SET NULL"), nullable=True, index=True)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    link_url = Column(Text, nullable=True)
    severity = Column(String(30), default="info", nullable=False)
    read_at = Column(UTCDateTime(), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False, index=True)
    metadata_json = Column(JSON, default=dict, nullable=False)

    user = relationship("Usuario")
    event = relationship("NotificationEvent")

class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("notification_events.id", ondelete="SET NULL"), nullable=True, index=True)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("notification_rules.id", ondelete="SET NULL"), nullable=True, index=True)
    template_id = Column(UUID(as_uuid=True), ForeignKey("notification_templates.id", ondelete="SET NULL"), nullable=True, index=True)
    channel = Column(String(30), nullable=False, index=True)
    recipient_user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    recipient_email = Column(String(255), nullable=True, index=True)
    subject = Column(Text, nullable=True)
    body_text = Column(Text, nullable=True)
    body_html = Column(Text, nullable=True)
    status = Column(String(30), default="PENDING", nullable=False, index=True)
    attempt_count = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=5, nullable=False)
    next_attempt_at = Column(UTCDateTime(), nullable=True, index=True)
    last_attempt_at = Column(UTCDateTime(), nullable=True)
    sent_at = Column(UTCDateTime(), nullable=True)
    error = Column(Text, nullable=True)
    provider_message_id = Column(String(255), nullable=True)
    dedupe_key = Column(String(255), nullable=True, index=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())
    metadata_json = Column(JSON, default=dict, nullable=False)

    event = relationship("NotificationEvent")
    recipient_user = relationship("Usuario")

class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(120), nullable=True, index=True)
    channel = Column(String(30), nullable=False, index=True)
    enabled = Column(Boolean, default=True, nullable=False)
    frequency = Column(String(30), default="immediate", nullable=False)
    quiet_hours_json = Column(JSON, nullable=True)
    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
    updated_at = Column(UTCDateTime(), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("user_id", "event_type", "channel", name="uq_notification_preference_user_event_channel"),)

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...time_utils import utc_now
from . import digest_service
from .event_payload_and_seeds import (
    ADMINISTRATIVE_EVENT_TYPES,
    DEFAULT_TEMPLATE_VARIABLES,
    REDACTED_NOTIFICATION_SECRET,
    SECURITY_EVENT_TYPES,
    SEED_RULES,
    SEED_TEMPLATES,
    ensure_notification_seeds,
    sanitize_notification_payload,
)
from .recipient_resolver import recipient_frequency, recipient_schedule, resolve_recipients, user_allows_channel
from .rules_engine import rule_matches
from .template_renderer import render_html_template, render_text_template


def _notification_type_for_event(event_type: str) -> str:
    if event_type in ADMINISTRATIVE_EVENT_TYPES:
        return "ADMINISTRATIVA"
    if event_type in SECURITY_EVENT_TYPES:
        return "SEGURIDAD"
    if event_type.startswith("ai."):
        return "IA"
    if event_type.startswith("execution.") or event_type.startswith("bug."):
        return "CALIDAD"
    if event_type.startswith("report."):
        return "REPORTE"
    return "PROYECTO"


def _short_entity_name(value: Any, fallback: str = "") -> str:
    if not isinstance(value, dict):
        return fallback
    return str(value.get("nombre") or value.get("titulo") or value.get("codigo") or fallback).strip()


def inbox_presentation_from_event(
    event: models.NotificationEvent,
    *,
    actor_name: str | None = None,
    fallback_title: str | None = None,
    fallback_message: str | None = None,
) -> tuple[str, str, str | None, str]:
    """Return safe, human-facing inbox text without leaking technical payloads."""
    payload = event.payload_json or {}
    bug = payload.get("bug") or {}
    user = payload.get("user") or {}
    role = payload.get("role") or {}
    build = payload.get("build") or {}
    project = payload.get("proyecto") or {}
    event_type = event.event_type
    subject = _short_entity_name(user, "un usuario")
    project_name = _short_entity_name(project)

    # Existing domain events use heterogeneous payloads.  Keep this mapping
    # centralized rather than exposing event identifiers in the UI.
    mapping = {
        "user.created": ("Usuario creado", f"Se creó la cuenta de {subject}."),
        "user.disabled": ("Usuario desactivado", f"Se desactivó la cuenta de {subject}."),
        "user.role_changed": ("Permisos de usuario actualizados", f"Se actualizaron el rol o los permisos de {subject}."),
        "role.permissions_changed": ("Permisos de rol actualizados", f"Se actualizaron los permisos de {_short_entity_name(role, 'un rol')}."),
        "project.member_added": ("Miembro agregado al proyecto", "Se actualizó el equipo del proyecto."),
        "project.member_removed": ("Miembro removido del proyecto", "Se actualizó el equipo del proyecto."),
        "build.activated": ("Build activada", f"{_short_entity_name(build, 'La build')} está disponible."),
        "build.closed": ("Build cerrada", f"{_short_entity_name(build, 'La build')} fue cerrada."),
        "auth.login_failed_many": ("Intentos de acceso detectados", "Se detectaron múltiples intentos de inicio de sesión fallidos."),
        "evidence.required_missing": ("Falta evidencia requerida", "Una ejecución requiere evidencia antes de poder completarse."),
        "automation.runner.offline": ("Runner de automatización sin conexión", "Un runner requiere atención."),
        "ai.engine.unavailable": ("Motor de IA no disponible", "El motor de IA no pudo atender una solicitud."),
        "ai.execution.review_required": ("Revisión de IA requerida", "Una ejecución asistida requiere revisión humana."),
        "ai.execution.failed": ("Ejecución de IA con error", "Una ejecución asistida no pudo completarse."),
        "report.shared": ("Reporte compartido", "Hay un reporte disponible para revisar."),
        "report.generated": ("Reporte generado", "Un nuevo reporte está disponible."),
        "report.quality_gate_failed": ("Control de calidad no aprobado", "Un reporte requiere revisión antes de continuar."),
    }
    if bug:
        title = str(bug.get("codigo") or "Actualización de bug")
        message = str(bug.get("titulo") or "Hay una actualización en un bug.")
    elif event_type in mapping:
        title, message = mapping[event_type]
    else:
        title = fallback_title or "Nueva notificación"
        message = fallback_message or str(payload.get("message") or "Hay una actualización disponible.")
    if project_name and event_type.startswith(("report.", "execution.")):
        message = f"{message} Proyecto: {project_name}."
    return title, message, bug.get("link_url") or payload.get("link_url"), _notification_type_for_event(event_type)


def _actor_name(actor: models.Usuario | None) -> str | None:
    if not actor:
        return None
    return str(actor.display_name or actor.nombre_completo or "Usuario del sistema").strip() or None


async def emit_event(
    db: AsyncSession,
    event_type: str,
    entity_type: str,
    actor_user_id=None,
    proyecto_id=None,
    organizacion_id=None,
    entity_id=None,
    severity: str = "info",
    payload: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
    correlation_id: str | None = None,
) -> models.NotificationEvent:
    safe_payload = sanitize_notification_payload(payload or {})
    if dedupe_key:
        existing = await db.execute(select(models.NotificationEvent).filter(models.NotificationEvent.dedupe_key == dedupe_key))
        event = existing.scalar_one_or_none()
        if event:
            return event
    event = models.NotificationEvent(
        event_type=event_type,
        actor_user_id=actor_user_id,
        proyecto_id=proyecto_id,
        organizacion_id=organizacion_id,
        entity_type=entity_type,
        entity_id=entity_id,
        severity=severity,
        payload_json=safe_payload,
        dedupe_key=dedupe_key,
        correlation_id=correlation_id,
    )
    db.add(event)
    await db.flush()
    await apply_rules_for_event(db, event)
    event.status = "PROCESSED"
    event.processed_at = utc_now()
    await db.commit()
    await db.refresh(event)
    return event


async def apply_rules_for_event(db: AsyncSession, event: models.NotificationEvent) -> None:
    result = await db.execute(select(models.NotificationRule).order_by(models.NotificationRule.priority.asc()))
    rules = result.scalars().all()
    for rule in rules:
        if not rule_matches(rule, event):
            continue
        channels = (rule.actions_json or {}).get("channels") or ["in_app"]
        recipients = await resolve_recipients(db, rule.recipient_strategy_json or {}, event)
        template = None
        if rule.template_id:
            template = (await db.execute(select(models.NotificationTemplate).filter(models.NotificationTemplate.id == rule.template_id))).scalar_one_or_none()
        actor = await db.get(models.Usuario, event.actor_user_id) if event.actor_user_id else None
        actor_name = _actor_name(actor)
        for recipient in recipients:
            for channel in channels:
                user = recipient.get("user")
                if not await user_allows_channel(db, user, event.event_type, channel):
                    continue
                frequency = await recipient_frequency(
                    db,
                    recipient,
                    event,
                    channel,
                    (rule.actions_json or {}).get("frequency"),
                )
                if frequency == "never":
                    continue
                if frequency != "immediate":
                    schedule = await recipient_schedule(db, recipient, event, channel)
                    await digest_service.queue_event(db, event=event, recipient=recipient, frequency=frequency, timezone_name=schedule["timezone"], send_hour=schedule["send_hour"], send_day=schedule["send_day"])
                    continue
                title, message, link_url, notification_type = inbox_presentation_from_event(event, actor_name=actor_name)
                subject = title
                body_text = message
                body_html = None
                if template and template.enabled:
                    subject = render_text_template(template.subject_template, event.payload_json)
                    body_text = render_text_template(template.text_template, event.payload_json)
                    body_html = render_html_template(template.html_template, event.payload_json) if template.html_template else None
                dedupe = f"{event.dedupe_key or event.id}:{rule.id}:{channel}:{recipient.get('email') or getattr(user, 'id', '')}"
                existing = await db.execute(select(models.NotificationDelivery).filter(models.NotificationDelivery.dedupe_key == dedupe))
                if existing.scalar_one_or_none():
                    continue
                db.add(models.NotificationDelivery(
                    event_id=event.id,
                    rule_id=rule.id,
                    template_id=getattr(template, "id", None),
                    channel=channel,
                    recipient_user_id=getattr(user, "id", None),
                    recipient_email=recipient.get("email"),
                    subject=subject,
                    body_text=body_text,
                    body_html=body_html,
                    dedupe_key=dedupe,
                    max_attempts=5,
                    metadata_json={
                        "link_url": link_url,
                        "title": title,
                        "message": message,
                        "severity": event.severity,
                        "notification_type": notification_type,
                        "event_type": event.event_type,
                        "actor_name": actor_name,
                    },
                ))

from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...services.error_sanitizer import sanitize_external_error
from ...time_utils import utc_now
from .config_service import get_email_smtp_config, smtp_config_with_secret
from .email_sender import send_smtp_email


async def process_outbox(db: AsyncSession, limit: int = 100) -> dict[str, int]:
    now = utc_now()
    result = await db.execute(
        select(models.NotificationDelivery)
        .filter(models.NotificationDelivery.status.in_(["PENDING", "RETRY"]))
        .filter(or_(models.NotificationDelivery.next_attempt_at.is_(None), models.NotificationDelivery.next_attempt_at <= now))
        .order_by(models.NotificationDelivery.created_at.asc())
        .limit(limit)
    )
    deliveries = result.scalars().all()
    stats = {"processed": 0, "sent": 0, "failed": 0, "retry": 0}
    smtp_public = await get_email_smtp_config(db)
    smtp_config = smtp_config_with_secret(smtp_public)
    for delivery in deliveries:
        delivery.status = "SENDING"
        delivery.last_attempt_at = utc_now()
        await db.flush()
        try:
            if delivery.channel == "in_app":
                if delivery.recipient_user_id:
                    db.add(models.NotificationInbox(
                        user_id=delivery.recipient_user_id,
                        event_id=delivery.event_id,
                        title=delivery.metadata_json.get("title") or delivery.subject or "Notificacion",
                        message=delivery.metadata_json.get("message") or delivery.body_text or "",
                        link_url=delivery.metadata_json.get("link_url"),
                        severity=delivery.metadata_json.get("severity") or "info",
                        metadata_json=delivery.metadata_json or {},
                    ))
                delivery.status = "SENT"
                delivery.sent_at = utc_now()
                stats["sent"] += 1
            elif delivery.channel == "email":
                if not smtp_config.get("enabled"):
                    raise RuntimeError("SMTP no esta habilitado")
                await send_smtp_email(smtp_config, {
                    "to": [delivery.recipient_email],
                    "subject": delivery.subject,
                    "text_body": delivery.body_text,
                    "html_body": delivery.body_html,
                })
                delivery.status = "SENT"
                delivery.sent_at = utc_now()
                stats["sent"] += 1
            else:
                delivery.status = "CANCELLED"
            delivery.error = None
        except Exception as exc:
            delivery.attempt_count = int(delivery.attempt_count or 0) + 1
            delivery.error = sanitize_external_error(exc)
            if delivery.attempt_count >= int(delivery.max_attempts or 5):
                delivery.status = "FAILED"
                stats["failed"] += 1
            else:
                delivery.status = "RETRY"
                delivery.next_attempt_at = utc_now() + timedelta(minutes=min(60, 2 ** delivery.attempt_count))
                stats["retry"] += 1
        finally:
            delivery.updated_at = utc_now()
            stats["processed"] += 1
    await db.commit()
    return stats

from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...services.config_service import DEFAULT_BRANDING, get_workspace_branding
from ...services.edition.entitlement_provider import get_entitlement_provider
from ...services.error_sanitizer import sanitize_external_error
from ...time_utils import utc_now
from .config_service import get_email_smtp_config, smtp_config_with_secret
from .email_sender import send_smtp_email
from .digest_service import materialize_due_digests


async def _apply_email_branding(db: AsyncSession, config: dict) -> dict:
    """Attach only the effective local branding asset to outgoing email.

    Branding is evaluated server-side so a client cannot inject arbitrary
    image URLs into email. Community installations keep the Treseko asset;
    a custom asset is used only when its entitlement is active.
    """
    result = dict(config)
    try:
        state = await get_entitlement_provider().get_state(db)
        custom_allowed = state.get("edition") == "premium" and "branding.custom" in set(state.get("enabled_features") or [])
        stored = await get_workspace_branding(db)
    except Exception:
        # Branding must never block a notification delivery.  Falling back to
        # the built-in brand also avoids using an unverified custom asset.
        custom_allowed, stored = False, {}
    use_custom = bool(custom_allowed and stored.get("enabled") and stored.get("logo_url"))
    logo_path = str(stored.get("logo_url") if use_custom else DEFAULT_BRANDING["logo_url"])
    brand_name = str(stored.get("brand_name") if use_custom else DEFAULT_BRANDING["brand_name"])
    base_url = str(result.get("base_url") or "").rstrip("/")
    if logo_path.startswith("/") and base_url.startswith(("https://", "http://")):
        result["branding_logo_url"] = f"{base_url}{logo_path}"
    result["branding_primary_color"] = stored.get("primary_color") if use_custom else DEFAULT_BRANDING["primary_color"]
    result["branding_accent_color"] = stored.get("accent_color") if use_custom else DEFAULT_BRANDING["accent_color"]
    result.setdefault("from_name", brand_name)
    return result


async def process_outbox(db: AsyncSession, limit: int = 100) -> dict[str, int]:
    digest_stats = await materialize_due_digests(db, limit=limit)
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
    smtp_config = await _apply_email_branding(db, smtp_config_with_secret(smtp_public))
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    sent_today_result = await db.execute(
        select(func.count()).select_from(models.NotificationDelivery)
        .filter(models.NotificationDelivery.channel == "email")
        .filter(models.NotificationDelivery.status == "SENT")
        .filter(models.NotificationDelivery.sent_at >= day_start)
    )
    # Lightweight session adapters used by tests may expose only ``scalars``;
    # a missing counter is safely equivalent to no messages sent today.
    sent_today = int(sent_today_result.scalar() or 0) if hasattr(sent_today_result, "scalar") else 0
    daily_limit = int(smtp_config.get("daily_send_limit") or 500)
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
                if smtp_config.get("test_mode"):
                    delivery.status = "CANCELLED"
                    delivery.error = "Notificación no enviada: el correo de plataforma está en modo de prueba"
                    continue
                if sent_today >= daily_limit:
                    delivery.status = "RETRY"
                    delivery.error = "Límite diario de correo alcanzado"
                    delivery.next_attempt_at = day_start + timedelta(days=1)
                    stats["retry"] += 1
                    continue
                await send_smtp_email(smtp_config, {
                    "to": [delivery.recipient_email],
                    "subject": delivery.subject,
                    "text_body": delivery.body_text,
                    "html_body": delivery.body_html,
                })
                delivery.status = "SENT"
                delivery.sent_at = utc_now()
                sent_today += 1
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
    stats["digests_queued"] = digest_stats["queued"]
    return stats

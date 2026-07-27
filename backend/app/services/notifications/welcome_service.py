"""One-time welcome links; raw tokens exist only while building the email."""
from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import auth, models
from ...time_utils import utc_now
from .config_service import get_email_smtp_config
from .template_renderer import render_text_template


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def queue_welcome(db: AsyncSession, *, user: models.Usuario, actor_id=None) -> models.NotificationWelcomeInvitation:
    """Create a single-use invitation and queue a platform email.

    The delivery body is deliberately the sole holder of the raw token.  The
    database stores a SHA-256 hash only, so audit/log reads cannot recover it.
    """
    raw_token = secrets.token_urlsafe(32)
    invitation = models.NotificationWelcomeInvitation(
        user_id=user.id,
        token_hash=_hash(raw_token),
        auth_provider=(user.auth_provider or "local").lower(),
        expires_at=utc_now() + timedelta(days=7),
        created_by=actor_id,
    )
    db.add(invitation)
    await db.flush()
    config = await get_email_smtp_config(db)
    base_url = str(config.get("base_url") or "").rstrip("/")
    platform_name = str(config.get("from_name") or "Treseko")
    if (user.auth_provider or "local").lower() == "local":
        link = f"{base_url}/activate?token={quote(raw_token, safe='')}"
        subject = f"Bienvenido/a a {platform_name}"
        text = (
            f"Hola {user.nombre_completo or user.email},\n\n"
            f"Tu acceso a {platform_name} fue creado. Para definir o renovar tu contraseña, usá este enlace de un solo uso:\n{link}\n\n"
            "El enlace vence en 7 días. Nunca compartas este enlace."
        )
    else:
        link = base_url
        subject = f"Acceso corporativo a {platform_name}"
        text = (
            f"Hola {user.nombre_completo or user.email},\n\n"
            f"Tu acceso a {platform_name} usa autenticación corporativa ({user.auth_provider}). "
            f"Ingresá desde: {link}\n\nNo se envían contraseñas por correo."
        )
    template_key = "welcome_local_email" if (user.auth_provider or "local").lower() == "local" else "welcome_sso_email"
    template = (await db.execute(select(models.NotificationTemplate).filter(
        models.NotificationTemplate.key == template_key,
        models.NotificationTemplate.enabled.is_(True),
    ))).scalar_one_or_none()
    if template:
        context = {
            "platform": {"name": platform_name},
            "user": {"email": user.email, "nombre": user.nombre_completo or user.email, "auth_provider": user.auth_provider},
            "message": text,
        }
        subject = render_text_template(template.subject_template, context) or subject
        text = render_text_template(template.text_template, context) or text
    db.add(models.NotificationDelivery(
        channel="email", recipient_user_id=user.id, recipient_email=user.email,
        subject=subject, body_text=text, status="PENDING", max_attempts=int(config.get("max_attempts") or 5),
        dedupe_key=f"welcome:{invitation.id}",
        metadata_json={"welcome_invitation_id": str(invitation.id), "auth_provider": invitation.auth_provider},
    ))
    return invitation


async def consume_local_invitation(db: AsyncSession, *, raw_token: str, password: str) -> models.Usuario | None:
    invitation = (await db.execute(
        select(models.NotificationWelcomeInvitation).filter(models.NotificationWelcomeInvitation.token_hash == _hash(raw_token))
    )).scalar_one_or_none()
    now = utc_now()
    if not invitation or invitation.used_at or invitation.revoked_at or invitation.expires_at <= now:
        return None
    user = await db.get(models.Usuario, invitation.user_id)
    if not user or (user.auth_provider or "local").lower() != "local":
        return None
    user.hashed_password = auth.get_password_hash(password)
    user.session_version = int(user.session_version or 0) + 1
    invitation.used_at = now
    await db.commit()
    return user

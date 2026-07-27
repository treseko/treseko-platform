from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models


async def _user_by_id(db: AsyncSession, user_id: Any):
    if not user_id:
        return None
    try:
        normalized = UUID(str(user_id))
    except (TypeError, ValueError):
        return None
    result = await db.execute(select(models.Usuario).filter(models.Usuario.id == normalized))
    return result.scalar_one_or_none()


async def resolve_recipients(db: AsyncSession, strategy: dict[str, Any], event: models.NotificationEvent) -> list[dict[str, Any]]:
    recipients: dict[str, dict[str, Any]] = {}

    async def add_user(user):
        if not user or not user.activo or not user.email:
            return
        recipients[f"user:{user.id}"] = {"user": user, "email": user.email}

    async def add_email(email: str | None):
        # A raw email has no project membership to validate. Project-scoped
        # external audiences must be persisted stakeholders, which carry
        # consent and a project boundary; explicit rule emails are global-only.
        if email and not event.proyecto_id:
            recipients[f"email:{email.lower()}"] = {"user": None, "email": email}

    payload = event.payload_json or {}
    bug = payload.get("bug") or {}
    actor_id = event.actor_user_id
    notify_actor = strategy.get("actor", False) or strategy.get("notify_actor", False)
    if notify_actor:
        await add_user(await _user_by_id(db, actor_id))
    if strategy.get("assignee") and bug.get("asignado_a"):
        await add_user(await _user_by_id(db, bug.get("asignado_a")))
    if strategy.get("creator") and bug.get("creado_por"):
        await add_user(await _user_by_id(db, bug.get("creado_por")))

    for user_id in strategy.get("explicit_user_ids") or []:
        await add_user(await _user_by_id(db, user_id))
    for email in strategy.get("explicit_emails") or []:
        await add_email(email)

    global_roles = set(strategy.get("global_roles") or [])
    if global_roles:
        normalized_roles = []
        for role in global_roles:
            try:
                normalized_roles.append(models.Rol(str(role)))
            except ValueError:
                continue
        result = await db.execute(select(models.Usuario).filter(models.Usuario.rol.in_(normalized_roles)))
        for user in result.scalars().all():
            await add_user(user)

    project_roles = set(strategy.get("project_roles") or strategy.get("project_role") or [])
    if project_roles and event.proyecto_id:
        result = await db.execute(
            select(models.Usuario)
            .join(models.ProyectoMiembro, models.ProyectoMiembro.usuario_id == models.Usuario.id)
            .filter(models.ProyectoMiembro.proyecto_id == event.proyecto_id)
            .filter(
                (models.ProyectoMiembro.rol_proyecto.in_(list(project_roles)))
                | (models.Usuario.rol.in_([models.Rol(str(role)) for role in project_roles if str(role) in models.Rol.__members__]))
            )
        )
        for user in result.scalars().all():
            await add_user(user)

    if strategy.get("project_members") and event.proyecto_id:
        result = await db.execute(
            select(models.Usuario)
            .join(models.ProyectoMiembro, models.ProyectoMiembro.usuario_id == models.Usuario.id)
            .filter(models.ProyectoMiembro.proyecto_id == event.proyecto_id)
        )
        for user in result.scalars().all():
            await add_user(user)

    if strategy.get("stakeholders") and event.proyecto_id:
        result = await db.execute(
            select(models.NotificationStakeholder)
            .filter(models.NotificationStakeholder.proyecto_id == event.proyecto_id)
            .filter(models.NotificationStakeholder.active.is_(True))
        )
        for stakeholder in result.scalars().all():
            allowed = set(stakeholder.allowed_event_types or [])
            if allowed and event.event_type not in allowed:
                continue
            recipients[f"stakeholder:{stakeholder.id}"] = {"user": None, "stakeholder": stakeholder, "email": stakeholder.email}

    if not notify_actor and actor_id:
        recipients.pop(f"user:{actor_id}", None)

    return list(recipients.values())


async def user_allows_channel(db: AsyncSession, user: models.Usuario | None, event_type: str, channel: str) -> bool:
    if not user:
        return True
    result = await db.execute(
        select(models.NotificationPreference)
        .filter(models.NotificationPreference.user_id == user.id)
        .filter(models.NotificationPreference.channel == channel)
        .filter((models.NotificationPreference.event_type == event_type) | (models.NotificationPreference.event_type.is_(None)))
    )
    preferences = result.scalars().all()
    if not preferences:
        return True
    specific = next((item for item in preferences if item.event_type == event_type), None)
    preference = specific or preferences[0]
    quiet_hours = preference.quiet_hours_json or {}
    mute_until = quiet_hours.get("mute_until") if isinstance(quiet_hours, dict) else None
    if mute_until:
        try:
            from datetime import datetime, timezone
            if datetime.fromisoformat(str(mute_until).replace("Z", "+00:00")) > datetime.now(timezone.utc):
                return False
        except (TypeError, ValueError):
            pass
    return bool(preference.enabled and preference.frequency != "never")


async def recipient_frequency(
    db: AsyncSession,
    recipient: dict[str, Any],
    event: models.NotificationEvent,
    channel: str,
    rule_frequency: str | None = None,
) -> str:
    """Resolve a safe delivery mode without treating a digest as immediate."""
    if channel != "email":
        return "immediate"
    if rule_frequency:
        return rule_frequency
    user = recipient.get("user")
    stakeholder = recipient.get("stakeholder")
    if not user and not stakeholder:
        return "immediate" if str(event.severity).lower() in {"critical", "critica", "error"} else "daily"
    recipient_filter = models.NotificationRecipientSubscription.user_id == user.id if user else models.NotificationRecipientSubscription.stakeholder_id == getattr(stakeholder, "id", None)
    result = await db.execute(
        select(models.NotificationRecipientSubscription)
        .filter(recipient_filter)
        .filter(models.NotificationRecipientSubscription.channel == channel)
        .filter((models.NotificationRecipientSubscription.proyecto_id == event.proyecto_id) | (models.NotificationRecipientSubscription.proyecto_id.is_(None)))
        .filter((models.NotificationRecipientSubscription.event_type == event.event_type) | (models.NotificationRecipientSubscription.event_type.is_(None)))
        .order_by(models.NotificationRecipientSubscription.event_type.desc(), models.NotificationRecipientSubscription.proyecto_id.desc())
    )
    subscription = result.scalars().first()
    if subscription:
        if not subscription.enabled or (subscription.muted_until and subscription.muted_until > datetime.now(timezone.utc)):
            return "never"
        return subscription.frequency
    # Legacy preferences are retained for compatibility, but a scoped
    # subscription wins because it carries project and timezone information.
    if user:
        result = await db.execute(
            select(models.NotificationPreference)
            .filter(models.NotificationPreference.user_id == user.id)
            .filter(models.NotificationPreference.channel == channel)
            .filter((models.NotificationPreference.event_type == event.event_type) | (models.NotificationPreference.event_type.is_(None)))
        )
        preferences = result.scalars().all()
        pref = next((item for item in preferences if item.event_type == event.event_type), None) or (preferences[0] if preferences else None)
        if pref:
            return pref.frequency if pref.enabled else "never"
    # Critical events may notify immediately; normal email activity is grouped.
    return "immediate" if str(event.severity).lower() in {"critical", "critica", "error"} else "daily"


async def recipient_schedule(db: AsyncSession, recipient: dict[str, Any], event: models.NotificationEvent, channel: str) -> dict[str, Any]:
    """Return a persisted recipient schedule; never trust schedule data from a rule/UI."""
    user = recipient.get("user")
    stakeholder = recipient.get("stakeholder")
    if not user and not stakeholder:
        return {"timezone": "UTC", "send_hour": 9, "send_day": None}
    recipient_filter = models.NotificationRecipientSubscription.user_id == user.id if user else models.NotificationRecipientSubscription.stakeholder_id == getattr(stakeholder, "id", None)
    result = await db.execute(
        select(models.NotificationRecipientSubscription)
        .filter(recipient_filter)
        .filter(models.NotificationRecipientSubscription.channel == channel)
        .filter((models.NotificationRecipientSubscription.proyecto_id == event.proyecto_id) | (models.NotificationRecipientSubscription.proyecto_id.is_(None)))
        .filter((models.NotificationRecipientSubscription.event_type == event.event_type) | (models.NotificationRecipientSubscription.event_type.is_(None)))
        .order_by(models.NotificationRecipientSubscription.event_type.desc(), models.NotificationRecipientSubscription.proyecto_id.desc())
    )
    subscription = result.scalars().first()
    if not subscription:
        return {"timezone": "UTC", "send_hour": 9, "send_day": None}
    return {"timezone": subscription.timezone or "UTC", "send_hour": subscription.send_hour or 9, "send_day": subscription.send_day}

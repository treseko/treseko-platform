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
        if email:
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

"""Persistent, idempotent aggregation for outbound notification digests."""
from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...time_utils import ensure_utc, utc_now


DIGEST_FREQUENCIES = {"daily", "weekly", "monthly", "on_report_export", "on_build_closure", "on_project_closure"}


def _period(frequency: str, now, *, timezone_name: str = "UTC"):
    """Return a recipient-local aggregation window, stored as UTC."""
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    now = ensure_utc(now).astimezone(zone)
    if frequency == "daily":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        return start.astimezone(ZoneInfo("UTC")), end.astimezone(ZoneInfo("UTC"))
    if frequency == "weekly":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7)
        return start.astimezone(ZoneInfo("UTC")), end.astimezone(ZoneInfo("UTC"))
    if frequency == "monthly":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        return start.astimezone(ZoneInfo("UTC")), next_month.astimezone(ZoneInfo("UTC"))
    # Event-bound summaries are idempotent per individual event.
    now_utc = now.astimezone(ZoneInfo("UTC"))
    return now_utc, now_utc


def _key(*parts: Any) -> str:
    raw = "|".join(str(part or "-") for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _event_summary(event: models.NotificationEvent) -> dict[str, Any]:
    payload = event.payload_json or {}
    report = payload.get("report") or {}
    project = payload.get("proyecto") or {}
    build = payload.get("build") or {}
    return {
        "event_type": event.event_type,
        "severity": event.severity,
        "message": str(payload.get("message") or report.get("title") or event.event_type),
        "project_name": project.get("nombre"),
        "build_name": build.get("nombre") or report.get("build_nombre"),
        "actor": (payload.get("actor") or {}).get("nombre") or (payload.get("actor") or {}).get("email"),
    }


def _digest_metrics(events: list[dict[str, Any]]) -> list[str]:
    """Summarise only facts present in queued events; never invent QA KPIs."""
    execution_events = [item for item in events if str(item.get("event_type", "")).startswith("execution.")]
    bug_events = [item for item in events if str(item.get("event_type", "")).startswith("bug.")]
    critical = [item for item in events if str(item.get("severity", "")).lower() in {"critical", "critica", "error"}]
    actors = sorted({str(item["actor"]) for item in events if item.get("actor")})
    lines = [f"Actividad relevante: {len(events)} evento(s)"]
    if execution_events:
        lines.append(f"Ejecuciones registradas: {len(execution_events)}")
    if bug_events:
        lines.append(f"Bugs reportados o actualizados: {len(bug_events)}")
    if critical:
        lines.append(f"Eventos críticos que requieren revisión: {len(critical)}")
    if actors:
        lines.append(f"Participaron: {', '.join(actors[:8])}{'…' if len(actors) > 8 else ''}")
    return lines


async def _qa_snapshot_lines(db: AsyncSession, digest: models.NotificationDigest) -> list[str]:
    """Return verified, project-scoped QA facts for a scheduled summary.

    The event queue is deliberately not treated as the source of truth for
    execution status, bugs or coverage: an event may be filtered, retried or
    emitted after a workflow has changed.  These queries stay within the
    digest project and time window, so an external stakeholder cannot receive
    another project's activity through an aggregated email.
    """
    if not digest.proyecto_id:
        return []

    execution_rows = (
        await db.execute(
            select(models.EjecucionCaso.estado_resultado, models.EjecucionCaso.ejecutado_por)
            .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
            .where(
                models.TestRun.proyecto_id == digest.proyecto_id,
                models.EjecucionCaso.fecha_ejecucion >= digest.period_start,
                models.EjecucionCaso.fecha_ejecucion < digest.period_end,
            )
        )
    ).all()
    result_lines: list[str] = []
    if execution_rows:
        statuses = [getattr(status, "value", str(status)) for status, _ in execution_rows]
        result_lines.append(
            "Pruebas ejecutadas: "
            f"{len(execution_rows)} "
            f"(aprobadas: {statuses.count('PASO')}; fallidas: {statuses.count('FALLO')}; bloqueadas: {statuses.count('BLOQUEADO')})"
        )
        executor_ids = {user_id for _, user_id in execution_rows if user_id}
        if executor_ids:
            executors = (
                await db.execute(select(models.Usuario.nombre_completo, models.Usuario.email).where(models.Usuario.id.in_(executor_ids)))
            ).all()
            labels = sorted({str(name or email) for name, email in executors if name or email})
            if labels:
                result_lines.append(f"Ejecutaron pruebas: {', '.join(labels[:8])}{'…' if len(labels) > 8 else ''}")

    bug_rows = (
        await db.execute(
            select(models.BugIssue.creado_por)
            .where(
                models.BugIssue.proyecto_id == digest.proyecto_id,
                models.BugIssue.created_at >= digest.period_start,
                models.BugIssue.created_at < digest.period_end,
            )
        )
    ).scalars().all()
    if bug_rows:
        result_lines.append(f"Bugs reportados: {len(bug_rows)}")
        reporter_ids = {user_id for user_id in bug_rows if user_id}
        if reporter_ids:
            reporters = (
                await db.execute(select(models.Usuario.nombre_completo, models.Usuario.email).where(models.Usuario.id.in_(reporter_ids)))
            ).all()
            labels = sorted({str(name or email) for name, email in reporters if name or email})
            if labels:
                result_lines.append(f"Reportaron bugs: {', '.join(labels[:8])}{'…' if len(labels) > 8 else ''}")

    critical_open = (
        await db.execute(
            select(models.BugIssue.id).where(
                models.BugIssue.proyecto_id == digest.proyecto_id,
                models.BugIssue.criticidad == "CRITICA",
                models.BugIssue.estado.notin_(["RESUELTO", "CERRADO", "CLOSED"]),
            )
        )
    ).scalars().all()
    if critical_open:
        result_lines.append(f"Bugs críticos abiertos: {len(critical_open)}")

    pending_masters = (
        await db.execute(
            select(models.CasoPrueba.master_id).where(
                models.CasoPrueba.proyecto_id == digest.proyecto_id,
                models.CasoPrueba.activo.is_(True),
                (models.CasoPrueba.ultimo_resultado.is_(None)) | (models.CasoPrueba.ultimo_resultado.in_(["SIN_CORRER", "PENDIENTE"])),
            )
        )
    ).scalars().all()
    if pending_masters:
        result_lines.append(f"Casos pendientes de ejecución: {len(set(pending_masters))}")

    # Coverage is global to the project, not to the window.  It is explicitly
    # labelled that way to avoid presenting it as a period delta.
    from ...repositories.traceability_records import coverage_summary
    coverage = await coverage_summary(db, digest.proyecto_id)
    if coverage.get("estado_disponibilidad") != "NOT_AVAILABLE":
        result_lines.append(
            "Cobertura de criterios: "
            f"{coverage.get('cobertura_diseno', 0)}% de diseño; "
            f"{coverage.get('cobertura_ejecutada', 0)}% ejecutada; "
            f"{coverage.get('criterios_sin_caso', 0)} criterio(s) obligatorio(s) sin caso"
        )
    return result_lines


def _scheduled_at(frequency: str, period_end, *, timezone_name: str = "UTC", send_hour: int = 9, send_day: int | None = None):
    if frequency not in {"daily", "weekly", "monthly"}:
        return utc_now()
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    local = ensure_utc(period_end).astimezone(zone).replace(hour=max(0, min(23, int(send_hour))), minute=0, second=0, microsecond=0)
    if frequency == "weekly" and send_day:
        # ISO weekday 1..7, retaining the end-of-window date if it matches.
        local += timedelta(days=(int(send_day) - local.isoweekday()) % 7)
    elif frequency == "monthly" and send_day:
        # The selected day is clipped to the final day of that month.
        import calendar
        local = local.replace(day=min(max(1, int(send_day)), calendar.monthrange(local.year, local.month)[1]))
    return local.astimezone(ZoneInfo("UTC"))


async def queue_event(
    db: AsyncSession,
    *,
    event: models.NotificationEvent,
    recipient: dict[str, Any],
    frequency: str,
    timezone_name: str = "UTC",
    send_hour: int = 9,
    send_day: int | None = None,
) -> models.NotificationDigest | None:
    if frequency not in DIGEST_FREQUENCIES:
        return None
    now = utc_now()
    start, end = _period(frequency, now, timezone_name=timezone_name)
    user = recipient.get("user")
    stakeholder = recipient.get("stakeholder")
    email = str(recipient.get("email") or "").strip().lower()
    if not email:
        return None
    # External event-bound reports must never cross project boundaries.
    if stakeholder and stakeholder.proyecto_id != event.proyecto_id:
        return None
    scope = event.id if frequency.startswith("on_") else start.isoformat()
    dedupe_key = _key("digest", getattr(user, "id", None), getattr(stakeholder, "id", None), email, event.proyecto_id, frequency, scope)
    result = await db.execute(select(models.NotificationDigest).filter(models.NotificationDigest.dedupe_key == dedupe_key))
    digest = result.scalar_one_or_none()
    if not digest:
        digest = models.NotificationDigest(
            recipient_user_id=getattr(user, "id", None),
            stakeholder_id=getattr(stakeholder, "id", None),
            recipient_email=email,
            proyecto_id=event.proyecto_id,
            frequency=frequency,
            period_start=start,
            period_end=end,
            scheduled_for=_scheduled_at(frequency, end, timezone_name=timezone_name, send_hour=send_hour, send_day=send_day),
            dedupe_key=dedupe_key,
            metadata_json={"events": []},
        )
        db.add(digest)
        await db.flush()
    exists = await db.execute(
        select(models.NotificationDigestItem).filter(
            models.NotificationDigestItem.digest_id == digest.id,
            models.NotificationDigestItem.event_id == event.id,
        )
    )
    if not exists.scalar_one_or_none():
        db.add(models.NotificationDigestItem(digest_id=digest.id, event_id=event.id))
        metadata = dict(digest.metadata_json or {})
        events = list(metadata.get("events") or [])
        events.append(_event_summary(event))
        metadata["events"] = events[-100:]
        digest.metadata_json = metadata
    return digest


async def materialize_due_digests(db: AsyncSession, *, now=None, force: bool = False, limit: int = 100) -> dict[str, int]:
    now = ensure_utc(now or utc_now())
    query = select(models.NotificationDigest).filter(models.NotificationDigest.status == "PENDING")
    if not force:
        query = query.filter(models.NotificationDigest.scheduled_for <= now)
    result = await db.execute(query.order_by(models.NotificationDigest.scheduled_for.asc()).limit(limit))
    digests = result.scalars().all()
    created = 0
    for digest in digests:
        if not digest.recipient_email:
            digest.status = "CANCELLED"
            continue
        events = list((digest.metadata_json or {}).get("events") or [])
        if not events:
            digest.status = "CANCELLED"
            continue
        project_label = next((item.get("project_name") for item in events if item.get("project_name")), "Treseko")
        build_label = next((item.get("build_name") for item in events if item.get("build_name")), None)
        subject = f"[{project_label}] Resumen {digest.frequency} de Treseko"
        qa_lines = await _qa_snapshot_lines(db, digest) if digest.frequency in {"daily", "weekly", "monthly"} else []
        scope_label = f"Proyecto: {project_label}" + (f" · Build: {build_label}" if build_label else "")
        lines = [f"Resumen {digest.frequency} · {project_label}", scope_label, "", *qa_lines, *_digest_metrics(events), ""]
        for item in events:
            actor = f" — {item['actor']}" if item.get("actor") else ""
            lines.append(f"• {item.get('message') or item.get('event_type')}{actor}")
        lines.extend(["", "Ingresá a Treseko para ver el detalle autorizado."])
        delivery = models.NotificationDelivery(
            channel="email",
            recipient_user_id=digest.recipient_user_id,
            recipient_email=digest.recipient_email,
            subject=subject,
            body_text="\n".join(lines),
            status="PENDING",
            dedupe_key=f"digest-delivery:{digest.dedupe_key}",
            metadata_json={"digest_id": str(digest.id), "frequency": digest.frequency, "event_count": len(events)},
        )
        db.add(delivery)
        await db.flush()
        digest.delivery_id = delivery.id
        digest.status = "QUEUED"
        created += 1
    await db.commit()
    return {"processed": len(digests), "queued": created}

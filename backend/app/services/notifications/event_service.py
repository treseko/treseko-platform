from typing import Any
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import models
from ...services.error_sanitizer import sanitize_external_error
from ...time_utils import utc_now
from .recipient_resolver import resolve_recipients, user_allows_channel
from .rules_engine import rule_matches
from .template_renderer import render_html_template, render_text_template


DEFAULT_TEMPLATE_VARIABLES = [
    "bug.codigo", "bug.titulo", "bug.estado", "bug.severidad", "bug.prioridad", "bug.link_url",
    "proyecto.nombre", "build.nombre", "caso.codigo", "caso.titulo", "actor.nombre", "actor.email",
    "execution.id", "execution.estado", "execution.comentarios", "user.email", "user.nombre", "user.rol",
    "user.auth_provider", "message",
]

NOTIFICATION_SECRET_KEY_MARKERS = {
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "credential",
    "credentials",
    "password",
    "refresh_token",
    "secret",
    "token",
}
NOTIFICATION_URL_KEYS = {"link_url", "public_url", "url"}
NOTIFICATION_SENSITIVE_URL_QUERY_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "asset_token",
    "authorization",
    "password",
    "refresh_token",
    "secret",
    "token",
    "x_qa_api_key",
}
REDACTED_NOTIFICATION_SECRET = "[redacted]"


def _is_sensitive_notification_key(key: Any) -> bool:
    normalized = str(key or "").lower().replace("-", "_").replace(" ", "_")
    return any(marker in normalized for marker in NOTIFICATION_SECRET_KEY_MARKERS)


def _sanitize_notification_url(value: Any) -> str | None:
    text = str(value or "").replace("\x00", "").strip()
    if not text or any(char.isspace() for char in text) or any(char in text for char in "<>\"'"):
        return None
    parsed = urlparse(text)
    try:
        query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=50)
    except ValueError:
        return None
    if any(str(key).strip().lower() in NOTIFICATION_SENSITIVE_URL_QUERY_KEYS for key in query):
        return None
    if parsed.scheme:
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
            return None
        if parsed.username or parsed.password:
            return None
        return text
    if text.startswith("/") and not text.startswith("//"):
        return text
    return None


def sanitize_notification_payload(value: Any, key: Any = None) -> Any:
    if _is_sensitive_notification_key(key):
        return REDACTED_NOTIFICATION_SECRET
    if isinstance(value, dict):
        return {
            item_key: sanitize_notification_payload(item, item_key)
            for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_notification_payload(item) for item in value]
    if isinstance(value, str):
        if str(key or "").lower() in NOTIFICATION_URL_KEYS:
            return _sanitize_notification_url(value)
        return sanitize_external_error(value, max_len=2000)
    return value

SEED_TEMPLATES = [
    {
        "key": "bug_created_email",
        "nombre": "Bug critico creado",
        "channel": "email",
        "subject_template": "[QA] ${bug.codigo} ${bug.severidad}: ${bug.titulo}",
        "text_template": "Se registro un bug en ${proyecto.nombre}.\n\nBug: ${bug.codigo}\nTitulo: ${bug.titulo}\nEstado: ${bug.estado}\nSeveridad: ${bug.severidad}\nPrioridad: ${bug.prioridad}\nBuild: ${build.nombre}\nCaso: ${caso.codigo} - ${caso.titulo}\nReportado por: ${actor.nombre} (${actor.email})\n\nAbrir: ${bug.link_url}",
    },
    {
        "key": "bug_assigned_email",
        "nombre": "Bug asignado",
        "channel": "email",
        "subject_template": "[QA] Te asignaron ${bug.codigo}: ${bug.titulo}",
        "text_template": "Tienes un bug asignado.\n\nBug: ${bug.codigo}\nTitulo: ${bug.titulo}\nSeveridad: ${bug.severidad}\nPrioridad: ${bug.prioridad}\nProyecto: ${proyecto.nombre}\n\nAbrir: ${bug.link_url}",
    },
    {
        "key": "ad_user_provisioned_email",
        "nombre": "Usuario AD provisionado",
        "channel": "email",
        "subject_template": "[QA] Usuario AD provisionado: ${user.email}",
        "text_template": "Se creo o habilito un usuario desde Active Directory/OIDC.\n\nUsuario: ${user.email}\nNombre: ${user.nombre}\nRol: ${user.rol}\nProveedor: ${user.auth_provider}",
    },
    {
        "key": "bug_status_changed_email",
        "nombre": "Cambio de estado de bug",
        "channel": "email",
        "subject_template": "[QA] ${bug.codigo} cambio a ${bug.estado}",
        "text_template": "El bug ${bug.codigo} cambio de estado.\n\nTitulo: ${bug.titulo}\nEstado: ${bug.estado}\nProyecto: ${proyecto.nombre}\nActor: ${actor.nombre}\n\nAbrir: ${bug.link_url}",
    },
    {
        "key": "bug_comment_added_email",
        "nombre": "Comentario en bug",
        "channel": "email",
        "subject_template": "[QA] Nuevo comentario en ${bug.codigo}",
        "text_template": "Se agrego un comentario en ${bug.codigo}.\n\nTitulo: ${bug.titulo}\nSeveridad: ${bug.severidad}\nPrioridad: ${bug.prioridad}\nActor: ${actor.nombre}\n\nAbrir: ${bug.link_url}",
    },
    {
        "key": "execution_failed_email",
        "nombre": "Ejecucion fallida o bloqueada",
        "channel": "email",
        "subject_template": "[QA] Ejecucion ${execution.estado}: ${caso.codigo}",
        "text_template": "Una ejecucion requiere atencion.\n\nCaso: ${caso.codigo} - ${caso.titulo}\nEstado: ${execution.estado}\nObservaciones: ${execution.comentarios}\nActor: ${actor.nombre}",
    },
    {
        "key": "ai_review_required_email",
        "nombre": "Revision IA requerida",
        "channel": "email",
        "subject_template": "[QA] Revision IA requerida",
        "text_template": "${message}\n\nCaso: ${caso.codigo} - ${caso.titulo}\nActor: ${actor.nombre}",
    },
    {
        "key": "report_shared_email",
        "nombre": "Reporte compartido",
        "channel": "email",
        "subject_template": "[QA] Reporte compartido",
        "text_template": "${message}\n\nProyecto: ${proyecto.nombre}",
    },
    {
        "key": "admin_event_email",
        "nombre": "Evento administrativo",
        "channel": "email",
        "subject_template": "[QA] ${message}",
        "text_template": "${message}\n\nActor: ${actor.email}",
    },
]

SEED_RULES = [
    {
        "nombre": "Bug critico creado",
        "event_types": ["bug.created", "bug.created_from_snapshot", "bug.created_from_execution"],
        "conditions_json": {"any": [
            {"field": "payload.bug.severidad", "op": "severity_at_least", "value": "ALTA"},
            {"field": "payload.bug.prioridad", "op": "in", "value": ["P0", "P1"]},
        ]},
        "actions_json": {"channels": ["in_app", "email"]},
        "recipient_strategy_json": {"assignee": True, "creator": True, "global_roles": ["ADMIN", "QA_LEAD"]},
        "template_key": "bug_created_email",
        "priority": 10,
    },
    {
        "nombre": "Bug asignado",
        "event_types": ["bug.assigned"],
        "conditions_json": {},
        "actions_json": {"channels": ["in_app", "email"]},
        "recipient_strategy_json": {"assignee": True},
        "template_key": "bug_assigned_email",
        "priority": 20,
    },
    {
        "nombre": "Bug listo para retest",
        "event_types": ["bug.ready_for_retest"],
        "conditions_json": {},
        "actions_json": {"channels": ["in_app", "email"]},
        "recipient_strategy_json": {"creator": True, "assignee": True, "project_roles": ["TESTER", "QA_LEAD"]},
        "template_key": "bug_status_changed_email",
        "priority": 30,
    },
    {
        "nombre": "Comentario en bug critico",
        "event_types": ["bug.comment_added"],
        "conditions_json": {"any": [
            {"field": "payload.bug.severidad", "op": "severity_at_least", "value": "ALTA"},
            {"field": "payload.bug.prioridad", "op": "in", "value": ["P0", "P1"]},
        ]},
        "actions_json": {"channels": ["in_app", "email"]},
        "recipient_strategy_json": {"creator": True, "assignee": True},
        "template_key": "bug_comment_added_email",
        "priority": 40,
    },
    {
        "nombre": "Ejecucion fallida",
        "event_types": ["execution.failed", "execution.blocked"],
        "conditions_json": {},
        "actions_json": {"channels": ["in_app", "email"]},
        "recipient_strategy_json": {"project_roles": ["QA_LEAD"], "global_roles": ["ADMIN"]},
        "template_key": "execution_failed_email",
        "priority": 50,
    },
    {
        "nombre": "Revision IA requerida",
        "event_types": ["ai.execution.review_required", "ai.execution.failed", "ai.engine.unavailable"],
        "conditions_json": {},
        "actions_json": {"channels": ["in_app", "email"]},
        "recipient_strategy_json": {"project_roles": ["QA_LEAD"], "global_roles": ["ADMIN"]},
        "template_key": "ai_review_required_email",
        "priority": 60,
    },
    {
        "nombre": "Usuario AD provisionado",
        "event_types": ["auth.ad_user_provisioned"],
        "conditions_json": {},
        "actions_json": {"channels": ["in_app", "email"]},
        "recipient_strategy_json": {"global_roles": ["ADMIN"]},
        "template_key": "ad_user_provisioned_email",
        "priority": 70,
    },
    {
        "nombre": "Eventos administrativos",
        "event_types": [
            "user.created",
            "user.disabled",
            "user.role_changed",
            "role.permissions_changed",
            "project.member_added",
            "project.member_removed",
            "build.activated",
            "build.closed",
            "auth.login_failed_many",
            "evidence.required_missing",
            "automation.runner.offline",
        ],
        "conditions_json": {},
        "actions_json": {"channels": ["in_app"]},
        "recipient_strategy_json": {"global_roles": ["ADMIN"]},
        "template_key": "admin_event_email",
        "priority": 80,
    },
    {
        "nombre": "Reporte compartido",
        "event_types": ["report.shared", "report.generated", "report.quality_gate_failed"],
        "conditions_json": {},
        "actions_json": {"channels": ["in_app", "email"]},
        "recipient_strategy_json": {"project_roles": ["QA_LEAD"], "global_roles": ["ADMIN"]},
        "template_key": "report_shared_email",
        "priority": 90,
    },
]


async def ensure_notification_seeds(db: AsyncSession) -> None:
    templates_by_key: dict[str, models.NotificationTemplate] = {}
    for item in SEED_TEMPLATES:
        result = await db.execute(select(models.NotificationTemplate).filter(models.NotificationTemplate.key == item["key"]))
        template = result.scalar_one_or_none()
        if not template:
            template = models.NotificationTemplate(
                **item,
                allowed_variables=DEFAULT_TEMPLATE_VARIABLES,
                enabled=True,
            )
            db.add(template)
            await db.flush()
        templates_by_key[item["key"]] = template
    for item in SEED_RULES:
        result = await db.execute(select(models.NotificationRule).filter(models.NotificationRule.nombre == item["nombre"]))
        existing_rule = result.scalar_one_or_none()
        if existing_rule:
            existing_event_types = list(existing_rule.event_types or [])
            merged_event_types = existing_event_types + [event_type for event_type in item["event_types"] if event_type not in existing_event_types]
            if merged_event_types != existing_event_types:
                existing_rule.event_types = merged_event_types
                existing_rule.updated_at = utc_now()
            continue
        db.add(models.NotificationRule(
            nombre=item["nombre"],
            enabled=True,
            scope="GLOBAL",
            event_types=item["event_types"],
            conditions_json=item["conditions_json"],
            actions_json=item["actions_json"],
            recipient_strategy_json=item["recipient_strategy_json"],
            template_id=templates_by_key[item["template_key"]].id,
            priority=item["priority"],
        ))
    await db.commit()


def _inbox_text_from_event(event: models.NotificationEvent) -> tuple[str, str, str | None]:
    payload = event.payload_json or {}
    bug = payload.get("bug") or {}
    title = bug.get("codigo") or event.event_type
    message = bug.get("titulo") or payload.get("message") or event.event_type
    return str(title), str(message), bug.get("link_url") or payload.get("link_url")


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
        for recipient in recipients:
            for channel in channels:
                user = recipient.get("user")
                if not await user_allows_channel(db, user, event.event_type, channel):
                    continue
                title, message, link_url = _inbox_text_from_event(event)
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
                    metadata_json={"link_url": link_url, "title": title, "message": message, "severity": event.severity},
                ))

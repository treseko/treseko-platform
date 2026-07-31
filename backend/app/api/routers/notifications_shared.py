from ...main_context import *

def _inbox_response(item: models.NotificationInbox, event: models.NotificationEvent | None = None, actor: models.Usuario | None = None) -> dict:
    """Expose only presentation-safe metadata for the signed-in recipient."""
    metadata = dict(item.metadata_json or {})
    actor_name = metadata.get("actor_name") or getattr(actor, "display_name", None) or getattr(actor, "nombre_completo", None)
    title, message, link_url, notification_type = (
        notification_event_service.inbox_presentation_from_event(
            event,
            actor_name=actor_name,
            fallback_title=item.title,
            fallback_message=item.message,
        )
        if event else (item.title, item.message, item.link_url, metadata.get("notification_type") or "GENERAL")
    )
    return {
        "id": item.id,
        "event_id": item.event_id,
        "proyecto_id": item.proyecto_id,
        "title": title,
        "message": message,
        "link_url": link_url or item.link_url,
        "severity": item.severity,
        "read_at": item.read_at,
        "created_at": item.created_at,
        "notification_type": notification_type,
        "actor_name": actor_name,
        "metadata_json": metadata,
    }


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _notification_rule_audit_summary(rule: models.NotificationRule | schemas.NotificationRuleCreate | schemas.NotificationRuleUpdate | None) -> dict:
    if not rule:
        return {}
    if isinstance(rule, (schemas.NotificationRuleCreate, schemas.NotificationRuleUpdate)):
        data = rule.model_dump(exclude_unset=True)
    else:
        data = {
            "nombre": rule.nombre,
            "enabled": rule.enabled,
            "scope": rule.scope,
            "event_types": list(rule.event_types or []),
            "cooldown_minutes": rule.cooldown_minutes,
            "priority": rule.priority,
            "template_id": str(rule.template_id) if rule.template_id else None,
            "conditions_json": dict(rule.conditions_json or {}),
            "actions_json": dict(rule.actions_json or {}),
            "recipient_strategy_json": dict(rule.recipient_strategy_json or {}),
        }
    recipients = data.get("recipient_strategy_json") or {}
    explicit_emails = recipients.get("explicit_emails") if isinstance(recipients, dict) else []
    return {
        "nombre": data.get("nombre"),
        "enabled": data.get("enabled"),
        "scope": data.get("scope"),
        "event_types": data.get("event_types"),
        "cooldown_minutes": data.get("cooldown_minutes"),
        "priority": data.get("priority"),
        "template_id": str(data["template_id"]) if data.get("template_id") else None,
        "condition_keys": sorted((data.get("conditions_json") or {}).keys()),
        "action_keys": sorted((data.get("actions_json") or {}).keys()),
        "explicit_email_count": len(explicit_emails or []),
    }


def _notification_template_audit_summary(
    template: models.NotificationTemplate | schemas.NotificationTemplateCreate | schemas.NotificationTemplateUpdate | None,
) -> dict:
    if not template:
        return {}
    if isinstance(template, (schemas.NotificationTemplateCreate, schemas.NotificationTemplateUpdate)):
        data = template.model_dump(exclude_unset=True)
    else:
        data = {
            "key": template.key,
            "nombre": template.nombre,
            "channel": template.channel,
            "enabled": template.enabled,
            "version": template.version,
            "subject_template": template.subject_template,
            "text_template": template.text_template,
            "html_template": template.html_template,
            "allowed_variables": list(template.allowed_variables or []),
        }
    return {
        "key": data.get("key"),
        "nombre": data.get("nombre"),
        "channel": data.get("channel"),
        "enabled": data.get("enabled"),
        "version": data.get("version"),
        "has_subject": data.get("subject_template") is not None,
        "has_html": bool(data.get("html_template")),
        "text_template_length": len(data.get("text_template") or "") if "text_template" in data else None,
        "allowed_variables": data.get("allowed_variables"),
    }


def _require_explicit_notification_audit(current_user: models.Usuario):
    if not auth.has_explicit_capability_permission(current_user, "notificaciones.auditoria", "read"):
        raise HTTPException(
            status_code=403,
            detail="La auditoria global de notificaciones requiere permiso explicito",
        )

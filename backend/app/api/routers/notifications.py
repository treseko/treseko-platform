from fastapi import APIRouter
from typing import Annotated

from ...main_context import *
from ...services.error_sanitizer import sanitize_external_error
from ...services.edition.entitlement_service import require_feature
from ...services.notifications import digest_service
from ...services.notifications.email_sender import test_smtp_connection


router = APIRouter(tags=["Notificaciones"], dependencies=[Depends(require_feature("notifications.email"))])


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


@router.get("/notifications/email/config/", response_model=schemas.EmailSmtpConfig)
async def read_email_config(
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.configuracion", "read")),
):
    return await notification_config_service.get_email_smtp_config(db)

@router.patch("/notifications/email/config/", response_model=schemas.EmailSmtpConfig)
async def update_email_config(
    request: Request,
    payload: schemas.EmailSmtpConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.configuracion", "edit")),
):
    previous = await notification_config_service.get_email_smtp_config(db)
    updated = await notification_config_service.update_email_smtp_config(db, payload)
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE",
        recurso="notification_email_config",
        detalles={"old_value": previous, "new_value": updated},
        ip_address=_client_ip(request),
    )
    return updated

@router.post("/notifications/email/test/")
async def send_test_email(
    payload: schemas.EmailTestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.configuracion", "edit")),
):
    config_public = await notification_config_service.get_email_smtp_config(db)
    config = notification_config_service.smtp_config_with_secret(config_public)
    if config.get("test_mode") and payload.to.strip().lower() != str(current_user.email or "").strip().lower():
        raise HTTPException(status_code=422, detail="En modo de prueba el correo sólo puede enviarse al email verificado del administrador")
    delivery = models.NotificationDelivery(
        channel="email",
        recipient_user_id=current_user.id,
        recipient_email=payload.to,
        subject="[QA] Prueba de correo SMTP",
        body_text="Este es un correo de prueba de Treseko.",
        status="PENDING",
        max_attempts=int(config.get("max_attempts") or 5),
        metadata_json={"test": True},
    )
    db.add(delivery)
    await db.flush()
    try:
        await send_smtp_email(config, {"to": [payload.to], "subject": delivery.subject, "text_body": delivery.body_text})
        delivery.status = "SENT"
        delivery.sent_at = utc_now()
        await db.commit()
        return {"ok": True, "delivery_id": str(delivery.id)}
    except Exception as exc:
        safe_error = sanitize_external_error(exc)
        delivery.status = "FAILED"
        delivery.error = safe_error
        delivery.attempt_count = 1
        await db.commit()
        raise HTTPException(status_code=422, detail=safe_error)


@router.post("/notifications/email/connection-test/")
async def test_email_connection(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.configuracion", "edit")),
):
    """Check the configured SMTP transport without sending any email."""
    config = notification_config_service.smtp_config_with_secret(await notification_config_service.get_email_smtp_config(db))
    try:
        await test_smtp_connection(config)
    except Exception as exc:
        safe_error = sanitize_external_error(exc)
        await crud.create_audit_log(
            db=db, usuario_id=current_user.id, accion="TEST_FAILED", recurso="notification_email_connection",
            detalles={"success": False, "error": safe_error}, ip_address=_client_ip(request),
        )
        raise HTTPException(status_code=422, detail=safe_error)
    await crud.create_audit_log(
        db=db, usuario_id=current_user.id, accion="TEST", recurso="notification_email_connection",
        detalles={"success": True}, ip_address=_client_ip(request),
    )
    return {"ok": True}


@router.get("/proyectos/{proyecto_id}/notification-stakeholders/", response_model=List[schemas.NotificationStakeholderResponse])
async def list_notification_stakeholders(
    proyecto_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.destinatarios", "read")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "read")
    result = await db.execute(
        select(models.NotificationStakeholder)
        .filter(models.NotificationStakeholder.proyecto_id == proyecto_id)
        .order_by(models.NotificationStakeholder.active.desc(), models.NotificationStakeholder.nombre.asc())
    )
    return result.scalars().all()


@router.post("/proyectos/{proyecto_id}/notification-stakeholders/", response_model=schemas.NotificationStakeholderResponse)
async def create_notification_stakeholder(
    request: Request,
    proyecto_id: UUID,
    payload: schemas.NotificationStakeholderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.destinatarios", "edit")),
):
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    existing = await db.execute(
        select(models.NotificationStakeholder).filter(
            models.NotificationStakeholder.proyecto_id == proyecto_id,
            models.NotificationStakeholder.email == payload.email.lower(),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="El destinatario externo ya existe para este proyecto")
    stakeholder = models.NotificationStakeholder(
        proyecto_id=proyecto_id,
        nombre=payload.nombre.strip(),
        email=payload.email.lower(),
        allowed_event_types=payload.allowed_event_types,
        consent_source=payload.consent_source.strip(),
        created_by=current_user.id,
    )
    db.add(stakeholder)
    await db.commit()
    await db.refresh(stakeholder)
    await crud.create_audit_log(
        db=db, usuario_id=current_user.id, accion="CREATE", recurso="notification_stakeholder", recurso_id=stakeholder.id,
        detalles={"proyecto_id": str(proyecto_id), "email": stakeholder.email, "event_types": stakeholder.allowed_event_types}, ip_address=_client_ip(request),
    )
    return stakeholder


@router.patch("/notification-stakeholders/{stakeholder_id}/", response_model=schemas.NotificationStakeholderResponse)
async def update_notification_stakeholder(
    request: Request,
    stakeholder_id: UUID,
    payload: schemas.NotificationStakeholderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.destinatarios", "edit")),
):
    stakeholder = (await db.execute(select(models.NotificationStakeholder).filter(models.NotificationStakeholder.id == stakeholder_id))).scalar_one_or_none()
    if not stakeholder:
        raise HTTPException(status_code=404, detail="Destinatario externo no encontrado")
    await access_control.require_project_access(db, current_user, stakeholder.proyecto_id, "edit")
    previous = {"active": stakeholder.active, "event_types": list(stakeholder.allowed_event_types or [])}
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(stakeholder, key, value)
    if payload.active is False:
        stakeholder.deactivated_at = utc_now()
    elif payload.active is True:
        stakeholder.deactivated_at = None
    await db.commit()
    await crud.create_audit_log(
        db=db, usuario_id=current_user.id, accion="UPDATE", recurso="notification_stakeholder", recurso_id=stakeholder.id,
        detalles={"old_value": previous, "new_active": stakeholder.active, "event_types": stakeholder.allowed_event_types}, ip_address=_client_ip(request),
    )
    return stakeholder


@router.put("/notification-stakeholders/{stakeholder_id}/subscription/", response_model=schemas.NotificationSubscriptionResponse)
async def save_stakeholder_subscription(
    request: Request,
    stakeholder_id: UUID,
    payload: schemas.NotificationSubscriptionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.destinatarios", "edit")),
):
    stakeholder = (await db.execute(select(models.NotificationStakeholder).filter(models.NotificationStakeholder.id == stakeholder_id))).scalar_one_or_none()
    if not stakeholder:
        raise HTTPException(status_code=404, detail="Destinatario externo no encontrado")
    await access_control.require_project_access(db, current_user, stakeholder.proyecto_id, "edit")
    result = await db.execute(
        select(models.NotificationRecipientSubscription).filter(
            models.NotificationRecipientSubscription.stakeholder_id == stakeholder_id,
            models.NotificationRecipientSubscription.event_type == payload.event_type,
            models.NotificationRecipientSubscription.channel == payload.channel,
        )
    )
    subscription = result.scalar_one_or_none()
    if not subscription:
        subscription = models.NotificationRecipientSubscription(stakeholder_id=stakeholder_id, proyecto_id=stakeholder.proyecto_id, **payload.model_dump())
        db.add(subscription)
    else:
        for key, value in payload.model_dump().items():
            setattr(subscription, key, value)
    await db.commit()
    await db.refresh(subscription)
    await crud.create_audit_log(
        db=db, usuario_id=current_user.id, accion="UPSERT", recurso="notification_subscription", recurso_id=subscription.id,
        detalles={"stakeholder_id": str(stakeholder_id), "frequency": subscription.frequency}, ip_address=_client_ip(request),
    )
    return subscription


@router.get("/users/me/notification-subscriptions/", response_model=List[schemas.NotificationSubscriptionResponse])
async def list_my_notification_subscriptions(
    proyecto_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.inbox", "read")),
):
    if proyecto_id:
        await access_control.require_project_access(db, current_user, proyecto_id, "read")
    query = select(models.NotificationRecipientSubscription).filter(models.NotificationRecipientSubscription.user_id == current_user.id)
    if proyecto_id:
        query = query.filter(models.NotificationRecipientSubscription.proyecto_id == proyecto_id)
    return (await db.execute(query.order_by(models.NotificationRecipientSubscription.updated_at.desc()))).scalars().all()


@router.put("/users/me/notification-subscriptions/", response_model=schemas.NotificationSubscriptionResponse)
async def save_my_notification_subscription(
    request: Request,
    proyecto_id: Optional[UUID],
    payload: schemas.NotificationSubscriptionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.inbox", "edit")),
):
    if proyecto_id:
        await access_control.require_project_access(db, current_user, proyecto_id, "read")
    result = await db.execute(select(models.NotificationRecipientSubscription).filter(
        models.NotificationRecipientSubscription.user_id == current_user.id,
        models.NotificationRecipientSubscription.proyecto_id == proyecto_id,
        models.NotificationRecipientSubscription.event_type == payload.event_type,
        models.NotificationRecipientSubscription.channel == payload.channel,
    ))
    subscription = result.scalar_one_or_none()
    if not subscription:
        subscription = models.NotificationRecipientSubscription(user_id=current_user.id, proyecto_id=proyecto_id, **payload.model_dump())
        db.add(subscription)
    else:
        for key, value in payload.model_dump().items():
            setattr(subscription, key, value)
    await db.commit()
    await db.refresh(subscription)
    await crud.create_audit_log(
        db=db, usuario_id=current_user.id, accion="UPSERT", recurso="notification_subscription", recurso_id=subscription.id,
        detalles={"self_service": True, "proyecto_id": str(proyecto_id) if proyecto_id else None, "frequency": subscription.frequency}, ip_address=_client_ip(request),
    )
    return subscription


@router.get("/notifications/digests/", response_model=List[schemas.NotificationDigestResponse])
async def list_notification_digests(
    proyecto_id: Optional[UUID] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.resumenes", "read")),
):
    if proyecto_id:
        await access_control.require_project_access(db, current_user, proyecto_id, "read")
    query = select(models.NotificationDigest)
    if proyecto_id:
        query = query.filter(models.NotificationDigest.proyecto_id == proyecto_id)
    elif not access_control.is_global_admin(current_user):
        query = query.join(
            models.ProyectoMiembro,
            models.ProyectoMiembro.proyecto_id == models.NotificationDigest.proyecto_id,
        ).filter(models.ProyectoMiembro.usuario_id == current_user.id)
    result = await db.execute(query.order_by(models.NotificationDigest.created_at.desc()).limit(limit))
    return result.scalars().all()


@router.post("/notifications/digests/process/")
async def process_notification_digests(
    force: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("notificaciones.admin", "edit")),
):
    return await digest_service.materialize_due_digests(db, force=force, limit=limit)

@router.get("/notifications/rules/", response_model=List[schemas.NotificationRuleResponse])
async def list_notification_rules(db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.reglas", "read"))):
    result = await db.execute(select(models.NotificationRule).order_by(models.NotificationRule.priority.asc()))
    return result.scalars().all()

@router.post("/notifications/rules/", response_model=schemas.NotificationRuleResponse)
async def create_notification_rule(request: Request, payload: schemas.NotificationRuleCreate, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.reglas", "edit"))):
    rule = models.NotificationRule(**payload.model_dump(), created_by=current_user.id)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="notification_rule",
        recurso_id=rule.id,
        detalles={"new_value": _notification_rule_audit_summary(rule)},
        ip_address=_client_ip(request),
    )
    return rule

@router.get("/notifications/rules/{rule_id}/", response_model=schemas.NotificationRuleResponse)
async def read_notification_rule(rule_id: UUID, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.reglas", "read"))):
    rule = (await db.execute(select(models.NotificationRule).filter(models.NotificationRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    return rule

@router.patch("/notifications/rules/{rule_id}/", response_model=schemas.NotificationRuleResponse)
async def update_notification_rule(request: Request, rule_id: UUID, payload: schemas.NotificationRuleUpdate, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.reglas", "edit"))):
    rule = (await db.execute(select(models.NotificationRule).filter(models.NotificationRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    previous = _notification_rule_audit_summary(rule)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    rule.updated_at = utc_now()
    await db.commit()
    await db.refresh(rule)
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE",
        recurso="notification_rule",
        recurso_id=rule.id,
        detalles={"old_value": previous, "new_value": _notification_rule_audit_summary(rule)},
        ip_address=_client_ip(request),
    )
    return rule

@router.delete("/notifications/rules/{rule_id}/")
async def delete_notification_rule(request: Request, rule_id: UUID, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.reglas", "edit"))):
    rule = (await db.execute(select(models.NotificationRule).filter(models.NotificationRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    previous = _notification_rule_audit_summary(rule)
    await db.delete(rule)
    await db.commit()
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="DELETE",
        recurso="notification_rule",
        recurso_id=rule_id,
        detalles={"old_value": previous},
        ip_address=_client_ip(request),
    )
    return {"ok": True}

@router.get("/notifications/templates/", response_model=List[schemas.NotificationTemplateResponse])
async def list_notification_templates(db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.plantillas", "read"))):
    result = await db.execute(select(models.NotificationTemplate).order_by(models.NotificationTemplate.key.asc()))
    return result.scalars().all()

@router.post("/notifications/templates/", response_model=schemas.NotificationTemplateResponse)
async def create_notification_template(request: Request, payload: schemas.NotificationTemplateCreate, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.plantillas", "edit"))):
    template = models.NotificationTemplate(**payload.model_dump(), created_by=current_user.id)
    db.add(template)
    await db.commit()
    await db.refresh(template)
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="notification_template",
        recurso_id=template.id,
        detalles={"new_value": _notification_template_audit_summary(template)},
        ip_address=_client_ip(request),
    )
    return template

@router.patch("/notifications/templates/{template_id}/", response_model=schemas.NotificationTemplateResponse)
async def update_notification_template(request: Request, template_id: UUID, payload: schemas.NotificationTemplateUpdate, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.plantillas", "edit"))):
    template = (await db.execute(select(models.NotificationTemplate).filter(models.NotificationTemplate.id == template_id))).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    previous = _notification_template_audit_summary(template)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(template, field, value)
    template.version = int(template.version or 1) + 1
    template.updated_at = utc_now()
    await db.commit()
    await db.refresh(template)
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="UPDATE",
        recurso="notification_template",
        recurso_id=template.id,
        detalles={"old_value": previous, "new_value": _notification_template_audit_summary(template)},
        ip_address=_client_ip(request),
    )
    return template

@router.post("/notifications/templates/{template_id}/preview/", response_model=schemas.NotificationTemplatePreviewResponse)
async def preview_notification_template(template_id: UUID, payload: schemas.NotificationTemplatePreviewRequest, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.plantillas", "read"))):
    template = (await db.execute(select(models.NotificationTemplate).filter(models.NotificationTemplate.id == template_id))).scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    return {"subject": render_text_template(template.subject_template, payload.context), "text": render_text_template(template.text_template, payload.context), "html": render_html_template(template.html_template, payload.context) if template.html_template else None}

@router.get("/notifications/inbox/", response_model=List[schemas.NotificationInboxResponse])
async def list_notification_inbox(limit: Annotated[int, Query(ge=1, le=100)] = 20, unread_only: bool = False, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.inbox", "read"))):
    query = (
        select(models.NotificationInbox, models.NotificationEvent, models.Usuario)
        .outerjoin(models.NotificationEvent, models.NotificationInbox.event_id == models.NotificationEvent.id)
        .outerjoin(models.Usuario, models.NotificationEvent.actor_user_id == models.Usuario.id)
        .filter(models.NotificationInbox.user_id == current_user.id)
    )
    if unread_only:
        query = query.filter(models.NotificationInbox.read_at.is_(None))
    result = await db.execute(query.order_by(models.NotificationInbox.created_at.desc()).limit(limit))
    return [_inbox_response(item, event, actor) for item, event, actor in result.all()]

@router.post("/notifications/inbox/{item_id}/read/")
async def mark_notification_read(item_id: UUID, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.inbox", "edit"))):
    item = (await db.execute(select(models.NotificationInbox).filter(models.NotificationInbox.id == item_id, models.NotificationInbox.user_id == current_user.id))).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Notificacion no encontrada")
    item.read_at = utc_now()
    await db.commit()
    return {"ok": True}

@router.post("/notifications/inbox/read-all/")
async def mark_all_notifications_read(db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.inbox", "edit"))):
    result = await db.execute(select(models.NotificationInbox).filter(models.NotificationInbox.user_id == current_user.id, models.NotificationInbox.read_at.is_(None)))
    for item in result.scalars().all():
        item.read_at = utc_now()
    await db.commit()
    return {"ok": True}

@router.get("/notifications/inbox/unread-count/")
async def notification_unread_count(db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.inbox", "read"))):
    result = await db.execute(select(models.NotificationInbox).filter(models.NotificationInbox.user_id == current_user.id, models.NotificationInbox.read_at.is_(None)))
    return {"count": len(result.scalars().all())}

@router.get("/users/me/notification-preferences/", response_model=List[schemas.NotificationPreferenceResponse])
async def list_my_notification_preferences(db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.inbox", "read"))):
    result = await db.execute(select(models.NotificationPreference).filter(models.NotificationPreference.user_id == current_user.id))
    return result.scalars().all()

@router.patch("/users/me/notification-preferences/", response_model=List[schemas.NotificationPreferenceResponse])
async def update_my_notification_preferences(payload: List[schemas.NotificationPreferenceUpdate], db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.inbox", "edit"))):
    if len(payload) > schemas.MAX_NOTIFICATION_PREFERENCES_BATCH:
        raise HTTPException(status_code=413, detail="Demasiadas preferencias en una sola solicitud")
    for item in payload:
        result = await db.execute(select(models.NotificationPreference).filter(models.NotificationPreference.user_id == current_user.id, models.NotificationPreference.event_type == item.event_type, models.NotificationPreference.channel == item.channel))
        pref = result.scalar_one_or_none()
        if not pref:
            pref = models.NotificationPreference(user_id=current_user.id, **item.model_dump())
            db.add(pref)
        else:
            for field, value in item.model_dump().items():
                setattr(pref, field, value)
            pref.updated_at = utc_now()
    await db.commit()
    result = await db.execute(select(models.NotificationPreference).filter(models.NotificationPreference.user_id == current_user.id))
    return result.scalars().all()

@router.get("/notifications/events/", response_model=List[schemas.NotificationEventResponse])
async def list_notification_events(limit: Annotated[int, Query(ge=1, le=500)] = 100, status_filter: Optional[str] = Query(default=None, alias="status"), db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.auditoria", "read"))):
    _require_explicit_notification_audit(current_user)
    query = select(models.NotificationEvent)
    if status_filter:
        query = query.filter(models.NotificationEvent.status == status_filter)
    result = await db.execute(query.order_by(models.NotificationEvent.created_at.desc()).limit(limit))
    return result.scalars().all()

@router.get("/notifications/deliveries/", response_model=List[schemas.NotificationDeliveryResponse])
async def list_notification_deliveries(limit: Annotated[int, Query(ge=1, le=500)] = 100, status_filter: Optional[str] = Query(default=None, alias="status"), db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.auditoria", "read"))):
    _require_explicit_notification_audit(current_user)
    query = select(models.NotificationDelivery)
    if status_filter:
        query = query.filter(models.NotificationDelivery.status == status_filter)
    result = await db.execute(query.order_by(models.NotificationDelivery.created_at.desc()).limit(limit))
    return result.scalars().all()

@router.get("/notifications/deliveries/{delivery_id}/", response_model=schemas.NotificationDeliveryResponse)
async def read_notification_delivery(delivery_id: UUID, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.auditoria", "read"))):
    _require_explicit_notification_audit(current_user)
    delivery = (await db.execute(select(models.NotificationDelivery).filter(models.NotificationDelivery.id == delivery_id))).scalar_one_or_none()
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery no encontrado")
    return delivery

@router.post("/notifications/deliveries/{delivery_id}/retry/")
async def retry_notification_delivery(delivery_id: UUID, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.admin", "edit"))):
    delivery = (await db.execute(select(models.NotificationDelivery).filter(models.NotificationDelivery.id == delivery_id))).scalar_one_or_none()
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery no encontrado")
    delivery.status = "PENDING"
    delivery.next_attempt_at = None
    delivery.error = None
    await db.commit()
    return {"ok": True}

@router.post("/notifications/process/")
async def process_notifications(limit: Annotated[int, Query(ge=1, le=200)] = 100, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(auth.check_capability("notificaciones.admin", "edit"))):
    return await notification_processor.process_outbox(db, limit=limit)

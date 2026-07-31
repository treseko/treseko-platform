from fastapi import APIRouter
from typing import Annotated

from ...main_context import *
from ...services.error_sanitizer import sanitize_external_error
from ...services.edition.entitlement_service import require_feature
from ...services.notifications import digest_service
from ...services.notifications.email_sender import test_smtp_connection

router = APIRouter(tags=["Notificaciones"], dependencies=[Depends(require_feature("notifications.email"))])

from .notifications_shared import (
    _inbox_response,
    _notification_rule_audit_summary,
    _notification_template_audit_summary,
    _require_explicit_notification_audit,
)

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

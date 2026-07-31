from fastapi import APIRouter
from typing import Annotated

from ...main_context import *
from ...services.error_sanitizer import sanitize_external_error
from ...services.edition.entitlement_service import require_feature
from ...services.notifications import digest_service
from ...services.notifications.email_sender import test_smtp_connection

router = APIRouter(tags=["Notificaciones"], dependencies=[Depends(require_feature("notifications.email"))])

from .notifications_shared import _client_ip

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
    payload: schemas.NotificationSubscriptionUpdate,
    proyecto_id: Optional[UUID] = None,
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

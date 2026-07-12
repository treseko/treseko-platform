# Notificaciones y Email V1

Treseko incluye una V1 event-driven para notificaciones internas y correo.

## Arquitectura

- Los módulos emiten eventos en `notification_events`.
- Las reglas en `notification_rules` deciden canales y destinatarios.
- Las entregas quedan en `notification_deliveries`.
- El inbox de usuario vive en `notification_inbox`.
- Las preferencias por usuario viven en `notification_preferences`.
- El envío SMTP se procesa desde outbox; los endpoints funcionales no envían correo directo.

## SMTP

La configuración no sensible se guarda en `AppSetting` con key `email_smtp_config`.

El password SMTP de V1 se lee desde `.env`:

```env
SMTP_PASSWORD=...
NOTIFICATIONS_PUBLIC_BASE_URL=http://localhost:5173
NOTIFICATIONS_DEFAULT_FROM_EMAIL=qa@example.com
```

No se devuelve el password al frontend. La API solo devuelve `password_configured`.

## Processor

Ejecutar manualmente:

```bash
cd backend
python scripts/process_notification_outbox.py --limit 100
```

También existe endpoint admin:

```http
POST /notifications/process/
```

## Semillas V1

En startup se aseguran reglas y plantillas base para bugs críticos, bug asignado, listo para retest, comentarios críticos, ejecuciones fallidas/bloqueadas, revisión IA requerida, motor IA no disponible, reportes/quality gate y usuario AD provisionado. Las preferencias personales se guardan en `notification_preferences`; el switch global de notificaciones internas usa una preferencia general `channel=in_app`.

La UI de Configuración permite administrar SMTP, activar/desactivar reglas, editar plantillas base, ajustar preferencias personales y reintentar/procesar entregas desde auditoría.

## Endpoints

- `GET/PATCH /notifications/email/config/`
- `POST /notifications/email/test/`
- `GET/POST/PATCH/DELETE /notifications/rules/`
- `GET/POST/PATCH /notifications/templates/`
- `POST /notifications/templates/{template_id}/preview/`
- `GET /notifications/inbox/`
- `POST /notifications/inbox/{item_id}/read/`
- `POST /notifications/inbox/read-all/`
- `GET /notifications/inbox/unread-count/`
- `GET/PATCH /users/me/notification-preferences/`
- `GET /notifications/events/`
- `GET /notifications/deliveries/`
- `POST /notifications/deliveries/{delivery_id}/retry/`

## Seguridad

- SMTP usa `smtplib`, `ssl`, `EmailMessage` y `asyncio.to_thread`.
- Las plantillas usan `string.Template.safe_substitute`.
- HTML se escapa con `html.escape`.
- No se ejecuta código en plantillas.
- Las rutas admin usan RBAC `notificaciones.*`.

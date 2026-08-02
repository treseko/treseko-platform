from fastapi import APIRouter
from ...main_context import *
from ...services.edition.entitlement_service import require_feature
from . import notifications_email, notifications_management
from .notifications_email import *
from .notifications_management import *
from .notifications_shared import _notification_rule_audit_summary, _notification_template_audit_summary

router = APIRouter(tags=["Notificaciones"], dependencies=[Depends(require_feature("notifications.email"))])
router.routes.extend(notifications_email.router.routes)
router.routes.extend(notifications_management.router.routes)

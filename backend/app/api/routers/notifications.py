from fastapi import APIRouter
from ...main_context import *
from ...services.edition.entitlement_service import require_feature
from . import notifications_email, notifications_management
from .notifications_email import *
from .notifications_management import *

router = APIRouter(tags=["Notificaciones"], dependencies=[Depends(require_feature("notifications.email"))])
router.routes.extend(notifications_email.router.routes)
router.routes.extend(notifications_management.router.routes)

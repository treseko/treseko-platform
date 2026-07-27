from .repository_context import *
from ..services.error_sanitizer import sanitize_external_error

async def get_scheduled_runs_proyecto(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.ScheduledRun)
        .filter(models.ScheduledRun.proyecto_id == proyecto_id)
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()

async def create_scheduled_run(db: AsyncSession, schedule: schemas.ScheduledRunCreate):
    db_schedule = models.ScheduledRun(**schedule.model_dump())
    db.add(db_schedule)
    await db.commit()
    await db.refresh(db_schedule)
    return db_schedule

# --- AUDIT LOG ---
MAX_AUDIT_DETAILS_BYTES = 64 * 1024
AUDIT_REDACTED_VALUE = "[redacted]"
AUDIT_SECRET_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "cookie",
    "password",
    "refresh_token",
    "secret",
    "set_cookie",
    "token",
}


def _audit_detail_key_is_secret(key: Any) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", "_", str(key or "").strip().lower()).strip("_")
    return normalized in AUDIT_SECRET_KEYS or normalized.endswith(("_api_key", "_password", "_secret", "_token"))


def _sanitize_audit_details(value: Any, *, depth: int = 0) -> Any:
    if depth > 8:
        return "[max-depth]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, str):
        return sanitize_external_error(value, max_len=1000)
    if isinstance(value, list):
        return [_sanitize_audit_details(item, depth=depth + 1) for item in value[:200]]
    if isinstance(value, dict):
        sanitized = {}
        for key, item in list(value.items())[:200]:
            safe_key = str(key)[:120]
            sanitized[safe_key] = AUDIT_REDACTED_VALUE if _audit_detail_key_is_secret(key) else _sanitize_audit_details(item, depth=depth + 1)
        return sanitized
    return sanitize_external_error(value, max_len=1000)


def _bounded_audit_details(value: Optional[dict]) -> dict:
    sanitized = _sanitize_audit_details(value or {})
    encoded = json.dumps(sanitized, ensure_ascii=False, default=str, separators=(",", ":")).encode("utf-8")
    if len(encoded) <= MAX_AUDIT_DETAILS_BYTES:
        return sanitized if isinstance(sanitized, dict) else {"value": sanitized}
    return {"truncated": True, "reason": "audit details exceeded size limit"}


async def create_audit_log(
    db: AsyncSession,
    usuario_id: Optional[UUID],
    accion: str,
    recurso: str,
    recurso_id: Optional[UUID] = None,
    detalles: Optional[dict] = None,
    ip_address: Optional[str] = None
):
    db_log = models.AuditLog(
        usuario_id=usuario_id,
        accion=accion,
        recurso=recurso,
        recurso_id=recurso_id,
        detalles=_bounded_audit_details(detalles),
        ip_address=ip_address
    )
    db.add(db_log)
    await db.commit()
    return db_log

async def get_audit_logs(db: AsyncSession, skip: int = 0, limit: int = 100, usuario_id: Optional[UUID] = None):
    query = select(models.AuditLog).order_by(models.AuditLog.fecha.desc())
    if usuario_id:
        query = query.filter(models.AuditLog.usuario_id == usuario_id)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()

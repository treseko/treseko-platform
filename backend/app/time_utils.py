from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.types import DateTime, TypeDecorator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def isoformat_utc(value: Optional[datetime]) -> Optional[str]:
    normalized = ensure_utc(value)
    return normalized.isoformat() if normalized else None


class UTCDateTime(TypeDecorator):
    impl = DateTime
    cache_ok = True

    def __init__(self, *args, **kwargs):
        kwargs["timezone"] = True
        super().__init__(*args, **kwargs)

    def process_bind_param(self, value, dialect):
        return ensure_utc(value)

    def process_result_value(self, value, dialect):
        return ensure_utc(value)

from __future__ import annotations

from pathlib import Path
from typing import Any


MISSING_ATTACHMENT_REASON = "Archivo no disponible en storage"


def attachment_storage_path(attachment: Any) -> str:
    return str(getattr(attachment, "storage_path", "") or "").strip()


def attachment_file_available(attachment: Any) -> bool:
    storage_path = attachment_storage_path(attachment)
    if not storage_path:
        return False
    return Path(storage_path).is_file()


def attachment_missing_reason(attachment: Any) -> str | None:
    return None if attachment_file_available(attachment) else MISSING_ATTACHMENT_REASON


def attachment_availability_dict(attachment: Any) -> dict[str, Any]:
    available = attachment_file_available(attachment)
    return {
        "available": available,
        "missing_reason": None if available else MISSING_ATTACHMENT_REASON,
    }

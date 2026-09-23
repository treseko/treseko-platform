from __future__ import annotations

from pathlib import Path
from typing import Any


MISSING_ATTACHMENT_REASON = "Archivo no disponible en storage"


def attachment_storage_path(attachment: Any) -> str:
    return str(getattr(attachment, "storage_path", "") or "").strip()


def _attachment_file_candidates(storage_path: str) -> list[Path]:
    """Return the persisted path plus a portable path for restored instances.

    Older installations persisted the absolute Docker path (``/app/app/static``)
    in the database. That path is valid on the source container but not after a
    restore into another runtime, even when the attachment was copied correctly.
    Keep the original path first and resolve the relative suffix against this
    backend's own static directory as a compatibility fallback.
    """
    original = Path(storage_path)
    candidates = [original]
    normalized = storage_path.replace("\\", "/")
    marker = "/static/"
    if marker in normalized:
        relative_suffix = normalized.split(marker, 1)[1]
        candidates.append(Path(__file__).resolve().parent / "static" / relative_suffix)
    return candidates


def attachment_file_available(attachment: Any) -> bool:
    storage_path = attachment_storage_path(attachment)
    if not storage_path:
        return False
    return any(candidate.is_file() for candidate in _attachment_file_candidates(storage_path))


def attachment_missing_reason(attachment: Any) -> str | None:
    return None if attachment_file_available(attachment) else MISSING_ATTACHMENT_REASON


def attachment_availability_dict(attachment: Any) -> dict[str, Any]:
    available = attachment_file_available(attachment)
    return {
        "available": available,
        "missing_reason": None if available else MISSING_ATTACHMENT_REASON,
    }

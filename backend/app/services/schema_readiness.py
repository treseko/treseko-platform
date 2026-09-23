"""Fail-closed admission for backend code that depends on migrated columns."""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from sqlalchemy import text

from ..database import engine

GOVERNED_MCP_CREDENTIAL_REVISION = "20260915_0058"
_SCHEMA_NOT_READY_MESSAGE = "Database schema is not ready"
_VERSION_RE = re.compile(r'^revision\s*=\s*[\"\']([^\"\']+)[\"\']', re.MULTILINE)
_PARENT_RE = re.compile(r'^down_revision\s*=\s*[\"\']([^\"\']+)[\"\']', re.MULTILINE)


class SchemaNotReadyError(RuntimeError):
    """Raised when the database cannot safely serve this backend release."""


@lru_cache(maxsize=1)
def _migration_heads() -> frozenset[str]:
    try:
        versions_dir = Path(__file__).resolve().parents[2] / "alembic" / "versions"
        revisions: dict[str, str | None] = {}
        for path in versions_dir.glob("*.py"):
            source = path.read_text(encoding="utf-8")
            revision = _VERSION_RE.search(source)
            if not revision:
                continue
            parent = _PARENT_RE.search(source)
            revisions[revision.group(1)] = parent.group(1) if parent else None
        if not revisions:
            raise RuntimeError("migration metadata is unavailable")
        parents = {parent for parent in revisions.values() if parent}
        heads = frozenset(revisions.keys() - parents)
        if not heads:
            raise RuntimeError("migration metadata has no head")
        return heads
    except Exception:  # noqa: BLE001 - import-time discovery must fail closed
        raise SchemaNotReadyError(_SCHEMA_NOT_READY_MESSAGE) from None


def _current_head() -> str:
    heads = _migration_heads()
    return next(iter(heads)) if len(heads) == 1 else ""


CURRENT_HEAD = _current_head()


async def ensure_schema_ready(database_engine=engine) -> str:
    """Verify the installed database revision before backend initialization.

    The MCP credential migration is the minimum safe revision because the
    application reads and writes its governed columns during startup and API
    requests. The current single Alembic head and this explicit governed
    revision are the only accepted states; unknown, missing, or ambiguous
    revision state fails closed.
    """
    try:
        async with database_engine.connect() as connection:
            result = await connection.execute(text("SELECT version_num FROM alembic_version"))
            revision = result.scalar_one_or_none()
    except Exception:  # noqa: BLE001 - schema readiness must fail closed
        raise SchemaNotReadyError(_SCHEMA_NOT_READY_MESSAGE) from None

    revision = str(revision).strip() if revision is not None else ""
    current_head = _current_head()
    allowed = (
        {current_head, GOVERNED_MCP_CREDENTIAL_REVISION}
        if current_head
        else set()
    )
    if not revision or revision not in allowed:
        raise SchemaNotReadyError(_SCHEMA_NOT_READY_MESSAGE)
    return revision

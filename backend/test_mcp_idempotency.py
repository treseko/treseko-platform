from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.mcp_idempotency import fingerprint, reserve


class _Savepoint:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


class _NewSession:
    def __init__(self):
        self.added = []

    def begin_nested(self):
        return _Savepoint()

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        return None


class _ExistingSession:
    def __init__(self, existing):
        self.existing = existing

    def begin_nested(self):
        raise AssertionError("the duplicate path must reach the constraint handler")

    async def scalar(self, _query):
        return self.existing


@pytest.mark.asyncio
async def test_reserve_creates_pending_project_scoped_reservation():
    project_id = uuid4()
    db = _NewSession()
    reservation, cached = await reserve(db, project_id, "same-key", fingerprint("tool", project_id, {"x": 1}))
    assert cached is None
    assert reservation.status == "PENDING"
    assert reservation.proyecto_id == project_id
    assert db.added == [reservation]


def test_fingerprint_changes_when_tool_or_arguments_change():
    project_id = uuid4()
    base = fingerprint("tool-a", project_id, {"value": 1})
    assert base == fingerprint("tool-a", project_id, {"value": 1})
    assert base != fingerprint("tool-b", project_id, {"value": 1})
    assert base != fingerprint("tool-a", project_id, {"value": 2})


@pytest.mark.asyncio
async def test_completed_reservation_replays_and_mismatch_is_rejected(monkeypatch):
    project_id = uuid4()
    fp = fingerprint("tool", project_id, {"value": 1})
    existing = SimpleNamespace(
        fingerprint=fp,
        status="COMPLETED",
        result_json={"created": "object-1"},
    )
    # Force the insert path to behave like a unique-constraint collision.
    class DuplicateSession(_ExistingSession):
        def begin_nested(self):
            return _DuplicateSavepoint()

    class _DuplicateSavepoint:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            from sqlalchemy.exc import IntegrityError
            raise IntegrityError("duplicate", {}, None)

    replay, cached = await reserve(DuplicateSession(existing), project_id, "same-key", fp)
    assert replay is existing
    assert cached == {"created": "object-1"}
    with pytest.raises(ValueError, match="otra operación"):
        await reserve(DuplicateSession(existing), project_id, "same-key", "different-fingerprint")

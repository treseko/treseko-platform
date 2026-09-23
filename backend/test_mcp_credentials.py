from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from fastapi import HTTPException

from app import crud, models, schemas  # noqa: E402
from app.api.routers import users  # noqa: E402


class FakeDb:
    def __init__(self, result=None, active_count=0):
        self.result = result
        self.active_count = active_count
        self.added = None
        self.committed = False
        self.refreshed = None
        self.statements = []

    async def execute(self, statement):
        self.statements.append(str(statement))
        if self.result is not None:
            return SimpleNamespace(scalar_one_or_none=lambda: self.result, scalars=lambda: SimpleNamespace(all=lambda: [self.result]))
        return SimpleNamespace(scalar=lambda: self.active_count, scalar_one_or_none=lambda: None)

    def add(self, item):
        self.added = item

    async def commit(self):
        self.committed = True

    async def refresh(self, item):
        self.refreshed = item


class PurposeAwareRevokeDb(FakeDb):
    def __init__(self, key):
        super().__init__()
        self.key = key

    async def execute(self, statement):
        self.statements.append(str(statement))
        purpose = next(
            value for name, value in statement.compile().params.items() if name.startswith("purpose")
        )
        result = self.key if purpose == self.key.purpose else None
        return SimpleNamespace(scalar_one_or_none=lambda: result)


async def test_mcp_credential_creation_sets_explicit_purpose_expiry_and_scopes():
    db = FakeDb()
    payload = schemas.McpApiKeyCreate(
        nombre="QA agent",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        scopes=["treseko.project.get"],
    )

    db_key, raw_key = await crud.create_mcp_api_key(db, uuid4(), payload)

    assert raw_key
    assert db_key.purpose == "mcp"
    assert db_key.expires_at == payload.expires_at
    assert db_key.scopes_json == ["treseko.project.get"]


async def test_mcp_lookup_requires_mcp_purpose_and_rejects_expired_credentials():
    db = FakeDb(result=None)
    result = await crud.get_user_by_mcp_api_key(db, "treseko_valid_secret")

    assert result is None
    assert any("purpose" in statement and "expires_at" in statement for statement in db.statements)


async def test_legacy_api_key_creation_remains_legacy_and_has_no_mcp_scope():
    db = FakeDb()
    db_key, _ = await crud.create_api_key(db, uuid4(), schemas.ApiKeyCreate(nombre="Reports"))

    assert db_key.purpose == "legacy"
    assert db_key.expires_at is None
    assert db_key.scopes_json == []


def test_api_key_schemas_never_expose_hash_or_secret():
    assert "key_hash" not in schemas.ApiKey.model_fields
    assert "api_key" in schemas.ApiKeyCreated.model_fields
    assert "key_hash" not in schemas.ApiKeyCreated.model_fields
    assert schemas.McpApiKey.model_fields["purpose"].default == "mcp"


async def test_expired_mcp_key_is_not_accepted_even_when_active():
    expired = SimpleNamespace(
        usuario_id=uuid4(),
        activo=True,
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    db = FakeDb(result=expired)
    assert await crud.get_user_by_mcp_api_key(db, "treseko_expired") is None


async def test_revoke_api_key_requires_explicit_purpose():
    with pytest.raises(TypeError):
        await crud.revoke_api_key(FakeDb(), uuid4(), uuid4())


@pytest.mark.parametrize("route_name, credential_purpose", [
    ("revoke_my_api_key", "mcp"),
    ("revoke_my_mcp_credential", "legacy"),
])
async def test_revoke_routes_cannot_revoke_opposite_credential_type(route_name, credential_purpose):
    user = SimpleNamespace(id=uuid4())
    key = SimpleNamespace(id=uuid4(), purpose=credential_purpose, activo=True)
    db = PurposeAwareRevokeDb(key)
    request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))

    original_audit = users.crud.create_audit_log
    users.crud.create_audit_log = lambda **kwargs: None
    try:
        with pytest.raises(HTTPException) as exc_info:
            await getattr(users, route_name)(request, key.id, db=db, current_user=user)
        assert getattr(exc_info.value, "status_code", None) == 404
        assert key.activo is True
    finally:
        users.crud.create_audit_log = original_audit


@pytest.mark.parametrize("purpose", ["legacy", "mcp"])
async def test_revoke_same_purpose_credential_still_works(purpose):
    key = SimpleNamespace(id=uuid4(), usuario_id=uuid4(), purpose=purpose, activo=True)
    db = PurposeAwareRevokeDb(key)

    result = await crud.revoke_api_key(db, key.usuario_id, key.id, purpose=purpose)

    assert result is key
    assert key.activo is False
    assert db.committed is True
    assert db.refreshed is key


async def run_checks():
    await test_mcp_credential_creation_sets_explicit_purpose_expiry_and_scopes()
    await test_mcp_lookup_requires_mcp_purpose_and_rejects_expired_credentials()
    await test_legacy_api_key_creation_remains_legacy_and_has_no_mcp_scope()
    test_api_key_schemas_never_expose_hash_or_secret()
    await test_expired_mcp_key_is_not_accepted_even_when_active()
    print("MCP credential checks OK")

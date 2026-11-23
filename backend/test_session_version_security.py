from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import auth, schemas
from app.api.routers import users


class _FakeDb:
    pass


@pytest.mark.asyncio
async def test_access_token_matches_current_session_version(monkeypatch):
    user = SimpleNamespace(email="user@example.com", session_version=4)

    async def fake_get_user_by_email(_db, email):
        assert email == user.email
        return user

    monkeypatch.setattr(auth.crud, "get_user_by_email", fake_get_user_by_email)
    token = auth.create_access_token({"sub": user.email, "sv": 4})

    assert await auth.get_current_user(db=_FakeDb(), token=token) is user


@pytest.mark.asyncio
async def test_password_reset_invalidates_existing_access_token(monkeypatch):
    user = SimpleNamespace(email="user@example.com", session_version=5)

    async def fake_get_user_by_email(_db, email):
        assert email == user.email
        return user

    monkeypatch.setattr(auth.crud, "get_user_by_email", fake_get_user_by_email)
    old_token = auth.create_access_token({"sub": user.email, "sv": 4})

    with pytest.raises(HTTPException) as exc_info:
        await auth.get_current_user(db=_FakeDb(), token=old_token)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_pre_migration_token_is_only_valid_before_first_invalidation(monkeypatch):
    user = SimpleNamespace(email="user@example.com", session_version=0)

    async def fake_get_user_by_email(_db, email):
        assert email == user.email
        return user

    monkeypatch.setattr(auth.crud, "get_user_by_email", fake_get_user_by_email)
    legacy_token = auth.create_access_token({"sub": user.email})

    assert await auth.get_current_user(db=_FakeDb(), token=legacy_token) is user
    user.session_version = 1
    with pytest.raises(HTTPException):
        await auth.get_current_user(db=_FakeDb(), token=legacy_token)


@pytest.mark.asyncio
async def test_password_change_returns_token_for_new_session_version(monkeypatch):
    user = SimpleNamespace(
        auth_provider="local",
        email="user@example.com",
        hashed_password="old-hash",
        session_version=0,
    )
    payload = schemas.UserPasswordChange(
        current_password="Current-password-123",
        new_password="New-password-456",
    )

    def fake_verify_password(password, _hashed_password):
        return password == payload.current_password

    async def fake_change_my_password(_db, current_user, new_hashed_password):
        assert current_user is user
        assert new_hashed_password == "new-hash"
        current_user.session_version += 1
        return schemas.UserPreferences(
            profile_settings={"security": {"force_password_change": False}},
        )

    async def fake_issue_auth_tokens(_db, current_user):
        assert current_user.session_version == 1
        return {
            "access_token": auth.create_access_token(
                {"sub": current_user.email, "sv": current_user.session_version}
            ),
            "token_type": "bearer",
            "expires_in": 3600,
            "session_timeout_minutes": 60,
        }

    async def fake_get_user_by_email(_db, email):
        assert email == user.email
        return user

    monkeypatch.setattr(users.auth, "verify_password", fake_verify_password)
    monkeypatch.setattr(users.auth, "get_password_hash", lambda _password: "new-hash")
    monkeypatch.setattr(users.crud, "change_my_password", fake_change_my_password)
    monkeypatch.setattr(users, "_issue_auth_tokens", fake_issue_auth_tokens)
    monkeypatch.setattr(auth.crud, "get_user_by_email", fake_get_user_by_email)

    response = await users.change_my_password(payload, db=_FakeDb(), current_user=user)

    assert response.profile_settings["security"]["force_password_change"] is False
    assert response.session_timeout_minutes == 60
    assert await auth.get_current_user(db=_FakeDb(), token=response.access_token) is user

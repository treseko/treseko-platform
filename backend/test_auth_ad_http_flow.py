"""Hermetic HTTP lifecycle for the governed AD/OIDC and LDAP contracts."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.routers import auth_ad as auth_ad_router
from app.api.routers import users_admin as users_admin_router
from app.main import app
from app.services.edition import entitlement_service
from test_api_project_http_flow import _create_admin, _login


async def _premium_features_enabled(*_args, **_kwargs) -> bool:
    return True


async def _ignore_audit(*_args, **_kwargs) -> None:
    """Keep the endpoint flow hermetic; audit persistence has its own suite."""


def test_admin_can_configure_and_exercise_ad_oidc_and_ldap_http_contracts(monkeypatch):
    email = f"ad-http-{uuid4().hex}@example.test"
    password = "AdHttpFlowPassword-2026!"
    _create_admin(email, password)

    async def fake_build_authorization_url(*_args, **_kwargs) -> str:
        return "https://identity.example.test/authorize?state=controlled"

    async def fake_handle_callback(*_args, **_kwargs):
        return "controlled-exchange", SimpleNamespace(id=uuid4())

    async def fake_consume_exchange_code(*_args, **_kwargs):
        return SimpleNamespace(id=uuid4(), email="directory.user@example.test")

    async def fake_issue_tokens(*_args, **_kwargs) -> dict[str, object]:
        return {"access_token": "controlled-ad-token", "token_type": "bearer", "expires_in": 900}

    async def fake_ldap_authenticate(_config, username: str, password_value: str) -> dict[str, object]:
        assert username == "directory.user"
        assert password_value == "DirectoryPassword-2026!"
        return {"email": "directory.user@example.test", "name": "Directory User", "groups": ["QA"]}

    async def fake_provision(*_args, **_kwargs):
        return SimpleNamespace(id=uuid4(), email="directory.user@example.test", auth_provider="ad")

    async def fake_find_user(*_args, **_kwargs) -> dict[str, object]:
        return {
            "email": "directory.user@example.test",
            "name": "Directory User",
            "preferred_username": "directory.user",
            "upn": "directory.user@example.test",
            "groups": ["QA"],
        }

    async def fake_search_users(*_args, **_kwargs) -> list[dict[str, object]]:
        return [await fake_find_user()]

    async def fake_sync(*_args, **_kwargs):
        return [
            SimpleNamespace(
                user_id=str(uuid4()),
                email="directory.user@example.test",
                status="updated",
                previous_email="directory.user@old.example.test",
                new_email="directory.user@example.test",
                previous_name="Directory User",
                new_name="Directory User",
                groups=["QA"],
                error=None,
            )
        ]

    monkeypatch.setattr(entitlement_service, "is_feature_enabled", _premium_features_enabled)
    monkeypatch.setattr(auth_ad_router, "is_feature_enabled", _premium_features_enabled)
    monkeypatch.setattr(auth_ad_router.oidc_service, "build_authorization_url", fake_build_authorization_url)
    monkeypatch.setattr(auth_ad_router.oidc_service, "handle_callback", fake_handle_callback)
    monkeypatch.setattr(auth_ad_router.oidc_service, "consume_exchange_code", fake_consume_exchange_code)
    monkeypatch.setattr(auth_ad_router.oidc_service, "provision_or_sync_user", fake_provision)
    monkeypatch.setattr(auth_ad_router.ldap_service, "authenticate", fake_ldap_authenticate)
    monkeypatch.setattr(auth_ad_router.ldap_service, "find_user", fake_find_user)
    monkeypatch.setattr(auth_ad_router.ldap_service, "search_users", fake_search_users)
    monkeypatch.setattr(users_admin_router.ldap_service, "find_user", fake_find_user)
    monkeypatch.setattr(users_admin_router.ldap_service, "search_users", fake_search_users)
    monkeypatch.setattr(users_admin_router.user_sync_service, "sync_ad_users", fake_sync)
    monkeypatch.setattr(auth_ad_router, "_issue_auth_tokens", fake_issue_tokens)
    monkeypatch.setattr(auth_ad_router.crud, "create_audit_log", _ignore_audit)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)

        public_before = client.get("/auth/ad/config/public/")
        assert public_before.status_code == 200, public_before.text

        configured = client.patch(
            "/auth/ad/config/",
            headers=headers,
            json={
                "enabled": True,
                "provider_label": "Treseko Directory",
                "mode": "ldap",
                "ldap_url": "ldaps://directory.example.test:636",
                "ldap_base_dn": "DC=example,DC=test",
                "allowed_domains": ["example.test"],
                "default_role": "TESTER",
            },
        )
        assert configured.status_code == 200, configured.text
        assert configured.json()["mode"] == "ldap"

        public_after = client.get("/auth/ad/config/public/")
        assert public_after.status_code == 200, public_after.text
        assert public_after.json()["enabled"] is True

        config_detail = client.get("/auth/ad/config/", headers=headers)
        assert config_detail.status_code == 200, config_detail.text
        assert config_detail.json()["ldap_base_dn"] == "DC=example,DC=test"

        tested = client.post("/auth/ad/test-config/", headers=headers)
        assert tested.status_code == 200, tested.text
        assert tested.json()["ok"] is True

        login_redirect = client.get("/auth/ad/login/", params={"return_to": "/projects"}, follow_redirects=False)
        assert login_redirect.status_code == 307
        assert login_redirect.headers["location"].startswith("https://identity.example.test/")

        callback_redirect = client.get(
            "/auth/ad/callback/",
            params={"code": "controlled-code", "state": "controlled-state"},
            follow_redirects=False,
        )
        assert callback_redirect.status_code == 307
        assert "ad_exchange_code=controlled-exchange" in callback_redirect.headers["location"]

        exchange = client.post("/auth/ad/exchange/", json={"code": "controlled-exchange"})
        assert exchange.status_code == 200, exchange.text
        assert exchange.json()["access_token"] == "controlled-ad-token"

        ldap_login = client.post(
            "/auth/ad/password-login/",
            json={"username": "directory.user", "password": "DirectoryPassword-2026!"},
        )
        assert ldap_login.status_code == 200, ldap_login.text
        assert ldap_login.json()["token_type"] == "bearer"

        lookup = client.post("/usuarios/ad/lookup/", headers=headers, json={"query": "directory.user", "limit": 8})
        assert lookup.status_code == 200, lookup.text
        assert lookup.json()["email"] == "directory.user@example.test"

        synchronized = client.post("/usuarios/ad/sync/", headers=headers, json={"deactivate_missing": False, "limit": 10})
        assert synchronized.status_code == 200, synchronized.text
        assert synchronized.json()["updated"] == 1

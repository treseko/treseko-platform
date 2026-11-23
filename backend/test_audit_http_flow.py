"""Hermetic HTTP contract for the advanced audit trail."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services.edition import entitlement_service
from test_api_project_http_flow import _create_admin, _login
from uuid import uuid4


async def _audit_enabled(*_args, **_kwargs) -> bool:
    return True


def test_admin_can_record_redacted_secret_reveal_and_read_audit_log(monkeypatch):
    """Secret reveal events must be auditable without persisting the secret."""
    monkeypatch.setattr(entitlement_service, "is_feature_enabled", _audit_enabled)
    suffix = uuid4().hex
    email = f"audit-{suffix}@example.test"
    password = "AuditFlowPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)
        recorded = client.post(
            "/audit/secret-reveals/",
            headers=headers,
            json={"variable": "qa_access_token", "context": "controlled_run"},
        )
        assert recorded.status_code == 200, recorded.text
        assert recorded.json() == {"ok": True}

        audit_log = client.get("/audit/logs/", headers=headers)
        assert audit_log.status_code == 200, audit_log.text
        matching = [item for item in audit_log.json() if item["accion"] == "SECRET_REVEAL"]
        assert matching
        assert matching[0]["detalles"]["variable"] == "qa_access_token"
        assert matching[0]["detalles"]["value"] == "[redacted]"
        assert matching[0]["origen"] == "http_client"

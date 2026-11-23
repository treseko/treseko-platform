"""Hermetic HTTP lifecycle for the Premium notifications feature.

Community gating is asserted in ``test_api_project_http_flow``.  This test
enables only the entitlement dependency in-process so that templates, rules,
preferences and inbox behaviour are exercised without SMTP credentials or a
networked license service.
"""

from __future__ import annotations

import json
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient

from app.api.routers import notifications as notifications_router
from app.database import DATABASE_URL, engine
from app.main import app
from app.services.edition import entitlement_service
from test_api_project_http_flow import _create_admin, _login


async def _notifications_enabled(*_args, **_kwargs) -> bool:
    return True


async def _smtp_send_succeeds(*_args, **_kwargs) -> None:
    """Keep the HTTP contract hermetic while exercising the sent-delivery path."""


async def _smtp_connection_succeeds(*_args, **_kwargs) -> None:
    """Avoid a real SMTP socket in the configuration lifecycle."""


def test_premium_notification_management_http_lifecycle(monkeypatch):
    monkeypatch.setattr(entitlement_service, "is_feature_enabled", _notifications_enabled)
    monkeypatch.setattr(notifications_router, "send_smtp_email", _smtp_send_succeeds)
    monkeypatch.setattr(notifications_router, "test_smtp_connection", _smtp_connection_succeeds)
    suffix = uuid4().hex
    email = f"notifications-{suffix}@example.test"
    password = "NotificationsPassword-2026!"
    _create_admin(email, password)

    with TestClient(app, raise_server_exceptions=False) as client:
        headers = _login(client, email, password)

        email_config = client.get("/notifications/email/config/", headers=headers)
        assert email_config.status_code == 200, email_config.text
        updated_email_config = client.patch(
            "/notifications/email/config/",
            headers=headers,
            json={
                "enabled": True,
                "host": "smtp.example.test",
                "port": 587,
                "use_starttls": True,
                "use_ssl": False,
                "from_email": email,
                "from_name": "Treseko integration test",
                "base_url": "https://qa.example.test",
                "test_mode": True,
            },
        )
        assert updated_email_config.status_code == 200, updated_email_config.text
        assert updated_email_config.json()["host"] == "smtp.example.test"
        connection_test = client.post("/notifications/email/connection-test/", headers=headers)
        assert connection_test.status_code == 200, connection_test.text
        sent_test = client.post("/notifications/email/test/", headers=headers, json={"to": email})
        assert sent_test.status_code == 200, sent_test.text
        delivery_id = sent_test.json()["delivery_id"]

        # Community allows a bounded organization inventory.  Reuse the
        # authenticated test scope when the broader integration suite created
        # it first, rather than making the notification contract order-bound.
        organizations = client.get("/organizaciones/", headers=headers)
        assert organizations.status_code == 200, organizations.text
        if organizations.json():
            organization_id = organizations.json()[0]["id"]
        else:
            organization = client.post(
                "/organizaciones/",
                headers=headers,
                json={"nombre": f"Notification organization {suffix}", "tipo": "Cliente"},
            )
            assert organization.status_code == 200, organization.text
            organization_id = organization.json()["id"]

        projects = client.get("/proyectos/", headers=headers)
        assert projects.status_code == 200, projects.text
        if projects.json():
            project_id = projects.json()[0]["id"]
        else:
            project = client.post(
                "/proyectos/",
                headers=headers,
                json={
                    "nombre": f"Notification project {suffix}",
                    "organizacion_id": organization_id,
                },
            )
            assert project.status_code == 200, project.text
            project_id = project.json()["id"]

        stakeholders = client.get(
            f"/proyectos/{project_id}/notification-stakeholders/", headers=headers
        )
        assert stakeholders.status_code == 200, stakeholders.text
        stakeholder = client.post(
            f"/proyectos/{project_id}/notification-stakeholders/",
            headers=headers,
            json={
                "nombre": "QA stakeholder",
                "email": f"stakeholder-{suffix}@example.test",
                "allowed_event_types": ["case.failed"],
                "consent_source": "integration-test",
            },
        )
        assert stakeholder.status_code == 200, stakeholder.text
        stakeholder_id = stakeholder.json()["id"]
        updated_stakeholder = client.patch(
            f"/notification-stakeholders/{stakeholder_id}/",
            headers=headers,
            json={"nombre": "QA stakeholder updated"},
        )
        assert updated_stakeholder.status_code == 200, updated_stakeholder.text
        stakeholder_subscription = client.put(
            f"/notification-stakeholders/{stakeholder_id}/subscription/",
            headers=headers,
            json={"event_type": "case.failed", "channel": "email", "frequency": "daily"},
        )
        assert stakeholder_subscription.status_code == 200, stakeholder_subscription.text

        digests = client.get("/notifications/digests/", headers=headers, params={"proyecto_id": project_id})
        assert digests.status_code == 200, digests.text
        processed_digests = client.post(
            "/notifications/digests/process/", headers=headers, params={"force": "true"}
        )
        assert processed_digests.status_code == 200, processed_digests.text

        preferences = client.patch(
            "/users/me/notification-preferences/",
            headers=headers,
            json=[{"event_type": "case.failed", "channel": "email", "enabled": True, "frequency": "immediate"}],
        )
        assert preferences.status_code == 200, preferences.text
        assert preferences.json()[0]["event_type"] == "case.failed"
        assert client.get("/users/me/notification-preferences/", headers=headers).status_code == 200

        subscription = client.put(
            "/users/me/notification-subscriptions/",
            headers=headers,
            json={"event_type": "case.failed", "channel": "email", "frequency": "daily", "send_hour": 8},
        )
        assert subscription.status_code == 200, subscription.text
        subscriptions = client.get("/users/me/notification-subscriptions/", headers=headers)
        assert subscriptions.status_code == 200, subscriptions.text
        assert subscription.json()["id"] in {item["id"] for item in subscriptions.json()}

        template = client.post(
            "/notifications/templates/",
            headers=headers,
            json={
                "key": f"qa-notification-{suffix}",
                "nombre": "QA notification template",
                "channel": "email",
                "subject_template": "Case ${case_code}",
                "text_template": "Result ${verdict}",
                "html_template": "<strong>${verdict}</strong>",
                "allowed_variables": ["case_code", "verdict"],
            },
        )
        assert template.status_code == 200, template.text
        template_id = template.json()["id"]
        templates = client.get("/notifications/templates/", headers=headers)
        assert templates.status_code == 200, templates.text
        assert template_id in {item["id"] for item in templates.json()}
        preview = client.post(
            f"/notifications/templates/{template_id}/preview/",
            headers=headers,
            json={"context": {"case_code": "TC-NOTIFY", "verdict": "FAILED"}},
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["subject"] == "Case TC-NOTIFY"
        updated_template = client.patch(
            f"/notifications/templates/{template_id}/", headers=headers, json={"nombre": "QA template v2"}
        )
        assert updated_template.status_code == 200, updated_template.text
        assert updated_template.json()["version"] == 2

        rule = client.post(
            "/notifications/rules/",
            headers=headers,
            json={
                "nombre": f"QA notification rule {suffix}",
                "event_types": ["case.failed"],
                "template_id": template_id,
                "recipient_strategy_json": {"explicit_emails": [f"notify-{suffix}@example.test"]},
            },
        )
        assert rule.status_code == 200, rule.text
        rule_id = rule.json()["id"]
        rules = client.get("/notifications/rules/", headers=headers)
        assert rules.status_code == 200, rules.text
        assert rule_id in {item["id"] for item in rules.json()}
        assert client.get(f"/notifications/rules/{rule_id}/", headers=headers).status_code == 200
        updated_rule = client.patch(
            f"/notifications/rules/{rule_id}/", headers=headers, json={"priority": 5, "enabled": False}
        )
        assert updated_rule.status_code == 200, updated_rule.text
        assert updated_rule.json()["priority"] == 5

        sync_database_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
        inbox_item_id = uuid4()
        with psycopg.connect(sync_database_url) as connection:
            user_id = connection.execute("SELECT id FROM usuarios WHERE email = %s", (email,)).fetchone()[0]
            connection.execute(
                """INSERT INTO notification_inbox
                    (id, user_id, title, message, severity, metadata_json)
                    VALUES (%s, %s, %s, %s, %s, %s::json)""",
                (inbox_item_id, user_id, "Controlled inbox event", "Read through HTTP contract.", "info", json.dumps({"source": "integration"})),
            )
        inbox = client.get("/notifications/inbox/", headers=headers)
        assert inbox.status_code == 200, inbox.text
        assert str(inbox_item_id) in {item["id"] for item in inbox.json()}
        marked_read = client.post(f"/notifications/inbox/{inbox_item_id}/read/", headers=headers)
        assert marked_read.status_code == 200, marked_read.text
        assert marked_read.json() == {"ok": True}
        unread = client.get("/notifications/inbox/unread-count/", headers=headers)
        assert unread.status_code == 200, unread.text
        assert client.post("/notifications/inbox/read-all/", headers=headers).status_code == 200

        # Global notification audit intentionally requires an explicit permission,
        # even for an ADMIN role.  Grant only that audited capability to validate
        # the public delivery/event views without weakening the production rule.
        with psycopg.connect(sync_database_url) as connection:
            connection.execute(
                "UPDATE usuarios SET permisos_detallados = %s::json WHERE email = %s",
                (json.dumps({"notificaciones.auditoria": "read"}), email),
            )
        audited_headers = _login(client, email, password)
        events = client.get("/notifications/events/", headers=audited_headers)
        assert events.status_code == 200, events.text
        deliveries = client.get("/notifications/deliveries/", headers=audited_headers, params={"limit": 500})
        assert deliveries.status_code == 200, deliveries.text
        assert delivery_id in {item["id"] for item in deliveries.json()}
        delivery = client.get(f"/notifications/deliveries/{delivery_id}/", headers=audited_headers)
        assert delivery.status_code == 200, delivery.text
        assert delivery.json()["id"] == delivery_id
        retried_delivery = client.post(
            f"/notifications/deliveries/{delivery_id}/retry/", headers=audited_headers
        )
        assert retried_delivery.status_code == 200, retried_delivery.text
        processed_notifications = client.post("/notifications/process/", headers=audited_headers)
        assert processed_notifications.status_code == 200, processed_notifications.text

        assert client.delete(f"/notifications/rules/{rule_id}/", headers=headers).status_code == 200
        client.portal.call(engine.dispose)

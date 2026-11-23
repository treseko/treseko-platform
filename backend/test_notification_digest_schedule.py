from datetime import datetime, timedelta, timezone

from app.services.notifications.digest_service import _digest_metrics, _event_summary, _period, _scheduled_at
from app.schema_sections.notifications import ALLOWED_NOTIFICATION_FREQUENCIES
from app.schema_sections.notifications import NotificationStakeholderCreate, NotificationSubscriptionUpdate


def test_digest_schedule():
    assert {"daily", "weekly", "monthly", "on_report_export", "on_build_closure", "on_project_closure"}.issubset(ALLOWED_NOTIFICATION_FREQUENCIES)
    boundary = datetime(2026, 7, 20, 0, 0, tzinfo=timezone.utc)
    scheduled = _scheduled_at("daily", boundary, timezone_name="America/Argentina/Buenos_Aires", send_hour=9)
    assert scheduled.hour == 12  # UTC-3 in July
    assert scheduled.utcoffset().total_seconds() == 0
    assert _scheduled_at("daily", boundary, timezone_name="not-a-timezone", send_hour=8).hour == 8


def test_daily_digest_window_uses_recipient_timezone():
    # 01:00 UTC is still the previous local day in Buenos Aires (UTC-3).
    start, end = _period("daily", datetime(2026, 7, 20, 1, 0, tzinfo=timezone.utc), timezone_name="America/Argentina/Buenos_Aires")
    assert start == datetime(2026, 7, 19, 3, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)


def test_digest_metrics_only_summarize_received_events():
    lines = _digest_metrics([
        {"event_type": "execution.failed", "severity": "critical", "actor": "Ana"},
        {"event_type": "bug.created", "severity": "info", "actor": "Bruno"},
    ])
    assert "Ejecuciones registradas: 1" in lines
    assert "Bugs reportados o actualizados: 1" in lines
    assert "Eventos críticos que requieren revisión: 1" in lines


def test_digest_event_summary_keeps_safe_build_label():
    class Event:
        event_type = "build.closed"
        severity = "info"
        payload_json = {"proyecto": {"nombre": "Proyecto QA"}, "build": {"nombre": "v2.4"}}
    summary = _event_summary(Event())
    assert summary["project_name"] == "Proyecto QA"
    assert summary["build_name"] == "v2.4"


def test_external_recipient_contract_normalizes_email_and_rejects_bad_frequency():
    stakeholder = NotificationStakeholderCreate(
        nombre="Product Owner",
        email="  Owner@Example.COM ",
        consent_source="Contrato de proyecto",
        allowed_event_types=["report.exported"],
    )
    assert stakeholder.email == "owner@example.com"
    try:
        NotificationSubscriptionUpdate(frequency="cada_minuto")
    except ValueError:
        pass
    else:
        raise AssertionError("La frecuencia no permitida debe rechazarse")


def test_subscription_contract_accepts_temporary_mute():
    until = datetime.now(timezone.utc) + timedelta(hours=2)
    subscription = NotificationSubscriptionUpdate(frequency="daily", muted_until=until)
    assert subscription.muted_until == until


def main():
    test_digest_schedule()
    print("Notification digest schedule checks OK")


if __name__ == "__main__":
    main()

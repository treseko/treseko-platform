from app.services.notifications import email_sender
from app.services.notifications import config_service
from app.schema_sections.config import EmailSmtpConfigUpdate


def test_platform_smtp_secret_does_not_reuse_generic_smtp_password(monkeypatch):
    monkeypatch.delenv("NOTIFICATIONS_SMTP_PASSWORD", raising=False)
    monkeypatch.delenv("NOTIFICATIONS_SMTP_PASSWORD_FILE", raising=False)
    monkeypatch.setenv("SMTP_PASSWORD", "license-only-secret")
    assert config_service._notification_smtp_password() == ""
    monkeypatch.setenv("NOTIFICATIONS_SMTP_PASSWORD", "platform-only-secret")
    assert config_service._notification_smtp_password() == "platform-only-secret"


def test_smtp_transport_rejects_ssl_and_starttls_together():
    try:
        EmailSmtpConfigUpdate(use_ssl=True, use_starttls=True)
    except ValueError:
        pass
    else:
        raise AssertionError("El transporte SMTP ambiguo debe rechazarse")


def test_smtp_config_rejects_unimplemented_provider():
    try:
        EmailSmtpConfigUpdate(provider="sendgrid")
    except ValueError:
        pass
    else:
        raise AssertionError("No debe aceptarse un proveedor sin adaptador implementado")


def test_fallback_html_accepts_only_safe_brand_logo_urls():
    safe = email_sender.platform_html_from_text("Resumen", "QA Empresa", "https://qa.example.com/static/branding/logo.png")
    assert 'src="https://qa.example.com/static/branding/logo.png"' in safe
    assert "QA Empresa" in safe
    unsafe = email_sender.platform_html_from_text("Resumen", "QA Empresa", "javascript:alert(1)")
    assert "javascript:" not in unsafe.lower()


def test_fallback_html_uses_validated_brand_colors_only():
    html = email_sender.platform_html_from_text("Resumen", "QA Empresa", primary_color="#123456", accent_color="#abcdef")
    assert "background:#123456" in html
    assert "border-bottom:4px solid #abcdef" in html
    safe = email_sender.platform_html_from_text("Resumen", "QA Empresa", primary_color="url(javascript:bad)")
    assert "javascript:" not in safe.lower()
    assert "background:#172033" in safe


def test_smtp_connection_does_not_send_an_email(monkeypatch):
    calls = []

    class FakeSmtp:
        def __init__(self, *_args, **_kwargs):
            pass
        def __enter__(self): return self
        def __exit__(self, *_args): return False
        def login(self, *_args): calls.append("login")
        def noop(self): calls.append("noop")
        def send_message(self, *_args): raise AssertionError("Una prueba de conexión no debe enviar correo")

    monkeypatch.setattr(email_sender.smtplib, "SMTP", FakeSmtp)
    assert email_sender._test_smtp_connection_sync({"host": "smtp.test", "port": 587, "username": "qa@test", "password": "secret"}) == {"ok": True}
    assert calls == ["login", "noop"]


def main():
    sent = []

    class FakeSmtp:
        def __init__(self, *_args, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def login(self, *_args):
            return None

        def send_message(self, message):
            sent.append(message)

    original_smtp = email_sender.smtplib.SMTP
    email_sender.smtplib.SMTP = FakeSmtp
    try:
        email_sender._send_smtp_sync(
            {
                "host": "smtp.test",
                "port": 25,
                "from_email": "noreply@treseko.com",
                "from_name": "Treseko",
                "use_starttls": False,
            },
            {"to": ["qa@treseko.com"], "subject": "Prueba", "text_body": "OK"},
        )
    finally:
        email_sender.smtplib.SMTP = original_smtp

    assert len(sent) == 1
    assert sent[0]["Date"]
    assert sent[0]["Message-ID"].endswith("@treseko.com>")
    assert sent[0].get_body(preferencelist=("html",)).get_content_type() == "text/html"
    assert "Treseko" in sent[0].get_body(preferencelist=("html",)).get_content()
    assert "javascript:" not in sent[0].get_body(preferencelist=("html",)).get_content().lower()
    print("Notification SMTP header checks OK")


if __name__ == "__main__":
    main()

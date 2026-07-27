import asyncio
import re
import smtplib
import ssl
from html import escape
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from typing import Any


HEADER_CONTROL_RE = re.compile(r"[\r\n]+")


def platform_html_from_text(text: Any, platform_name: Any = "Treseko", logo_url: Any = None, primary_color: Any = "#172033", accent_color: Any = "#1677ff") -> str:
    """Small table-based fallback accepted by Gmail and Outlook.

    User-supplied template HTML remains sanitised by template_renderer.  This
    fallback protects normal deliveries from being sent as text-only while
    avoiding remote CSS, scripts, tracking pixels or unsafe URL handling.
    """
    safe_name = escape(_clean_header_value(platform_name) or "Treseko")
    safe_text = escape(str(text or "")).replace("\n", "<br>")
    safe_logo = escape(str(logo_url or ""), quote=True)
    logo = (
        f'<img src="{safe_logo}" width="32" height="32" alt="" style="display:inline-block;vertical-align:middle;margin-right:10px;border:0">'
        if safe_logo.startswith(("https://", "http://")) else ""
    )
    primary = str(primary_color or "").strip().lower()
    accent = str(accent_color or "").strip().lower()
    if not re.fullmatch(r"#[0-9a-f]{6}", primary):
        primary = "#172033"
    if not re.fullmatch(r"#[0-9a-f]{6}", accent):
        accent = "#1677ff"
    return (
        f'<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:Arial,sans-serif;color:{primary}">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:24px"><tr><td align="center">'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #dbe3ee;border-radius:12px">'
        f'<tr><td style="padding:20px 24px;font-weight:700;font-size:18px;color:#fff;background:{primary};border-bottom:4px solid {accent}">{logo}{safe_name}</td></tr>'
        f'<tr><td style="padding:24px;font-size:16px;line-height:1.5">{safe_text}</td></tr>'
        '</table></td></tr></table></body></html>'
    )


def _clean_header_value(value: Any) -> str:
    return HEADER_CONTROL_RE.sub(" ", str(value or "")).strip()


def _clean_email_address(value: Any) -> str:
    address = str(value or "").strip()
    if not address or HEADER_CONTROL_RE.search(address) or "," in address or ";" in address:
        raise ValueError("Direccion de email invalida")
    parsed_name, parsed_email = parseaddr(address)
    if parsed_name or parsed_email.lower() != address.lower() or "@" not in parsed_email:
        raise ValueError("Direccion de email invalida")
    return parsed_email


def _send_smtp_sync(config: dict[str, Any], message: dict[str, Any]) -> dict[str, Any]:
    email = EmailMessage()
    email["Subject"] = _clean_header_value(message.get("subject"))
    from_email = _clean_email_address(config.get("from_email") or config.get("username") or "")
    from_name = _clean_header_value(config.get("from_name"))
    email["From"] = formataddr((from_name, from_email)) if from_name else from_email
    recipients = [_clean_email_address(item) for item in (message.get("to") or [])]
    if not recipients:
        raise ValueError("Direccion de email invalida")
    email["To"] = ", ".join(recipients)
    # Amavis and other SMTP relays can quarantine messages without these
    # RFC-required traceability headers as BAD-HEADER.  Generate them in the
    # backend so every delivery channel (outbox and SMTP test) is valid.
    email["Date"] = formatdate(localtime=False)
    email["Message-ID"] = make_msgid(domain=from_email.rsplit("@", 1)[-1])
    if config.get("reply_to"):
        email["Reply-To"] = _clean_email_address(config["reply_to"])

    email.set_content(message.get("text_body") or "")
    email.add_alternative(
        message.get("html_body") or platform_html_from_text(message.get("text_body"), config.get("from_name"), config.get("branding_logo_url"), config.get("branding_primary_color"), config.get("branding_accent_color")),
        subtype="html",
    )

    timeout = int(config.get("timeout_seconds") or 20)
    host = config["host"]
    port = int(config["port"])
    username = config.get("username")
    password = config.get("password")

    if config.get("use_ssl"):
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=timeout) as smtp:
            if username:
                smtp.login(username, password or "")
            smtp.send_message(email)
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as smtp:
            if config.get("use_starttls"):
                smtp.starttls(context=ssl.create_default_context())
            if username:
                smtp.login(username, password or "")
            smtp.send_message(email)

    return {"ok": True}


def _test_smtp_connection_sync(config: dict[str, Any]) -> dict[str, Any]:
    """Validate transport and authentication without creating an email."""
    timeout = int(config.get("timeout_seconds") or 20)
    host = str(config.get("host") or "").strip()
    port = int(config.get("port") or 0)
    if not host or not port:
        raise ValueError("Configurá host y puerto SMTP antes de probar la conexión")
    username = config.get("username")
    password = config.get("password")
    if config.get("use_ssl"):
        with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=timeout) as smtp:
            if username:
                smtp.login(username, password or "")
            smtp.noop()
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as smtp:
            if config.get("use_starttls"):
                smtp.starttls(context=ssl.create_default_context())
            if username:
                smtp.login(username, password or "")
            smtp.noop()
    return {"ok": True}


async def send_smtp_email(config: dict[str, Any], message: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(_send_smtp_sync, config, message)


async def test_smtp_connection(config: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(_test_smtp_connection_sync, config)

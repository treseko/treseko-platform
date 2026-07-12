import asyncio
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Any


HEADER_CONTROL_RE = re.compile(r"[\r\n]+")


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
    if config.get("reply_to"):
        email["Reply-To"] = _clean_email_address(config["reply_to"])

    email.set_content(message.get("text_body") or "")
    if message.get("html_body"):
        email.add_alternative(message["html_body"], subtype="html")

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


async def send_smtp_email(config: dict[str, Any], message: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(_send_smtp_sync, config, message)

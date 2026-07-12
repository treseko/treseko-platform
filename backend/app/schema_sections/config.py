from __future__ import annotations

import ipaddress
from email.utils import parseaddr
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from ..models import (
    AiReviewStatus,
    AutomationJobStatus,
    Criticidad,
    EstadoCaso,
    EstadoResultado,
    EstadoRun,
    ExecutionMode,
    Prioridad,
    Rol,
    TipoPrueba,
)


def _validate_plain_email(value: Optional[str], *, required: bool = False) -> Optional[str]:
    if value is None:
        if required:
            raise ValueError("Email requerido")
        return value
    email = value.strip()
    if not email:
        if required:
            raise ValueError("Email requerido")
        return ""
    if any(char in email for char in ("\r", "\n", "\t")) or len(email) > 320:
        raise ValueError("Email invalido")
    parsed_name, parsed_email = parseaddr(email)
    if parsed_name or parsed_email != email or email.count("@") != 1:
        raise ValueError("Email invalido")
    local, domain = email.rsplit("@", 1)
    if not local or not domain or "." not in domain or domain.startswith(".") or domain.endswith("."):
        raise ValueError("Email invalido")
    return email


def _validate_public_https_base_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    url = value.strip().rstrip("/")
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme.lower() != "https" or not parsed.netloc or not parsed.hostname:
        raise ValueError("La URL base debe ser HTTPS absoluta")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("La URL base no puede incluir credenciales, query ni fragmento")
    hostname = parsed.hostname.strip().lower()
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ValueError("La URL base no puede apuntar a localhost")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        raise ValueError("La URL base no puede apuntar a una direccion privada o local")
    return url

class AuthSessionConfig(BaseModel):
    session_timeout_minutes: int = Field(default=480, ge=15, le=43200)

class EmailSmtpConfig(BaseModel):
    enabled: bool = False
    host: str = Field(default="", max_length=255)
    port: int = Field(default=587, ge=1, le=65535)
    use_starttls: bool = True
    use_ssl: bool = False
    username: Optional[str] = Field(default=None, max_length=255)
    from_email: str = Field(default="", max_length=320)
    from_name: str = Field(default="Treseko", max_length=120)
    reply_to: Optional[str] = Field(default=None, max_length=320)
    timeout_seconds: int = Field(default=20, ge=1, le=120)
    max_attempts: int = Field(default=5, ge=1, le=20)
    default_locale: str = Field(default="es", max_length=10)
    base_url: str = Field(default="http://localhost:5173", max_length=500)
    password_configured: bool = False

class EmailSmtpConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    host: Optional[str] = Field(default=None, max_length=255)
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    use_starttls: Optional[bool] = None
    use_ssl: Optional[bool] = None
    username: Optional[str] = Field(default=None, max_length=255)
    from_email: Optional[str] = Field(default=None, max_length=320)
    from_name: Optional[str] = Field(default=None, max_length=120)
    reply_to: Optional[str] = Field(default=None, max_length=320)
    timeout_seconds: Optional[int] = Field(default=None, ge=1, le=120)
    max_attempts: Optional[int] = Field(default=None, ge=1, le=20)
    default_locale: Optional[str] = Field(default=None, max_length=10)
    base_url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("host", "username", "from_name", "default_locale")
    @classmethod
    def validate_no_header_control_chars(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        text = value.strip()
        if any(char in text for char in ("\r", "\n", "\t")):
            raise ValueError("El valor contiene caracteres no permitidos")
        return text

    @field_validator("from_email")
    @classmethod
    def validate_from_email(cls, value: Optional[str]) -> Optional[str]:
        return _validate_plain_email(value)

    @field_validator("reply_to")
    @classmethod
    def validate_reply_to(cls, value: Optional[str]) -> Optional[str]:
        return _validate_plain_email(value)

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: Optional[str]) -> Optional[str]:
        return _validate_public_https_base_url(value)

class EmailTestRequest(BaseModel):
    to: str = Field(min_length=1, max_length=320)

    @field_validator("to")
    @classmethod
    def validate_to(cls, value: str) -> str:
        return _validate_plain_email(value, required=True) or ""

from __future__ import annotations

import ipaddress
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from ..rbac_catalog import ALL_CAPABILITIES, CAPABILITY_LEVELS, CAPABILITY_TO_MODULE

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

MAX_PROFILE_SETTINGS_BYTES = 128 * 1024
MAX_PROJECT_THEME_OVERRIDES_BYTES = 64 * 1024
MAX_PREFERENCE_JSON_DEPTH = 8
MAX_PREFERENCE_DICT_KEYS = 500
MAX_PREFERENCE_LIST_ITEMS = 2000
MAX_PREFERENCE_KEY_LENGTH = 120
MAX_PREFERENCE_STRING_LENGTH = 4000
MAX_RBAC_MODULES = 50
MAX_RBAC_PERMISSIONS = 80
MAX_RBAC_CAPABILITIES = 250
MAX_ACTIVE_API_KEYS_PER_USER = 20
MAX_USER_EMAIL_LENGTH = 320
MAX_PERSONAL_THEME_LENGTH = 64
BUILTIN_PERSONAL_THEMES = {"system", "light", "dark", "pink-panther"}
PERSONAL_THEME_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


def validate_personal_theme_id(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    theme_id = value.strip()
    if not theme_id:
        raise ValueError("Tema personal no soportado")
    if len(theme_id) > MAX_PERSONAL_THEME_LENGTH or not PERSONAL_THEME_ID_PATTERN.match(theme_id):
        raise ValueError("Tema personal no soportado")
    return theme_id
MAX_USER_NAME_LENGTH = 160
MAX_USER_AUTH_PROVIDER_LENGTH = 30
MAX_USER_PASSWORD_LENGTH = 256
MAX_ROLE_NAME_LENGTH = 120
MAX_ROLE_DESCRIPTION_LENGTH = 1000
USER_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ALLOWED_AUTH_PROVIDERS = {"local", "ad", "oidc"}
LEGACY_RBAC_MODULES = {"clientes"}
SENSITIVE_PREFERENCE_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "cookie",
    "credential",
    "credentials",
    "password",
    "private_key",
    "refresh_token",
    "secret",
    "set_cookie",
    "token",
}


def _preference_payload_size(value: Dict[str, Any]) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _validate_preference_json_value(value: Any, *, depth: int = 0, label: str = "La configuracion de preferencias") -> None:
    if depth > MAX_PREFERENCE_JSON_DEPTH:
        raise ValueError(f"{label} excede la profundidad permitida")
    if value is None or isinstance(value, (bool, int, float)):
        return
    if isinstance(value, str):
        if len(value) > MAX_PREFERENCE_STRING_LENGTH:
            raise ValueError(f"{label} contiene un texto demasiado largo")
        return
    if isinstance(value, list):
        if len(value) > MAX_PREFERENCE_LIST_ITEMS:
            raise ValueError(f"{label} contiene demasiados elementos")
        for item in value:
            _validate_preference_json_value(item, depth=depth + 1, label=label)
        return
    if isinstance(value, dict):
        if len(value) > MAX_PREFERENCE_DICT_KEYS:
            raise ValueError(f"{label} contiene demasiadas claves")
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > MAX_PREFERENCE_KEY_LENGTH:
                raise ValueError(f"{label} contiene una clave invalida")
            normalized_key = re.sub(r"[^a-z0-9]+", "_", key.strip().lower()).strip("_")
            if normalized_key in SENSITIVE_PREFERENCE_KEYS or normalized_key.endswith((
                "_api_key",
                "_password",
                "_secret",
                "_token",
                "_cookie",
                "_credential",
                "_credentials",
                "_private_key",
            )):
                raise ValueError(f"{label} no puede contener secretos")
            _validate_preference_json_value(item, depth=depth + 1, label=label)
        return
    raise ValueError(f"{label} contiene un valor no soportado")


def validate_preference_json_payload(value: Optional[Dict[str, Any]], *, max_bytes: int, label: str) -> Optional[Dict[str, Any]]:
    if value is None:
        return value
    _validate_preference_json_value(value, label=label)
    if _preference_payload_size(value) > max_bytes:
        raise ValueError(f"{label} excede el tamano maximo permitido")
    return value


def _normalize_email(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    email = value.strip().lower()
    if not email or len(email) > MAX_USER_EMAIL_LENGTH or not USER_EMAIL_RE.fullmatch(email):
        raise ValueError("Email invalido")
    return email


def _validate_auth_provider(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    provider = value.strip().lower()
    if not provider or len(provider) > MAX_USER_AUTH_PROVIDER_LENGTH or provider not in ALLOWED_AUTH_PROVIDERS:
        raise ValueError("Proveedor de autenticacion invalido")
    return provider


def _validate_password(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    if len(value) < 8 or len(value) > MAX_USER_PASSWORD_LENGTH:
        raise ValueError("La contraseña debe tener entre 8 y 256 caracteres")
    if "\x00" in value:
        raise ValueError("La contraseña contiene caracteres invalidos")
    return value


def _validate_module_list(value: Optional[List[str]]) -> Optional[List[str]]:
    if value is None:
        return value
    if len(value) > MAX_RBAC_MODULES:
        raise ValueError("La lista de modulos es demasiado grande")
    normalized: list[str] = []
    seen: set[str] = set()
    known_modules = set(CAPABILITY_TO_MODULE.values()) | LEGACY_RBAC_MODULES
    for item in value:
        module = str(item or "").strip()
        if not module or len(module) > MAX_PREFERENCE_KEY_LENGTH or module not in known_modules:
            raise ValueError("Modulo RBAC invalido")
        if module not in seen:
            normalized.append(module)
            seen.add(module)
    return normalized


def _validate_permission_map(value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    if value is None:
        return value
    if len(value) > MAX_RBAC_PERMISSIONS:
        raise ValueError("El mapa de permisos es demasiado grande")
    known_modules = set(CAPABILITY_TO_MODULE.values()) | LEGACY_RBAC_MODULES
    normalized: dict[str, str] = {}
    for raw_key, raw_level in value.items():
        module = str(raw_key or "").strip()
        level = str(raw_level or "").strip().lower()
        if not module or len(module) > MAX_PREFERENCE_KEY_LENGTH or module not in known_modules:
            raise ValueError("Modulo RBAC invalido")
        if level not in CAPABILITY_LEVELS:
            raise ValueError("Nivel de permiso RBAC invalido")
        normalized[module] = level
    return normalized


def _validate_capability_map(value: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    if value is None:
        return value
    if len(value) > MAX_RBAC_CAPABILITIES:
        raise ValueError("El mapa de capacidades es demasiado grande")
    normalized: dict[str, str] = {}
    for raw_key, raw_level in value.items():
        capability = str(raw_key or "").strip()
        level = str(raw_level or "").strip().lower()
        if not capability or len(capability) > MAX_PREFERENCE_KEY_LENGTH or capability not in ALL_CAPABILITIES:
            raise ValueError("Capacidad RBAC invalida")
        if level not in CAPABILITY_LEVELS:
            raise ValueError("Nivel de capacidad RBAC invalido")
        normalized[capability] = level
    return normalized
